# 技术方案 — 内置对话 Agent（飞书入口）

> 故事 ID：`2026-08-02-builtin-agent`
> 版本：`v1.1`
> 最后更新：2026-08-03
> 输入：PRD v0.3 + research 4 份（pi-ai providers / feishu command menu / provider injection / sdk-vs-rpc）+ ADR-013
> v1.1 修订：review-tech 修复——F-1 IPC 补 session-config/notify-result + secret 约束 + 数据流 7 配置变更；W-1 绑定 arming（pendingBind）；W-2 确认结果经 notify-result 注入会话；W-3 SQLite 为真相声明；W-5 spike 挂 signoff 前置；W-6 IPC 并发/错误/大小语义；W-4 术语登记待办

---

## 设计目标

在平台现有"单 server 运行时 + 飞书通道 + CLI 共享服务层"之上，新增一个**独立 agent 子进程**承载 PI 对话内核，以飞书为第一入口提供对话式驱动平台的能力——同时满足：崩溃隔离（agent 致命错误不连带桌面应用）、多对话空间并发、确认与执行解耦（挂起可稍后处理）、CLI 即控制面（保险层单点）。

## 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| **agentRouter**（主进程路由层） | 三纯函数：绑定检查 → 斜杠命令识别 → 会话分发（D1） | 新增（imRouter 扩展） |
| **agentService**（主进程） | agent 子进程生命周期（spawn/看门狗重启）、IPC 客户端、**会话注册表 = 活跃句柄缓存（SQLite 为真相，随重启重建，W-3）** | 新增 |
| **agent 子进程**（PI 宿主） | PI SDK 多 `AgentSession` 实例（每对话空间一个）、工具面（import CLI 命令模块）、事件上报、高危命令拦截 | 新增（新进程） |
| **会话卡片渲染器**（主进程） | agent 流式事件 / flow 执行事件 → CardKit 卡片构建/更新指令（两类卡片：回复卡片、任务卡片） | 新增 |
| **确认服务**（主进程） | 挂起队列（SQLite `agent_confirmations`）、确认卡片、回调 → 驱动执行（b 解耦） | 新增 |
| **sessionStore**（SQLite） | `agent_sessions` 表（**真相**，W-3）：对话空间 ↔ PI session 引用、元数据（B1） | 新增 |
| **feishuChannelAdapter**（扩展） | 新增 `sendCard` / `updateCardStream`（F1） | 扩展 |
| **CLI 命令模块**（扩展） | 每命令声明 `riskLevel: query \| dispatch \| confirm`；confirm 类在 agent 工具路径触发确认（C2 保险层） | 扩展 |
| **settings**（扩展） | Agent 配置区：供应商/key（safeStorage）/身份自定义/绑定状态（E3） | 扩展 |
| **imRouter**（改造） | agent 优先路由（REQ-CHANNEL-002 修订：绑定 flow 不再直接触发，成为默认目标候选） | 改造 |

### 模块关系图

```
飞书 ──WSClient──> channelManager ──> imRouter（改造）
                                        │
                                        ▼
                              ┌──── agentRouter（新，三纯函数）────┐
                              │ ①绑定检查  ②命令识别  ③会话分发      │
                              │     │            │            │
                       E-AUTH-NOT-BOUND   命令直通       会话 key（feishu:<chatId>）
                                          （调命令模块）        │
                              ┌───────────────────────────────┘
                              ▼
                        agentService（主进程）
                              │ stdio IPC（自建协议 + 心跳看门狗）
                              ▼
                    ┌─── agent 子进程（PI SDK）───┐
                    │  AgentSession × N（多空间）  │
                    │  工具面：import CLI 命令模块  │←─ 高危拦截 ──> IPC ──> 确认服务（SQLite 挂起队列）
                    │  fauxProvider 可注入          │                  │
                    └─────────────────────────────┘                  ▼
                              │ 流式事件（text_delta/工具事件）  确认卡片 ──> 卡片渲染器 ──> adapter
                              ▼                                          ▼
                    会话卡片渲染器 ──> feishuChannelAdapter（sendCard/updateCardStream）
                              │
                       SQLite：agent_sessions / agent_confirmations
```

