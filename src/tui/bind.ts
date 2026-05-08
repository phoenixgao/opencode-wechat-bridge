import qrcode from "qrcode-terminal";
import type { TokenData } from "../weixin/auth.js";

export interface BindUi {
  toast: (t: { variant?: "info" | "success" | "warning" | "error"; title?: string; message: string }) => void;
  showAlert: (title: string, message: string) => void;
}

export type LoginFn = (params: {
  baseUrl: string;
  storageDir: string;
  log: (msg: string) => void;
  renderQrUrl?: (url: string) => void;
}) => Promise<TokenData>;

export type QrRenderer = (url: string) => string;

export const defaultQrRenderer: QrRenderer = (url) => {
  let out = "";
  qrcode.generate(url, { small: true }, (qr) => {
    out = qr;
  });
  return out;
};

export interface RunBindFlowParams {
  login: LoginFn;
  ui: BindUi;
  stateDir: string;
  baseUrl: string;
  botType?: string;
  renderQr?: QrRenderer;
}

export type RunBindFlowResult =
  | { ok: true; token: TokenData }
  | { ok: false; error: string };

export async function runBindFlow(params: RunBindFlowParams): Promise<RunBindFlowResult> {
  const { login, ui, stateDir, baseUrl, renderQr = defaultQrRenderer } = params;
  ui.toast({ variant: "info", title: "WeChat", message: "Starting QR login..." });
  try {
    const token = await login({
      baseUrl,
      storageDir: stateDir,
      log: (msg) => {
        ui.toast({ variant: "info", title: "WeChat", message: msg });
      },
      renderQrUrl: (url) => {
        const qr = renderQr(url);
        const body = qr && qr.length > 0
          ? `Scan this QR with WeChat (or open the URL on your phone):\n\n${qr}\nURL: ${url}\n\nThe login will refresh automatically.`
          : `Open this URL on your phone, then scan with WeChat:\n\n${url}\n\nThe login will refresh automatically.`;
        ui.showAlert("WeChat QR login", body);
      },
    });
    ui.toast({
      variant: "success",
      title: "WeChat",
      message: `Bound (accountId=${token.accountId}, userId=${token.userId})`,
    });
    return { ok: true, token };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.toast({ variant: "error", title: "WeChat bind failed", message: msg });
    return { ok: false, error: msg };
  }
}
