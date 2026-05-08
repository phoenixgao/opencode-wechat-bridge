/**
 * Pinned WeChat conversation target: who the bridge talks to.
 * Stored as ~/.opencode-wechat/target.json.
 *
 * The context_token is required for every outbound message and is rotated by
 * the server on each inbound message; the poll loop refreshes it on every
 * incoming USER message.
 */
import fs from "node:fs";
import { ensureStateDir, targetPath, writePrivateFile } from "../state/paths.js";

export interface Target {
  to_user_id: string;
  context_token: string;
  lastSeenAt: string;
}

export function loadTarget(): Target | null {
  const p = targetPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Target;
  } catch {
    return null;
  }
}

/** Atomic write via tmp + rename. */
export function saveTarget(t: Target): void {
  ensureStateDir();
  const p = targetPath();
  const tmp = `${p}.tmp.${process.pid}`;
  writePrivateFile(tmp, JSON.stringify(t, null, 2));
  fs.renameSync(tmp, p);
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // best-effort private perms
  }
}

/** Update only the context_token + lastSeenAt; preserve to_user_id if same user. */
export function refreshContextToken(to_user_id: string, context_token: string): void {
  const existing = loadTarget();
  if (existing && existing.to_user_id !== to_user_id) {
    // Different user DM'd us. Single-account v1: keep the originally pinned target.
    return;
  }
  saveTarget({ to_user_id, context_token, lastSeenAt: new Date().toISOString() });
}
