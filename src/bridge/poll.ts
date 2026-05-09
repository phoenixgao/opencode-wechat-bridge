import os from "node:os";
import { stateDir } from "../state/paths.js";
import { loadToken } from "../weixin/auth.js";
import { startMonitor } from "../weixin/monitor.js";
import { log } from "./logger.js";
import {
	defaultDbPath,
	handleInboundMessage,
	type OpencodeClient,
	type RouterConfig,
	type RouterState,
} from "./router.js";
import { loadTarget } from "./target.js";

export interface PollOptions {
	baseUrl?: string;
	directory?: string;
	inboundPrefix?: string;
	dbPath?: string;
}

async function buildClient(baseUrl: string): Promise<OpencodeClient> {
	// Client must NOT bake `directory`: /switch changes workdir at runtime, and a
	// baked default that no longer matches makes session.messages silently return [].
	const mod = await import("@opencode-ai/sdk/client");
	const create = (
		mod as { createOpencodeClient?: (a: { baseUrl: string }) => OpencodeClient }
	).createOpencodeClient;
	if (!create)
		throw new Error(
			"createOpencodeClient not found in @opencode-ai/sdk/client",
		);
	return create({ baseUrl });
}

export async function runPoll(opts: PollOptions = {}): Promise<number> {
	const token = loadToken(stateDir());
	if (!token) {
		log.error("poll: no token.json; run 'bind' first");
		return 70;
	}
	const target = loadTarget();

	const cfg: RouterConfig = {
		baseUrl:
			opts.baseUrl || process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096",
		directory: opts.directory || process.env.OPENCODE_DIRECTORY || os.homedir(),
		inboundPrefix:
			opts.inboundPrefix ||
			process.env.OPENCODE_WECHAT_INBOUND_PREFIX ||
			"[WeChat]",
		dbPath: opts.dbPath || defaultDbPath(),
	};
	const state: RouterState = { currentSessionId: null, lastSessionsList: [] };
	const seenMsgIds = new Set<string>();

	const client = await buildClient(cfg.baseUrl);
	log.info("poll: starting", {
		baseUrl: cfg.baseUrl,
		directory: cfg.directory,
		target: target?.to_user_id ?? "(unbound)",
	});

	const ac = new AbortController();
	const onSig = (sig: NodeJS.Signals) => {
		log.info(`received ${sig}; shutting down`);
		ac.abort();
	};
	process.once("SIGINT", onSig);
	process.once("SIGTERM", onSig);

	await startMonitor({
		baseUrl: token.baseUrl,
		token: token.token,
		storageDir: stateDir(),
		abortSignal: ac.signal,
		log: (msg) => log.info(msg),
		onMessage: async (msg) => {
			const msgId =
				msg.message_id !== undefined
					? String(msg.message_id)
					: msg.client_id !== undefined
						? String(msg.client_id)
						: undefined;
			if (msgId) {
				if (seenMsgIds.has(msgId)) {
					log.debug("dedup: skipping duplicate message", { msgId });
					return;
				}
				seenMsgIds.add(msgId);
				if (seenMsgIds.size > 1000) {
					const first = seenMsgIds.values().next().value;
					if (first) seenMsgIds.delete(first);
				}
			}
			try {
				await handleInboundMessage(msg, client, token, cfg, state);
			} catch (err) {
				log.error("handleInboundMessage threw", {
					err: (err as Error).message,
				});
			}
		},
	});

log.info("poll: monitor exited, shutting down");
  return 0;
}

export async function retryPollLoop(
  pollFn: () => Promise<number>,
  opts: { delay?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const delay = opts.delay ?? 2000;
  while (!opts.signal?.aborted) {
    try {
      const code = await pollFn();
      log.warn(`poll loop exited with code ${code}; restarting in ${delay}ms`);
    } catch (err) {
      log.error(`poll loop crashed`, { err: (err as Error).message });
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      if (opts.signal) {
        opts.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
      }
    });
  }
}
