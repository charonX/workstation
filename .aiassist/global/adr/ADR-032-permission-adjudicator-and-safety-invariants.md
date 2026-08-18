# ADR-032: 权限裁决器 PermissionAdjudicator 领域模块化与四大安全不变量结构化强制

- **状态**: 已接受
- **日期**: 2026-08-18
- **相关 story**: 2026-08-16-deepen-permission-adjudication（/improve-codebase-architecture 候选 #3）
- **相关 REQ**: 待结晶（REQ-AGENT-118~122）

## 背景

权限链路跨越 `server.js`、`confirmationService`、`agentPolicy/permissionPolicy`、`permissionBridge`、Worker `tool_call hook` 等 6 个模块 8 跳。
在 ADR-017 的历史演进与 BUG-001/002 修复中确立了关键纪律：
1. **单一评估**：pre-gate 预检 gotgenes 不可见运算符，同一命令不重复 ask；
2. **单一询问**：一个命令只生成一个 confirmId 并按空间分流；
3. **唯一执行者**：授权桥 approve 决议只放行 Worker 侧执行，主进程 100% 跳过 execute；
4. **严格降级（Fail-Closed）**：未知工具面或异常策略默认判 ask。

然而上述不变量此前散落在各模块的 if-else 与注释中，且 `confirmationService` 内部残留模块级全局 Map（`notifySettleFlags`）及 20ms 数据库轮询，缺乏独立的领域实体承载。

## 决策

1. **提取 `PermissionAdjudicator` 领域工厂**：
   - 采用 Per-Instance 工厂模式（`createPermissionAdjudicator`），彻底消灭模块级全局 Map；
   - 内部维护内存 Promise 注册表（`pendingDecisions`），用户 approve/reject 时即时 resolve 唤醒 Worker，消除 20ms 定时器轮询开销；
   - 状态迁移与清理权威由 `try/finally` 强制闭环。
2. **纯函数规则评估器（`PermissionPolicy`）下沉**：
   - 无状态纯函数库，负责命令分类、运算符剥除、路径越界判定；
   - 强制 Fail-Closed：未匹配显式 allow 的所有操作与未知工具一律判定为 ask。
3. **结构化保证「唯一执行者」**：
   - `adjudicator.approve(confirmId)` 仅更新持久化状态并向 Worker 发送 allow 决策，绝不调用主进程 `execute`；
   - 主进程仅保留 CLI 普通 confirm 流的兼容支持，授权桥流与 CLI 流职责分明。
4. **双端授权桥标准接入**：
   - Worker 侧通过标准 `AuthorizerBridge` 与主进程通信，收敛 `tool_call`、`user_bash` 与 `pre-gate`。
5. **清理主进程与路由胶水**：
   - 移除 `server.js` 中的 strict 二次门控与分散检查，统一面向 `adjudicator` API。

## 后果

- 四大安全不变量由状态机与契约代码结构化强制，彻底杜绝命令双跑与重定向漏判隐患；
- 决议延迟降至 0ms，并发测试零状态污染；
- 模块边界清晰，各组件可直接注入假时钟与内存 DB 独立单测。

## 替代方案

- **A. 仅在主进程做 Facade 浅包装**：未能消灭全局 Map 与 20ms 轮询，Worker 侧接缝依然脆弱，否决。

## 相关文件

- PRD：`.aiassist/stories/2026-08-16-deepen-permission-adjudication/prd.md` §10
- 前置 ADR：ADR-017、ADR-020、ADR-022、ADR-023
