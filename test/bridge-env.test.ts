import { describe, expect, it } from "vitest";
import { buildBridgeEnv, resolveBridgeNodeExecutable } from "../src/index.js";

describe("buildBridgeEnv", () => {
  it("passes PluginInput serverUrl and directory to the detached poller env", () => {
    const env = buildBridgeEnv(
      { KEEP: "yes", OPENCODE_BASE_URL: "http://old", OPENCODE_DIRECTORY: "/old" },
      { serverUrl: new URL("http://127.0.0.1:3333"), directory: "/repo" },
    );

    expect(env).toMatchObject({
      KEEP: "yes",
      OPENCODE_BASE_URL: "http://127.0.0.1:3333/",
      OPENCODE_DIRECTORY: "/repo",
    });
  });

  it("does not throw and preserves base env when plugin input is undefined", () => {
    const env = buildBridgeEnv(
      { KEEP: "yes", OPENCODE_BASE_URL: "http://old", OPENCODE_DIRECTORY: "/old" },
      undefined,
    );

    expect(env).toMatchObject({
      KEEP: "yes",
      OPENCODE_BASE_URL: "http://old",
      OPENCODE_DIRECTORY: "/old",
    });
  });

  it("does not throw when base env is undefined", () => {
    const env = buildBridgeEnv(undefined, {
      serverUrl: new URL("http://127.0.0.1:3333"),
      directory: "/repo",
    });

    expect(env).toMatchObject({
      OPENCODE_BASE_URL: "http://127.0.0.1:3333/",
      OPENCODE_DIRECTORY: "/repo",
    });
  });

  it("does not throw and preserves base env when serverUrl is missing", () => {
    const env = buildBridgeEnv(
      { KEEP: "yes", OPENCODE_BASE_URL: "http://old", OPENCODE_DIRECTORY: "/old" },
      {},
    );

    expect(env).toMatchObject({
      KEEP: "yes",
      OPENCODE_BASE_URL: "http://old",
      OPENCODE_DIRECTORY: "/old",
    });
  });

  it("lets plugin input serverUrl override an old base url", () => {
    const env = buildBridgeEnv(
      { KEEP: "yes", OPENCODE_BASE_URL: "http://old", OPENCODE_DIRECTORY: "/old" },
      { serverUrl: new URL("http://127.0.0.1:3333"), directory: "/repo" },
    );

    expect(env).toMatchObject({
      KEEP: "yes",
      OPENCODE_BASE_URL: "http://127.0.0.1:3333/",
      OPENCODE_DIRECTORY: "/repo",
    });
  });
});

describe("resolveBridgeNodeExecutable", () => {
  it("uses the provided override when OPENCODE_WECHAT_NODE is set", () => {
    expect(resolveBridgeNodeExecutable("/usr/bin/opencode", { OPENCODE_WECHAT_NODE: "/custom/node" })).toBe(
      "/custom/node",
    );
  });

  it("preserves a node execPath", () => {
    expect(resolveBridgeNodeExecutable("/usr/local/bin/node", { OPENCODE_WECHAT_NODE: undefined })).toBe("/usr/local/bin/node");
  });

  it("preserves a node execPath when env is undefined", () => {
    expect(resolveBridgeNodeExecutable("/usr/local/bin/node", undefined)).toBe("/usr/local/bin/node");
  });

  it("falls back to node when execPath is opencode", () => {
    expect(resolveBridgeNodeExecutable("/usr/local/bin/opencode", { OPENCODE_WECHAT_NODE: undefined })).toBe("node");
  });
});
