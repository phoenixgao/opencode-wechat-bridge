/**
 * QR bind flow: render QR code in terminal, wait for confirmation, save token.json.
 */
import qrcode from "qrcode-terminal";
import { login } from "../weixin/auth.js";
import { stateDir } from "../state/paths.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

export async function runBind(): Promise<number> {
  const baseUrl = process.env.OPENCODE_WECHAT_BASE_URL || DEFAULT_BASE_URL;
  const log = (msg: string): void => {
    process.stdout.write(`[bind] ${msg}\n`);
  };

  try {
    const tok = await login({
      baseUrl,
      storageDir: stateDir(),
      log,
      renderQrUrl: (url: string) => {
        // ASCII QR; small=true so it fits in a normal terminal.
        qrcode.generate(url, { small: true }, (qr) => {
          process.stdout.write(qr + "\n");
        });
      },
    });
    process.stdout.write(
      `\n\u2713 bound as bot ${tok.accountId} (userId=${tok.userId})\n` +
      `  token.json saved under ${stateDir()}\n` +
      `  next: have someone DM the bot from WeChat to pin a target, then run 'opencode-wechat poll'\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`bind failed: ${(err as Error).message}\n`);
    return 1;
  }
}
