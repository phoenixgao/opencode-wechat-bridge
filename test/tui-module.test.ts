import { describe, it, expect } from "vitest";
import mod from "../src/tui.js";

describe("TUI plugin module shape", () => {
  it("exports default with id and tui, and no server", () => {
    expect(mod).toBeTruthy();
    expect(typeof mod.id).toBe("string");
    expect(mod.id).toBe("opencode-wechat-plugin");
    expect(typeof mod.tui).toBe("function");
    expect("server" in mod ? (mod as { server?: unknown }).server : undefined).toBeUndefined();
  });
});