## 数据流

1. **消息对话（happy path）**：飞书消息 → WSClient → imRouter → agentRouter ①绑定检查（未绑定且未 arming → 拒绝 + 引导卡片；未绑定但 arming → 走绑定流程，见 5）→ ②命令识别（`/` 前缀命中 → 直通命令模块 → 格式化回复；未命中继续）→ ③会话分发（`feishu:<chatId>` 查 `agent_sessions`，无则创建 PI session + `session-config` 下发）→ IPC `prompt` → agent 子进程 → LLM（DeepSeek/Kimi）→ 工具调用（CLI 命令模块 → HTTP API → services）→ 流式事件回传 → 卡片渲染器 → 回复卡片流式更新。
2. **命令直通**：`/status <uuid>` → agentRouter 命令识别命中 → 主进程内直接调命令模块 → 格式化回复。不占 agent turn、未配 key 可用。
3. **下发任务 + 流式**：对话"跑一下日报"→ agent 识别意图（绑定 flow 为默认目标候选）→ 工具 `task run`（dispatch 级，直跑）→ 执行开始 → eventBus 执行事件 + agent 流式事件 → 卡片渲染器 → **任务卡片**流式更新 → 完成卡片。
4. **高危确认（解耦）**：对话"删除内容源 X"→ agent 工具 `source delete`（confirm 级）→ 命令模块拦截 → IPC `confirm-request`（含命令/参数/风险等级/会话）→ 确认服务入 `agent_confirmations` 队列 + 发确认卡片 → agent 该轮结束并回复"操作待确认" → 用户点击确认 → 回调 → 确认服务驱动同一命令模块执行（保险层已通过）→ 结果经 IPC `notify-result` 注入 agent 会话 → **agent 生成自然语言回投**（保持对话连贯性，W-2）。
5. **绑定（E3 + arming，W-1）**：Settings Agent 区显示"未绑定"→ 引导"打开飞书给机器人发一条消息"→ **用户点击"开始绑定"置 `pendingBind` 标记（一次性，可带有效期）** → 用户发送消息 → agentRouter 绑定检查发现未绑定 + `pendingBind` → 记录发送者 open_id 到 settings + 清除标记 → 回复"绑定成功"→ Settings 显示已绑定 + 解绑。
6. **看门狗重启**：agent 子进程崩溃 → 主进程检测 exit → 重启子进程 → 各会话按 `agent_sessions` 引用 + JSONL 重建（`SessionManager.open`，只丢半条流式消息）→ 恢复服务。
7. **配置变更（F-1）**：Settings 改供应商/key/身份 → 主进程 → IPC `session-config` → 子进程：systemPrompt 变更 → 存量会话热更新（config-ack）；provider/key 变更 → 该会话上下文重建（新 key 注入）→ ack。变更日志不含 key 值。

## 接口契约

### IPC 协议（主进程 ↔ agent 子进程，stdio JSONL，自建）

| 方向 | 消息类型 | 内容 |
|---|---|---|
| 主→子 | `session-config` | `{ sessionKey, provider, model, keyRef, systemPrompt }`（配置/凭证下发；keyRef = safeStorage 句柄引用，**一次性注入，不随 prompt 携带**） |
| 主→子 | `prompt` | `{ sessionKey, text }` |
| 主→子 | `notify-result` | `{ sessionKey, result }`（确认执行结果注入会话，agent 生成自然语言回投，W-2） |
| 主→子 | `confirm-result` | `{ confirmId, approved }`（确认回调驱动） |
| 主→子 | `cancel` / `reset-session` / `shutdown` | 会话控制 |
| 子→主 | `session-event` | `{ sessionKey, event }`（text_delta / tool_execution_* / turn_* / message_update） |
| 子→主 | `confirm-request` | `{ confirmId, sessionKey, command, args, riskLevel }` |
| 子→主 | `session-error` / `log` / `ready` / `config-ack` | 生命周期与日志 |
| 双向 | `ping` / `pong` | 心跳（看门狗，超时判定崩溃） |

