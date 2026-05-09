import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { disconnectWechat } from "../src/state/disconnect.js";

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owc-disc-"));
  prevEnv = process.env.OPENCODE_WECHAT_STATE_DIR;
  process.env.OPENCODE_WECHAT_STATE_DIR = tmpDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.OPENCODE_WECHAT_STATE_DIR;
  else process.env.OPENCODE_WECHAT_STATE_DIR = prevEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("disconnectWechat", () => {
  it("removes token.json, target.json, sync-buf.json, bridge.pid, bridge-meta.json and preserves logs", () => {
    fs.writeFileSync(path.join(tmpDir, "token.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "target.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "sync-buf.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "bridge.pid"), "42");
    fs.writeFileSync(path.join(tmpDir, "bridge-meta.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "bridge.log"), "logline\n");
    fs.writeFileSync(path.join(tmpDir, "sent.log"), "sent\n");

    const r = disconnectWechat();
    expect(r.removed.sort()).toEqual(["bridge-meta.json", "bridge.pid", "sync-buf.json", "target.json", "token.json"]);

    expect(fs.existsSync(path.join(tmpDir, "token.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "target.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "sync-buf.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "bridge.pid"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "bridge-meta.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "bridge.log"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "sent.log"))).toBe(true);
  });

  it("is idempotent (no error when files already absent)", () => {
    const r1 = disconnectWechat();
    expect(r1.removed).toEqual([]);
    const r2 = disconnectWechat();
    expect(r2.removed).toEqual([]);
  });

  it("returns only the files actually removed", () => {
    fs.writeFileSync(path.join(tmpDir, "token.json"), "{}");
    const r = disconnectWechat();
    expect(r.removed).toEqual(["token.json"]);
  });

  it("does not touch logs or non-state files in stateDir", () => {
    fs.writeFileSync(path.join(tmpDir, "token.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "bridge.pid"), "12345");
    fs.writeFileSync(path.join(tmpDir, "bridge.log"), "logline\n");
    fs.writeFileSync(path.join(tmpDir, "custom.dat"), "x");
    disconnectWechat();
    expect(fs.existsSync(path.join(tmpDir, "bridge.pid"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "bridge.log"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "custom.dat"))).toBe(true);
  });
});
