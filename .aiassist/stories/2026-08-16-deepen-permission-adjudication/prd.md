# 权限裁决管道深化——permissionAdjudication

> 状态：**已完结（历史记录）**  
> 故事 ID：`2026-08-16-deepen-permission-adjudication`  
> 评审来源：架构深化候选 #3（`.aiassist/global/architecture-reviews/architecture-review-2026-08-16.html`）  
> 关联 ADR：ADR-017（已打过 BUG-001/002 补丁）、ADR-020、ADR-022、ADR-023、ADR-032（新建）  
> 最后更新：2026-08-18  

---

## 1. 问题陈述

一条 bash 确认链跨越 6 个模块 8 跳（`server.js`、`confirmationService`、`agentPolicy/permissionPolicy`、`permissionBridge`、`authorizer bridge`、`worker tool_call hook` 等），职责不清；`strict` 模式门控在 `server.js` 被二次实现；「唯一执行者（approve 决议不重复执行）」与「单一评估（pre-gate 预检不产生重复 ask）」仅靠注释和零散 if-else 维系，曾引发 BUG-001（命令双跑）与 BUG-002（重定向漏判）；FS 工具在 gotgenes 回退路径或未知工具调用时存在零确认风险；`confirmationService` 内部存在模块级全局 Map（`notifySettleFlags`）及 20ms 轮询等待。

一句话痛点：**权限裁决的知识散在两层接缝里，安全不变量没有结构承载。**

## 2. 解决方案

提取独立的权限裁决领域模块（`PermissionAdjudicator`）与纯函数规则评估器（`PermissionPolicy`），确立主/Worker 各司其职的双端契约：
1. **纯函数下沉与 Fail-Closed**：`permissionPolicy` 成为无状态纯函数库，负责命令分类、重定向解析与策略匹配，未知工具面与回退路径默认一律 Fail-Closed（判定为 ask）；
2. **Per-Instance 裁决领域模块化与唯一执行者保障**：`permissionAdjudicator` 统一管理挂起确认单生命周期、超时流转与决议状态，彻底消灭模块级全局 Map；approve 决议产生 `allow` 决策并通过内存 Promise 注册表即时通知 Worker，主进程零 `execute`，结构化杜绝双重执行；
3. **双端授权桥契约收敛**：Worker 侧通过标准 `AuthorizerBridge` 申请裁决与监听状态，统一 `tool_call` 授权、`user_bash` 和 `pre-gate` 的拦截与流转通道，消除 20ms 轮询；
4. **胶水代码清理**：移除 `server.js` 中分散的权限二次门控与手写 confirmation 状态检查，对外提供统一、类型安全的权限领域 API。

## 3. 用户故事

1. 作为平台安全审计者，我想要所有高危操作（CLI、FS 写、脚本、重定向等）无论经何种路径触发，都能受到严格一致且具备 Fail-Closed 兜底的权限拦截。
2. 作为开发者，我想要「approve 决议只放行 Worker 执行、主进程绝不重复跑」由状态机结构强制保证，而不是靠维护者的人肉注释和纪律。
3. 作为开发者，我想要权限评估与裁决状态机能够无副作用导入并直测（注入假时钟/假队列），摆脱跨 6 个模块的环境依赖。
4. 作为前端/飞书交互方，我想要确认卡数据协议和 SSE 事件流保持完全向后兼容，业务层无需感知底层重构。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | **纯函数策略评估器（`permissionPolicy`）与 Fail-Closed 契约**：无状态纯函数库；收编 `evaluate` / `classifyBashToolCall` / 重定向管道剥除；未匹配规则的未知工具或异常解析一律产出 `ask`（Fail-Closed）。 | 需求洞察 Q1/Q3 确认；安全底线不容妥协 |
| 2 | **权限裁决域（`permissionAdjudicator`）与唯一执行者状态机**：Per-Instance 工厂；管理挂起单生成、超时处理、决议广播；内存 Promise 注册表即时通知，消灭模块级全局 Map 与 20ms 轮询；approve 决议产生 `allow` 决策对象，主进程杜绝调用 `execute`。 | 需求洞察 Q1/Q2 及技术方案确认；彻底根除 BUG-001 隐患 |
| 3 | **双端授权桥（`AuthorizerBridge`）与 pre-gate 统一接入**：Worker 侧通过标准桥接对象与主进程通信，收敛 `tool_call` 授权、`user_bash` 与 `pre-gate` 重定向拦截，保证单一评估、不重复弹卡。 | ADR-017 / BUG-002 经验与需求洞察确认 |
| 4 | **主进程与路由胶水清理**：`server.js` 移除 strict 二次门控，路由（`agentConfirmations` 等）改面向 `permissionAdjudicator` 统一 API；保持 SSE 事件与 `pi-permission-config.json` 兼容。 | 架构深化标准（消除浅残留与依赖倒置） |

