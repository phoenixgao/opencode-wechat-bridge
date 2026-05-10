import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { TokenData } from "../weixin/auth.js";
import { sendTextMessage, splitText } from "../weixin/send.js";
import { log } from "./logger.js";
import {
  defaultDbPath,
  extractText,
  findSessionById,
  formatGroupedSessions,
  loadAllSessionsFromDisk,
  newestSession,
  parseSwitchArg,
  stripRoutingPrefix,
  type SessionRow,
} from "./sessions.js";
import { loadTarget, refreshContextToken, saveTarget, type Target } from "./target.js";

export interface RouterConfig {
  baseUrl: string;
  directory: string;
  inboundPrefix: string;
  dbPath: string;
}

export interface OpencodeClient {
  session: {
    list: (args: { query?: { directory?: string } }) => Promise<unknown>;
    messages: (args: { path: { id: string }; query?: { directory?: string; limit?: number } }) => Promise<unknown>;
    promptAsync: (args: {
      path: { id: string };
      query?: { directory?: string };
      body: { parts: Array<{ type: "text"; text: string }> };
    }) => Promise<unknown>;
    create: (args: {
      query?: { directory?: string };
      body?: { parentID?: string; title?: string };
    }) => Promise<unknown>;
  };
}

export interface RouterState {
  currentSessionId: string | null;
  lastSessionsList: string[];
}

function unwrap<T>(r: unknown): T {
  if (r && typeof r === "object" && "data" in r) return (r as { data: T }).data;
  return r as T;
}

async function sendChunked(token: TokenData, target: Target, text: string): Promise<void> {
  const segs = splitText(text, 1800);
  log.info("sendChunked: start", { toUser: target.to_user_id, segs: segs.length, totalLen: text.length });
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] ?? "";
    try {
      await sendTextMessage(target.to_user_id, seg, {
        baseUrl: token.baseUrl,
        token: token.token,
        contextToken: target.context_token,
      });
      log.info("sendChunked: seg ok", { idx: i + 1, of: segs.length, len: seg.length });
    } catch (err) {
      log.warn("sendChunked: seg FAILED", { idx: i + 1, of: segs.length, err: (err as Error).message });
      throw err;
    }
  }
  log.info("sendChunked: done", { toUser: target.to_user_id, segs: segs.length });
}

async function snapshotMessageIds(client: OpencodeClient, cfg: RouterConfig, sessionId: string): Promise<Set<string>> {
  try {
    const r = await client.session.messages({ path: { id: sessionId }, query: { directory: cfg.directory, limit: 50 } });
    const arr = unwrap<Array<{ info?: { id?: string } }>>(r) || [];
    return new Set(arr.map((m) => m.info?.id).filter((x): x is string => !!x));
  } catch (err) {
    log.warn("snapshotMessageIds failed", { err: (err as Error).message, sessionId });
    return new Set();
  }
}

