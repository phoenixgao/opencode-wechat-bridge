import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRel(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf-8");
}

describe("release hardening source assertions", () => {
  it("does not ship the retired state conversion implementation or CLI surface", () => {
    const removedFile = ["src/state/", "mi", "grate-open", "claw.ts"].join("");
    expect(fs.existsSync(path.join(root, removedFile))).toBe(false);

    const source = ["src/bridge/cli.ts", "src/bridge/poll.ts", "src/state/paths.ts"]
      .map(readRel)
      .join("\n");
    expect(source).not.toMatch(new RegExp(["mi", "grate|legacyOpen", "clawDir|mi", "grate-open", "claw"].join(""), "i"));

    const distStateDir = path.join(root, "dist", "src", "state");
    if (fs.existsSync(distStateDir)) {
      const retiredBase = ["mi", "grate", "-open", "claw"].join("");
      expect(fs.existsSync(path.join(distStateDir, `${retiredBase}.js`))).toBe(false);
      expect(fs.existsSync(path.join(distStateDir, `${retiredBase}.js.map`))).toBe(false);

      const distSource = fs.readdirSync(distStateDir).flatMap((name) => {
        const full = path.join(distStateDir, name);
        return fs.statSync(full).isFile() ? [fs.readFileSync(full, "utf-8")] : [];
      }).join("\n");
      expect(distSource).not.toContain(["mi", "grate", "-open", "claw"].join(""));
    }
  });

  it("has release README coverage for install, usage, architecture, env, FAQ, security, and development", () => {
    const readme = readRel("README.md");

    for (const phrase of [
      "opencode-wechat-plugin",
      "opencode-wechat-plugin/tui",
      "opencode.json",
      "tui.json",
      "/wechat-bind",
      "/wechat-status",
      "/wechat-disconnect",
      "wechat_notify",
      "/sessions",
      "/switch",
      "OPENCODE_WECHAT_DB_PATH",
      "OPENCODE_DB",
      "127.0.0.1:4096",
      "npm test -- --run",
      "npm run typecheck",
      "npm run build",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  it("publishes runtime build output without compiled tests", () => {
    const pkg = JSON.parse(readRel("package.json")) as { files: string[] };

    expect(pkg.files).toContain("dist/src/");
    expect(pkg.files).not.toContain("dist/");
  });
});
