# 需求规格说明书 — permissionAdjudication

> 故事 ID：`2026-08-16-deepen-permission-adjudication`  
> 关联 PRD：`.aiassist/stories/2026-08-16-deepen-permission-adjudication/prd.md`  
> 关联 ADR：ADR-017、ADR-020、ADR-022、ADR-023、ADR-032  
> 测试目录：`tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/`  

---

## REQ-AGENT-118: 纯函数策略评估器与 Fail-Closed 安全契约

- **优先级**: P0
- **必须性**: 必须
- **scope**: `intra-module`
- **modules**: `src/services/permissionPolicy.js`
- **测试类型**: 单元
- **capability**: `agent-security`
- **entity**: `PermissionPolicy`
- **seam**: `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/permissionPolicy.test.js`

### 验收标准

1. **纯函数无副作用**：`createPolicyEvaluator({ cwd, projectDir })` 创建的评估器不依赖且不污染全局状态，`evaluate({ tool, input })` 产出严格属于 `{"allow", "ask", "deny"}`。
2. **Fail-Closed 严格兜底**：任何未匹配明确 allow 规则的外部/未知工具（如 `tool: "custom_unlisted_tool"`）或格式损坏的策略配置，`evaluate` 必须一律返回 `"ask"`，杜绝零确认放行。
3. **读写与破坏性分类**：
   - 读类工具（`read`, `ls`, `grep`, `find`, `cat`）在项目/cwd 内部返回 `"allow"`，cwd 外部绝对路径返回 `"ask"`；
   - 写类工具（`write`, `edit`, `create`, `delete`）无论路径内外一律返回 `"ask"`；
   - bash 命令包含 `BASH_DESTRUCTIVE_PATTERNS` 或外部路径一律返回 `"ask"`。
4. **重定向与管道 pre-gate 分类**：`classifyBashToolCall(command, { cwd, projectDir })`：
   - 当危险仅由 gotgenes 热路径不可见运算符（`>`/`>>`/`|sh`/`|bash`）承载时返回 `"ask"`；
   - 当危险由 gotgenes 可见模式（如 `rm`、`sudo`）承载或为无害命令时返回 `"allow"`（交由 gotgenes 处理，保证单一评估）。

---

## REQ-AGENT-119: PermissionAdjudicator 领域工厂与内存 Promise 决议状态机

- **优先级**: P0
- **必须性**: 必须
- **scope**: `intra-module`
- **modules**: `src/services/permissionAdjudicator.js`
- **测试类型**: 单元
- **capability**: `agent-security`
- **entity**: `PermissionAdjudicator`
- **seam**: `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/permissionAdjudicator.test.js`

### 验收标准

1. **Per-Instance 工厂构造**：`createPermissionAdjudicator({ dbPath, execute, notifyResult, sendCard, defaultTimeoutMs })` 返回独立领域实例，模块级零全局 Map；所有挂起 Promise 与标志封闭于实例内部。
2. **挂起单提交与持久化**：`adjudicator.submit(req)` 将确认行持久化写入 SQLite `agent_confirmations` 表（状态为 `pending`），并注册内存 Promise 决策句柄。
3. **空间分流事件广播**：
   - `ui:*` 空间提交时向 `eventBus` 发布 `confirmation-pending`（携带 `confirmId`, `sessionKey`, `command`, `args`, `description`）；
   - `feishu:*` 等通道空间提交时调用注入的 `sendCard` 发送卡片。
4. **内存 Promise 即时唤醒**：`waitForDecision(confirmId)` 返回 Promise；当 `approve(confirmId)` 或 `reject(confirmId)` 被调用时，内存决策 Promise 立即被 resolve（零 `setInterval` 轮询延迟）。
5. **清理权威与 try/finally**：决议一旦终态（approved/rejected/timeout），内存注册表必须在 `finally` 中清理对应 `confirmId` 的 Promise 与 Timer，无内存泄漏。

---

