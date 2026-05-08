import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const saveTarget = vi.fn();
const refreshContextToken = vi.fn();
const loadTarget = vi.fn(() => null);
const extractText = vi.fn(() => "hello there");

vi.mock("../src/bridge/target.js", () => ({
	loadTarget,
	saveTarget,
	refreshContextToken,
}));

vi.mock("../src/bridge/sessions.js", () => ({
	defaultDbPath: vi.fn(() => "db.sqlite"),
	extractText,
	findSessionById: vi.fn(),
	formatGroupedSessions: vi.fn(),
	loadAllSessionsFromDisk: vi.fn(() => []),
	newestSession: vi.fn(),
	parseSwitchArg: vi.fn(),
	stripRoutingPrefix: vi.fn((text: string) => text),
}));

vi.mock("../src/bridge/logger.js", () => ({
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("../src/weixin/send.js", () => ({
	sendTextMessage: vi.fn(),
	splitText: vi.fn(() => ["ok"]),
}));

let tmpDir: string;
let prevStateDir: string | undefined;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owc-router-"));
	prevStateDir = process.env.OPENCODE_WECHAT_STATE_DIR;
	process.env.OPENCODE_WECHAT_STATE_DIR = tmpDir;
	saveTarget.mockReset();
	refreshContextToken.mockReset();
	loadTarget.mockReturnValue(null);
	extractText.mockReturnValue("hello there");
});

afterEach(() => {
	if (prevStateDir === undefined) delete process.env.OPENCODE_WECHAT_STATE_DIR;
	else process.env.OPENCODE_WECHAT_STATE_DIR = prevStateDir;
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleInboundMessage", () => {
	it("pins first inbound user when target.json is missing", async () => {
		const { handleInboundMessage } = await import("../src/bridge/router.js");
		const client = {
			session: {
				list: vi.fn(),
				messages: vi.fn(),
				promptAsync: vi.fn(),
				create: vi.fn(),
			},
		};

		await handleInboundMessage(
			{
				message_type: 1,
				from_user_id: "user-1",
				context_token: "ctx-1",
				item_list: [{ type: 1, text_item: { text: "hello there" } }],
			},
			client,
			{ baseUrl: "http://127.0.0.1:4096", token: "token-1", accountId: "acct", userId: "user", savedAt: "2026-01-01T00:00:00.000Z" },
			{ baseUrl: "http://127.0.0.1:4096", directory: "/repo", inboundPrefix: "[WeChat]", dbPath: "db.sqlite" },
			{ currentSessionId: null, lastSessionsList: [] },
		);

		expect(saveTarget).toHaveBeenCalledWith(
			expect.objectContaining({
				to_user_id: "user-1",
				context_token: "ctx-1",
			}),
		);
		expect(refreshContextToken).not.toHaveBeenCalled();
	});

	it("keeps ignoring non-pinned users when target exists", async () => {
		loadTarget.mockReturnValue({ to_user_id: "pinned-user", context_token: "ctx-0", lastSeenAt: "2026-01-01T00:00:00.000Z" } as never);
		const { handleInboundMessage } = await import("../src/bridge/router.js");
		const client = {
			session: {
				list: vi.fn(),
				messages: vi.fn(),
				promptAsync: vi.fn(),
				create: vi.fn(),
			},
		};

		await handleInboundMessage(
			{
				message_type: 1,
				from_user_id: "other-user",
				context_token: "ctx-new",
				item_list: [{ type: 1, text_item: { text: "hello there" } }],
			},
			client,
			{ baseUrl: "http://127.0.0.1:4096", token: "token-1", accountId: "acct", userId: "user", savedAt: "2026-01-01T00:00:00.000Z" },
			{ baseUrl: "http://127.0.0.1:4096", directory: "/repo", inboundPrefix: "[WeChat]", dbPath: "db.sqlite" },
			{ currentSessionId: null, lastSessionsList: [] },
		);

		expect(saveTarget).not.toHaveBeenCalled();
		expect(refreshContextToken).not.toHaveBeenCalled();
	});
});
