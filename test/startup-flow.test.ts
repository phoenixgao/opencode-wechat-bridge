import { describe, expect, it } from "vitest";

describe("non-blocking plugin startup", () => {
  it("returns tool registration immediately even when bridge startup is slow", async () => {
    const deferred = new Promise<{ spawned: boolean; pid: number }>(() => {});

    const startBridge = async () => deferred;

    const { createWechatPlugin } = await import("../src/index.js");

    const plugin = createWechatPlugin(startBridge);

    const result = await Promise.race([
      plugin({} as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out: startup blocked plugin init")), 500),
      ),
    ]);

    const tool = result.tool ?? {};
    expect(tool.wechat_notify).toBeDefined();
  });

  it("returns tool registration even when bridge startup rejects", async () => {
    const startBridge = async (): Promise<{ spawned: boolean; pid: number }> => {
      throw new Error("simulated bridge failure");
    };

    const { createWechatPlugin } = await import("../src/index.js");

    const plugin = createWechatPlugin(startBridge);

    const result = await plugin({} as any);

    const tool = result.tool ?? {};
    expect(tool.wechat_notify).toBeDefined();
  });
});