async function watchAndPushAssistantReply(
  client: OpencodeClient,
  cfg: RouterConfig,
  sessionId: string,
  token: TokenData,
  beforeMsgIds: Set<string>,
): Promise<void> {
  log.info("watchAndPushAssistantReply: started", { sessionId, dir: cfg.directory, beforeCount: beforeMsgIds.size });
  const deadline = Date.now() + 5 * 60_000;
  let iteration = 0;
  while (Date.now() < deadline) {
    await sleep(2000);
    iteration++;
    try {
      const r = await client.session.messages({
        path: { id: sessionId },
        query: { directory: cfg.directory, limit: 20 },
      });
      const arr = unwrap<Array<{ id?: string; info?: { id?: string; role?: string; time?: { completed?: number } }; role?: string; time?: { created?: number; completed?: number }; parts?: Array<{ type?: string; text?: string }> }>>(r) || [];
      const summary = arr.map((m) => {
        const role = m.info?.role || m.role || "?";
        const id = (m.info?.id || m.id || "?").slice(0, 12);
        const done = !!(m.info?.time?.completed || m.time?.completed);
        const seen = beforeMsgIds.has(m.info?.id || m.id || "");
        return `${role[0]}:${id}${done ? "✓" : "·"}${seen ? "S" : ""}`;
      }).join(" ");
      if (iteration === 1 || iteration % 10 === 0) {
        log.info("watcher iter", { sessionId, iter: iteration, n: arr.length, msgs: summary });
      }
      for (const m of arr) {
        const msgRole = m.info?.role || m.role || "";
        const msgId = m.info?.id || m.id || "";
        const completed = m.info?.time?.completed || m.time?.completed;
        if (msgRole !== "assistant" || !msgId || beforeMsgIds.has(msgId)) continue;
        if (!completed) {
          if (iteration === 1) {
            log.info("watcher: new assistant msg, not yet completed", { sessionId, msgId });
          }
          continue;
        }
        log.info("watcher: new completed assistant msg", { sessionId, msgId });
        const text = (m.parts || [])
          .filter((p) => p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .filter((p): p is string => typeof p === "string")
          .join("\n")
          .trim();
        if (!text) {
          log.info("watcher: assistant msg has no text part, marking seen", { sessionId, msgId, partTypes: (m.parts || []).map((p) => p.type) });
          beforeMsgIds.add(msgId);
          continue;
        }
        beforeMsgIds.add(msgId);
        const tgt = loadTarget();
        if (!tgt) {
          log.warn("watchAndPushAssistantReply: no target.json");
          return;
        }
        await sendChunked(token, tgt, text);
        log.info("pushed assistant reply", { sessionId, len: text.length });
        return;
      }
    } catch (err) {
      log.warn("watchAndPushAssistantReply poll error", { err: (err as Error).message, sessionId });
    }
  }
  log.info("watchAndPushAssistantReply: timed out (no completed assistant reply in 5min)", { sessionId });
}

async function sendLastAssistant(
  client: OpencodeClient,
  cfg: RouterConfig,
  sessionId: string,
  token: TokenData,
  target: Target,
): Promise<void> {
  try {
    const r = await client.session.messages({ path: { id: sessionId }, query: { directory: cfg.directory, limit: 20 } });
    const arr = unwrap<Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }>>(r) || [];
    const last = [...arr].reverse().find((m) => m.info?.role === "assistant");
    if (!last) {
      await sendChunked(token, target, "(no assistant message in recent history)");
      return;
    }
			const text =
			  (last.parts || [])
				.filter((p) => p.type === "text" && typeof p.text === "string")
				.map((p) => p.text)
				.filter((p): p is string => typeof p === "string")
				.join("\n")
				.trim() || "(empty)";
    await sendChunked(token, target, text);
  } catch (err) {
    await sendChunked(token, target, `/last failed: ${(err as Error).message}`);
  }
}

async function resolveSessionId(
  client: OpencodeClient,
  cfg: RouterConfig,
  sessions: SessionRow[],
): Promise<{ sessionId: string | null; directory: string }> {
	try {
		const r = await client.session.list({ query: { directory: cfg.directory } });
		const arr = unwrap<Array<{ id?: string; directory?: string; time?: { created?: number; updated?: number } }>>(r) || [];
		if (arr.length > 0) {
			const newest = [...arr].sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))[0];
			if (newest?.id) {
				const onDisk = findSessionById(sessions, newest.id);
				return { sessionId: newest.id, directory: onDisk?.directory || newest.directory || cfg.directory };
			}
    }
	} catch (err) {
		log.debug("session.list failed, falling back to disk", { err: (err as Error).message });
	}
	const newest = newestSession(sessions);
	if (!newest) return { sessionId: null, directory: cfg.directory };
	return { sessionId: newest.id, directory: newest.directory };
}

const HELP_TEXT = [
  "Bridge commands:",
  "  /help, /?         this help",
  "  /status           bridge alive + current session + workdir",
  "  /current          current session id + workdir",
  "  /sessions [N]     recent sessions grouped by directory (default 10, max 30)",
  "  /switch <num|ses_xxx>   switch active session",
  "  /workdir <path>   set active workdir without creating a session",
  "  /new [title]      create a new session in current workdir",
  "  /new [title] --dir <path>   create a new session in path",
  "  /new <path> [title]        create a new session in path",
  "  /last             resend last assistant reply of current session",
  "  (anything else)   forwarded to OpenCode (prefix 'opencode:' is stripped)",
].join("\n");

