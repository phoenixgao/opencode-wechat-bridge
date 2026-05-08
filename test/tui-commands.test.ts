import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import mod from "../src/tui.js";

type Cmd = {
	title: string;
	value: string;
	description?: string;
	slash?: { name: string; aliases?: string[] };
	onSelect?: () => void;
};

interface FakeApi {
	app: { version: string };
	command: {
		register: (cb: () => Cmd[]) => () => void;
		trigger: (v: string) => void;
		show: () => void;
	};
	ui: {
		toast: (t: { variant?: string; title?: string; message: string }) => void;
		dialog: {
			replace: (render: () => unknown, onClose?: () => void) => void;
			clear: () => void;
			setSize: (s: "medium" | "large" | "xlarge") => void;
			readonly size: "medium" | "large" | "xlarge";
			readonly depth: number;
			readonly open: boolean;
		};
		DialogAlert: (props: {
			title: string;
			message: string;
			onConfirm?: () => void;
		}) => unknown;
		DialogConfirm: (props: {
			title: string;
			message: string;
			onConfirm?: () => void;
			onCancel?: () => void;
		}) => unknown;
	};
	lifecycle: {
		signal: AbortSignal;
		onDispose: (fn: () => void | Promise<void>) => () => void;
	};
}

interface CapturedToast {
	variant?: string;
	title?: string;
	message: string;
}
interface CapturedDialog {
	kind: "alert" | "confirm";
	title: string;
	message: string;
	onConfirm?: () => void;
	onCancel?: () => void;
}

function makeFakeApi() {
	const registers: Array<() => Cmd[]> = [];
	const toasts: CapturedToast[] = [];
	const dialogs: CapturedDialog[] = [];
	const ac = new AbortController();

	const api: FakeApi = {
		app: { version: "test" },
		command: {
			register: (cb) => {
				registers.push(cb);
				return () => {};
			},
			trigger: () => {},
			show: () => {},
		},
		ui: {
			toast: (t) => {
				toasts.push(t);
			},
			dialog: {
				replace: (render) => {
					// eagerly invoke render to capture which Dialog* component was used
					render();
				},
				clear: () => {},
				setSize: () => {},
				size: "medium",
				depth: 0,
				open: false,
			},
			DialogAlert: (props) => {
				dialogs.push({
					kind: "alert",
					title: props.title,
					message: props.message,
					onConfirm: props.onConfirm,
				});
				return { kind: "alert", props };
			},
			DialogConfirm: (props) => {
				dialogs.push({
					kind: "confirm",
					title: props.title,
					message: props.message,
					onConfirm: props.onConfirm,
					onCancel: props.onCancel,
				});
				return { kind: "confirm", props };
			},
		},
		lifecycle: { signal: ac.signal, onDispose: () => () => {} },
	};

	return { api, registers, toasts, dialogs };
}

function expectDefined<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owc-tui-"));
	prevEnv = process.env.OPENCODE_WECHAT_STATE_DIR;
	process.env.OPENCODE_WECHAT_STATE_DIR = tmpDir;
});

