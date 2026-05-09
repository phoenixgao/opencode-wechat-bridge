import fs from "node:fs";
import { bridgeMetaPath, bridgePidPath, syncBufPath, targetPath, tokenPath } from "./paths.js";

export interface DisconnectResult {
  removed: string[];
}

const TARGETS: Array<{ name: string; resolve: () => string }> = [
  { name: "token.json", resolve: tokenPath },
  { name: "target.json", resolve: targetPath },
  { name: "sync-buf.json", resolve: syncBufPath },
  { name: "bridge.pid", resolve: bridgePidPath },
  { name: "bridge-meta.json", resolve: bridgeMetaPath },
];

export function disconnectWechat(): DisconnectResult {
  const removed: string[] = [];
  for (const t of TARGETS) {
    const p = t.resolve();
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
        removed.push(t.name);
      }
    } catch {
      /* idempotent: ignore */
    }
  }
  return { removed };
}