**IPC 语义（W-6）**：
- **并发**：同 sessionKey 的 prompt **排队串行**（PI 原生消息队列，`streamingBehavior: followUp`）；跨空间并行（多 session 协作式交错）。
- **崩溃/重启中**：prompt 返回 `session-error {code: "restarting"}`，主进程缓存待会话就绪后重投；无法恢复的消息拒绝并提示稍后。
- **大小上限**：单条消息 ≤ 256KB（先行约束来自飞书文本消息 150KB 上限）；超限截断或降级为文件引用。
- **secret 约束（F-1）**：key 经 `session-config` 一次性注入后**不落日志、不进 JSONL 会话文件**（子进程仅持内存值）。

### agentRouter（三纯函数）

| 项目 | 说明 |
|---|---|
| 输入 | `{ message, chatId, senderId, channelType }` |
| 输出 | `{ action: "reject" \| "command" \| "dialogue", payload }` |
| 业务错误 | `E-AUTH-NOT-BOUND`（未绑定）/ `E-CMD-INVALID`（命令参数错） |
| 幂等性 | 是（纯函数，无副作用） |

### 命令保险层钩子（C2）

| 项目 | 说明 |
|---|---|
| 声明 | 命令模块导出 `{ riskLevel: "query" \| "dispatch" \| "confirm" }`（映射见 PRD §7.2） |
| 生效范围 | 仅 agent 工具路径；人类 CLI 路径不拦截（用户本人直接操作） |
| 拦截行为 | confirm 级 → IPC `confirm-request` → 挂起队列 → 确认回调后继续/中止 |

### 确认服务（b 解耦）

| 项目 | 说明 |
|---|---|
| 存储 | SQLite `agent_confirmations`（confirmId/会话/命令/参数/状态: pending\|approved\|rejected） |
| 执行驱动 | 回调 `approved` → 主进程内调同一命令模块（C2 路径）→ 结果回投会话 |
| 幂等性 | 是（confirmId 唯一，回调一次生效） |

### 会话 key 与 sessionStore

- 空间 key：`feishu:<chatId>`（单聊/群聊以 chatId 区分；UI copilot 入口 `ui:copilot` 留待下一 story）。
- `agent_sessions`：`spaceKey / sessionRef（JSONL 路径）/ createdAt / lastActiveAt / summaryRef（压缩摘要索引）`。
- 恢复：空间消息 → 查表 → 无 → 创建新 PI session；有 → `SessionManager.open(path)` 续上下文。

### 卡片渲染器 → adapter

- 卡片类型：回复卡片（agent 对话流式）、任务卡片（flow 执行进度 + 流式文本）。
- adapter 新接口：`sendCard({chatId, cardJson})` / `updateCardStream({cardId, content, sequence})`（CardKit streaming_mode，sequence 严格递增；10 分钟窗口自动关闭 → 降级普通消息 + 提示 /status）。

## 测试 seams

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| S1 供应商/key 配置 | settings HTTP API + 配置服务 | 单元 | 真实（临时目录） |
| S2 身份/系统提示词 | settings API + agent 适配层 | 单元 | fake adapter |
| S3 PI 对话内核 | agent 子进程适配层 + **fauxProvider()**（官方测试 provider，零网络脚本化流式） | 单元 + 集成 | mock（faux） |
| S4 session 持久化 | sessionStore（SQLite 临时库）+ 重启恢复流程 | 单元 | 真实（临时库） |
| S5 CLI 工具面 | 命令模块 riskLevel 声明 + 工具适配器 | 单元 | 真实命令模块 + 内存 server |
| S6 授权与确认 | agentRouter 纯函数 + 确认服务状态机 | 单元 + 集成 | 临时 SQLite |
| S7 飞书对话入口 | imRouter/agentRouter + 飞书 adapter（fake 断言，沿用 REQ-CHANNEL 模式） | 单元 + E2E | mock（adapter） |
| S8 CardKit 流式 | 卡片渲染器 + adapter 卡片接口（fake 断言结构） | 单元 | mock（adapter） |
| S9 斜杠命令 | agentRouter 命令识别 + 命令格式化 | 单元 | 真实命令模块 |

