# Installation

## For Humans

Paste this into your LLM agent session:

```
Install and configure opencode-wechat-bridge by following the instructions here:
https://raw.githubusercontent.com/phoenixgao/opencode-wechat-bridge/refs/heads/main/docs/installation.md
```

## For LLM Agents

If you're helping a user install opencode-wechat-bridge, follow these steps:

### Step 1: Check prerequisites

```sh
node --version  # must be >= 20
opencode --version  # must support plugins
```

### Step 2: Install the npm package

```sh
npm install -g opencode-wechat-bridge
```

### Step 3: Register the server plugin

Read `~/.config/opencode/opencode.json`. Ensure the `plugin` array contains `"opencode-wechat-bridge"`. If the file doesn't exist or doesn't have a `plugin` array, create it:

```json
{
  "plugin": ["opencode-wechat-bridge"]
}
```

This registers the `wechat_notify` tool and starts the bridge poller on plugin init.

### Step 4: Register the TUI plugin

Read `~/.config/opencode/tui.json`. Ensure the `plugin` array contains `"opencode-wechat-bridge/tui"`. If the file doesn't exist, create it:

```json
{
  "plugin": ["opencode-wechat-bridge/tui"]
}
```

This registers `/wechat-bind`, `/wechat-status`, and `/wechat-disconnect` slash commands.

### Step 5: Verify

```sh
# Check plugin is installed
npm list -g opencode-wechat-bridge

# Check plugin is referenced in config
cat ~/.config/opencode/opencode.json
cat ~/.config/opencode/tui.json
```

### Step 6: Tell the user

Tell the user the installation is complete. The plugin has these parts:

**Server plugin** (`opencode-wechat-bridge` in `opencode.json`):
- Registers `wechat_notify` tool
- On first load, spawns a managed OpenCode backend at `http://127.0.0.1:4096/` (fire-and-forget)
- Spawns a bridge poller process

**TUI plugin** (`opencode-wechat-bridge/tui` in `tui.json`):
- `/wechat-bind` — display QR code for WeChat iLink bot binding
- `/wechat-status` — show bind state
- `/wechat-disconnect` — remove token and targets

State is stored in `~/.opencode-wechat/`.

To use:
1. Start/open OpenCode
2. Run `/wechat-bind` and scan the QR code from WeChat
3. Send a DM to the bot from WeChat — this pins your WeChat user as the reply target
4. Conversations from WeChat drive the managed OpenCode backend
