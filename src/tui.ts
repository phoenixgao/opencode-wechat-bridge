import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiCommand } from "@opencode-ai/plugin/tui";
import { getWechatStatus, formatWechatStatusText } from "./state/status.js";
import { disconnectWechat } from "./state/disconnect.js";
import { stateDir } from "./state/paths.js";
import { login as defaultLogin } from "./weixin/auth.js";
import { runBindFlow, type LoginFn } from "./tui/bind.js";

const DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com";

export function resolveWechatBaseUrl(): string {
  return process.env.OPENCODE_WECHAT_BASE_URL ?? DEFAULT_WECHAT_BASE_URL;
}

export function buildCommands(api: TuiPluginApi, login: LoginFn): TuiCommand[] {
  return [
    {
      title: "WeChat: status",
      value: "wechat-status",
      description: "Show WeChat bridge bind status",
      category: "WeChat",
      slash: { name: "wechat-status" },
      onSelect: () => {
        const s = getWechatStatus();
        const text = formatWechatStatusText(s);
        api.ui.dialog.replace(() =>
          api.ui.DialogAlert({
            title: s.bound ? "WeChat: bound" : "WeChat: not bound",
            message: text,
          }),
        );
        api.ui.toast({
          variant: s.bound ? "success" : "warning",
          title: "WeChat",
          message: s.bound ? "Bound and ready" : "Not bound — run /wechat-bind",
        });
      },
    },
    {
      title: "WeChat: bind",
      value: "wechat-bind",
      description: "QR-login a WeChat account",
      category: "WeChat",
      slash: { name: "wechat-bind" },
      onSelect: () => {
        void runBindFlow({
          login,
          ui: {
            toast: (t) => api.ui.toast(t),
            showAlert: (title, message) => {
              api.ui.dialog.replace(() => api.ui.DialogAlert({ title, message }));
            },
          },
          stateDir: stateDir(),
          baseUrl: resolveWechatBaseUrl(),
        });
      },
    },
    {
      title: "WeChat: disconnect",
      value: "wechat-disconnect",
      description: "Remove local token/target/sync-buf (logs preserved)",
      category: "WeChat",
      slash: { name: "wechat-disconnect" },
      onSelect: () => {
        api.ui.dialog.replace(() =>
          api.ui.DialogConfirm({
            title: "Disconnect WeChat?",
            message:
              "This deletes token.json, target.json and sync-buf.json from " +
              `${stateDir()}. Logs are preserved. You can /wechat-bind again later.`,
            onConfirm: () => {
              const r = disconnectWechat();
              api.ui.toast({
                variant: "success",
                title: "WeChat",
                message: r.removed.length === 0
                  ? "Already disconnected"
                  : `Removed: ${r.removed.join(", ")}`,
              });
            },
            onCancel: () => {
              api.ui.toast({ variant: "info", title: "WeChat", message: "Disconnect cancelled" });
            },
          }),
        );
      },
    },
  ];
}

const tui: TuiPlugin = async (api) => {
  api.command.register(() => buildCommands(api, defaultLogin));
};

const mod: TuiPluginModule = {
  id: "opencode-wechat-plugin",
  tui,
};

export default mod;
