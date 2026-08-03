# Review 报告 — 内置对话 Agent（飞书入口） / tech

> 故事 ID：`2026-08-02-builtin-agent`
> 审查阶段：`tech`
> 日期：2026-08-03
> 输入：PRD v0.3、tech-design v1、ADR-001~014、CONTEXT.md、STANDARDS.md、architecture.md、research/4 份（存在性确认）

---

## 审查摘要

- **总体结果**：FAIL（1 阻塞项，就地补 tech-design 即可，无需回流）
- **阻塞项数量**：1
- **警告项数量**：6

---

## 审查项

| 维度 | 结果 | 说明 |
|---|---|---|
| 对齐 PRD | PASS | S1~S9 全部稳定块均有模块与数据流落点（S1/S2→settings 扩展，S3→agent 子进程，S4→sessionStore+B1，S5→CLI 命令模块+C2，S6→agentRouter+确认服务+b，S7→imRouter 改造+D1，S8→卡片渲染器+F1，S9→命令识别）；范围外项未被顺手纳入 |
| 模块边界 | WARN | 各模块职责单一清晰；唯 agentService「会话注册表」与 sessionStore（SQLite `agent_sessions`）存在职责重叠风险，需明确谁是真相（见 W-3） |
| 接口契约 | FAIL | agentRouter/确认服务/保险层钩子四要素齐全；但 IPC 协议缺配置/凭证下发通道（F-1），确认结果回投链路未闭环（W-2），IPC 错误/并发语义未定义（W-6） |
| 测试 seams | PASS | 9 个稳定块逐块有 seam 表；fauxProvider（官方零网络 provider）落地 S3；对话回路快/慢双路径 + 看门狗 kill 恢复测试 + E2E 分层合理 |
| 复杂度 | PASS | 自建子进程+IPC+看门狗是最大复杂度增量，但 ADR-014 已完整记录取舍（崩溃隔离 vs 官方进程内推荐），非过度设计；双运行时由 ADR-013 背书 |
| 风险 | PASS | 风险表 6 条均标回流层；spike 4 项明确；唯 spike 完成判定点未挂流程（W-5） |
| ADR 覆盖 | PASS | ADR-013/014 满足三条件且已写入；与 ADR-001（命令经 HTTP API）、ADR-006（server 仍单一，子进程是客户端）、ADR-007（F1 卡片能力内聚 adapter）均无冲突；REQ-CHANNEL-002 修订已在 PRD §13 显式声明接替关系 |
| 术语一致性 | WARN | 用语与 CONTEXT.md 一致（通道绑定/执行/通道）；但新增概念「对话空间 / 绑定 / 确认挂起」未入 CONTEXT.md，且 DOMAIN-MODEL 阶段被跳过（W-4） |
| 标准 | PASS | 符合 STANDARDS.md：safeStorage 存 key 明文不落盘、服务层单例/惰性初始化无冲突、表名小写复数（agent_sessions/agent_confirmations） |

---

## 阻塞项（建议修复或回流）

- [ ] **F-1 接口契约：IPC 协议缺配置/凭证下发通道**
  - 问题：S1（供应商/API key/模型）与 S2（身份/系统提示词）配置存于主进程（safeStorage + settings），但 IPC 主→子消息只有 `prompt / confirm-result / cancel / reset-session / shutdown`——agent 子进程创建 `AgentSession` 所需的 provider、key、system prompt 没有任何送达机制。运行时改配置（换供应商/改身份）后存量会话如何生效也未定义。同时 key 属 secret，传输路径需要约束（不进 IPC 日志、不落 JSONL 会话文件）。
  - 建议：在「接口契约」补一个 `session-config`（或 `configure`）消息类型（含 provider/model/keyRef/systemPrompt 字段，key 建议以引用或一次性注入而非每次 prompt 携带），并在「数据流」补一条「配置变更 → 子进程会话更新（或重建）」；写明 secret 约束（不记日志、不进 JSONL）。
  - 建议动作：**就地补 tech-design（一挡内修订），修复后重审**。不需回流 PRD——PRD §10 已声明「PI 集成形态 tech-design 定稿」，此缺口属于方案层。

---

## 警告项（建议但不阻塞）

