# 内置对话 Agent（飞书入口）

> 状态：探索期
> 故事 ID：`2026-08-02-builtin-agent`
> 最后更新：2026-08-03
> 输入：`interview-notes.md` + wayfind `builtin-agent`（map + 8 票决议）+ ADR-013
> 前置调研：wayfind `research/pi-toolbox.md`（PI 能力边界）、`research/feishu-streaming.md`（CardKit 流式）

---

## 1. 问题陈述

平台的 AI 能力依赖本机 Claude Code 环境——新用户安装应用后没有这个环境，用不了任何 AI 能力；而想用 agent 的用户还必须手动搭 flow（画图、配节点）才能触发一次 agent 执行。同时，人不在电脑前时，无法了解平台正在进行的任务、无法下发任务——飞书里现在只能固定触发绑定 flow，不能自由对话。

## 2. 解决方案

内置一个**随应用分发、零本机依赖**的对话 agent（底层 = PI 运行时，ADR-013；LLM 供应商 = DeepSeek/Kimi，仅需 API key，存系统 keychain）。飞书即第一入口：

- 自然语言对话（"看看执行情况""跑一下日报流程"）+ 斜杠命令（/status /list /reset /help 确定性直通）
- agent 的工具面 = `opc-workstation` CLI 命令（除 release 外全量），**CLI 即控制面**（保险层，后续可收紧）
- 任务执行进度以 CardKit 卡片流式呈现到飞书
- 高危操作（删除/配置变更/取消类）卡片确认、挂起可稍后处理；下发/查询直跑
- 单用户绑定（飞书 open_id），未绑定用户不能操作
- 会话按对话空间持久化（SQLite），跨重启延续，对话过长滚动摘要压缩

UI copilot 面板（`2026-08-02-ui-copilot`）消费同一内核，本 story 不做。

## 3. 用户故事

