import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const startMonitor = vi.fn();
const createOpencodeClient = vi.fn(() => ({
	session: {
		list: vi.fn(),
		messages: vi.fn(),
		promptAsync: vi.fn(),
		create: vi.fn(),
	},
}));
const handleInboundMessage = vi.fn();


vi.mock("../src/weixin/auth.js", () => ({
	loadToken: vi.fn(() => ({ baseUrl: "http://127.0.0.1:1", token: "dummy-token" })),
}));

vi.mock("../src/weixin/monitor.js", () => ({
	startMonitor,
}));

vi.mock("../src/bridge/router.js", () => ({
	defaultDbPath: vi.fn(() => "db.sqlite"),
	handleInboundMessage,
}));

vi.mock("@opencode-ai/sdk/client", () => ({
	createOpencodeClient,
}));

let tmpDir: string;
let prevStateDir: string | undefined;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owc-poll-"));
	prevStateDir = process.env.OPENCODE_WECHAT_STATE_DIR;
	process.env.OPENCODE_WECHAT_STATE_DIR = tmpDir;
	startMonitor.mockReset();
	createOpencodeClient.mockClear();
	handleInboundMessage.mockReset();
});

afterEach(() => {
	if (prevStateDir === undefined) delete process.env.OPENCODE_WECHAT_STATE_DIR;
	else process.env.OPENCODE_WECHAT_STATE_DIR = prevStateDir;
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runPoll", () => {
	it("starts monitoring even when target.json is missing", async () => {
		startMonitor.mockResolvedValueOnce(undefined);

		const { runPoll } = await import("../src/bridge/poll.js");
		const code = await runPoll({ baseUrl: "http://127.0.0.1:4096", dbPath: path.join(tmpDir, "missing.db") });

		expect(code).toBe(0);
		expect(startMonitor).toHaveBeenCalledTimes(1);
		expect(createOpencodeClient).toHaveBeenCalledTimes(1);
	});
});
