import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "package.json");

describe("package.json exports", () => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
    exports: Record<string, string>;
    bin: Record<string, string>;
  };

  it("exports . -> dist/src/index.js", () => {
    expect(pkg.exports["."]).toBe("./dist/src/index.js");
  });

  it("exports ./tui -> dist/src/tui.js", () => {
    expect(pkg.exports["./tui"]).toBe("./dist/src/tui.js");
  });

  it("preserves opencode-wechat-bridge bin entry", () => {
    expect(pkg.bin["opencode-wechat-bridge"]).toBe("dist/src/bridge/cli.js");
  });
});
