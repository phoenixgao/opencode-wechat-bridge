import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, type PluginInput, tool } from "@opencode-ai/plugin";
import { loadTarget } from "./bridge/target.js";
import {
	bridgeLogPath,
	bridgeMetaPath,
	bridgePidPath,
	ensureStateDir,
	openPrivateAppendFile,
	writePrivateFile,
} from "./state/paths.js";
import { loadToken } from "./weixin/auth.js";
import { sendTextMessage, splitText } from "./weixin/send.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "bridge", "cli.js");

export function resolveBridgeNodeExecutable(
	execPath: string,
	env?: { OPENCODE_WECHAT_NODE?: string },
): string {
	if (env?.OPENCODE_WECHAT_NODE) return env.OPENCODE_WECHAT_NODE;
	const base = path.basename(execPath).toLowerCase();
	if (base === "node" || base === "nodejs") return execPath;
	return "node";
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function stopBridge(pid: number): void {
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// stale pid or insufficient permission; spawning a fresh bridge is still safe
	}
}

export function buildBridgeEnv(
	baseEnv?: NodeJS.ProcessEnv,
	input?: Partial<Pick<PluginInput, "serverUrl" | "directory">>,
): NodeJS.ProcessEnv {
	const env = { ...baseEnv };
	if (input?.serverUrl) env.OPENCODE_BASE_URL = input.serverUrl.toString();
	if (input?.directory) env.OPENCODE_DIRECTORY = input.directory;
	return env;
}

interface BridgeMetadata {
	baseUrl?: string;
	directory?: string;
}

function readBridgeMetadata(): BridgeMetadata | null {
	try {
		const raw = readFileSync(bridgeMetaPath(), "utf8");
		const parsed = JSON.parse(raw) as BridgeMetadata;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

export function bridgeMetadataMatchesEnv(
	metadata: BridgeMetadata | null,
	env: { OPENCODE_BASE_URL?: string; OPENCODE_DIRECTORY?: string },
): boolean {
	if (!metadata) return false;
	return (
		metadata.baseUrl === env.OPENCODE_BASE_URL &&
		metadata.directory === env.OPENCODE_DIRECTORY
	);
}

function ensureBridgeRunning(
	input?: Partial<Pick<PluginInput, "serverUrl" | "directory">>,
): { spawned: boolean; pid: number } {
	ensureStateDir();
	const env = buildBridgeEnv(process.env, input);
	const pidFile = bridgePidPath();
  if (existsSync(pidFile)) {
    const existing = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
		if (Number.isFinite(existing) && isAlive(existing)) {
			if (bridgeMetadataMatchesEnv(readBridgeMetadata(), env)) {
				return { spawned: false, pid: existing };
			}
			stopBridge(existing);
		}
	}
	const logFd = openPrivateAppendFile(bridgeLogPath());
	const child = spawn(resolveBridgeNodeExecutable(process.execPath, process.env), [cliPath, "poll"], {
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env,
	});
	child.unref();
	const pid = child.pid ?? 0;
	writePrivateFile(pidFile, String(pid));
	writePrivateFile(
		bridgeMetaPath(),
		JSON.stringify(
			{
				baseUrl: env.OPENCODE_BASE_URL,
				directory: env.OPENCODE_DIRECTORY,
			},
			null,
			2,
		),
	);
	return { spawned: true, pid };
}

export const WechatPlugin: Plugin = async (input) => {
	try {
		const r = ensureBridgeRunning(input);
		if (r.spawned) console.error(`[wechat-plugin] spawned bridge pid=${r.pid}`);
	} catch (e) {
		console.error(`[wechat-plugin] failed to spawn bridge:`, e);
	}

	return {
		tool: {
			wechat_notify: tool({
				description:
					"Send a notification message to the user's WeChat. Use this when the user asked to be notified on WeChat (e.g. 'tell me on WeChat when done', '处理完了用微信通知我'). Long messages are split into ~1800-char chunks automatically.",
				args: {
					text: tool.schema
						.string()
						.min(1)
						.describe("Message body to send to the bound WeChat user"),
				},
			async execute(args): Promise<string> {
				const token = await loadToken(ensureStateDir());
					if (!token) {
						return "wechat_notify failed: no token bound. Run `opencode-wechat bind` first.";
					}
					const target = await loadTarget();
					if (!target) {
						return "wechat_notify failed: no target user bound. Send a WeChat message to the bot first so the bridge captures your user_id.";
					}
					const chunks = splitText(args.text, 1800);
					for (const chunk of chunks) {
						await sendTextMessage(target.to_user_id, chunk, {
							baseUrl: token.baseUrl,
							token: token.token,
							contextToken: target.context_token,
						});
					}
					return `Sent ${chunks.length} segment(s) to ${target.to_user_id}`;
				},
			}),
		},
	};
};

export default WechatPlugin;
