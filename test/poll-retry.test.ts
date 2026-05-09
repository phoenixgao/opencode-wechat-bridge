import { describe, it, expect, vi } from "vitest";

vi.mock("sqlite", () => ({ default: vi.fn() }));
vi.mock("sqlite3", () => ({ default: vi.fn() }));

describe("retryPollLoop", () => {
  it("retries after each runPoll exit until aborted", async () => {
    const { retryPollLoop } = await import("../src/bridge/poll.js");
    let calls = 0;
    const ac = new AbortController();
    const runPoll = vi.fn(async () => {
      calls++;
      if (calls >= 3) ac.abort();
      return 0;
    });
    await retryPollLoop(runPoll, { delay: 0, signal: ac.signal });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("retries after a non-zero exit code", async () => {
    const { retryPollLoop } = await import("../src/bridge/poll.js");
    let calls = 0;
    const ac = new AbortController();
    const runPoll = vi.fn(async () => {
      calls++;
      if (calls >= 2) ac.abort();
      return 70;
    });
    await retryPollLoop(runPoll, { delay: 0, signal: ac.signal });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("retries after runPoll throws", async () => {
    const { retryPollLoop } = await import("../src/bridge/poll.js");
    let calls = 0;
    const ac = new AbortController();
    const runPoll = vi.fn(() => {
      calls++;
      if (calls >= 2) ac.abort();
      throw new Error("simulated crash");
    });
    await retryPollLoop(runPoll, { delay: 0, signal: ac.signal });
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});