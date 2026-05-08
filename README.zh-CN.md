# opencode-wechat-bridge

[English](README.md) | 简体中文

将腾讯 OpenClaw 个人微信桥接到插件管理的 OpenCode 后端。微信收到的消息驱动 OpenCode 会话，助手回复回推微信，同时提供 `wechat_notify` 工具供智能体主动通知。

一个 npm 包，两个插件入口：服务端插件注册工具并启动后台桥接进程，TUI 插件注册 `/wechat-bind`、`/wechat-status`、`/wechat-disconnect`。

## 环境要求

- Node.js 20+
- 支持插件的 OpenCode
- 一个可以扫描腾讯 OpenClaw 二维码登录的个人微信号

## 微信协议说明

本桥接复用腾讯官方个人微信 OpenClaw 协议，也就是 `@tencent-weixin/openclaw-weixin` 提供的 `openclaw-weixin` 渠道。扫码登录时可能显示 OpenClaw，因为底层授权流程就是 OpenClaw 的 Weixin 渠道。

腾讯公开文档描述的机制是：扫码登录会创建本地 OpenClaw 账号条目，同一个 OpenClaw 配置中可以让多个微信号同时在线。实际使用时，请把同一个微信号视为只能被一个活跃的 OpenClaw 类桥接占用：如果你用已经绑定过其他 OpenClaw/Lobehub/OpenClaw 实例的微信号来绑定本桥接，之前那个实例可能会失效或被干扰。如果需要两边同时稳定运行，建议使用不同微信号。

## 快速开始

### 给人类用

把下面这段发给你的 LLM 智能体（Claude Code、OpenCode、Cursor 等）：

```
Install and configure opencode-wechat-bridge by following the instructions here:
https://raw.githubusercontent.com/phoenixgao/opencode-wechat-bridge/refs/heads/main/docs/installation.md
```

搞定。智能体会处理剩下的事。

### 手动安装

<details>
<summary>点击展开：如果你喜欢自己敲命令</summary>

```sh
npm install -g opencode-wechat-bridge
```

在 `opencode.json` 中添加：

```json
{ "plugin": ["opencode-wechat-bridge"] }
```

在 `tui.json` 中添加：

```json
{ "plugin": ["opencode-wechat-bridge/tui"] }
```

启动 OpenCode，运行 `/wechat-bind`，从微信扫描二维码，然后给机器人发一条消息。

</details>

### 首次使用

1. 启动 OpenCode。
2. 在 TUI 中运行 `/wechat-bind`，从微信扫描二维码。
3. 从微信给机器人发一条消息，系统会自动将你的微信用户固定为回复目标。
4. 在微信中继续对话，或让智能体使用 `wechat_notify` 发通知。

### 源码安装（开发）

```sh
git clone git@github.com:phoenixgao/opencode-wechat-bridge.git
cd opencode-wechat-bridge
npm install
npm run build
```

然后在配置中使用绝对路径：

- `opencode.json`：`"plugin": ["/绝对路径/opencode-wechat-bridge/dist/src/index.js"]`
- `tui.json`：`"plugin": ["/绝对路径/opencode-wechat-bridge/dist/src/tui.js"]`

## 架构

```
┌──────────────────────────────────────────────────┐
│  OpenCode TUI（你的会话）                          │
│  ┌──────────────────────────────────────────────┐ │
│  │  TUI 插件  (/wechat-bind/status/disconnect)  │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │  服务端插件 (wechat_notify 工具 + 桥接进程)    │ │
│  └──────────────┬───────────────────────────────┘ │
└─────────────────┼──────────────────────────────────┘
                  │ 启动（fire-and-forget，不等待）
                  ▼
┌──────────────────────────────────────────────────┐
│  托管 OpenCode 后端                                │
│  opencode --port 4096                              │
│  http://127.0.0.1:4096/                           │
│                                                   │
│  首次加载插件时自动启动。如果已可达则复用。         │
│  以完整功能实例运行，包含所有用户插件。             │
│  内部的微信插件检测到托管后端后跳过重复启动。       │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│  独立桥接轮询进程                                  │
│  node dist/src/bridge/cli.js poll                 │
│                                                   │
│  长轮询微信消息。将消息路由到 OpenCode 后端。       │
│  将助手回复回推微信。                              │
└──────────────┬───────────────────────────────────┘
               │
               ▼
          微信 iLink API
```

