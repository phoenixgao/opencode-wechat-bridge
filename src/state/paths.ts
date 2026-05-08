/**
 * Single source of truth for filesystem paths.
 * All paths can be overridden via OPENCODE_WECHAT_STATE_DIR env var (used by tests).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function stateDir(): string {
  return process.env?.OPENCODE_WECHAT_STATE_DIR || path.join(os.homedir(), ".opencode-wechat");
}

export function ensurePrivateDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best-effort private perms
  }
  return dir;
}

export function ensureStateDir(): string {
  return ensurePrivateDir(stateDir());
}

export function writePrivateFile(filePath: string, data: string): void {
  ensurePrivateDir(path.dirname(filePath));
  fs.writeFileSync(filePath, data, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort private perms
  }
}

export function appendPrivateLog(filePath: string, line: string): void {
  ensurePrivateDir(path.dirname(filePath));
  fs.appendFileSync(filePath, line, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort private perms
  }
}

export function openPrivateAppendFile(filePath: string): number {
  ensurePrivateDir(path.dirname(filePath));
  const fd = fs.openSync(filePath, "a", 0o600);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort private perms
  }
  return fd;
}

export function tokenPath(): string {
  return path.join(stateDir(), "token.json");
}

export function targetPath(): string {
  return path.join(stateDir(), "target.json");
}

export function syncBufPath(): string {
  return path.join(stateDir(), "sync-buf.json");
}

export function bridgePidPath(): string {
  return path.join(stateDir(), "bridge.pid");
}

export function bridgeMetaPath(): string {
  return path.join(stateDir(), "bridge-meta.json");
}

export function bridgeLogPath(): string {
  return path.join(stateDir(), "bridge.log");
}

export function opencodeBackendPidPath(): string {
  return path.join(stateDir(), "opencode-backend.pid");
}

export function opencodeBackendMetaPath(): string {
  return path.join(stateDir(), "opencode-backend-meta.json");
}

export function opencodeBackendLogPath(): string {
  return path.join(stateDir(), "opencode-backend.log");
}

export function sentLogPath(): string {
  return path.join(stateDir(), "sent.log");
}
