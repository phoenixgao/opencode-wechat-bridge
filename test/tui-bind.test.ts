import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBindFlow } from "../src/tui/bind.js";

interface CapturedToast { variant?: string; title?: string; message: string }
interface CapturedAlert { title: string; message: string }

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owc-bind-"));
  prevEnv = process.env.OPENCODE_WECHAT_STATE_DIR;
  process.env.OPENCODE_WECHAT_STATE_DIR = tmpDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.OPENCODE_WECHAT_STATE_DIR;
  else process.env.OPENCODE_WECHAT_STATE_DIR = prevEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeStubUi() {
  const toasts: CapturedToast[] = [];
  const alerts: CapturedAlert[] = [];
  return {
    toasts,
    alerts,
    toast: (t: CapturedToast) => { toasts.push(t); },
    showAlert: (title: string, message: string) => { alerts.push({ title, message }); },
  };
}

function requireItem<T>(item: T | undefined, message: string): T {
  if (item === undefined) {
    throw new Error(message);
  }
  return item;
}

describe("runBindFlow", () => {
  it("calls injected login with renderQrUrl + log callbacks and shows the QR URL via alert", async () => {
    const ui = makeStubUi();
    let capturedRender: ((url: string) => void) | undefined;

    const fakeLogin = async (params: {
      baseUrl: string;
      storageDir: string;
      log: (msg: string) => void;
      renderQrUrl?: (url: string) => void;
    }) => {
      params.log("starting...");
      params.renderQrUrl?.("https://qr.example/abc");
      capturedRender = params.renderQrUrl;
      return {
        token: "T", baseUrl: params.baseUrl, accountId: "ACC", userId: "U",
        savedAt: "2025-01-01T00:00:00.000Z",
      };
    };

    const result = await runBindFlow({
      login: fakeLogin,
      ui,
      stateDir: tmpDir,
      baseUrl: "https://bot.example",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.accountId).toBe("ACC");
    }
    expect(typeof capturedRender).toBe("function");
    const qrAlert = ui.alerts.find((a) => a.message.includes("https://qr.example/abc"));
    expect(qrAlert).toBeTruthy();
    const successToast = ui.toasts.find((t) => t.variant === "success");
    expect(successToast).toBeTruthy();
  });

  it("renders an ASCII QR block alongside the URL in the alert", async () => {
    const ui = makeStubUi();
    const fakeQr = "##QR_BLOCK_FAKE##";
    let qrCalledWith: string | undefined;
    const fakeLogin = async (params: {
      baseUrl: string;
      storageDir: string;
      log: (msg: string) => void;
      renderQrUrl?: (url: string) => void;
    }) => {
      params.renderQrUrl?.("https://qr.example/xyz");
      return {
        token: "T", baseUrl: params.baseUrl, accountId: "ACC", userId: "U",
        savedAt: "2025-01-01T00:00:00.000Z",
      };
    };
    const result = await runBindFlow({
      login: fakeLogin,
      ui,
      stateDir: tmpDir,
      baseUrl: "https://bot.example",
      renderQr: (url) => { qrCalledWith = url; return fakeQr; },
    });
    expect(result.ok).toBe(true);
    expect(qrCalledWith).toBe("https://qr.example/xyz");
    const qrAlert = ui.alerts.find((a) => a.message.includes(fakeQr));
    expect(qrAlert).toBeTruthy();
    expect(requireItem(qrAlert, "Expected QR alert to be present").message).toContain("https://qr.example/xyz");
  });

  it("default QR renderer (no injection) still includes ASCII block + URL", async () => {
    const ui = makeStubUi();
    const fakeLogin = async (params: {
      baseUrl: string;
      storageDir: string;
      log: (msg: string) => void;
      renderQrUrl?: (url: string) => void;
    }) => {
      params.renderQrUrl?.("https://qr.example/default");
      return {
        token: "T", baseUrl: params.baseUrl, accountId: "ACC", userId: "U",
        savedAt: "2025-01-01T00:00:00.000Z",
      };
    };
    await runBindFlow({
      login: fakeLogin,
      ui,
      stateDir: tmpDir,
      baseUrl: "https://bot.example",
    });
    const alert = ui.alerts[0];
    expect(alert).toBeTruthy();
    const alertMessage = requireItem(alert, "Expected alert to be present").message;
    expect(alertMessage).toContain("https://qr.example/default");
    // qrcode-terminal small output uses half-block chars ▀ ▄ █ or spaces.
    expect(/[\u2580\u2584\u2588 ]{5,}/.test(alertMessage)).toBe(true);
  });

  it("returns ok:false and shows error toast when login throws", async () => {
    const ui = makeStubUi();
    const failLogin = async () => { throw new Error("boom"); };
    const result = await runBindFlow({
      login: failLogin,
      ui,
      stateDir: tmpDir,
      baseUrl: "https://bot.example",
    });
    expect(result.ok).toBe(false);
    expect(ui.toasts.some((t) => t.variant === "error")).toBe(true);
  });

  it("does not leak token value into any toast or alert", async () => {
    const ui = makeStubUi();
    const fakeLogin = async (params: { baseUrl: string; log: (m: string) => void }) => {
      params.log("ok");
      return {
        token: "SECRET-TOKEN-LEAK",
        baseUrl: params.baseUrl, accountId: "A", userId: "U",
        savedAt: "2025-01-01T00:00:00.000Z",
      };
    };
    await runBindFlow({ login: fakeLogin, ui, stateDir: tmpDir, baseUrl: "https://x" });
    const blob = JSON.stringify({ toasts: ui.toasts, alerts: ui.alerts });
    expect(blob).not.toContain("SECRET-TOKEN-LEAK");
  });
});
