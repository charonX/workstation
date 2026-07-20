# Review 报告 — 媒体生产线 · 收集管线 / TECH-DESIGN

> 故事 ID：`2026-07-19-media-production-line`
> 审查阶段：`tech`
> 日期：2026-07-19

---

## 审查摘要

- **总体结果**：FAIL
- **阻塞项数量**：3
- **警告项数量**：6

方案主干质量高：模块边界清晰、6 张接口契约表四要素齐全、测试 seams 与 11 个稳定块一一对应、风险表每条都带回流点与快速验证方式、ADR-006 已按三条件补建。但场景 B 主链路上有一个未定义的数据模型环节（通道绑定与 IM→项目路由），两个 PRD 白纸黑字交办 tech-design 的决策未作答，结晶前必须补齐。

---

## 审查项

| 维度 | 结果 | 说明 |
|---|---|---|
| 对齐 PRD | FAIL | 11 个稳定块均有模块承载与 seam 映射；但 PRD 交办的两项决策未落定（内容源归属、通知清理规则），且通道绑定的存储与路由规则缺失（见阻塞项 1、2） |
| 模块边界 | FAIL | 各新模块职责单一；但飞书"完成/失败回复"的发送责任方未定，且与 PRD §10.1 "taskService 不感知触发来源类型"边界存在未裁决冲突（见阻塞项 3） |
| 接口契约 | WARN | 6 张契约表均有输入/输出/业务错误/系统错误/副作用/幂等；缺 schedulerService 契约表，createTask 的 draft 拒绝未限定 trigger 范围（见警告项 2、3） |
| 测试 seams | WARN | 11 个稳定块逐一映射，真实文件断言符合 STANDARDS 红线；但 ADR-006 要求的 userData→`~/.opc-workstation` 数据迁移无实现条目也无 seam（见警告项 5） |
| 复杂度 | PASS | channelAdapter 单实现抽象有范围外 #13 多通道预留背书；per-project 串行有 3 秒时限背书；单 server 顶替经 ADR-006 备选推死分析。无过度设计 |
| 风险 | WARN | 5 条风险均含"错了怎样/回流到/能否快速验证"，WSClient domain spike 列为第一切片正确；缺队列无界与抓取内容 prompt injection 两条（见警告项 6） |
| ADR 覆盖 | PASS | ADR-006 已建且含迁移影响；其余决策（JSON 列、明文凭据+600、convert 通路、tenant_readable）可逆或局部，记关键决策表足够。与 ADR-001/002/003/004/005 无冲突（逐一核对：新路由走 HTTP API ✓、skill 经 skillService 安装 ✓、agent 沿用 Claude SDK ✓、E2E 用 Playwright ✓） |
| 术语一致性 | PASS | 内容源/通知/通道/素材库/产物/触发来源/Tag 用法与 CONTEXT.md 一致；新表名小写复数符合命名约定。注意：补通道绑定概念时需同步 CONTEXT.md |
| 标准 | PASS | 真实 I/O 断言、删除实体同步清理、测试即契约均符合 STANDARDS；settings.json 当前无 600 权限（`settingsService.js:49-55`），"明文+600"是设计新增约束，实现时须落地 |

### 代码事实核查（技术方案引用的现状声明）

| 声明 | 核实结果 |
|---|---|
| `taskService.js:550` 只有订阅者没有发布者 | 属实（实际 551 行；全 `src/` 仅一处 `subscribe("schedule:triggered")`，无 publish） |
| `db.js:9-14` 默认 `:memory:` | 属实 |
| serverRegistry 需新增 shutdown 握手 | 属实（现有 register/unregister，无 shutdown 协议） |
| node-cron 可用 | 已在依赖（`package.json` ^4.5.0），调度器无新增依赖 |
| `createTask` 扩展 `trigger`/`variables` | **略不准**：`trigger` 已存在（`taskService.js:193`），execution 已有 `variables` 字段（恒 `{}`）；实际新增的是 variables 透传 + 入队。建议修正措辞 |
| schedules 表现状 | 仅 `id/projectId/flowId/cron/enabled`——证实 variables 列缺失（警告项 1） |

---

## 阻塞项（建议修复或回流）

- [ ] **维度：对齐 PRD — 通道绑定数据模型与 IM→项目路由规则未定义**
  - 问题：模板实例化契约写"写 flows 表 + 通道绑定记录"，但绑定存哪张表、什么字段，全文未定。更严重的是场景 B 数据流断点：IM 消息到达后 adapter 凭什么决定 `createTask({projectId: ?})`？若两个项目各自实例化了链接速存模板，消息路由给谁？per-project 串行队列反而放大了这个问题——路由错了队都排错。OP-8 验收锚点"绑定关系可查"依赖此决策。
  - 建议：补一节"通道绑定"：表结构（如 `channel_bindings: id/channelType/flowId/projectId/createdAt`）、路由规则（单绑定？最新生效？多绑定时拒绝第二个实例化并报错）、与模板实例化的同事务写入。同步把"通道绑定"术语登记进 CONTEXT.md。
  - 建议动作：修复后重审（tech-design 文档级补全，不需回流 PRD）

- [ ] **维度：对齐 PRD — 内容源归属（项目级/全局）未按 PRD 交办决策**
  - 问题：PRD §7.1 明确"同名内容源不允许重复（同一项目/全局——/tech-design 定归属）"，把决策权交给了本方案，但 tech-design 全文未出现归属决策。它直接决定 `content_sources` 表是否带 projectId 列、E-SRC-DUP 的校验范围、以及 CLI `source list --tag` 的查询域。
  - 建议：一句话落定（从场景看全局归属+tag 筛选最简，且与"flow 按 tag 引用、无反向引用"自洽），写进 contentSourceService 契约的输入/业务错误行。
  - 建议动作：修复后重审