- **服务端插件**（`opencode-wechat-bridge`）：注册 `wechat_notify` 并启动桥接轮询进程。后端/桥接进程的启动是 fire-and-forget 的 — 插件初始化立即返回，不等待后端就绪。
- **TUI 插件**（`opencode-wechat-bridge/tui`）：注册 `/wechat-bind`、`/wechat-status`、`/wechat-disconnect`。
- **托管后端**：`opencode --port 4096` 运行在 `http://127.0.0.1:4096/`。以完整功能实例运行，包含所有用户插件。微信插件通过 `OPENCODE_WECHAT_IS_MANAGED_BACKEND=1` 检测到自身在托管后端中运行，跳过重复启动后端和桥接进程。如果后端在该地址已可达，插件会复用而非重复启动。
- **桥接轮询进程**：长轮询微信新消息，路由到托管后端，回推回复。使用 `OPENCODE_BASE_URL`（由服务端插件自动设置）。
- **状态文件**位于 `~/.opencode-wechat/`：`token.json`、`target.json`、`sync-buf.json`、`bridge.pid`、`bridge-meta.json`、`bridge.log`、`opencode-backend.pid`、`opencode-backend-meta.json`、`opencode-backend.log`、`sent.log`。
- **微信会话**与当前 TUI 会话独立。微信端的 `/new`、`/sessions`、`/switch` 操作托管后端。

vendored wechat-acp 协议代码版权说明见 `NOTICE`。

## 使用方式

### TUI 斜杠命令

| 命令 | 说明 |
|---|---|
| `/wechat-bind` | 扫码绑定微信 iLink 机器人并存储本地令牌。 |
| `/wechat-status` | 显示绑定状态，不泄露 token 和会话内容。 |
| `/wechat-disconnect` | 移除 token、target 和同步缓冲区。日志保留。 |

### 智能体工具

`wechat_notify` — 向已固定的微信用户发送消息。智能体用于工作完成后通知你（如"处理完了用微信通知我"）。

### 微信端命令

| 命令 | 说明 |
|---|---|
| `/help` | 显示命令列表。 |
| `/status` | 当前桥接和会话状态。 |
| `/current` | 显示当前活跃会话。 |
| `/sessions` | 按目录分组的最近会话。 |
| `/switch <序号\|ses_xxx>` | 切换活跃会话。 |
| `/workdir <路径>` | 设置活跃工作目录但不创建会话。会清空当前会话，下一步需要显式 `/new` 或 `/switch`。`~` 会展开为用户主目录。 |
| `/new [标题]` | 在当前工作目录创建新会话。 |
| `/new [标题] --dir <路径>` | 在指定路径创建新会话。 |
| `/new <路径> [标题]` | 在指定路径创建新会话。绝对路径和 `~/...` 会被识别为目录。 |
| `/last` | 显示最后一次助手输出。 |

默认工作目录是 `~/`。`/switch` 会自动跟随被切换会话保存的目录。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCODE_WECHAT_STATE_DIR` | `~/.opencode-wechat` | 插件状态目录。 |
| `OPENCODE_WECHAT_BASE_URL` | `https://ilinkai.weixin.qq.com` | 微信 iLink API 基础地址。 |
| `OPENCODE_WECHAT_INBOUND_PREFIX` | `[WeChat]` | 微信消息的前缀标记。 |
| `OPENCODE_WECHAT_OPENCODE_PORT` | `4096` | 托管后端的端口。后端不可达时，插件会启动 `opencode --port <端口>`。 |
| `OPENCODE_WECHAT_OPENCODE_URL` | `http://127.0.0.1:4096/` | 托管后端的 URL。对于非本地 URL，后端必须已运行 — 插件不会启动进程。 |
| `OPENCODE_WECHAT_NODE` | 自动检测 | 桥接子进程使用的 Node.js 可执行文件。 |
| `OPENCODE_WECHAT_DB_PATH` | 自动检测 | OpenCode SQLite 数据库路径，用于 `/sessions` 和 `/switch`。 |
| `OPENCODE_BASE_URL` | 由插件设置 | 桥接进程使用的 OpenCode 后端 URL。正常情况下无需手动设置。 |
| `OPENCODE_DIRECTORY` | 由插件设置 | 桥接进程的工作目录。来自 `PluginInput.directory`。 |
| `OPENCODE_DB` | 自动检测 | OpenCode DB 设置。`OPENCODE_WECHAT_DB_PATH` 未设置时使用。 |
| `XDG_DATA_HOME` | `~/.local/share` | 默认 OpenCode DB 发现的基础数据目录。 |

## 安全

- 令牌、目标、同步缓冲区和日志存储在本地状态目录中。请将该目录视为敏感数据。
- 插件创建状态目录时使用私有权限（`0o700`），状态文件在平台支持时使用 `0o600`。
- `/wechat-status` 不会泄露 token、context-token 或会话内容。
- `/wechat-disconnect` 移除 token、target 和同步状态，但保留日志以便本地排查。
- 请勿提交包含私有路径或密钥的状态文件、日志或配置。

## 开发

```sh
npm install
npm test -- --run
npm run typecheck
npm run build
```

发布前：

```sh
npm pack --dry-run     # 验证包内容
npm publish --dry-run  # 预览发布
npm publish            # 发布到 npm
```

CLI 仅用于构建后的调试：

```sh
node dist/src/bridge/cli.js status
```

除非需要真实的微信网络交互，否则不要运行 bind/send/poll 命令。正常使用不需要 CLI。
