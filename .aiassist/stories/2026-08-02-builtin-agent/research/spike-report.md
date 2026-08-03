# Spike 报告 — 2026-08-02-builtin-agent（H1~H4）

> 日期：2026-08-03
> 目的：signoff 前置验证项（tech-design「前置 spike 项」）——H1~H4
> 环境：node v24.18.0；pi-coding-agent 0.83.0 + pi-ai 0.83.0（/tmp/pi-spike 临时安装）；打包产物 out/opc-workstation-darwin-arm64（v0.1.0）

## 结论总览

| # | 假设 | 结果 | 结论 |
|---|---|---|---|
| H1 | asar 打包下 agent 子进程入口可 spawn | **PASS** | `ELECTRON_RUN_AS_NODE=1` + 打包 Electron 二进制可 require asar 内文件——子进程入口随主 bundle 进 asar，无需解包 |
| H2 | PI 会话目录可自定义 + SessionManager.open 恢复 | **PASS**（8/8 检查） | `SessionManager.create(cwd, sessionDir)` 自定义目录；JSONL 落盘；`SessionManager.open` 恢复上下文（entries=4） |
| H3 | fauxProvider 可注入 createAgentSession | **PASS** | `ModelRuntime.registerNativeProvider(faux.provider)` + `model: faux.getModel()` 注入成功；流式事件完整 |
| H4 | CardKit 卡片流式可用 | **契约 PASS / 联调待 QA** | 端点/字段/约束已由 primary source 证实；无真实飞书凭据，10 分钟窗口行为与渲染效果推迟到 QA 联调 |

## H1：asar 打包 spawn 路径

**验证方式**：打包产物 `out/opc-workstation-darwin-arm64`（v0.1.0）实测：
- `npx asar list app.asar`：主 bundle 在 `/.vite/build/main.js`（+ server 分块）——未来 agent-worker 入口同路径进 asar。
- `ELECTRON_RUN_AS_NODE=1 <app>/Contents/MacOS/opc-workstation -e "require('<abs>/app.asar/.vite/build/agentRegistry.json')"` → **asar-require-ok**（asar 内文件在 RUN_AS_NODE 模式可读）。

**实现结论**：agent 子进程 spawn = `spawn(process.execPath, [<asar 内 bundle 路径>], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })`；开发模式 spawn `node <源码入口>`。Electron 43 内嵌 node 24.17.0（≥ pi 要求 22.19）。**无需 asarUnpack 配置。**

## H2：会话目录自定义 + 恢复

**验证脚本**：`/tmp/pi-spike/spike-h23.mjs`（8/8 PASS）：

| 检查 | 结果 |
|---|---|
| H2a 会话目录自定义（非默认 ~/.pi） | PASS（`SessionManager.create(workdir, sessionDir)`，getSessionDir 返回自定义路径） |
| H2b JSONL 会话文件存在 | PASS |
| H2c 消息已落盘（用户+助手） | PASS（1.1KB，含双方消息） |
| H2d SessionManager.open 恢复上下文 | PASS（entries=4，助手回复可读） |
| H2e ~/.pi 未被污染 | PASS（**authPath 重定向**：`ModelRuntime.create({ authPath })` 后无 ~/.pi 写入） |

**关键教训（实现必须遵守）**：
1. `ModelRuntime.create` 是 **async**。
2. 凭证存储默认指向 `~/.pi/agent/auth.json`——**必须传 `authPath` 重定向**（或 InMemoryCredentialStore），否则污染用户 ~/.pi。
3. `SettingsManager.inMemory()` 可避免设置文件 I/O（实现时按需选择；生产用 `SettingsManager.create(cwd, agentDir)` 位置参数）。

## H3：fauxProvider 注入

**验证脚本**：同一 `/tmp/pi-spike/spike-h23.mjs`：

| 检查 | 结果 |
|---|---|
| H3a fauxProvider 注册 + 模型可获取 | PASS（`registerNativeProvider(faux.provider)`；`faux.getModel()` → `faux-1`） |
| H3b 对话回路（faux 流式回复） | PASS（回复文本 = 脚本化响应） |
| H3c 流式事件序列 | PASS（agent_start→turn_start→message_start→message_update×4→message_end→turn_end→agent_end） |

**实现关键事实**（tech-design 补充）：
- `session.prompt()` 返回 `Promise<void>`——**回复文本从事件订阅提取**，不走返回值。
- `message_update` 事件的文本载体是 **`assistantMessageEvent`**：`text_start` / `text_delta`（`delta` 字段）/ `text_end`（`content` 字段）——IPC 事件透传需按此结构。
- 流式中 prompt 需 `streamingBehavior: "followUp"`（或 steer），否则 throw（research 已记录，实测一致）。
- `createAgentSession` 支持 `sessionManager` / `modelRuntime` / `model` / `customTools` / `noTools` 注入——工具面（REQ-AGENT-012）落点确认。
- 测试 seam 结论：**对话回路测试用 fauxProvider + 事件断言**，零网络、确定性（REQ-AGENT-006/007 测试骨架可行）。

## H4：CardKit 卡片流式（契约验证）

**契约（primary sources，见 research/feishu-streaming.md）**：
- 创建：卡片 JSON 2.0 + `config.streaming_mode: true` + `streaming_config` → `card_id`；卡片实体一次性发送。
- 流式更新：`PUT /open-apis/cardkit/v1/cards/:card_id/elements/:element_id/content`，`content`（**全量累计文本**，1~100,000 字符）、`sequence`（**严格递增**，错误码 300317）、`uuid`（幂等可选）。
- 流式期间**不触发 QPS 限流**；10 分钟自动关闭（建议手动 `card.settings` 关 `streaming_mode`）；客户端 7.20+（7.23+ 自定义打印参数）；权限 `cardkit:card:write` + `im:message:send_as_bot`。

**联调待办（QA 阶段）**：需真实飞书应用凭据验证——卡片实体创建、sequence 递增更新、10 分钟窗口关闭行为、打字机渲染效果。实现按契约先行，联调发现问题走 `/bug`。

**实现要点**（供 BUILD）：adapter 新增 `sendCard` / `updateCardStream({cardId, elementId, content, sequence})`；`content` 为累计全文（渲染器维护全量文本）；长任务自行控制 ≤100,000 字符。

## 对 tech-design 的增补结论

1. IPC `session-event` 需按 PI 事件结构透传（`assistantMessageEvent` 载体）。
2. agent 子进程 spawn 参数：`ELECTRON_RUN_AS_NODE=1`（打包）/ `node`（开发），入口 = vite 打包的 agent-worker bundle。
3. `ModelRuntime` 凭证存储必须重定向（authPath），不污染用户 ~/.pi。
4. H4 联调推迟 QA——spike 4 的"10 分钟窗口行为"验收依赖真实凭据。

## 遗留

- spike 环境 `/tmp/pi-spike`（含脚本与依赖）保留供 BUILD 阶段参考；不入库。
- `~/.pi` 在 spike 早期运行产生过 auth.json，已清理；实现阶段遵守 authPath 重定向即可不再产生。
