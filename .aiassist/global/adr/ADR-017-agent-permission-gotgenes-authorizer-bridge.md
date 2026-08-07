# ADR-017: agent 权限层采用 gotgenes 权限扩展 + 授权桥，策略文件全局/项目两级

- **状态**: 已接受
- **日期**: 2026-08-06
- **相关 story**: 2026-08-02-ui-copilot
- **相关 REQ**: 待结晶（2026-08-02-ui-copilot S8）

## 背景

ui-copilot M2 要给项目空间 agent 放开 FS/脚本工具面（前 story S5 决策的"CLI-only、不给原始 FS/DB 工具"按空间分级放开），需要权限层承接"高危拦截确认、其余放行、不做 UI 配置"。

research（`research/pi-permission-extensions.md`）证实：PI 扩展 API 原生有 `tool_call` 调用前拦截钩子（async 可挂起等人工）；社区存在成熟权限扩展 `@gotgenes/pi-permission-system`（allow/ask/deny × 六 surface，非 TUI 降级兼容 SDK 嵌入，`registerAuthorizer` 授权链 seam）。

平台已有**命令保险层**（builtin-agent）：高危 CLI 命令拦截 → 确认挂起队列 → 卡片回调驱动执行。权限层选型必须回答：新机制与既有保险层什么关系？

## 决策

1. **权限引擎 = `@gotgenes/pi-permission-system`**（npm 运行时依赖）：allow/ask/deny 策略评估，承接 FS 写/脚本执行/bash 破坏性模式等工具面高危判定。
2. **策略文件两级、不做 UI 配置**：全局策略随应用分发（应用资源，只读默认）；项目策略 = 项目目录内约定文件（可选，用户手写）。不按会话编程——项目空间会话 cwd=项目目录，文件驱动模型天然对齐。
3. **`ask` 经授权桥（`registerAuthorizer`）接入既有确认挂起队列**：ask → 创建挂起确认项 → 按 spaceKey 前缀分流渲染（UI 内联确认卡 / 飞书卡片）→ 回调决议 → allow/deny。**一套队列、一种卡语义**，命令保险层（CLI 高危分类）与 gotgenes（FS/脚本策略）在队列处收口，不形成两套并行确认体验。
4. 用户 `!` bash 走 `user_bash` 事件（不经 `tool_call`），实现期同策略拦截。
5. **回退预案**：若签核前 spike（H3 嵌入 config 发现 / H4 单进程多会话正确性）证伪，回退自实现 `tool_call` 钩子 + 自写策略评估（research 证实可行），REQ 语义不变。

## 后果

- 引入一个运行时 npm 依赖（MIT，v24.0.0，170+ 版本仍活跃维护）——打包需纳入 worker external 清单（BUG-002 教训：CJS 运行时依赖 external 配齐）。
- 权限策略可对高级用户手写项目文件开放，无需 UI 建设。
- 两个不确定项（H3/H4）转为签核前 spike，带明确回退路径。
- 未来若策略复杂度超出现模型（按会话编程、动态授权链），gotgenes 的 authorizerChain 与自实现钩子都是演进出口。

## 替代方案

- **A. 自实现 tool_call 钩子 + 复用命令保险层分类**：零新依赖、与既有机制完全同构；但 FS/脚本面的策略表达（bash 通配/tree-sitter 分解/path 边界）要自写自测，且用户提出"策略文件全局+项目"的文件驱动模型更贴合其心智（人拍板 B）。
- **C. 沙箱路线（Gondolin/Docker/OpenShell）**：隔离强度最高但部署复杂度与桌面分发形态冲突（零依赖内核承诺），且粒度过粗（整会话沙箱化，无法表达"单操作确认"）。

## 相关文件

- 方案：`.aiassist/stories/2026-08-02-ui-copilot/tech-design.md`（D2、授权桥契约）
- 调研：`.aiassist/stories/2026-08-02-ui-copilot/research/pi-permission-extensions.md`
- 既有机制：`src/services/confirmationService.js`（挂起队列）、`src/agent/toolAdapter.js`（命令保险层）

## 补充（2026-08-07，BUG-001/002 实证修订）

实现期两个 code-defect 暴露并修正了本决策的两处隐含假设，决策本身不变：

1. **唯一执行者**（BUG-001）：授权桥行（`riskLevel: "permission"`，command = CLI 工具名）的 approve 决议**跳过主进程 execute**——操作由 worker 侧 gate allow 后经工具调用路径单一执行。修正前主进程 approve→execute + worker gate 放行再执行 = 同一命令双重执行（18 个 confirm 级工具受影响，含超时后的晚批准）。原则沉淀：双层安全机制必须显式指定唯一执行者（见 engineering-lessons「单一执行/单一询问」）。
2. **单一评估 + 桥在 gotgenes 前**（BUG-002）：gotgenes 热路径（tree-sitter command-enumeration）跳过 file_redirect 节点与 `|` 匿名 token——`>`/`>>`/`|sh` 对策略通配不可见，附录 A bash 破坏性 ask 对重定向/管道类失效。修正：worker 扩展层在 gotgenes gate **前**自评估（`permissionPolicy.classifyBashToolCall`，与本模块评估器同一真源），仅当危险**仅由**不可见运算符承载时 pre-gate 拦截，其余交 gotgenes——同一命令不产生二次 ask/双评估（wrapper floor 例外：gotgenes #481 floor 为 ask 时 pre-gate 跳过）。
3. 已知角落登记：gotgenes 规则级重复确认（`..` 相对重定向同时命中 cwd 外与 `*>` 模式 → 双确认卡，无安全洞）——去重规则转入 2026-08-07-pi-agent-consolidation。
