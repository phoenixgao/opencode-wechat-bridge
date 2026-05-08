import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, type PluginInput, tool } from "@opencode-ai/plugin";
import { loadTarget } from "./bridge/target.js";
import {
	bridgeLogPath,
	bridgeMetaPath,
	bridgePidPath,
	ensureStateDir,
	opencodeBackendLogPath,
	opencodeBackendMetaPath,
	opencodeBackendPidPath,
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

function stopProcess(pid: number): void {
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// stale pid or insufficient permission; spawning a fresh process is still safe
	}
}

function readPidIfPresent(pidFile: string): number | null {
	if (!existsSync(pidFile)) return null;
	const existing = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
	return Number.isFinite(existing) ? existing : null;
}

type OpenCodeBackendEnv = {
	OPENCODE_WECHAT_OPENCODE_URL?: string;
	OPENCODE_WECHAT_OPENCODE_PORT?: string;
};

export function resolveOpenCodeBackendPort(env?: OpenCodeBackendEnv): string {
	return env?.OPENCODE_WECHAT_OPENCODE_PORT?.trim() || "4096";
}

export function resolveOpenCodeBackendUrl(env?: OpenCodeBackendEnv): string {
	const configuredUrl = env?.OPENCODE_WECHAT_OPENCODE_URL?.trim();
	if (configuredUrl) return new URL(configuredUrl).toString();
	return new URL(`http://127.0.0.1:${resolveOpenCodeBackendPort(env)}`).toString();
}

export function buildOpenCodeBackendSpawnArgs(port: string): string[] {
	return ["--port", port];
}

interface OpenCodeBackendMetadata {
	baseUrl?: string;
}

export function opencodeBackendMetadataMatchesEnv(
	metadata: OpenCodeBackendMetadata | null,
	env: OpenCodeBackendEnv,
): boolean {
	if (!metadata) return false;
	return metadata.baseUrl === resolveOpenCodeBackendUrl(env);
}

export function isLikelyOpenCodeBackendResponse(status: number, body: string): boolean {
	return status >= 200 && status < 300 && /opencode/i.test(body);
}

async function isOpenCodeBackendReachable(baseUrl: string): Promise<boolean> {
	try {
		const res = await fetch(baseUrl, { method: "GET" });
		const body = await res.text();
		return isLikelyOpenCodeBackendResponse(res.status, body);
	} catch {
		return false;
	}
}

function isLocalSpawnableBackendUrl(baseUrl: string): boolean {
	const url = new URL(baseUrl);
	return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

async function ensureOpenCodeBackendRunning(baseEnv?: NodeJS.ProcessEnv): Promise<string> {
	ensureStateDir();
	const backendUrl = resolveOpenCodeBackendUrl(baseEnv);

	if (await isOpenCodeBackendReachable(backendUrl)) return backendUrl;

	if (!isLocalSpawnableBackendUrl(backendUrl)) {
		throw new Error(`Configured OpenCode backend is not reachable at ${backendUrl}`);
	}

	const pidFile = opencodeBackendPidPath();
	const existing = readPidIfPresent(pidFile);
	if (existing && isAlive(existing)) stopProcess(existing);

	const logFd = openPrivateAppendFile(opencodeBackendLogPath());
	const port = new URL(backendUrl).port || resolveOpenCodeBackendPort(baseEnv);
	const child = spawn("opencode", buildOpenCodeBackendSpawnArgs(port), {
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: { ...baseEnv, OPENCODE_WECHAT_IS_MANAGED_BACKEND: "1" },
	});
	child.unref();

	const pid = child.pid ?? 0;
	writePrivateFile(pidFile, String(pid));
	writePrivateFile(opencodeBackendMetaPath(), JSON.stringify({ baseUrl: backendUrl }, null, 2));

	for (let i = 0; i < 20; i++) {
		if (await isOpenCodeBackendReachable(backendUrl)) return backendUrl;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	throw new Error(`OpenCode backend did not become reachable at ${backendUrl}`);
}

export function buildBridgeEnv(
	baseEnv?: NodeJS.ProcessEnv,
	input?: Partial<Pick<PluginInput, "serverUrl" | "directory">>,
	backendUrl = resolveOpenCodeBackendUrl(baseEnv),
): NodeJS.ProcessEnv {
	const env = { ...baseEnv };
	env.OPENCODE_BASE_URL = backendUrl;
	if (input?.directory) env.OPENCODE_DIRECTORY = input.directory;
	return env;
}

interface BridgeMetadata {
	baseUrl?: string;
	directory?: string;
	runtimeId?: string;
}

export function bridgeRuntimeId(runtimeCliPath = cliPath): string {
	const resolvedCliPath = path.resolve(runtimeCliPath);
	const stat = statSync(resolvedCliPath);
	return `${resolvedCliPath}:${stat.mtimeMs}:${stat.size}`;
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
	env: {
		OPENCODE_BASE_URL?: string;
		OPENCODE_DIRECTORY?: string;
		OPENCODE_WECHAT_BRIDGE_RUNTIME_ID?: string;
	},
): boolean {
	if (!metadata) return false;
	return (
		metadata.baseUrl === env.OPENCODE_BASE_URL &&
		metadata.directory === env.OPENCODE_DIRECTORY &&
		metadata.runtimeId === env.OPENCODE_WECHAT_BRIDGE_RUNTIME_ID
	);
}

async function ensureBridgeRunning(
	input?: Partial<Pick<PluginInput, "serverUrl" | "directory">>,
): Promise<{ spawned: boolean; pid: number }> {
	ensureStateDir();
	const backendUrl = await ensureOpenCodeBackendRunning(process.env);
	const env = buildBridgeEnv(process.env, input, backendUrl);
	env.OPENCODE_WECHAT_BRIDGE_RUNTIME_ID = bridgeRuntimeId();
	const pidFile = bridgePidPath();
	if (existsSync(pidFile)) {
		const existing = readPidIfPresent(pidFile);
		if (existing !== null && isAlive(existing)) {
			if (bridgeMetadataMatchesEnv(readBridgeMetadata(), env)) {
				return { spawned: false, pid: existing };
			}
			stopProcess(existing);
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
				runtimeId: env.OPENCODE_WECHAT_BRIDGE_RUNTIME_ID,
			},
			null,
			2,
		),
	);
	return { spawned: true, pid };
}

export function createWechatPlugin(
	startBridge: (input?: Partial<Pick<PluginInput, "serverUrl" | "directory">>) => Promise<{ spawned: boolean; pid: number }> = ensureBridgeRunning,
): Plugin {
	return async (input) => {
		if (!process.env.OPENCODE_WECHAT_IS_MANAGED_BACKEND) {
			void startBridge(input)
				.then((r) => {
					if (r.spawned) console.error(`[wechat-plugin] spawned bridge pid=${r.pid}`);
				})
				.catch((e) => {
					console.error(`[wechat-plugin] failed to spawn bridge:`, e);
				});
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
}

export const WechatPlugin = createWechatPlugin();

export default WechatPlugin;