- [ ] **W-1 接口契约：绑定 arming 条件自相矛盾**
  - 问题：数据流 1「未绑定 → 拒绝 + 引导卡片」与数据流 5「未绑定消息即绑定发送者 open_id」对同一状态给出两种行为。E3 的真实语义应是「Settings 发起引导后，下一条未绑定消息才执行绑定」，arming 前提未写进契约。
  - 建议：在 agentRouter 契约或绑定数据流中写明绑定窗口的触发条件（如 settings 中置 `pendingBind` 标记 + 有效期/一次性），否则结晶时 REQ 无法写验收标准。

- [ ] **W-2 接口契约：确认执行结果回投会话的链路未闭环**
  - 问题：数据流 4 结尾「结果投递回会话」，但 IPC 主→子无消息注入类型；结果是由 agent 续聊生成自然语言回复，还是确认服务 → 卡片渲染器直接出结果卡片？两条链路用户体验与测试 seam 都不同。
  - 建议：明确选其一（建议：结果经 IPC 注入 agent 会话，由 agent 生成回投，保持对话连贯性；或声明「结果卡片直通渲染器，不进会话上下文」），并补对应消息类型。

- [ ] **W-3 模块边界：agentService「会话注册表」与 sessionStore 职责重叠**
  - 问题：agentService 职责含「会话注册表」，sessionStore 又持 `agent_sessions` 表——内存注册表与 SQLite 表谁是真相、崩溃后如何对账未说明。
  - 建议：声明 SQLite 表为真相、内存注册表仅为活跃句柄缓存（随看门狗重启重建），一句话即可。

- [ ] **W-4 术语一致性：新术语未入 CONTEXT.md，DOMAIN-MODEL 阶段被跳过**
  - 问题：「对话空间（spaceKey）」「绑定（open_id 单用户绑定）」「确认挂起（pending confirmation）」是跨 story 复用语（ui-copilot story 马上要用对话空间），但未登记；workflow-state 历史 THINK→PRD→TECH-DESIGN 跳过了 DOMAIN-MODEL。
  - 建议：结晶前补跑 `/domain-model` 登记这三个术语（含 ui-copilot 的 `ui:copilot` 空间 key 预留语义）。

- [ ] **W-5 风险：spike 4 项无流程挂点**
  - 问题：「前置 spike 项（BUILD 前）」列出 4 项，但当前 phase 已到 CRYSTALLIZE，spike 结果没有落点（不进 REQ 也不在 signoff 检查项里），存在被遗忘风险；其中 spike 2（SessionManager.open 恢复）是 B1 的根基、spike 3（fauxProvider 注入）是 S3 唯一 seam，失败会动摇方案。
  - 建议：结晶时把 spike 1~4 列为 signoff 前置验证项（或在 requirements.md 中记为假设 + 验证方式），spike 失败的回流层已在风险表声明，保持可追溯即可。

- [ ] **W-6 接口契约：IPC 并发/错误语义未定义**
  - 问题：同一 sessionKey 并发 prompt（用户连发两条）是排队、steer 还是拒绝？prompt 发往已崩溃/重启中的会话返回什么？IPC 消息有无大小上限（长文本/工具结果）？
  - 建议：在 IPC 表后补 3~5 行语义说明（排队策略 + `session-error` 覆盖场景 + 大小限制），不必展开实现。

另：PRD §7 的「测试连接」（保存前验证 key 可用）在 tech-design 无模块/接口落点，建议结晶时确认归入 settings HTTP API 即可，不构成 review 问题。

---

## 结论

- [ ] 可进入下一阶段
- [x] 需修复阻塞项后重审（F-1 就地补 tech-design 接口契约节，工作量约一节内容）
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `BUILD`

**总体判断**：方案骨架扎实——模块边界清晰、决策全部有 ADR 背书、测试 seam 逐块落实、风险与回流点诚实。唯一硬伤是 IPC 契约不闭环（配置/凭证下发 + 确认回投），属于"补一节"级别的修复，不动摇方案本身。修复 F-1（顺带 W-1/W-2 两条契约语义）后可直接进入结晶。

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：接受 / 有条件接受 / 不接受

**理由**：

**下一步动作**：