## REQ-AGENT-120: 唯一执行者与单一询问安全不变量

- **优先级**: P0
- **必须性**: 必须
- **scope**: `cross-module`
- **modules**: `src/services/permissionAdjudicator.js`, `src/services/permissionBridge.js`
- **测试类型**: 单元
- **capability**: `agent-security`
- **entity**: `PermissionAdjudicator`
- **seam**: `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/permissionAdjudicator.test.js`

### 验收标准

1. **唯一执行者（Zero Execute On Main Process）**：对授权桥提交的确认单（`riskLevel: "permission"`），调用 `adjudicator.approve(confirmId)` 仅更新 DB 状态为 `approved` 并 resolve `{ kind: "allow" }` 给 Worker，**绝不调用**注入的 `execute` 函数，物理杜绝双重执行。
2. **单一询问（Single Ask）**：同一操作仅生成一个 `confirmId`；重复对同一 `confirmId` 执行 `approve` 或 `reject` 具备幂等性（返回已决议状态，不触发二次分发或二次执行）。
3. **拒绝语义闭环**：`adjudicator.reject(confirmId, reason)` 将状态更新为 `rejected`，resolve `{ kind: "deny", reason }`，Worker 侧将收到拒绝决策并安全中止工具执行。

---

## REQ-AGENT-121: 双端授权桥与 pre-gate 统一通信接线

- **优先级**: P0
- **必须性**: 必须
- **scope**: `cross-module`
- **modules**: `src/services/permissionBridge.js`, `src/services/agentService.js`
- **测试类型**: 集成
- **capability**: `agent-security`
- **entity**: `AuthorizerBridge`
- **seam**: `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/permissionBridge.test.js`

### 验收标准

1. **授权桥适配器**：`createPermissionBridge({ adjudicator })` 提供 `authorize`、`evaluateUserBash` 与 `evaluateBashToolCall` 三个标准方法，统一桥接至 `adjudicator`。
2. **Worker IPC 协议对接**：
   - Worker 发送 `permission-ask` 时，主进程通过 `onPermissionAsk` 调用 `bridge.authorize` 或 `evaluateUserBash`；
   - 决议生成后，主进程向 Worker 发送 `permission-decision`（`{ type: "permission-decision", confirmId, kind: "allow" | "deny", reason }`）。
3. **未接线与异常 Fail-Closed**：若 `onPermissionAsk` 缺失或处理异常，主进程必须向 Worker 发送 `kind: "deny"` 兜底，绝不让 Worker 工具挂起悬挂。

---

## REQ-AGENT-122: 主进程装配与路由胶水清理

- **优先级**: P0
- **必须性**: 必须
- **scope**: `cross-module`
- **modules**: `src/http/server.js`, `src/http/routes/agentConfirmations.js`, `src/services/confirmationService.js`
- **测试类型**: 集成
- **capability**: `agent-security`
- **entity**: `PermissionAdjudicator`
- **seam**: `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/serverPermissionWiring.test.js`

### 验收标准

1. **消除 strict 二次门控**：`server.js` 中移除关于权限模式/strict 的手工 `if-else` 二次实现，统一由 `permissionPolicy` 与 `permissionAdjudicator` 托管。
2. **HTTP API 与 SSE 兼容**：
   - `POST /api/agent-confirmations/:id/approve` 与 `POST /api/agent-confirmations/:id/reject` 路由改造为调用 `adjudicator.approve` / `adjudicator.reject`，响应 JSON 格式与 HTTP 状态码（200 / 404 / 400）保持 100% 向后兼容；
   - `GET /api/agent-confirmations/pending` 返回待确认列表契约不变；
   - `sessionSseRegistry` / UI 订阅的 `confirmation-pending` SSE 事件载荷完全向后兼容。
3. **向后兼容 re-export**：`confirmationService.js` 保留并作为 `permissionAdjudicator.js` 的兼容别名包装层，保障既有业务与测试无缝过渡。
