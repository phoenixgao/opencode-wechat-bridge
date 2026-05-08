import fs from "node:fs";
import { appendPrivateLog, bridgeLogPath, ensureStateDir } from "../state/paths.js";

export type LogLevel = "info" | "warn" | "error" | "debug";

let stderrIsFile = false;

try {
  const st = fs.fstatSync(process.stderr.fd);
  const logSt = fs.statSync(bridgeLogPath());
  stderrIsFile = st.dev === logSt.dev && st.ino === logSt.ino;
} catch {
  void 0;
}

function write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra })}\n`;
  if (!stderrIsFile) process.stderr.write(line);
  try {
    ensureStateDir();
    appendPrivateLog(bridgeLogPath(), line);
  } catch {
    if (stderrIsFile) process.stderr.write(line);
  }
}

export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => write("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write("error", msg, extra),
  debug: (msg: string, extra?: Record<string, unknown>) => write("debug", msg, extra),
};
