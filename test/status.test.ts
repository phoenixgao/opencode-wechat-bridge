import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getWechatStatus, formatWechatStatusText } from "../src/state/status.js";

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owc-status-"));
  prevEnv = process.env.OPENCODE_WECHAT_STATE_DIR;
  process.env.OPENCODE_WECHAT_STATE_DIR = tmpDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.OPENCODE_WECHAT_STATE_DIR;
  else process.env.OPENCODE_WECHAT_STATE_DIR = prevEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getWechatStatus", () => {
  it("reports neither bound when state dir is empty", () => {
    const s = getWechatStatus();
    expect(s.bound).toBe(false);
    expect(s.token).toBeNull();
    expect(s.target).toBeNull();
    expect(s.hasSyncBuf).toBe(false);
    expect(s.stateDir).toBe(tmpDir);
  });

  it("reports bound when both token.json and target.json exist", () => {
    fs.writeFileSync(
      path.join(tmpDir, "token.json"),
      JSON.stringify({
        token: "SECRET-DO-NOT-LEAK",
        baseUrl: "https://example.test",
        accountId: "acct-1",
        userId: "user-1",
        savedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "target.json"),
      JSON.stringify({
        to_user_id: "uid-9",
        context_token: "CTX-DO-NOT-LEAK",
        lastSeenAt: "2025-01-02T00:00:00.000Z",
      }),
    );
    fs.writeFileSync(path.join(tmpDir, "sync-buf.json"), "{}");

    const s = getWechatStatus();
    expect(s.bound).toBe(true);
    expect(s.token).not.toBeNull();
    expect(s.token?.accountId).toBe("acct-1");
    expect(s.token?.userId).toBe("user-1");
    expect(s.target?.to_user_id).toBe("uid-9");
    expect(s.hasSyncBuf).toBe(true);
  });

  it("never returns secret token or context_token in summary", () => {
    fs.writeFileSync(
      path.join(tmpDir, "token.json"),
      JSON.stringify({
        token: "SECRET-DO-NOT-LEAK",
        baseUrl: "https://example.test",
        accountId: "acct-1",
        userId: "user-1",
        savedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "target.json"),
      JSON.stringify({
        to_user_id: "uid-9",
        context_token: "CTX-DO-NOT-LEAK",
        lastSeenAt: "2025-01-02T00:00:00.000Z",
      }),
    );
    const s = getWechatStatus();
    const blob = JSON.stringify(s);
    expect(blob).not.toContain("SECRET-DO-NOT-LEAK");
    expect(blob).not.toContain("CTX-DO-NOT-LEAK");
  });
});

describe("formatWechatStatusText", () => {
  it("includes stateDir and present/missing markers", () => {
    fs.writeFileSync(
      path.join(tmpDir, "token.json"),
      JSON.stringify({
        token: "SECRET-X",
        baseUrl: "https://example.test",
        accountId: "acct-1",
        userId: "user-1",
        savedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    const s = getWechatStatus();
    const txt = formatWechatStatusText(s);
    expect(txt).toContain(tmpDir);
    expect(txt).toContain("acct-1");
    expect(txt).toMatch(/target\.json/);
    expect(txt).not.toContain("SECRET-X");
  });
});
