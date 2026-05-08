# opencode-wechat-plugin

English | [简体中文](README.zh-CN.md)

Bridge a WeChat iLink bot to a plugin-managed OpenCode backend. Incoming WeChat DMs drive OpenCode sessions, agent replies go back to WeChat, and the agent gets a `wechat_notify` tool for proactive notifications.

One npm package, two plugin entrypoints: a server plugin that registers the tool and starts the background bridge, and a TUI plugin that adds `/wechat-bind`, `/wechat-status`, and `/wechat-disconnect`.

## Requirements

- Node.js 20+
- OpenCode with plugin support
- A WeChat iLink bot/account that can create a QR login token

## Quickstart

### 1. Install

```sh
npm install -g opencode-wechat-plugin
```

### 2. Configure OpenCode plugins

Add to `opencode.json` (server plugin — registers the `wechat_notify` tool and starts the bridge):

```json
{
  "plugin": ["opencode-wechat-plugin"]
}
```

Add to `tui.json` (TUI plugin — registers slash commands):

```json
{
  "plugin": ["opencode-wechat-plugin/tui"]
}
```

### 3. Bind and start

1. Start OpenCode.
2. In the TUI, run `/wechat-bind` and scan the QR code from WeChat.
3. Send one DM to the bot from WeChat. That pins your WeChat user as the reply target.
4. Continue the conversation from WeChat, or ask the agent to use `wechat_notify`.

### From source (development)

```sh
git clone git@github.com:phoenixgao/opencode-wechat-bridge.git
cd opencode-wechat-bridge
npm install
npm run build
```

Then use absolute paths in your config:

- `opencode.json`: `"plugin": ["/absolute/path/to/opencode-wechat-plugin/dist/src/index.js"]`
- `tui.json`: `"plugin": ["/absolute/path/to/opencode-wechat-plugin/dist/src/tui.js"]`

## Architecture

```
┌──────────────────────────────────────────────────┐
│  OpenCode TUI (your session)                      │
│  ┌──────────────────────────────────────────────┐ │
│  │  TUI plugin  (/wechat-bind/status/disconnect)│ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │  Server plugin (wechat_notify tool + bridge)  │ │
│  └──────────────┬───────────────────────────────┘ │
└─────────────────┼──────────────────────────────────┘
                  │ starts (fire-and-forget)
                  ▼
┌──────────────────────────────────────────────────┐
│  Managed OpenCode backend                         │
│  opencode --port 4096 --pure                      │
│  http://127.0.0.1:4096/                           │
│                                                   │
│  Spawned on first plugin load. Reused if already  │
│  reachable. Not tied to the current TUI instance. │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│  Detached bridge poller                           │
│  node dist/src/bridge/cli.js poll                 │
│                                                   │
│  Long-polls WeChat. Routes DMs → OpenCode backend.│
│  Pushes assistant replies → WeChat.               │
└──────────────┬───────────────────────────────────┘
               │
               ▼
          WeChat iLink API
```

- **Server plugin** (`opencode-wechat-plugin`): registers `wechat_notify` and starts the bridge poller. Backend/bridge startup is fire-and-forget — plugin initialization returns immediately without waiting for the backend to be ready.
- **TUI plugin** (`opencode-wechat-plugin/tui`): registers `/wechat-bind`, `/wechat-status`, `/wechat-disconnect`.
- **Managed backend**: `opencode --port 4096 --pure` at `http://127.0.0.1:4096/`. `--pure` prevents external plugin recursion. If the backend is already reachable on that URL, the plugin reuses it instead of spawning a duplicate.
- **Bridge poller**: long-polls WeChat for new DMs, routes them to the managed backend, pushes replies back. Uses `OPENCODE_BASE_URL` (set automatically by the server plugin).
- **State files** in `~/.opencode-wechat/`: `token.json`, `target.json`, `sync-buf.json`, `bridge.pid`, `bridge-meta.json`, `bridge.log`, `opencode-backend.pid`, `opencode-backend-meta.json`, `opencode-backend.log`, `sent.log`.
- **WeChat sessions** are independent of the active TUI session. WeChat-side `/new`, `/sessions`, and `/switch` operate on the managed backend.

Vendored wechat-acp protocol code is attributed in `NOTICE`.

## Usage

### TUI slash commands

| Command | Description |
|---|---|
| `/wechat-bind` | QR-bind the WeChat iLink bot and store the local token. |
| `/wechat-status` | Show bind state without leaking token or session context. |
| `/wechat-disconnect` | Remove token, target, and sync buffer. Logs are preserved. |

### Agent tool

`wechat_notify` — sends a message to the pinned WeChat user. The agent uses this to notify you when work completes (e.g. "处理完了用微信通知我").

### WeChat-side commands

| Command | Description |
|---|---|
| `/help` | Show command list. |
| `/status` | Current bridge and session status. |
| `/current` | Show active session. |
| `/sessions` | Recent sessions grouped by directory. |
| `/switch <num\|ses_xxx>` | Switch active session. |
| `/new [title]` | Create a new session. |
| `/last` | Show last assistant output. |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_WECHAT_STATE_DIR` | `~/.opencode-wechat` | Plugin state directory. |
| `OPENCODE_WECHAT_BASE_URL` | `https://ilinkai.weixin.qq.com` | WeChat iLink API base URL. |
| `OPENCODE_WECHAT_INBOUND_PREFIX` | `[WeChat]` | Prefix added to inbound WeChat prompts. |
| `OPENCODE_WECHAT_OPENCODE_PORT` | `4096` | Managed backend port. Plugin spawns `opencode --port <port> --pure` if the backend is not already reachable. |
| `OPENCODE_WECHAT_OPENCODE_URL` | `http://127.0.0.1:4096/` | Managed backend URL. For non-local URLs, the backend must already be reachable — the plugin will not spawn a process. |
| `OPENCODE_WECHAT_NODE` | auto-detected | Explicit Node.js executable for the bridge child process. |
| `OPENCODE_WECHAT_DB_PATH` | auto-detected | Explicit OpenCode SQLite DB path for `/sessions` and `/switch`. |
| `OPENCODE_BASE_URL` | set by plugin | OpenCode backend URL for the bridge. Set automatically; do not override for normal use. |
| `OPENCODE_DIRECTORY` | set by plugin | Working directory for the bridge. Set from `PluginInput.directory`. |
| `OPENCODE_DB` | auto-detected | OpenCode DB setting. Used when `OPENCODE_WECHAT_DB_PATH` is not set. |
| `XDG_DATA_HOME` | `~/.local/share` | Base data directory for default OpenCode DB discovery. |

## Security

- Tokens, targets, sync buffers, and logs are stored locally in the state directory. Treat that directory as sensitive.
- The plugin creates the state directory with private permissions (`0o700`) and state files with `0o600` where the platform supports it.
- `/wechat-status` never leaks token, context-token, or prompt/session content.
- `/wechat-disconnect` removes token, target, and sync state but keeps logs for local troubleshooting.
- Do not commit state files, logs, or config with private paths or secrets.

## Development

```sh
npm install
npm test -- --run
npm run typecheck
npm run build
```

Before publishing:

```sh
npm pack --dry-run     # verify package contents
npm publish --dry-run  # preview publish
npm publish            # publish to npm
```

The CLI is optional for debugging after build:

```sh
node dist/src/bridge/cli.js status
```

Do not run bind/send/poll commands unless you want a real WeChat network flow. The CLI is not required for normal TUI usage.