## 5. 移动块

当前无移动块。

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 触发动作 / 场景 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | Agent 在会话中触发只读工具（`read` / `ls` / `grep` 位于 cwd 内） | `permissionPolicy` 评估为 `allow`，Worker 直接放行执行 | 无确认卡挂起，工具立即返回 |
| 2 | Agent 在会话中触发写文件工具（`write` / `edit` / `create`） | 评估为 `ask`，经 `AuthorizerBridge` 生成确认单，向 UI/飞书分发 | 生成 `confirmId`，广播 `confirmation-pending` 事件 |
| 3 | 用户在 UI 或飞书点击「批准（Approve）」 | `permissionAdjudicator.approve(confirmId)` 将状态置为 `approved`，通过 Promise 注册表即时通知 Worker 放行 | Worker 收到 `{kind: "allow"}` 放行工具执行；主进程**不执行**命令 |
| 4 | 用户在 UI 或飞书点击「拒绝（Reject）」 | `permissionAdjudicator.reject(confirmId)` 状态置为 `rejected` | Worker 收到 `{kind: "deny"}`，工具抛出「操作已取消」错误 |
| 5 | Agent 执行含重定向 bash（如 `echo a > b.txt`） | pre-gate 识别 gotgenes 不可见运算符，提前拦截并进入 ask 挂起单 | 仅生成一张确认卡（单一评估），无重复弹卡 |
| 6 | 确认单到达超时时限（默认超时） | `permissionAdjudicator` 状态机触发超时自动拒绝 | 状态转为 `rejected`，Worker 抛出超时错误 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 未知工具名称或未在配置中定义的外部工具 | `permissionPolicy` 默认 Fail-Closed 判为 `ask` | 走人工确认挂起流程 |
| 项目/全局策略 JSON 文件损坏或不存在 | 降级到内置默认规则，未明确放行的一律判为 `ask` | 记录警告日志，无崩溃，安全不降级 |
| 重复对已决议的 confirmId 进行 approve/reject | 幂等忽略或返回已决议状态 | 保证状态机单向不可逆迁移 |
| approve 决议到达但 Worker 进程已崩溃/超时 | 主进程记录状态，不产生孤儿 execute | 资源正常随会话清理释放 |

### 6.3 预期值锚点（Expected-Value Anchors）

| 稳定块 | 输入 | 预期输出 / 结果 | 依据 |
|---|---|---|---|
| 1 | `evaluate({ tool: "read", input: { path: "inside.txt" } })` | `"allow"` | `permissionPolicy.js` 规则表 |
| 1 | `evaluate({ tool: "read", input: { path: "/etc/hosts" } })`（cwd 外） | `"ask"` | ADR-017 裁决 14 |
| 1 | `evaluate({ tool: "unknown_custom_tool", input: {} })` | `"ask"`（Fail-Closed） | 需求洞察 Q3 决策 |
| 1 | `classifyBashToolCall("echo hi > out.txt", { cwd })` | `"ask"` | BUG-002 pre-gate 规则 |
| 1 | `classifyBashToolCall("rm -rf foo", { cwd })` | `"allow"`（交由 gotgenes gate 处理，不重复 ask） | 单一评估原则（BUG-001/002） |
| 2 | `adjudicator.approve(confirmId)` | 状态更新为 `approved`，`decision` promise 即时 resolve 为 `{ kind: "allow" }`；主进程 zero execute | BUG-001 单一执行者 |
| 2 | `adjudicator.reject(confirmId, "用户取消")` | 状态更新为 `rejected`，`decision` promise 即时 resolve 为 `{ kind: "deny", reason: "用户取消" }` | 现有确认卡交互契约 |
| 3 | Worker `AuthorizerBridge.authorize(...)` 挂起并在 approve 触发时即时响应 | Worker 收到 allow 并继续工具执行，零轮询延迟 | ADR-017 标准 3/4 |
| 4 | 静态检查 `server.js` | 不存在 `riskLevel === "confirm"` 的二次条件判断，不存在主进程 `execute` 授权桥命令 | 架构深化目标 |