- [ ] **维度：模块边界 — 飞书完成/失败回复的发送责任方未定，与既有边界冲突**
  - 问题：场景 A step 5 日报摘要、场景 B step 5 "已存：`路径`"、PRD 分支表 E-AGENT-FAILED/E-FETCH-FAILED 的失败回复，由谁发？模块图中 `feishuChannelAdapter.send` 的调用方含糊。两条候选路径各有硬伤需裁决：① taskService 终态钩子发——则 taskService 必须感知 trigger=channel 上下文（messageId/chatId），违反 PRD §10.1 自己写下的"不感知触发来源类型"边界；② agent/skill 发——则 agent 挂掉时失败原因没人送达（恰恰是最需要通知的场景）。这是验收断言落点（mock seam 断言哪一层发出消息）的前提。
  - 建议：显式选定并写清。常见解法：系统层（taskService 终态或 notificationService 旁路）负责"回复类消息"——把回复视为通道投递而非业务逻辑，trigger 上下文（replyTo）随 execution variables 传递，投递层只读 variables 不感知语义；业务消息（日报摘要正文）由 agent 产出文本、系统层投递。选定后更新 channelAdapter 契约的调用方与场景 A/B 数据流步骤。
  - 建议动作：修复后重审

---

## 警告项（建议但不阻塞）

- [ ] **维度：测试 seams/数据模型 — schedules.variables 列遗漏**
  - 问题：场景 A step 1 明确 schedule 携带 variables（含 topic），但 db 改造行只列了 3 张新表 + executions.artifacts，漏了 schedules 表的 variables 列（现状仅 5 列，已核实）。
  - 建议：db 改造行补上 `schedules` 加 `variables` JSON 列；schedulerService 契约的 publish payload 与之对应。

- [ ] **维度：接口契约 — schedulerService 无契约表，CRUD 同步机制未定**
  - 问题：模块表写"CRUD 变更同步增删"，但 schedule CRUD 在 taskService（`createSchedule` `taskService.js:369`），变更如何到达 scheduler——直接调用、还是 eventBus 事件（如 `schedule:changed`）——未定。schedulerService 是唯一没有契约表的新模块。
  - 建议：补一张小契约表（注册/注销/重载的输入输出与副作用），并写明 CRUD→scheduler 的同步通路。

- [ ] **维度：接口契约 — E-SCHED-FLOW-INVALID 的 draft 拒绝未限定 trigger 范围**
  - 问题：createTask 契约写 draft flow 报 E-SCHED-FLOW-INVALID，但 trigger 枚举含 `debug`；现状 `debugFlow`（`taskService.js:241`）专门用于跑 draft（默认取未发布 nodeList）。若 createTask 对所有 trigger 拒绝 draft，调试主路径被破坏。PRD §7.1 原文是"仅已发布 flow 可被 **schedule** 触发"。
  - 建议：契约中写明 draft 拒绝仅当 `trigger="schedule"`；顺带明确 debug 是否改走 createTask（若改走，执行记录语义变化需一句说明）。

- [ ] **维度：模块边界 — 重启/顶替时孤儿执行恢复语义未定义**
  - 问题：executionQueue 是内存队列，execution 有 queued 状态。App 顶替（ADR-006 核心场景）或进程崩溃时，DB 里 status=queued/running 的执行将永远卡死；新 server 只加载 schedules，无人接管它们。
  - 建议：补一句语义即可，如"server 启动时将非终态 execution 标记为 error（reason: server-restart），不自动重跑"；可进 executionQueue 契约副作用行。

- [ ] **维度：测试 seams — userData→`~/.opc-workstation` 数据迁移无实现条目与 seam**
  - 问题：ADR-006 影响部分明确要求"App 原 `userData/data.db` 数据做一次性迁移……需要迁移逻辑与回滚考虑"，但模块表 db 改造行只写了 defaultDbPath 统一，未提迁移；seams 表稳定块 2 也只有"CLI 自起断言 DB 文件 + 顶替握手"。
  - 建议：db/serverRegistry 改造行补迁移职责（检测旧路径存在→复制/移动→标记完成），seams 表稳定块 2 加"旧数据迁移集成测试（临时目录模拟双路径）"。

- [ ] **维度：风险 — 队列无界与抓取内容 prompt injection 未入风险表**
  - 问题：① IM 侧无任何限速，恶意/失控发送方可让队列无限增长（回执"第 N 位" N 无上限），per-project 串行下恢复时间长；② fetch 层只考虑了 SSRF，未考虑抓取到的网页内容进入 agent context 的注入面——security checklist LLM 节"模型输出视为不可信"，而 ADR-005 bypassPermissions 放大了注入指令的破坏半径（agent 可读写项目目录）。
  - 建议：风险表加两行：队列上限/去抖策略（哪怕初版只记录风险+接受）；prompt injection 的缓解（skill 层把抓取内容标记为不可信数据、agent prompt 指引，与 SSRF 同款"接受并记录"亦可，但要显式）。

---

## 结论

- [ ] 可进入下一阶段
- [x] 需修复阻塞项后重审
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `BUILD`

方案骨架可以签核级别的成熟：ADR-006 决策链完整、研究证据扎实（3 秒时限、message_id 去重、集群投递等均已落入设计）、复杂度无过度设计。3 个阻塞项全部是 tech-design 文档级补全——通道绑定模型、内容源归属、回复责任方——不需要回流 PRD，也不动摇架构主干。建议在同一轮修订中顺手处理 6 条警告（尤其 schedules.variables 与数据迁移，两者都是一行决策的事），然后重审即可进 CRYSTALLIZE。

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：接受 / 有条件接受 / 不接受

**理由**：

**下一步动作**：