1. 作为新用户，我想要在设置里配置 LLM 供应商与 API key（DeepSeek/Kimi），以便不安装任何 agent 工具就能使用内置 agent。
2. 作为用户，我想要自定义 agent 的身份/语气/额外指令，以便它符合我的使用习惯（内置基础身份保证平台能力正确使用）。
3. 作为用户，我想在飞书里用自然语言问"执行情况怎么样"，以便不在电脑前也能了解正在进行的任务。
4. 作为用户，我想在飞书里对话下发任务，以便远程启动流程。
5. 作为用户，我想看到任务执行的实时进度（卡片流式），以便了解执行过程而不只是结果。
6. 作为用户，我想要高危操作先确认（卡片挂起、随时可点），以便误操作可控。
7. 作为用户，我想用 /status、/list 等命令快速直达查询，以便不经过对话等待。
8. 作为用户，我想对话跨应用重启延续、可显式 /reset 重置，以便长对话不丢失。
9. 作为未绑定用户，我发消息应被拒绝，以便平台数据不被他人操作。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| S1 | LLM 供应商与 API key 配置 | wayfind 访谈拍板：Settings > Agent 配置区，多供应商选择器，首版 DeepSeek + Kimi（pi-ai 内置支持，含国内/海外双端点），key 存系统 keychain |
| S2 | agent 身份与系统提示词 | 访谈拍板：内置基础身份固定（平台助手 + 工具面说明 + 授权/确认/流式汇报行为规则）+ Settings > Agent 全局自定义（名称/语气/额外指令），所有对话空间共享；沿 REQ-FLOW-014 systemPrompt 契约模式 |
| S3 | PI 对话内核 | wayfind 05 + ADR-013 拍板：底层 = PI；与 flow 节点 Claude Agent SDK 双运行时并存；多轮对话 + 流式事件；上下文不流入执行（执行独立，状态靠查询） |
| S4 | 对话 session 持久化 | wayfind 07 拍板 + tech-design B1：PI JSONL 会话树 = 运行时真相（协议细节、SDK 原生恢复）；SQLite `agent_sessions` 表 = 平台元数据（空间 ↔ 引用/确认队列/摘要索引）；按对话空间分（飞书单聊/群聊各一）；不超时 + 显式 /reset；对话过长滚动摘要压缩 |
| S5 | CLI 工具面 | wayfind 03 + 06 拍板：除 release 外全量 CLI 命令为 agent 工具；CLI 即控制面（保险层，后续命令白名单/确认钩子）；不给原始 FS/DB 工具 |
| S6 | 授权与确认 | wayfind 06 拍板 + tech-design E3/b：飞书单用户绑定（open_id，Settings 引导"发一条消息即绑定" + 可解绑）；高危（删除/配置变更类）卡片确认、**确认与执行解耦**（回调驱动执行，挂起队列 = SQLite 真相）；下发/查询直跑；未绑定用户一切消息拒绝（含查询，2026-08-03 拍板） |
| S7 | 飞书对话入口 | wayfind 02 拍板 + tech-design D1：飞书 = 第一入口（与 UI copilot 独立 story 并行）；复用现有通道（REQ-CHANNEL-001~005、ADR-007）接收/发送/去重；**路由 = agent 优先**：主进程路由层 = 绑定检查 + 斜杠命令识别 + 会话分发三纯函数；绑定 flow 不再直接触发（**修订 REQ-CHANNEL-002**），绑定成为 agent 下发任务的默认目标候选 |
| S8 | CardKit 卡片流式输出 | wayfind 04 调研拍板：卡片流式更新（streaming_mode）是唯一可行路径；约束：流式核心需客户端 7.20+（自定义打印参数需 7.23+）、流式窗口 10 分钟自动关闭、卡片实体一次发送 |
| S9 | 斜杠命令 | wayfind 08 拍板：双轨——/status /list /reset /help 确定性直通（不走 LLM）+ 自然语言走 agent；飞书指令菜单呈现（待验证）；/run /cancel 明确不做 |
| S10 | Settings 页 tab 化与分区保存 | 2026-08-05 UX 原型拍板（`ux/settings-tabs.html`，源自 BUG-003 会话登记的 UX 诉求）：设置页改四 tab——通用 / Agent 配置 / 飞书通道 / 关于与更新；每 tab 区内独立保存（原右上角全局保存移除）；tab 切换保留未保存编辑；关于 tab 只读无保存；Agent 区 keepExistingKey 逻辑不变（未输新 key 保留原 key）；API key 输入框 placeholder 强化为「已加密存储，输入则更换」（回应"空框=丢配置"观察误读） |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| M1 | 飞书指令菜单的具体配置 | 飞书"应用指令"能力与配置成本未验证（tech-design 验证；不支持则降级纯文本解析） |
| M2 | 确认挂起队列的可见性 | 被忽略的确认项如何查看/撤销（飞书待确认卡片列表？），设计未定 |
| M3 | 上下文压缩触发阈值 | 滚动摘要的触发时机与 token 预算、保留策略未定 |
| M4 | 对话回复语言/时区 | 跟随系统设置还是独立配置未定（默认建议：跟随系统） |

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | Settings > Agent 选择供应商（DeepSeek/Kimi）、粘贴 API key、保存 | 保存到 keychain；显示"已配置"状态 | S1 |
| 2 | Settings > Agent 自定义身份（名称/语气/额外指令） | 保存并生效到所有对话空间 | S2 |
| 3 | 飞书单聊发"看看最近的执行情况" | agent 经 CLI 查询 execution → 文本回复列表 | S3+S5+S7 |
| 4 | 飞书单聊发"跑一下日报流程" | agent 定位 flow → task run → 执行开始 → 卡片流式进度 → 完成卡片 | S3+S5+S7+S8 |
| 5 | 飞书单聊发"删除内容源 X" | agent 识别高危 → 卡片确认挂起 → 用户点确认 → 执行 → 结果回复 | S6 |
| 6 | 飞书发 `/status <id>` | 命令直通 CLI → 格式化回复 | S9 |
| 7 | 飞书发 `/reset` | 重置当前对话空间会话 | S4 |
| 8 | 应用重启后继续对话 | session 从 SQLite 恢复，上下文延续 | S4 |
| 9 | 未绑定用户给机器人发消息 | 拒绝回复（提示需绑定，含查询） | S6 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 未配置供应商 key | 对话引导去 Settings 配置 | E-AGENT-NO-KEY |
| 供应商 key 无效/欠费/限流 | 对话明确报错；流式卡片失败时降级普通消息 | E-AGENT-LLM-FAIL |
| 高危确认卡片发出后用户不点 | 操作挂起（不超时拒绝），用户随时可确认 | E-CONFIRM-PENDING |
| CardKit 流式 10 分钟窗口关闭 | 降级普通消息 + 提示用 /status 查询 | E-CARD-STREAM-CLOSED |
| 未绑定用户发消息（含群聊非绑定者） | 拒绝回复（提示需绑定，读也拒） | E-AUTH-NOT-BOUND |
| CLI 工具执行失败 | 错误回投对话，用户可见 | E-AGENT-CLI-ERROR |
| 飞书发送失败 | 复用 E-CHANNEL-SEND 告警重试，不阻断对话 | E-CHANNEL-SEND |
| 对话过长触发压缩 | 旧上下文滚动摘要化（用户无感，可在状态里提示） | —（无错误） |

