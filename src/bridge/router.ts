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
  for (const seg of segs) {
    await sendTextMessage(target.to_user_id, seg, {
      baseUrl: token.baseUrl,
      token: token.token,
      contextToken: target.context_token,
    });
  }
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
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const r = await client.session.messages({
        path: { id: sessionId },
        query: { directory: cfg.directory, limit: 20 },
      });
      const arr = unwrap<Array<{ info?: { id?: string; role?: string; time?: { completed?: number } }; parts?: Array<{ type?: string; text?: string }> }>>(r) || [];
      for (const m of arr) {
        if (
          m.info?.role === "assistant" &&
          m.info.time?.completed &&
          m.info.id &&
          !beforeMsgIds.has(m.info.id)
        ) {
			const text = (m.parts || [])
				.filter((p) => p.type === "text" && typeof p.text === "string")
				.map((p) => p.text)
				.filter((p): p is string => typeof p === "string")
				.join("\n")
				.trim();
          if (!text) return;
          const tgt = loadTarget();
          if (!tgt) {
            log.warn("watchAndPushAssistantReply: no target.json");
            return;
          }
          await sendChunked(token, tgt, text);
          log.info("pushed assistant reply", { sessionId, len: text.length });
          return;
        }
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
  "  /new [title]      create a new session in current workdir",
  "  /last             resend last assistant reply of current session",
  "  (anything else)   forwarded to OpenCode (prefix 'opencode:' is stripped)",
].join("\n");

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
      case "/new": {
        const title = args.join(" ").trim() || undefined;
        try {
          const r = await client.session.create({
            query: { directory: cfg.directory },
            body: title ? { title } : {},
          });
          const created = unwrap<{ id?: string; directory?: string; title?: string }>(r);
          if (!created?.id) {
            await sendChunked(token, liveTarget, "❌ /new: server returned no session id");
            return;
          }
          state.currentSessionId = created.id;
          if (created.directory) cfg.directory = created.directory;
          log.info("created new session", { sessionId: created.id, directory: cfg.directory, title });
          await sendChunked(
            token,
            liveTarget,
            `✅ New session: ${created.id}\n   ${created.title || title || "(untitled)"}\n   Workdir: ${cfg.directory}`,
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