function expandDirectory(input: string, currentDirectory: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  if (path.isAbsolute(input)) return input;
  return path.resolve(currentDirectory, input);
}

function looksLikeDirectoryArg(input: string | undefined): input is string {
  if (!input) return false;
  return input === "~" || input.startsWith("~/") || path.isAbsolute(input);
}

function parseNewArgs(args: string[], currentDirectory: string): { directory: string; title: string | undefined; error?: string } {
  const dirFlagIndex = args.indexOf("--dir");
  if (dirFlagIndex >= 0) {
    const dirValue = args[dirFlagIndex + 1];
    if (!dirValue) return { directory: currentDirectory, title: undefined, error: "/new --dir requires a path" };
    const title = args
      .filter((_, index) => index !== dirFlagIndex && index !== dirFlagIndex + 1)
      .join(" ")
      .trim() || undefined;
    return { directory: expandDirectory(dirValue, currentDirectory), title };
  }

  const [first, ...rest] = args;
  if (looksLikeDirectoryArg(first)) {
    const title = rest.join(" ").trim() || undefined;
    return { directory: expandDirectory(first, currentDirectory), title };
  }

  const title = args.join(" ").trim() || undefined;
  return { directory: currentDirectory, title };
}

export async function handleInboundMessage(
  raw: { from_user_id?: string; message_type?: number; context_token?: string; item_list?: Array<{ type?: number; text_item?: { text?: string } }> },
  client: OpencodeClient,
  token: TokenData,
  cfg: RouterConfig,
  state: RouterState,
): Promise<void> {
  if (raw.message_type !== 1) return;

  const target = loadTarget();
  if (!target) {
		if (!raw.from_user_id || !raw.context_token) {
			log.warn("inbound message but no target.json and missing pin data; ignoring");
			return;
		}
		saveTarget({
			to_user_id: raw.from_user_id,
			context_token: raw.context_token,
			lastSeenAt: new Date().toISOString(),
		});
	}
	const pinned = loadTarget();
	if (!pinned) return;
	if (raw.from_user_id !== pinned.to_user_id) {
		log.debug("inbound from non-pinned user; ignoring", { from: raw.from_user_id, pinned: pinned.to_user_id });
		return;
	}

	if (raw.context_token) {
		refreshContextToken(pinned.to_user_id, raw.context_token);
	}
	const liveTarget = loadTarget();
	if (!liveTarget) return;

	const text = extractText(raw);
	if (!text) return;
	log.info("inbound", { len: text.length, text: text.slice(0, 80), currentSessionId: state.currentSessionId });

	if (state.currentSessionId === null) {
		const sessions = loadAllSessionsFromDisk(cfg.dbPath, 100);
		const resolved = await resolveSessionId(client, cfg, sessions);
		state.currentSessionId = resolved.sessionId;
		cfg.directory = resolved.directory;
	}

  if (text.startsWith("/")) {
    log.debug("slash command detected", { cmd: text.split(/\s+/)[0] });
    const [cmd, ...args] = text.split(/\s+/);
    switch (cmd) {
      case "/help":
      case "/?":
        await sendChunked(token, liveTarget, HELP_TEXT);
        return;
      case "/status":
        await sendChunked(
          token,
          liveTarget,
          `OpenCode bridge alive. Session: ${state.currentSessionId ?? "(none)"}\nWorkdir: ${cfg.directory}`,
        );
        return;
      case "/current":
        await sendChunked(
          token,
          liveTarget,
          `Current session: ${state.currentSessionId ?? "(none)"}\nWorkdir: ${cfg.directory}`,
        );
        return;
      case "/sessions": {
        const n = Math.max(1, Math.min(30, Number(args[0]) || 10));
        const sessions = loadAllSessionsFromDisk(cfg.dbPath, 100);
        const { text: formatted, ids } = formatGroupedSessions(sessions, state.currentSessionId, n);
        state.lastSessionsList = ids;
        const reply = formatted
          ? `Recent sessions (▶ = current):\n\n${formatted}\n\nReply: /switch <num> or /switch ses_xxx`
          : "(no sessions found)";
        await sendChunked(token, liveTarget, reply);
        return;
      }
      case "/switch": {
        const parsed = parseSwitchArg(args[0], state.lastSessionsList);
        if ("error" in parsed) {
          await sendChunked(token, liveTarget, `❌ ${parsed.error}`);
          return;
        }
        const sessions = loadAllSessionsFromDisk(cfg.dbPath, 200);
        const found = findSessionById(sessions, parsed.sessionId);
        if (!found) {
          await sendChunked(token, liveTarget, `❌ session not found: ${parsed.sessionId}`);
          return;
        }
        state.currentSessionId = found.id;
        cfg.directory = found.directory;
        await sendChunked(
          token,
          liveTarget,
          `✅ Switched to: ${found.id}\n   ${found.title || "(untitled)"}\n   Workdir: ${found.directory}`,
        );
        return;
      }
      case "/workdir": {
        const rawDirectory = args[0];
        if (!rawDirectory) {
          await sendChunked(token, liveTarget, "❌ /workdir requires a path");
          return;
        }
        cfg.directory = expandDirectory(rawDirectory, cfg.directory);
        state.currentSessionId = null;
        await sendChunked(token, liveTarget, `✅ Workdir set to: ${cfg.directory}\n   Current session cleared. Use /new or /switch next.`);
        return;
      }
      case "/new": {
        const parsed = parseNewArgs(args, cfg.directory);
        if (parsed.error) {
          await sendChunked(token, liveTarget, `❌ ${parsed.error}`);
          return;
        }
        try {
          const r = await client.session.create({
            query: { directory: parsed.directory },
            body: parsed.title ? { title: parsed.title } : {},
          });
          const created = unwrap<{ id?: string; directory?: string; title?: string }>(r);
          if (!created?.id) {
            await sendChunked(token, liveTarget, "❌ /new: server returned no session id");
            return;
          }
          state.currentSessionId = created.id;
          cfg.directory = created.directory || parsed.directory;
          log.info("created new session", { sessionId: created.id, directory: cfg.directory, title: parsed.title });
          await sendChunked(
            token,
            liveTarget,
            `✅ New session: ${created.id}\n   ${created.title || parsed.title || "(untitled)"}\n   Workdir: ${cfg.directory}`,
          );
        } catch (err) {
          const msg = (err as Error).message;
          log.error("session.create failed", { err: msg });
          await sendChunked(token, liveTarget, `❌ /new failed: ${msg}`);
        }
        return;
      }
      case "/last": {
        if (!state.currentSessionId) {
          await sendChunked(token, liveTarget, "(no current session)");
          return;
        }
        await sendLastAssistant(client, cfg, state.currentSessionId, token, liveTarget);
        return;
      }
      default:
        await sendChunked(token, liveTarget, `unknown command: ${cmd}\n\n${HELP_TEXT}`);
        return;
    }
  }

  const stripped = stripRoutingPrefix(text).trim();
  if (!stripped) return;
  if (!state.currentSessionId) {
    await sendChunked(token, liveTarget, "(no active session; try /sessions then /switch <num>)");
    return;
  }

  const before = await snapshotMessageIds(client, cfg, state.currentSessionId);
  try {
    await client.session.promptAsync({
      path: { id: state.currentSessionId },
      query: { directory: cfg.directory },
      body: { parts: [{ type: "text", text: `${cfg.inboundPrefix} ${stripped}` }] },
    });
    log.info("forwarded to opencode", { sessionId: state.currentSessionId, len: stripped.length });
    void watchAndPushAssistantReply(client, cfg, state.currentSessionId, token, before);
  } catch (err) {
    const msg = (err as Error).message;
    log.error("forwardToOpenCode failed", { err: msg });
    await sendChunked(token, liveTarget, `❌ forward to OpenCode failed: ${msg}`);
  }
}

export { defaultDbPath };
