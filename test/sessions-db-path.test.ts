import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDbPath } from "../src/bridge/sessions.js";

vi.mock("node:sqlite", () => ({
  DatabaseSync: class {},
}));

const envKeys = ["OPENCODE_WECHAT_DB_PATH", "OPENCODE_DB", "XDG_DATA_HOME"] as const;
let previousEnv: Partial<Record<(typeof envKeys)[number], string>>;

describe("defaultDbPath", () => {
  beforeEach(() => {
    previousEnv = {};
    for (const key of envKeys) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("prefers OPENCODE_WECHAT_DB_PATH over all OpenCode defaults", () => {
    process.env.OPENCODE_WECHAT_DB_PATH = "/tmp/wechat-specific.db";
    process.env.OPENCODE_DB = "/tmp/opencode.db";
    process.env.XDG_DATA_HOME = "/tmp/xdg-data";

    expect(defaultDbPath()).toBe("/tmp/wechat-specific.db");
  });

  it("honors absolute OPENCODE_DB directly", () => {
    process.env.OPENCODE_DB = "/tmp/custom-opencode.db";

    expect(defaultDbPath()).toBe("/tmp/custom-opencode.db");
  });

  it("honors :memory: OPENCODE_DB directly", () => {
    process.env.OPENCODE_DB = ":memory:";

    expect(defaultDbPath()).toBe(":memory:");
  });

  it("resolves relative OPENCODE_DB under the OpenCode data dir", () => {
    process.env.XDG_DATA_HOME = "/tmp/xdg-data";
    process.env.OPENCODE_DB = "relative.db";

    expect(defaultDbPath()).toBe(path.join("/tmp/xdg-data", "opencode", "relative.db"));
  });

  it("defaults under XDG_DATA_HOME when set", () => {
    process.env.XDG_DATA_HOME = "/tmp/xdg-data";

    expect(defaultDbPath()).toBe(path.join("/tmp/xdg-data", "opencode", "opencode.db"));
  });

  it("falls back to ~/.local/share/opencode/opencode.db", () => {
    expect(defaultDbPath()).toBe(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"));
  });
});