## 7. 表单与输入验证（Form / Input Validation）

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| 供应商选择 | 枚举 {deepseek, kimi}，必选；切换供应商时校验对应 key | "请选择供应商" | E-CONFIG-INVALID |
| API key | 仅非空（前缀不校验，准确性由用户负责，2026-08-03 签核拍板）；保存前可"测试连接"验证 | "API key 不能为空" | E-CONFIG-INVALID |
| 自定义身份（名称/语气/指令） | 长度上限（如 2000 字符）；可留空 = 用内置默认 | "身份配置过长" | E-CONFIG-INVALID |
| `/status <id>` | id 必填、UUID 格式（execution.id = `crypto.randomUUID()`，非整数） | "用法：/status <executionId>" | E-CMD-INVALID |
| `/list [project|flow 过滤]` | 可选参数，格式校验 | "用法：/list [projectId|flowId]" | E-CMD-INVALID |
| `/reset` | 无参数 | "用法：/reset" | E-CMD-INVALID |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 错误状态 |
|---|---|---|
| 未配置 key 时 agent 对话不可用（命令直通仍可用） | 对话开始 | E-AGENT-NO-KEY |
| 单用户绑定：仅绑定 open_id 可与 agent 对话；未绑定用户一切消息拒绝（含查询，2026-08-03 拍板） | 消息路由 | E-AUTH-NOT-BOUND |
| 高危判定规则化：命令→风险等级映射见 7.2 | CLI 工具调用前 | E-CONFIRM-PENDING |

### 7.2 命令→风险等级映射（S6 可测化，审查 W-4 补全）

| 风险等级 | 命令 | 行为 |
|---|---|---|
| 直跑-查询 | task list/get、flow list/get、project list/get、schedule list、skill list/agents、source list、channel binding/status、settings get、notify list/read、dashboard stats | 不经确认直接执行 |
| 直跑-下发 | task run | 直接执行（对话下发） |
| 高危-确认 | project create/update/skill、flow create/import/export、schedule create/toggle、skill install/update/remove、source create/update/toggle/delete、channel bind/credentials/reconnect、settings set | 卡片确认挂起，用户确认后执行 |
| 永不开放 | release | 拒绝（§12） |

