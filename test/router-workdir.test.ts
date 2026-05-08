import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveTarget = vi.fn();
const refreshContextToken = vi.fn();
const loadTarget = vi.fn();
const extractText = vi.fn();
const loadAllSessionsFromDisk = vi.fn(() => []);
const findSessionById = vi.fn();
const parseSwitchArg = vi.fn();
const sendTextMessage = vi.fn();
const splitText = vi.fn((text: string) => [text]);

vi.mock("../src/bridge/target.js", () => ({
	loadTarget,
	saveTarget,
	refreshContextToken,
}));

vi.mock("../src/weixin/send.js", () => ({
	sendTextMessage,
	splitText,
}));

vi.mock("../src/bridge/sessions.js", () => ({
	defaultDbPath: vi.fn(() => "db.sqlite"),
	extractText,
	findSessionById,
	formatGroupedSessions: vi.fn(),
	loadAllSessionsFromDisk,
	newestSession: vi.fn(),
	parseSwitchArg,
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

let tmpDir: string;
let prevStateDir: string | undefined;

function inbound(text: string) {
	extractText.mockReturnValue(text);
	return {
		message_type: 1,
		from_user_id: "user-1",
		context_token: "ctx-1",
		item_list: [{ type: 1, text_item: { text } }],
	};
}

function token() {
	return { baseUrl: "http://127.0.0.1:1", token: "token-1", accountId: "acct", userId: "user", savedAt: "2026-01-01T00:00:00.000Z" };
}

function cfg(directory = "/repo") {
	return { baseUrl: "http://127.0.0.1:4096", directory, inboundPrefix: "[WeChat]", dbPath: "db.sqlite" };
}

function state(currentSessionId: string | null = "ses_current") {
	return { currentSessionId, lastSessionsList: [] };
}

function client() {
	return {
		session: {
			list: vi.fn(async () => []),
			messages: vi.fn(async () => []),
			promptAsync: vi.fn(async () => undefined),
			create: vi.fn(async () => ({ id: "ses_new", directory: "/created", title: "Created" })),
		},
	};
}

describe("WeChat router workdir commands", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owc-router-workdir-"));
		prevStateDir = process.env.OPENCODE_WECHAT_STATE_DIR;
		process.env.OPENCODE_WECHAT_STATE_DIR = tmpDir;
		loadTarget.mockReturnValue({ to_user_id: "user-1", context_token: "ctx-0", lastSeenAt: "2026-01-01T00:00:00.000Z" });
		saveTarget.mockReset();
		refreshContextToken.mockReset();
		sendTextMessage.mockReset();
		splitText.mockClear();
		extractText.mockReset();
		loadAllSessionsFromDisk.mockClear();
		findSessionById.mockReset();
		parseSwitchArg.mockReset();
	});

	afterEach(() => {
		if (prevStateDir === undefined) delete process.env.OPENCODE_WECHAT_STATE_DIR;
		else process.env.OPENCODE_WECHAT_STATE_DIR = prevStateDir;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("sets workdir without creating a session", async () => {
		const { handleInboundMessage } = await import("../src/bridge/router.js");
		const fakeClient = client();
		const config = cfg("/repo");
		const routerState = state("ses_old");

		await handleInboundMessage(inbound("/workdir /tmp/project"), fakeClient, token(), config, routerState);

		expect(config.directory).toBe("/tmp/project");
		expect(routerState.currentSessionId).toBeNull();
		expect(fakeClient.session.create).not.toHaveBeenCalled();
		expect(sendTextMessage).toHaveBeenCalledWith("user-1", expect.stringContaining("/tmp/project"), expect.any(Object));
	});

	it("creates a new session with --dir without changing the title", async () => {
		const { handleInboundMessage } = await import("../src/bridge/router.js");
		const fakeClient = client();
		const config = cfg("/repo");
		const routerState = state("ses_old");

		await handleInboundMessage(inbound("/new Ship this --dir /tmp/project"), fakeClient, token(), config, routerState);

		expect(fakeClient.session.create).toHaveBeenCalledWith({
			query: { directory: "/tmp/project" },
			body: { title: "Ship this" },
		});
		expect(routerState.currentSessionId).toBe("ses_new");
		expect(config.directory).toBe("/created");
	});

	it("expands tilde when setting workdir", async () => {
		const { handleInboundMessage } = await import("../src/bridge/router.js");
		const config = cfg("/repo");

		await handleInboundMessage(inbound("/workdir ~/code/project"), client(), token(), config, state("ses_old"));

		expect(config.directory).toBe(path.join(os.homedir(), "code/project"));
	});

	it("creates a new session from a leading directory argument", async () => {
		const { handleInboundMessage } = await import("../src/bridge/router.js");
		const fakeClient = client();
		const config = cfg("/repo");

		await handleInboundMessage(inbound("/new /tmp/project Fix tests"), fakeClient, token(), config, state("ses_old"));

		expect(fakeClient.session.create).toHaveBeenCalledWith({
			query: { directory: "/tmp/project" },
			body: { title: "Fix tests" },
		});
	});

	it("keeps existing /new title-only behavior in the current workdir", async () => {
		const { handleInboundMessage } = await import("../src/bridge/router.js");
		const fakeClient = client();
		const config = cfg("/repo");

		await handleInboundMessage(inbound("/new Fix tests"), fakeClient, token(), config, state("ses_old"));

		expect(fakeClient.session.create).toHaveBeenCalledWith({
			query: { directory: "/repo" },
			body: { title: "Fix tests" },
		});
	});

	it("switch follows the selected session workdir", async () => {
		parseSwitchArg.mockReturnValue({ sessionId: "ses_target" });
		findSessionById.mockReturnValue({ id: "ses_target", title: "Target", directory: "/target/repo" });
		const { handleInboundMessage } = await import("../src/bridge/router.js");
		const config = cfg("/repo");
		const routerState = state("ses_old");

		await handleInboundMessage(inbound("/switch ses_target"), client(), token(), config, routerState);

		expect(routerState.currentSessionId).toBe("ses_target");
		expect(config.directory).toBe("/target/repo");
	});
});