afterEach(() => {
	if (prevEnv === undefined) delete process.env.OPENCODE_WECHAT_STATE_DIR;
	else process.env.OPENCODE_WECHAT_STATE_DIR = prevEnv;
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("TUI command registration", () => {
	it("registers /wechat-status, /wechat-bind, /wechat-disconnect with slash names", async () => {
		const { api, registers } = makeFakeApi();
		// The plugin function may be typed against the full TuiPluginApi, but our fake
		// implements the surface our code uses. Cast through unknown for the test only.
		await mod.tui(api as unknown as Parameters<typeof mod.tui>[0], undefined, {
			id: "opencode-wechat",
			source: "internal",
			spec: "",
			target: "",
			first_time: 0,
			last_time: 0,
			time_changed: 0,
			load_count: 1,
			fingerprint: "",
			state: "first",
		} as unknown as Parameters<typeof mod.tui>[2]);

		expect(registers.length).toBe(1);
		const register = expectDefined(
			registers[0],
			"Expected one command registration callback",
		);
		const cmds = register();
		const slashNames = cmds.map((c) => c.slash?.name).filter(Boolean);
		expect(slashNames).toEqual(
			expect.arrayContaining([
				"wechat-status",
				"wechat-bind",
				"wechat-disconnect",
			]),
		);
		for (const c of cmds) {
			expect(typeof c.title).toBe("string");
			expect(typeof c.value).toBe("string");
			expect(typeof c.onSelect).toBe("function");
		}
	});

	it("/wechat-status opens an alert dialog with status text and emits a toast", async () => {
		const { api, registers, dialogs, toasts } = makeFakeApi();
		await mod.tui(api as unknown as Parameters<typeof mod.tui>[0], undefined, {
			id: "opencode-wechat",
			source: "internal",
			spec: "",
			target: "",
			first_time: 0,
			last_time: 0,
			time_changed: 0,
			load_count: 1,
			fingerprint: "",
			state: "first",
		} as unknown as Parameters<typeof mod.tui>[2]);
		const register = expectDefined(
			registers[0],
			"Expected one command registration callback",
		);
		const cmds = register();
		const statusCmd = expectDefined(
			cmds.find((c) => c.slash?.name === "wechat-status"),
			"Expected /wechat-status command to be registered",
		);
		expect(statusCmd.onSelect).toBeDefined();
		if (!statusCmd.onSelect)
			throw new Error("Expected /wechat-status to expose onSelect");
		statusCmd.onSelect();

		expect(dialogs.length).toBeGreaterThanOrEqual(1);
		const last = expectDefined(
			dialogs.at(-1),
			"Expected an alert dialog to be captured",
		);
		expect(last.kind).toBe("alert");
		expect(last.message).toContain(tmpDir);
		expect(
			toasts.find(
				(t) => /wechat/i.test(t.message) || /wechat/i.test(t.title ?? ""),
			),
		).toBeTruthy();
	});

	it("/wechat-disconnect prompts a confirm dialog and only deletes on confirm", async () => {
		fs.writeFileSync(path.join(tmpDir, "token.json"), "{}");
		fs.writeFileSync(path.join(tmpDir, "target.json"), "{}");

		const { api, registers, dialogs } = makeFakeApi();
		await mod.tui(api as unknown as Parameters<typeof mod.tui>[0], undefined, {
			id: "opencode-wechat",
			source: "internal",
			spec: "",
			target: "",
			first_time: 0,
			last_time: 0,
			time_changed: 0,
			load_count: 1,
			fingerprint: "",
			state: "first",
		} as unknown as Parameters<typeof mod.tui>[2]);
		const register = expectDefined(
			registers[0],
			"Expected one command registration callback",
		);
		const cmds = register();
		const cmd = expectDefined(
			cmds.find((c) => c.slash?.name === "wechat-disconnect"),
			"Expected /wechat-disconnect command to be registered",
		);
		expect(cmd.onSelect).toBeDefined();
		if (!cmd.onSelect)
			throw new Error("Expected /wechat-disconnect to expose onSelect");
		cmd.onSelect();

		const confirm = expectDefined(
			dialogs.find((d) => d.kind === "confirm"),
			"Expected a confirm dialog to be captured",
		);
		expect(fs.existsSync(path.join(tmpDir, "token.json"))).toBe(true);
		expect(confirm.onConfirm).toBeDefined();
		if (!confirm.onConfirm)
			throw new Error("Expected confirm dialog to expose onConfirm");
		confirm.onConfirm();
		expect(fs.existsSync(path.join(tmpDir, "token.json"))).toBe(false);
		expect(fs.existsSync(path.join(tmpDir, "target.json"))).toBe(false);
	});

	it("/wechat-disconnect cancel keeps files intact", async () => {
		fs.writeFileSync(path.join(tmpDir, "token.json"), "{}");
		const { api, registers, dialogs } = makeFakeApi();
		await mod.tui(api as unknown as Parameters<typeof mod.tui>[0], undefined, {
			id: "opencode-wechat",
			source: "internal",
			spec: "",
			target: "",
			first_time: 0,
			last_time: 0,
			time_changed: 0,
			load_count: 1,
			fingerprint: "",
			state: "first",
		} as unknown as Parameters<typeof mod.tui>[2]);
		const register = expectDefined(
			registers[0],
			"Expected one command registration callback",
		);
		const cmds = register();
		const disconnectCmd = expectDefined(
			cmds.find((c) => c.slash?.name === "wechat-disconnect"),
			"Expected /wechat-disconnect command to be registered",
		);
		expect(disconnectCmd.onSelect).toBeDefined();
		if (!disconnectCmd.onSelect)
			throw new Error("Expected /wechat-disconnect to expose onSelect");
		disconnectCmd.onSelect();
		const confirm = expectDefined(
			dialogs.find((d) => d.kind === "confirm"),
			"Expected a confirm dialog to be captured",
		);
		confirm.onCancel?.();
		expect(fs.existsSync(path.join(tmpDir, "token.json"))).toBe(true);
	});
});