> 注：创建类写命令也归入确认——对 wayfind「删除/配置变更」规则的可测化扩展（更保守，符合"CLI 保险层"取向），后续可在保险层放开。

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| 未配置 LLM | agent 对话（非命令）时无 key | E-AGENT-NO-KEY："请在设置中配置 Agent API key" | 对话内引导文案 | 无 |
| LLM 调用失败 | 供应商超时/限流/key 无效 | E-AGENT-LLM-FAIL（透传供应商错误） | 对话内错误回复 | 会话可继续 |
| CLI 工具失败 | agent 调 CLI 命令返回错误 | E-AGENT-CLI-ERROR（透传 CLI 错误码） | 对话内错误回复 | 无部分写入（CLI 事务性） |
| 飞书发送失败 | 通道不可用/限流 | E-CHANNEL-SEND（复用现有，重试 ≤3） | 告警日志；对话侧可见重试 | 无 |
| 流式窗口关闭 | 卡片流式 10 分钟自动关闭 | E-CARD-STREAM-CLOSED | 降级普通消息 + 提示 /status 查询 | 无 |
| 高危确认挂起 | 确认卡片未响应 | E-CONFIRM-PENDING | 卡片常驻可点；操作未执行 | 操作不执行（幂等） |
| 未绑定用户消息 | 非绑定 open_id 发消息 | E-AUTH-NOT-BOUND | 拒绝回复（含查询） | 无 |
| session 持久化失败 | SQLite 写入失败 | E-SESSION-PERSIST | 对话可用但重启不恢复（告警日志） | 内存态继续 |
| 命令参数无效 | /status 缺 id 等 | E-CMD-INVALID | 用法提示 | 无 |
| PI 运行时异常 | agent 循环崩溃/卡死 | E-AGENT-RUNTIME | 错误回复 + 会话可重建 | 重建 session |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 稳定块 9 个；外部依赖 3 类（PI 运行时、DeepSeek/Kimi 供应商、飞书 API）；跨进程（Electron 主进程/服务进程 ↔ agent 运行时）；输入分支多（自然语言 + 命令 + 确认回调 + 流式事件）；授权/确认状态机 |

## 10. 实现决策（高层，不写代码）

- **PI 集成形态（A2，tech-design 定稿）**：PI SDK 跑在平台新增的**独立 agent 子进程**，主进程经自建 stdio IPC 通信，自建看门狗重启。官方推荐 Node 宿主进程内 SDK，本方案偏离以获得崩溃隔离（ADR-014）。
- **会话存储（B1）**：PI 自带 append-only JSONL 会话树 = agent 会话运行时真相（SDK `SessionManager.open` 恢复）；SQLite 新增 `agent_sessions` 表存平台侧元数据（对话空间 ↔ session 引用、确认挂起队列、压缩摘要索引）。
- **CLI 工具面（C2）**：agent 工具 = 进程内 import 同一 CLI 命令模块（保险层钩子 = 命令模块层声明的风险等级 + 确认前置，一处实现两端生效）；命令经现有 HTTP API（ADR-001）调服务层。
- **确认与执行解耦（b）**：高危命令被拦截 → agent 回复"待确认"并结束该轮 → 确认回调驱动执行（同一命令模块）→ 结果回投会话；挂起队列 = SQLite 真相。
- **命令识别（D1）**：主进程路由层 = 绑定检查 + 斜杠命令识别 + 会话分发三纯函数；命令直通不占 LLM/agent turn，未配 key 也可用。
- **绑定（E3）**：Settings 引导"去飞书发一条消息"→ 未绑定消息即绑定发送者 open_id → Settings 显示已绑定 + 解绑。
- **卡片（F1）**：扩展 feishuChannelAdapter 新增 sendCard/updateCardStream；会话卡片渲染器（主进程）把 agent 事件/执行事件 → 卡片构建/更新指令。
- **keychain 存储**：Electron `safeStorage`（macOS 走 Keychain）；key 明文不落 settings JSON。
- **测试 seam**：pi-ai 官方 fauxProvider()（零网络、脚本化流式响应）——对话回路测试不真调 DeepSeek/Kimi。

## 11. 测试决策

- 单元 + 集成（`node --test`，沿用 `tests/capabilities/` 组织）：配置服务、PI 适配器（fake provider）、session 存储、授权/确认状态机、命令解析、工具面适配。
- E2E（Playwright Electron）：Settings Agent 配置区 UI、飞书通道（fake 断言，沿用 REQ-CHANNEL 模式）、卡片发送结构。
- 对话回路集成测试（fake LLM）：NL → agent → CLI 工具 → 回复 的闭环。
- 主观/观感（卡片视觉效果）不设自动化测试，REFLECT 人工验收。

### 11.1 覆盖接缝（coverage seams）

