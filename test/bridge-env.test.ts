import { describe, expect, it } from "vitest";
import {
  bridgeMetadataMatchesEnv,
  buildBridgeEnv,
  buildOpenCodeBackendSpawnArgs,
  isLikelyOpenCodeBackendResponse,
  opencodeBackendMetadataMatchesEnv,
  resolveBridgeNodeExecutable,
  resolveOpenCodeBackendPort,
  resolveOpenCodeBackendUrl,
} from "../src/index.js";

describe("buildBridgeEnv", () => {
  it("uses the fixed managed OpenCode backend URL and preserves PluginInput directory", () => {
    const env = buildBridgeEnv(
      { KEEP: "yes", OPENCODE_BASE_URL: "http://old", OPENCODE_DIRECTORY: "/old", OPENCODE_WECHAT_OPENCODE_PORT: "5123" },
      { serverUrl: new URL("http://localhost:9999"), directory: "/repo" },
    );

    expect(env).toMatchObject({
      KEEP: "yes",
      OPENCODE_BASE_URL: "http://127.0.0.1:5123/",
      OPENCODE_DIRECTORY: "/repo",
    });
  });

  it("does not throw and uses default backend when plugin input is undefined", () => {
    const env = buildBridgeEnv(
      { KEEP: "yes", OPENCODE_BASE_URL: "http://old", OPENCODE_DIRECTORY: "/old" },
      undefined,
    );

    expect(env).toMatchObject({
      KEEP: "yes",
      OPENCODE_BASE_URL: "http://127.0.0.1:4096/",
      OPENCODE_DIRECTORY: "/old",
    });
  });

  it("does not throw when base env is undefined", () => {
    const env = buildBridgeEnv(undefined, {
      serverUrl: new URL("http://127.0.0.1:3333"),
      directory: "/repo",
    });

    expect(env).toMatchObject({
      OPENCODE_BASE_URL: "http://127.0.0.1:4096/",
      OPENCODE_DIRECTORY: "/repo",
    });
  });

  it("does not throw and uses default backend when serverUrl is missing", () => {
    const env = buildBridgeEnv(
      { KEEP: "yes", OPENCODE_BASE_URL: "http://old", OPENCODE_DIRECTORY: "/old" },
      {},
    );

    expect(env).toMatchObject({
      KEEP: "yes",
      OPENCODE_BASE_URL: "http://127.0.0.1:4096/",
      OPENCODE_DIRECTORY: "/old",
    });
  });

  it("ignores PluginInput serverUrl when setting the bridge OpenCode base URL", () => {
    const env = buildBridgeEnv(
      { KEEP: "yes", OPENCODE_BASE_URL: "http://old", OPENCODE_DIRECTORY: "/old" },
      { serverUrl: new URL("http://127.0.0.1:3333"), directory: "/repo" },
    );

    expect(env).toMatchObject({
      KEEP: "yes",
      OPENCODE_BASE_URL: "http://127.0.0.1:4096/",
      OPENCODE_DIRECTORY: "/repo",
    });
  });
});

describe("fixed OpenCode backend helpers", () => {
  it("resolves the default fixed backend URL", () => {
    expect(resolveOpenCodeBackendUrl({})).toBe("http://127.0.0.1:4096/");
  });

  it("resolves the fixed backend URL from a port override", () => {
    expect(resolveOpenCodeBackendUrl({ OPENCODE_WECHAT_OPENCODE_PORT: "5123" })).toBe("http://127.0.0.1:5123/");
  });

  it("resolves the fixed backend URL from an explicit URL override", () => {
    expect(resolveOpenCodeBackendUrl({ OPENCODE_WECHAT_OPENCODE_URL: "http://127.0.0.1:6000" })).toBe(
      "http://127.0.0.1:6000/",
    );
  });

  it("resolves the fixed backend port override", () => {
    expect(resolveOpenCodeBackendPort({ OPENCODE_WECHAT_OPENCODE_PORT: "5123" })).toBe("5123");
  });

	it("builds minimal OpenCode backend spawn args", () => {
		expect(buildOpenCodeBackendSpawnArgs("4096")).toEqual(["--port", "4096"]);
	});

  it("matches backend metadata against the current fixed backend env", () => {
    expect(
      opencodeBackendMetadataMatchesEnv(
        { baseUrl: "http://127.0.0.1:4096/" },
        { OPENCODE_WECHAT_OPENCODE_PORT: "4096" },
      ),
    ).toBe(true);

    expect(
      opencodeBackendMetadataMatchesEnv(
        { baseUrl: "http://127.0.0.1:4096/" },
        { OPENCODE_WECHAT_OPENCODE_PORT: "5123" },
      ),
    ).toBe(false);
  });

	it("classifies likely OpenCode backend responses", () => {
		expect(isLikelyOpenCodeBackendResponse(200, "<!doctype html><title>OpenCode</title>")).toBe(true);
		expect(isLikelyOpenCodeBackendResponse(200, "<!doctype html><html><title>Other App</title>")).toBe(false);
		expect(isLikelyOpenCodeBackendResponse(404, "not found")).toBe(false);
		expect(isLikelyOpenCodeBackendResponse(200, "plain text")).toBe(false);
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

describe("bridgeMetadataMatchesEnv", () => {
  it("rejects an alive bridge launched with a stale OpenCode base URL", () => {
    expect(
      bridgeMetadataMatchesEnv(
        { baseUrl: "http://localhost:4096/", directory: "/repo" },
        { OPENCODE_BASE_URL: "http://127.0.0.1:57985/", OPENCODE_DIRECTORY: "/repo" },
      ),
    ).toBe(false);
  });

  it("accepts an alive bridge launched with the current OpenCode base URL", () => {
    expect(
      bridgeMetadataMatchesEnv(
        { baseUrl: "http://127.0.0.1:57985/", directory: "/repo" },
        { OPENCODE_BASE_URL: "http://127.0.0.1:57985/", OPENCODE_DIRECTORY: "/repo" },
      ),
    ).toBe(true);
  });
});
