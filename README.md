# opencode-wechat-plugin

OpenCode plugin that bridges a WeChat iLink bot to your active OpenCode server. Incoming WeChat DMs can drive OpenCode sessions, agent replies are sent back to the pinned WeChat user, and agents get a `wechat_notify` tool for proactive notifications.

## Requirements

- Node.js 20+
- OpenCode with plugin support
- A WeChat iLink bot/account that can create a QR login token

## Install and configure

Install from GitHub or from npm after the package is published, then configure two separate OpenCode plugin surfaces.

### Install from GitHub source

```sh
git clone git@github.com:phoenixgao/opencode-wechat-bridge.git
cd opencode-wechat-bridge
npm install
npm run build
```

Use the absolute `dist` paths in the config examples below when installing from source.

### Install from npm package

After this package is published to npm:

```sh
npm install -g opencode-wechat-plugin
```

Then use the package-name config examples below.

### Server plugin (`opencode.json`)

The server plugin registers the `wechat_notify` tool and starts the background bridge poller.

Package install:

```json
{
  "plugin": ["opencode-wechat-plugin"]
}
```

GitHub/source build:

```json
{
  "plugin": ["/absolute/path/to/opencode-wechat-plugin/dist/src/index.js"]
}
```

### TUI plugin (`tui.json`)

The TUI plugin registers `/wechat-bind`, `/wechat-status`, and `/wechat-disconnect`.

OpenCode TUI plugins live in `tui.json`, not `opencode.json`.

Package install:

```json
{
  "plugin": ["opencode-wechat-plugin/tui"]
}
```

GitHub/source build:

```json
{
  "plugin": ["/absolute/path/to/opencode-wechat-plugin/dist/src/tui.js"]
}
```

## Usage

In the OpenCode TUI:

- `/wechat-bind` — QR-bind the WeChat iLink bot and store the local token.
- `/wechat-status` — show local state without leaking token or session context.
- `/wechat-disconnect` — remove token, pinned target, and sync buffer while preserving logs.

After binding, DM the bot once from WeChat. That pins your WeChat user as the target for outbound replies and `wechat_notify`.

Agent tool:

- `wechat_notify` — send a message to the pinned WeChat target, useful when you ask the agent to notify you when work is done.

WeChat-side commands:

- `/help` — command list.
- `/status` — current bridge/session status.
- `/current` — show active session.
- `/sessions` — recent sessions grouped by directory.
- `/switch <num|ses_xxx>` — switch active session.
- `/new [title]` — create a new session.
- `/last` — show last assistant output.

Normal TUI usage does not require running the CLI directly. The CLI is optional debugging support.

Typical first run:

1. Start OpenCode after configuring both plugin surfaces.
2. Run `/wechat-bind` in the OpenCode TUI.
3. Scan the QR code from WeChat.
4. Send one DM to the bot from WeChat so the bridge can pin your WeChat user as the reply target.
5. Continue the conversation from WeChat, or ask the agent to use `wechat_notify`.

## Architecture

- **Server plugin** (`opencode-wechat-plugin`) registers `wechat_notify` and starts a detached bridge poller.
- **TUI plugin** (`opencode-wechat-plugin/tui`) registers `/wechat-bind`, `/wechat-status`, and `/wechat-disconnect`.
- **Detached bridge poller** (`dist/src/bridge/cli.js poll`) long-polls WeChat updates and routes messages into OpenCode using the SDK/API.
- **State files** live under `OPENCODE_WECHAT_STATE_DIR` or `~/.opencode-wechat`: token, pinned target, sync buffer, bridge pid/log, and send log.
- **OpenCode SDK/API use** goes through the OpenCode HTTP server URL supplied by `PluginInput.serverUrl` when started as a server plugin.
- **Read-only SQLite discovery** is used only as a best-effort way to support cross-workdir `/sessions` and `/switch`; the plugin opens the OpenCode DB read-only.

Vendored wechat-acp protocol code is attributed in `NOTICE`.

## Environment variables

- `OPENCODE_WECHAT_STATE_DIR` — override local plugin state directory.
- `OPENCODE_WECHAT_BASE_URL` — WeChat iLink API base URL used by bind/TUI code.
- `OPENCODE_WECHAT_INBOUND_PREFIX` — prefix added to inbound WeChat prompts (default `[WeChat]`).
- `OPENCODE_BASE_URL` — OpenCode HTTP server URL for the bridge poller. The server plugin sets this from `PluginInput.serverUrl`.
- `OPENCODE_DIRECTORY` — OpenCode working directory for the bridge poller. The server plugin sets this from `PluginInput.directory`.
- `OPENCODE_WECHAT_DB_PATH` — explicit OpenCode SQLite DB path for read-only cross-workdir session discovery.
- `OPENCODE_DB` — OpenCode DB setting honored when `OPENCODE_WECHAT_DB_PATH` is not set. Absolute paths and `:memory:` are used directly; relative paths resolve under the OpenCode data dir.
- `XDG_DATA_HOME` — base data directory for default OpenCode DB discovery (`$XDG_DATA_HOME/opencode/opencode.db`). If unset, discovery falls back to `~/.local/share/opencode/opencode.db`.

## FAQ

### What is `127.0.0.1:4096`?

It is the OpenCode HTTP server manual fallback used only when the bridge poller is run outside the server plugin and no `OPENCODE_BASE_URL` or explicit option is provided. It is not a WeChat endpoint.

### Why does the plugin read an OpenCode DB path?

OpenCode plugin input exposes `serverUrl` and `directory`, but it does not expose the DB path. The plugin reads the DB path best-effort so WeChat-side `/sessions` and `/switch` can discover sessions across workdirs. SQLite access is read-only and not required for basic message routing.

## Security and state notes

- Tokens, pinned targets, sync buffers, and bridge/send logs are stored locally in the plugin state directory. Treat that directory and its files as sensitive.
- The plugin attempts to create the state directory with private permissions and writes local state/log files with private permissions where the platform allows.
- `/wechat-status` avoids token, context-token, and prompt/session-content leaks.
- `/wechat-disconnect` removes token, target, and sync state, but preserves logs for local troubleshooting.
- Do not commit state files, logs, tokens, or local config containing private paths/secrets.

## Development

```sh
npm install
npm test -- --run
npm run typecheck
npm run build
```

This repo uses npm scripts and currently includes `package-lock.json`, so npm is the default package manager for development and publishing. Bun is fine for local experiments if you prefer it, but publish with npm (`npm publish`) after running the package verification flow.

Before publishing to npm, verify the package contents without uploading:

```sh
npm pack --dry-run
```

Optional CLI debugging after build:

```sh
node dist/src/bridge/cli.js status
```

Do not run bind/send/poll commands unless you intentionally want a real WeChat network flow. The CLI is not required for normal TUI usage.
