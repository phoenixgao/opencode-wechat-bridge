#!/usr/bin/env node
/**
 * opencode-wechat CLI dispatcher.
 *
 * Subcommands:
 *   bind      QR-login a fresh WeChat account; writes token.json
 *   send <text>   Send a one-off text to the pinned target (uses token.json + target.json)
 *   status    Print current state (token presence, target presence, paths)
 *   poll      Run the implemented long-poll bridge loop
 *
 * No subcommand or `--help` prints usage.
 */
import { disconnectWechat } from "../state/disconnect.js";
import {
	appendPrivateLog,
	ensureStateDir,
	sentLogPath,
	targetPath,
	tokenPath,
} from "../state/paths.js";
import { formatWechatStatusText, getWechatStatus } from "../state/status.js";
import { loadToken } from "../weixin/auth.js";
import { sendTextMessage, splitText } from "../weixin/send.js";
import { loadTarget } from "./target.js";

function usage(): void {
	process.stderr.write(
		[
			"opencode-wechat <subcommand>",
			"",
			"  bind                 QR-login a fresh account",
			"  send <text>          send a text to the pinned WeChat target",
			"  status               print state summary",
			"  disconnect           remove token/target/sync-buf (preserves logs)",
			"  poll                 run the implemented bridge long-poll loop",
			"",
		].join("\n"),
	);
}

function logSent(entry: {
	to: string;
	len: number;
	source: string;
	ok: boolean;
	err?: string;
}): void {
	try {
		ensureStateDir();
		appendPrivateLog(sentLogPath(), `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
	} catch {
		/* non-fatal */
	}
}

async function cmdStatus(): Promise<number> {
	const s = getWechatStatus();
	process.stdout.write(`${formatWechatStatusText(s)}\n`);
	return s.bound ? 0 : 2;
}

async function cmdDisconnect(): Promise<number> {
	const r = disconnectWechat();
	if (r.removed.length === 0) {
		process.stdout.write(
			"disconnect: nothing to remove (already disconnected)\n",
		);
	} else {
		process.stdout.write(`disconnect: removed ${r.removed.join(", ")}\n`);
	}
	return 0;
}

async function cmdSend(args: string[]): Promise<number> {
	const text = args.join(" ").trim();
	if (!text) {
		process.stderr.write("send: empty text\n");
		return 64;
	}
	const t = loadToken(ensureStateDir());
	const tgt = loadTarget();
	if (!t) {
		process.stderr.write(`send: no token.json at ${tokenPath()}; run 'bind'\n`);
		return 70;
	}
	if (!tgt) {
		process.stderr.write(
			`send: no target.json at ${targetPath()}; have the user DM the bot once\n`,
		);
		return 70;
	}

	const segments = splitText(text, 1800);
	let sent = 0;
	try {
		for (const seg of segments) {
			await sendTextMessage(tgt.to_user_id, seg, {
				baseUrl: t.baseUrl,
				token: t.token,
				contextToken: tgt.context_token,
			});
			sent++;
		}
		logSent({
			to: tgt.to_user_id,
			len: text.length,
			source: "cli-send",
			ok: true,
		});
		process.stdout.write(
			`sent ${sent}/${segments.length} segment(s) to ${tgt.to_user_id}\n`,
		);
		return 0;
	} catch (err) {
		const msg = (err as Error).message;
		logSent({
			to: tgt.to_user_id,
			len: text.length,
			source: "cli-send",
			ok: false,
			err: msg,
		});
		process.stderr.write(
			`send failed after ${sent}/${segments.length}: ${msg}\n`,
		);
		return 1;
	}
}

async function cmdBind(): Promise<number> {
	// Phase 2 entrypoint - imported lazily so 'send' / 'status' don't pull qrcode-terminal at import time.
	const { runBind } = await import("./bind.js");
	return runBind();
}

async function cmdPoll(): Promise<number> {
  const { runPoll, retryPollLoop } = await import("./poll.js");
  await retryPollLoop(runPoll);
  return 0;
}

async function main(): Promise<void> {
	const [, , sub, ...rest] = process.argv;
	if (!sub || sub === "-h" || sub === "--help") {
		usage();
		process.exit(64);
	}

	let code = 0;
	switch (sub) {
		case "status":
			code = await cmdStatus();
			break;
		case "disconnect":
			code = await cmdDisconnect();
			break;
		case "send":
			code = await cmdSend(rest);
			break;
		case "bind":
			code = await cmdBind();
			break;
		case "poll":
			code = await cmdPoll();
			break;
		default:
			usage();
			code = 64;
	}
	process.exit(code);
}

main().catch((err) => {
	process.stderr.write(`fatal: ${(err as Error).stack || err}\n`);
	process.exit(1);
});
