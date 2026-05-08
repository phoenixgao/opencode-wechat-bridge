import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoginFn } from "../src/tui/bind.js";
import { buildCommands, resolveWechatBaseUrl } from "../src/tui.js";

describe("resolveWechatBaseUrl", () => {
	let prev: string | undefined;

	beforeEach(() => {
		prev = process.env.OPENCODE_WECHAT_BASE_URL;
		delete process.env.OPENCODE_WECHAT_BASE_URL;
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.OPENCODE_WECHAT_BASE_URL;
		else process.env.OPENCODE_WECHAT_BASE_URL = prev;
	});

	it("defaults to https://ilinkai.weixin.qq.com when env var is absent", () => {
		expect(resolveWechatBaseUrl()).toBe("https://ilinkai.weixin.qq.com");
	});

	it("respects OPENCODE_WECHAT_BASE_URL when set", () => {
		process.env.OPENCODE_WECHAT_BASE_URL = "https://example.test";
		expect(resolveWechatBaseUrl()).toBe("https://example.test");
	});
});

describe("buildCommands /wechat-bind uses default base URL", () => {
	let prev: string | undefined;

	beforeEach(() => {
		prev = process.env.OPENCODE_WECHAT_BASE_URL;
		delete process.env.OPENCODE_WECHAT_BASE_URL;
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.OPENCODE_WECHAT_BASE_URL;
		else process.env.OPENCODE_WECHAT_BASE_URL = prev;
	});

	it("invokes login with baseUrl=https://ilinkai.weixin.qq.com without hitting network", async () => {
		let capturedBaseUrl: string | undefined;
		const fakeLogin: LoginFn = async ({ baseUrl }) => {
			capturedBaseUrl = baseUrl;
			throw new Error("stop-before-network");
		};

		const fakeApi = {
			ui: {
				toast: () => {},
				dialog: {
					replace: (render: () => unknown) => {
						render();
					},
				},
				DialogAlert: () => ({}),
				DialogConfirm: () => ({}),
			},
		};

		const cmds = buildCommands(
			fakeApi as unknown as Parameters<typeof buildCommands>[0],
			fakeLogin,
		);
		const bind = cmds.find((c) => c.slash?.name === "wechat-bind");
		expect(bind).toBeDefined();
		if (!bind)
			throw new Error("Expected /wechat-bind command to be registered");
		expect(bind.onSelect).toBeDefined();
		if (!bind.onSelect)
			throw new Error("Expected /wechat-bind to expose onSelect");
		bind.onSelect();
		await new Promise((r) => setTimeout(r, 0));
		expect(capturedBaseUrl).toBe("https://ilinkai.weixin.qq.com");
	});
});
