import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

function tempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-wechat-state-"));
}

describe("state permissions", () => {
  it("falls back to the home state directory when env is undefined", async () => {
    const savedEnv = process.env;
    Object.defineProperty(process, "env", { value: undefined, configurable: true });
    try {
      const { stateDir } = await import("../src/state/paths.js");
      expect(stateDir()).toBe(path.join(os.homedir(), ".opencode-wechat"));
    } finally {
      Object.defineProperty(process, "env", { value: savedEnv, configurable: true });
    }
  });

  it("keeps token and state directory private", async () => {
    const dir = tempStateDir();
    process.env.OPENCODE_WECHAT_STATE_DIR = dir;

    const { ensurePrivateDir } = await import("../src/state/paths.js");
    const { saveToken } = await import("../src/weixin/auth.js");

    expect(ensurePrivateDir(dir)).toBe(dir);

    saveToken(dir, {
      token: "t",
      baseUrl: "http://example.com",
      accountId: "a",
      userId: "u",
      savedAt: new Date().toISOString(),
    });

    expect((fs.statSync(dir).mode & 0o777)).toBe(0o700);
    expect((fs.statSync(path.join(dir, "token.json")).mode & 0o777)).toBe(0o600);
  });

  it("writes target, sync buffer, and bridge log privately", async () => {
    const dir = tempStateDir();
    process.env.OPENCODE_WECHAT_STATE_DIR = dir;

    const { appendPrivateLog, ensurePrivateDir } = await import("../src/state/paths.js");
    const { saveTarget } = await import("../src/bridge/target.js");
    const monitor = await import("../src/weixin/monitor.js");

    expect(ensurePrivateDir(dir)).toBe(dir);

    saveTarget({ to_user_id: "u", context_token: "c", lastSeenAt: new Date().toISOString() });
    appendPrivateLog(path.join(dir, "bridge.log"), "line\n");
    vi.spyOn(fs, "writeFileSync");

    const startMonitor = monitor.startMonitor;
    const stop = new AbortController();
    stop.abort();
    await expect(
      startMonitor({
        baseUrl: "http://example.com",
        storageDir: dir,
        abortSignal: stop.signal,
        log: () => void 0,
        onMessage: () => void 0,
      }),
    ).resolves.toBeUndefined();

    expect((fs.statSync(path.join(dir, "target.json")).mode & 0o777)).toBe(0o600);
    expect((fs.statSync(path.join(dir, "bridge.log")).mode & 0o777)).toBe(0o600);
  });

  it("opens append logs privately for bridge startup", async () => {
    const dir = tempStateDir();
    process.env.OPENCODE_WECHAT_STATE_DIR = dir;

    const { openPrivateAppendFile } = await import("../src/state/paths.js");

    const originalUmask = process.umask(0o022);
    try {
      const fd = openPrivateAppendFile(path.join(dir, "nested", "bridge.log"));
      fs.closeSync(fd);
    } finally {
      process.umask(originalUmask);
    }

    expect((fs.statSync(path.join(dir, "nested")).mode & 0o777)).toBe(0o700);
    expect((fs.statSync(path.join(dir, "nested", "bridge.log")).mode & 0o777)).toBe(0o600);
  });

  it("resolves separate state paths for the managed OpenCode backend", async () => {
    const dir = tempStateDir();
    process.env.OPENCODE_WECHAT_STATE_DIR = dir;

    const { opencodeBackendLogPath, opencodeBackendMetaPath, opencodeBackendPidPath } = await import(
      "../src/state/paths.js"
    );

    expect(opencodeBackendPidPath()).toBe(path.join(dir, "opencode-backend.pid"));
    expect(opencodeBackendMetaPath()).toBe(path.join(dir, "opencode-backend-meta.json"));
    expect(opencodeBackendLogPath()).toBe(path.join(dir, "opencode-backend.log"));
  });
});