## 7. 表单与输入验证

- **策略配置输入**：支持 `pi-permission-config.json`，格式校验需支持 `{ permission: { [surface]: string | object } }` 与顶层 surface 映射两种形态。
- **授权请求参数**：`spaceKey` 必须为非空字符串；`tool` 必须为字符串；`input` 为对象。
- **决议操作参数**：`confirmId` 必须存在于活跃或历史表中；`decision` 必须为 `approve` 或 `reject`。

## 8. 错误状态与失败响应

- `E-INVALID-CONFIG`：策略文件格式严重错误，记录日志并安全降级到内置 Fail-Closed 策略。
- `E-CONFIRM-NOT-FOUND`：查询或决议不存在的 `confirmId`，返回 404 或抛出明确领域异常。
- `E-CONFIRM-SETTLED`：试图重复决议已关闭的确认单，返回 409 Conflict 或幂等已决议状态。
- `E-BRIDGE-TIMEOUT`：授权等待超时，自动决议为 `deny` 并清理挂起定时器。

## 9. 复杂度分级

- **分级**：`complex`
- **理由**：
  1. 涉及主进程与 Worker 进程之间的状态流转和异步 Promise 决议。
  2. 承担全系统的核心安全不变量（防双重执行、防绕过、防重定向漏洞）。
  3. 需保持与既有前端 UI、飞书通道和 SQLite 持久化表的 100% 兼容。

## 10. 技术方案（深潜落地）

### 10.1 设计目标与架构

1. **结构化四大安全不变量**：
   - **单一评估**：pre-gate 仅拦截 gotgenes 不可见运算符（重定向/管道），可见危险交 gotgenes，同一命令绝不产生双 ask。
   - **单一询问**：一次工具调用仅生成唯一 `confirmId`，向 UI 内联卡或飞书卡片单向分发。
   - **唯一执行者**：授权桥挂起行的 `approve` 仅标记状态并向 Worker 发送 `allow` 决策，主进程 100% 跳过命令 `execute`。
   - **严格降级（Fail-Closed）**：任何未显式允许的工具调用或损坏策略，一律判定为 `ask`。
2. **模块与职责划分**：
   - `src/services/permissionPolicy.js`：无状态纯函数规则库。
   - `src/services/permissionAdjudicator.js`：主进程领域工厂，封装 SQLite 操作、内存 Promise 注册表、超时控制与事件广播。
   - `src/services/permissionBridge.js`：Worker 侧授权桥与主进程通信适配。
   - `src/http/server.js` / 路由：清理权限胶水代码，统一通过 `adjudicator` 交互。

### 10.2 模块数据流

```
[ Worker Tool Call ]
       │
       ▼
[ classifyBashToolCall / gotgenes gate ] ──(allow)──► [ 放行工具执行 ]
       │ (ask)
       ▼
[ AuthorizerBridge.authorize() ]
       │
       ▼ (IPC: permission-ask)
[ PermissionAdjudicator.submit() ]
       ├─► 写入 SQLite (agent_confirmations 表，status='pending')
       ├─► 注册 pendingDecisions.set(confirmId, { resolve, timer })
       └─► 发布 eventBus 'confirmation-pending' / 飞书卡片
              │
              ▼
       [ 用户点击 Approve / Reject ]
              │
              ▼
[ PermissionAdjudicator.approve(confirmId) ]
       ├─► 更新 SQLite (status='approved')
       ├─► 取出 pendingDecisions.get(confirmId) 并 resolve({ kind: "allow" })
       ├─► finally 清理 Map 内存与超时 Timer
       └─► (零主进程 execute!)
              │
              ▼ (IPC: permission-decision)
[ Worker 收到 allow 决策，恢复工具执行 ]
```

### 10.3 接口契约 (§10.4)

1. **`permissionPolicy` 接口**：
   - `createPolicyEvaluator({ cwd, projectDir }): { evaluate({ tool, input }): "allow" | "ask" | "deny" }`
   - `classifyBashToolCall(command, { cwd, projectDir }): "allow" | "ask"`
   - `stripRedirectPipeOperators(command): string`