- 对话回路集成测试：fauxProvider 注入 → NL → agent → CLI 工具 → 回复 闭环（内存版 IPC，不 spawn 真进程的快速路径 + 真子进程的慢速路径各一套）。
- 看门狗：子进程 kill → 断言重启 + 会话恢复（真实 spawn，临时目录）。
- E2E（Playwright Electron）：Settings Agent 配置区、绑定引导、飞书 fake 通道对话。

## 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| **A2：PI SDK 独立 agent 子进程**（ADR-014） | A1 进程内（官方推荐）/ A2 子进程 / A3 RPC | Electron 崩溃隔离（agent 致命错误 ≠ 应用崩）+ SDK 一进程多会话（07 多空间并发）；官方推荐未考虑桌面场景 | 无官方背书；自建 IPC/看门狗 |
| **B1：PI JSONL 真相 + SQLite 元数据** | B1 / B2 SQLite 全量 / B3 纯 PI | 会话恢复需完整协议状态（原生 JSONL）；平台语义（空间/确认/摘要）由 SQLite 自持 | JSONL 格式随 PI 版本升级兼容（锁版本 + spike） |
| **C2：工具面 import CLI 命令模块** | C1 spawn / C2 / C3 直调 API | 保险层单点（riskLevel 声明一处实现两端生效）；避开 spawn 开销与 asar 路径 | 命令模块与 agent 进程耦合（同进程 import） |
| **b：确认与执行解耦** | a 阻塞 / b 解耦 | "挂起可稍后处理"（07）真实成立；规避 PI `timeoutMs`（10 分钟）冲突 | 确认执行上下文序列化；结果回投链路 |
| **D1：路由三纯函数在主进程** | D1 / D2 agent 内识别 | 命令直通独立于 LLM/agent 存活（§7.1：未配 key 可用）；三函数可单测 | 路由层与 agent 双份消息处理 |
| **E3：发消息即绑定** | E1 手填 / E2 卡片确认 / E3 引导即绑定 | 零门槛 onboarding；机器人凭据用户自持，未绑定期窗口风险低 | "谁先发消息谁绑定"歧义（Settings 解绑兜底） |
| **F1：卡片能力入通道适配器** | F1 / F2 独立服务 | 通道能力内聚（ADR-007 边界）；channelManager 唯一入口 | 卡片渲染器与 adapter 的契约稳定性 |

## 风险与回流点

| 假设 | 若错则 | 回流层 |
|---|---|---|
| pi-ai DeepSeek/Kimi provider 实际工具调用质量（结构已验证，体验未测） | 供应商体验差 | TECH-DESIGN（配置层加 models.json 自定义端点兜底） |
| PI JSONL / SDK API 随版本升级兼容 | 会话恢复失效 | TECH-DESIGN（锁定版本 + spike 验证恢复） |
| CardKit 流式客户端版本门槛（7.20+/7.23+） | 流式不可用 | 设计降级路径（普通消息 + /status）已内建，无需回流 |
| Electron 打包（asar）下 agent 子进程入口 spawn 路径 | 子进程起不来 | TECH-DESIGN（spike 验证；兜底：解包 asar 或独立 node 入口） |
| Electron safeStorage 在无钥匙串环境（Linux）降级 | key 不可存 | TECH-DESIGN（降级方案：加密存储或明文+警告） |
| 飞书指令菜单能力（M1 移动块） | 命令菜单不可用 | 已定降级纯文本解析，不构成回流 |

## 前置 spike 项（BUILD 前；列为 signoff 前置验证项，结晶时写入 requirements.md 假设 + 验证方式，W-5）

1. asar 打包下 agent 子进程 spawn 路径验证。
2. PI 会话自定义目录（避开 `~/.pi`）+ `SessionManager.open` 恢复验证（B1 根基）。
3. fauxProvider 注入到 `createAgentSession` 的最小示例（S3 测试 seam 落地）。
4. CardKit 卡片流式最小调用（消息发送 + sequence 递增更新 + 10 分钟窗口行为）。

## 术语登记（W-4）

结晶前补跑 `/domain-model` 登记新术语：**对话空间（spaceKey）**、**绑定（open_id 单用户绑定）**、**确认挂起（pending confirmation）**；含 ui-copilot story 的 `ui:copilot` 空间 key 预留语义。
