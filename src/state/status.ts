import fs from "node:fs";
import { stateDir, tokenPath, targetPath, syncBufPath } from "./paths.js";
import { loadToken, type TokenData } from "../weixin/auth.js";
import { loadTarget, type Target } from "../bridge/target.js";

export interface WechatStatusTokenSummary {
  accountId: string;
  userId: string;
  baseUrl: string;
  savedAt: string;
}

export interface WechatStatusTargetSummary {
  to_user_id: string;
  lastSeenAt: string;
}

export interface WechatStatus {
  stateDir: string;
  bound: boolean;
  token: WechatStatusTokenSummary | null;
  target: WechatStatusTargetSummary | null;
  hasSyncBuf: boolean;
}

function summariseToken(t: TokenData): WechatStatusTokenSummary {
  return { accountId: t.accountId, userId: t.userId, baseUrl: t.baseUrl, savedAt: t.savedAt };
}

function summariseTarget(t: Target): WechatStatusTargetSummary {
  return { to_user_id: t.to_user_id, lastSeenAt: t.lastSeenAt };
}

export function getWechatStatus(): WechatStatus {
  const dir = stateDir();
  const t = loadToken(dir);
  const tgt = loadTarget();
  const hasSyncBuf = (() => {
    try { return fs.existsSync(syncBufPath()); } catch { return false; }
  })();
  return {
    stateDir: dir,
    bound: Boolean(t && tgt),
    token: t ? summariseToken(t) : null,
    target: tgt ? summariseTarget(tgt) : null,
    hasSyncBuf,
  };
}

export function formatWechatStatusText(s: WechatStatus): string {
  const lines = [
    `stateDir: ${s.stateDir}`,
    `token.json:    ${s.token ? `present (accountId=${s.token.accountId}, userId=${s.token.userId}, savedAt=${s.token.savedAt})` : `MISSING (${tokenPath()})`}`,
    `target.json:   ${s.target ? `present (to_user_id=${s.target.to_user_id}, lastSeenAt=${s.target.lastSeenAt})` : `MISSING (${targetPath()})`}`,
    `sync-buf.json: ${s.hasSyncBuf ? "present" : "missing (will start fresh)"}`,
    `bound:         ${s.bound ? "yes" : "no"}`,
  ];
  return lines.join("\n");
}