2. **`permissionAdjudicator` 接口**：
   - `createPermissionAdjudicator({ dbPath, execute, notifyResult, sendCard }): PermissionAdjudicatorInstance`
   - `adjudicator.submit(req): { status, replyText }`
   - `adjudicator.approve(confirmId): Promise<{ success: boolean, status: string }>`
   - `adjudicator.reject(confirmId, reason?): Promise<{ success: boolean, status: string }>`
   - `adjudicator.get(confirmId): ConfirmRow | null`
   - `adjudicator.listPending(spaceKey?): ConfirmRow[]`
   - `adjudicator.waitForDecision(confirmId): Promise<{ kind: "allow" | "deny", reason?: string }>`
3. **`permissionBridge` 接口**：
   - `createPermissionBridge({ adjudicator }): { authorize, evaluateUserBash, evaluateBashToolCall }`

### 10.4 关键决策（ADR 关联）

- **ADR-032**：将权限裁决器重构为 Per-Instance 领域工厂，基于内存 Promise 注册表消灭轮询与全局 Map，结构化强制四大安全不变量。

### 10.5 风险与回退

- **风险**：旧测试若直接 mock `confirmationService` 内部字段可能受影响。
- **对策**：`PermissionAdjudicator` 导出别名或保持 `confirmationService.js` 兼容 re-export，平滑迁移测试。

### 10.6 安全、性能与可观测性

- **安全**：Fail-Closed 兜底；严格 realpath 归一化校验 cwd 越界；单向不可逆决议状态迁移。
- **性能**：消除 20ms 定时器轮询，决议响应延迟从 0~20ms 降至 0ms 即时唤醒；零全局内存泄漏。
- **可观测性**：在 `submit`、`approve`、`reject`、超时与 IPC 传输时记录标准结构化日志。

## 11. 测试决策（含覆盖接缝，CLI/API 优先）

### 11.1 覆盖接缝（Seams）

| 编号 | 稳定块 | 测试类型 | 接缝文件路径 | 业务能力 | 覆盖重点 |
|---|---|---|---|---|---|
| SEAM-01 | 1 | 单元测试 | `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/permissionPolicy.test.js` | agent-security/permission | 纯函数直测：规则匹配、Fail-Closed、重定向管道剥除、cwd 越界 |
| SEAM-02 | 2 | 单元测试 | `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/permissionAdjudicator.test.js` | agent-security/permission | 领域状态机：挂起、approve/reject 幂等、超时自动拒绝、零主进程 execute |
| SEAM-03 | 3 | 集成测试 | `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/permissionBridge.test.js` | agent-security/permission | 双端通信桥：Worker 挂起与 Promise 即时唤醒，零轮询验证 |
| SEAM-04 | 4 | 集成测试 | `tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/serverPermissionWiring.test.js` | agent-security/permission | 依赖方向回正与路由装配：移除 strict 二次门控，SSE 与 API 契约兼容 |

## 12. 范围外

1. 不修改前端确认卡 UI 视觉组件与 React 交互逻辑；
2. 不修改飞书卡片消息模板协议；
3. 不动 `sessionStore` 数据库连接生命周期（归属 `deepen-db-per-path-cache`）；
4. 不做服务全局 DI 容器改造（归属 `deepen-service-container`）。

## 13. 补充说明

本 Story 是系统深化架构的第 3 候选任务，严格沿用 ADR-028/029/030 的 Per-Instance 工厂化与无状态纯函数标准。

## 14. PRD 完整性自检查

- [x] 每个稳定块至少有一条 happy path（写入第 6 节）。
- [x] 涉及用户输入的稳定块有字段级验证规则（写入第 7 节）。
- [x] 每个稳定块有 ≥1 条具体预期值锚点（写入第 6.3 节）。
- [x] 每个稳定块有失败场景或显式定义（写入第 8 节）。
- [x] 跨模块/外部依赖调用有错误状态定义（写入第 8 节）。
- [x] 复杂度已分级并给出理由（写入第 9 节为 `complex`）。
- [x] 第 10 节给出深潜技术方案架构与接口契约。
- [x] 第 11 节列出清晰覆盖接缝（SEAM-01 ~ SEAM-04）。