| 稳定块 | seam | 测试类型 |
|---|---|---|
| S1 供应商/key 配置 | settings HTTP API + 配置服务 + Settings 页 | 单元 + E2E |
| S2 身份/系统提示词 | settings API + agent 适配层（注入断言） | 单元 |
| S3 PI 对话内核 | PI adapter（fake provider 注入） | 单元 + 集成 |
| S4 session 持久化 | session 存储服务（SQLite，临时库） | 单元 |
| S5 CLI 工具面 | 工具面适配器（命令调用 + 错误透传） | 单元 |
| S6 授权与确认 | 授权服务 + 确认状态机 | 单元 + 集成 |
| S7 飞书对话入口 | imRouter 分发 + 飞书 adapter（fake，沿用 REQ-CHANNEL 模式） | 单元 + E2E |
| S8 CardKit 流式 | 卡片构建/发送服务（fake 断言结构） | 单元 |
| S9 斜杠命令 | 命令解析器 | 单元 |

## 12. 范围外

- UI copilot 面板（独立 story `2026-08-02-ui-copilot`）。
- flow 内 agent 节点运行时迁移/扫描本机 agent 回退 PI（独立 story，已记 ADR-013）。
- release 命令触发；取消执行能力（wayfind 08 决议不做）。
- 飞书之外的多通道接入。
- 多用户/多组织/团队协作。

## 13. 补充说明

- **分层交付里程碑**（访谈确认的方向 B，供实现排期）：
  - M1 对话查询回路：飞书单聊 NL → PI agent → CLI 查询工具 → 文本回复（覆盖 S1/S2/S3/S4/S5/S7 主干）
  - M2 任务下发 + 流式：对话下发任务 → 执行 → CardKit 卡片流式进度（覆盖 S8 + S5 写路径）
  - M3 命令 + 确认：斜杠命令（S9）+ 高危确认挂起（S6 完整）
- **双运行时**：内置 agent = PI（本 story）；flow agent 节点 = Claude Agent SDK 不动（ADR-013）。两套凭证/依赖模型并存。
- **REQ-CHANNEL-002 修订声明**（2026-08-03 用户拍板 agent 优先）：IM 消息路由不再"命中绑定 → createTask 直接触发"，改为全量进 agent 对话；绑定（channel_bindings）语义降级为"agent 下发任务的默认目标候选"。此为对已签核契约（2026-07-19-media-production-line）的行为变更，结晶时需显式处理旧 REQ 的接替关系。
- **与现有飞书通道的关系**：复用不重造——接收/发送/去重沿用 REQ-CHANNEL-001~005；settings 中已有飞书关联配置。
- **前置验证项**（tech-design 前 /research 或 spike）：pi-ai 的 DeepSeek/Kimi provider 工具调用细节；飞书指令菜单能力与配置；pi-ai provider 注入（测试 seam）；PI 集成形态定稿。
- wayfind 完整决策记录：`.aiassist/wayfind/builtin-agent/`（map + 8 票）；调研笔记：`research/pi-toolbox.md`、`research/feishu-streaming.md`。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | 9 个稳定块均有 happy path（6.1）；分支异常 8 条（6.2） |
| 输入验证 | PASS | S1/S2/S9 有输入 → 字段级规则（7）；S3/S4/S5 无直接用户输入，规则在 7.1 业务规则 |
| 错误状态 | PASS | 10 类失败模式（8），覆盖外部依赖（LLM/飞书/PI）与业务规则 |
| 复杂度分级 | complex | 见第 9 节理由 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-03 | 初稿（interview-notes + wayfind 决议 + ADR-013 合成） | AI + 人 |
| v0.2 | 2026-08-03 | review 修复：F-1 未绑定读权限一致化（全部拒绝，拍板）；F-2 /status 校验改 UUID；W-2 高危分类去取消类；W-4 新增 7.2 命令→风险等级映射表；W-5 客户端版本 7.20+/7.23+ 细分；W-3 路由 = agent 优先（拍板，REQ-CHANNEL-002 修订声明） | AI + 人 |
| v0.3 | 2026-08-03 | tech-design 反向同步（7 决策写回 §10）：A2 独立 agent 子进程 / B1 JSONL+SQLite 元数据 / C2 命令模块工具面 / b 确认解耦 / D1 路由三纯函数 / E3 发消息即绑定 / F1 卡片入适配器 | AI + 人 |
