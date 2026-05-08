/**
 * WeChat QR login flow + token persistence.
 */

import fs from "node:fs";
import path from "node:path";
import { ensurePrivateDir, writePrivateFile } from "../state/paths.js";
import { getBotQrcode, getQrcodeStatus } from "./api.js";

export interface TokenData {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
  savedAt: string;
}

function getTokenPath(storageDir: string): string {
  return path.join(storageDir, "token.json");
}

export function loadToken(storageDir: string): TokenData | null {
  const tokenPath = getTokenPath(storageDir);
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, "utf-8")) as TokenData;
  } catch {
    return null;
  }
}

export function saveToken(storageDir: string, data: TokenData): void {
  ensurePrivateDir(storageDir);
  const tokenPath = getTokenPath(storageDir);
  writePrivateFile(tokenPath, JSON.stringify(data, null, 2));
}

export async function login(params: {
  baseUrl: string;
  botType?: string;
  storageDir: string;
  log: (msg: string) => void;
  renderQrUrl?: (url: string) => void;
}): Promise<TokenData> {
  const { baseUrl, botType, storageDir, log, renderQrUrl } = params;

  log("Starting WeChat QR login...");

  const qrResp = await getBotQrcode({ baseUrl, botType });
  const qrcodeUrl = qrResp.qrcode_img_content;

  log("Please scan the QR code with WeChat:");
  if (renderQrUrl) {
    renderQrUrl(qrcodeUrl);
  } else {
    log(`QR URL: ${qrcodeUrl}`);
  }

  const deadline = Date.now() + 5 * 60_000;
  let currentQrcode = qrResp.qrcode;
  let refreshCount = 0;

  while (Date.now() < deadline) {
    const statusResp = await getQrcodeStatus({ baseUrl, qrcode: currentQrcode });

    switch (statusResp.status) {
      case "wait":
        break;
      case "scaned":
        log("QR scanned, please confirm in WeChat...");
        break;
      case "expired": {
        refreshCount++;
        if (refreshCount > 3) {
          throw new Error("QR code expired multiple times, please retry");
        }
        log(`QR expired, refreshing (${refreshCount}/3)...`);
        const newQr = await getBotQrcode({ baseUrl, botType });
        currentQrcode = newQr.qrcode;
        if (renderQrUrl) {
          renderQrUrl(newQr.qrcode_img_content);
        } else {
          log(`New QR URL: ${newQr.qrcode_img_content}`);
        }
        break;
      }
      case "confirmed": {
        log("Login successful!");
        const { bot_token, baseurl, ilink_bot_id, ilink_user_id } = statusResp;
        if (!bot_token || !ilink_bot_id || !ilink_user_id) {
          throw new Error("Login confirmed without token data");
        }
        const tokenData: TokenData = {
          token: bot_token,
          baseUrl: baseurl || baseUrl,
          accountId: ilink_bot_id,
          userId: ilink_user_id,
          savedAt: new Date().toISOString(),
        };
        saveToken(storageDir, tokenData);
        log(`Bot ID: ${tokenData.accountId}`);
        log(`Token saved to ${getTokenPath(storageDir)}`);
        return tokenData;
      }
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new Error("Login timeout (5 minutes)");
}
