# 独立服务容器（Service Container）——装配知识收归与 server.js 纯化

- **Story ID**: `2026-08-16-deepen-service-container`
- **日期**: 2026-08-19
- **来源**: `/improve-codebase-architecture` 架构评审候选 #7（`architecture-review-2026-08-16.html`）

---

## 1. 问题陈述

`src/http/server.js`（638 行）身兼三重职责：
1. **HTTP 路由与传输分发**（`handleRequest`、`parseBody`、CORS、端点派发）；
2. **隐式 DI 容器**（8 个服务的惰性工厂、闭包变量与挂在 `server._opcXxx` 上的隐式状态）；
3. **服务生命周期与协作胶水**（`imRouter` 创建与回投钩子、`eventBus` 跨服务事件订阅、每日定时日志清理、`stopServer` 逐一关闭）。

这导致读者必须并行追踪“闭包单例”与“`server` 属性”两条状态路径，装配逻辑与 HTTP 传输紧密交织，服务缺乏单一的装配所有者。

**一句话痛点**：装配知识没有自己的家，路由文件里藏着隐式 DI 容器。

---

## 2. 解决方案

抽取独立的 **Service Container** 模块（`src/services/serviceContainer.js`），实现装配知识内聚与 `server.js` 纯化：

1. **新建 `src/services/serviceContainer.js`**：通过 `createServiceContainer({ port, configDir, baseUrl, ... })` 工厂统一管理 8 个服务的惰性实例化（`sessionStore`、`agentRouter`、`sseRegistry`、`confirmationService`、`permissionBridge`、`modeService`、`agentService`、`cardRenderer`）以及相互接线（`imRouter`、`eventBus` 事件转发、定时日志清理）。
2. **生命周期统一收归**：`container.dispose()`（或 `container.stop()`）统一销毁定时任务、停止 agent 子进程与清理相关事件订阅。
3. **`server.js` 彻底瘦身（≤250 行）**：专注 HTTP 传输与路由分发，持有 `server.services`（即 container 实例），将服务通过 context 袋注入各路由 handler。
4. **平滑向后兼容**：`server.services` 成为正规 DI Seam；在 `server` 对象上保留薄 `_opcXxx` getter/setter 代理，确保既有测试零改动全绿。

---

## 3. 用户故事

- 作为 workstation 核心架构维护者，我阅读 `server.js` 时只需关注 HTTP 请求如何路由，阅读 `serviceContainer.js` 时只需关注系统内各服务如何组装与接线，装配知识结构清晰一目了然。
- 作为功能开发者与测试作者，我可以把 `server.services` 作为统一的依赖注入与 mock seam，同进程多 server 实例拥有各自独立的容器上下文，状态不再跨实例污染。

---

## 4. 稳定块

| 块 ID | 内容 |
|---|---|
| **B1** | **独立服务容器模块**（`src/services/serviceContainer.js`）：`createServiceContainer` 工厂内聚 8 个服务的惰性单例工厂、`peekAgentService`、`imRouter` 接线与 `eventBus` 订阅、日志清理定时任务。 |
| **B2** | **容器生命周期统一管理**：`container.dispose()` / `container.stop()` 统一负责定时器销毁、`agentService.stop()`、`schedulerService.removeAll()`、`eventBus.clearSubscribers()`、`runner.reset()`、`closeDb()`、`channelManager.stop()`。 |
| **B3** | **`server.js` 瘦身与依赖注入 Seam**：`server.services` 挂载 container 实例；`server.js` 剔除具体服务工厂与胶水（行数降至 ≤250 行）；挂载 `_opcXxx` 代理平滑兼容既有测试。 |

---

## 5. 移动块

- 无（本 story 范围高度聚焦在装配与传输层的职责分离，无未决实验性块）。

---

## 6. 用户操作流

### 6.1 主路径（服务启动与路由分发视角）

1. `startServer(options)` 启动 HTTP 监听。
2. 监听成功后，创建 `const container = createServiceContainer({ port, configDir, ... })` 并挂载至 `server.services`。
3. 容器完成即时启动项（如孤儿执行恢复、enabled schedules 加载、启动时日志清理、cron 任务登记、`imRouter` 注册、`eventBus` 订阅）。
4. 请求到达 `handleRequest`：从 `server.services` 获取各服务的惰性 getter 并传入对应的路由 handler（如 `handleSettings`、`handleAgentSessions` 等）。
5. 路由首次调用 getter 时，容器触发对应的服务惰性构造并缓存（严格符合 ADR-009）。
6. 调用 `stopServer({ server })`：内部直接调用 `container.dispose()` 统一执行资源释放与关停，再关闭 HTTP 监听。

### 6.3 预期值锚点

| 场景 / 断言 | 锚点值 / 预期行为 |
|---|---|
| `container.getSessionStore()` 两次调用 | 返回同一 `sharedSessionStore` 单例（`strictEqual`） |
| `container.getModeService()` 两次调用 | 返回同一 `modeService` 单例（`strictEqual`） |
| `container.getSseRegistry()` 两次调用 | 返回同一 `sseRegistry` 实例（`strictEqual`，per-container 隔离） |
| 未调用 `getAgentService()` 时 | `container.peekAgentService()` 返回 `null`（不提前拉起子进程，ADR-009） |
| 调用 `getAgentService()` 后 | `container.peekAgentService()` 返回该服务实例 |
| `container.dispose()` 释放 | 定时清理 cron 被 destroy、`agentService.stop()` 被 await 执行 |
| `server.services` 存在性 | `const { server } = await startServer();` 得到 `server.services` 为 container 实例 |
| `server._opcXxx` 兼容代理 | `server._opcSessionStoreFactory` 可读且调用等价于 `container.getSessionStore`；可写覆盖反映到容器 |
| `server.js` 代码行数阈值 | `wc -l src/http/server.js` ≤ 250 行 |
| `server.js` import 方向 | `server.js` 不再直接 import `createSessionStore`、`createCardRenderer`、`createPermissionBridge`、`createConfirmationService`、`createModeService` 等具体服务工厂 |

---

## 7. 表单与输入验证

- `createServiceContainer(options)` 参数校验：
  - `port`: 必须为有效端口数字；
  - `configDir`: 必须为有效的目录路径字符串（缺省由 `settingsService.configDir()` 解析）；
  - `baseUrl`: 缺省由 `http://127.0.0.1:${port}` 派生；
  - `owner`: 可选进程标识符字符串。
- 其余均为内部依赖装配，无直接终端用户表单输入。

---

## 8. 错误状态与失败响应

| 场景 | 行为与错误处理 |
|---|---|
| 启动阶段恢复孤儿执行/加载调度失败 | 记录 `console.error`，不中断启动流程（保持既有 safe default 行为） |
| 日志定时清理执行失败 | `runExecutionLogPurge` 捕获异常并记录日志，不抛出异常（保持既有行为） |
| `container.dispose()` 中子服务关停异常 | 逐项 try-catch 并安全忽略/记录，确保剩余清理项与 HTTP server.close 顺利完成 |

---

## 9. 复杂度分级

**simple**——本 story 为内部架构深化重构：
1. 装配逻辑与工厂代码自 `src/http/server.js` 逐字节搬迁至 `src/services/serviceContainer.js`；
2. 接口形式与行为保持 100% 现状保全；
3. 不引入新的第三方库、不修改 REST 契约、不涉及数据库变更；
4. 结晶路径直接为：`PRD → CRYSTALLIZE → TEST → ASSERTION-SIGNOFF → BUILD`（可跳过 `/tech-design`）。

---

## 10. 技术方案（simple 高层）

### 10.2 模块与边界

| 模块 | 职责（本 story 增量） |
|---|---|
| `src/services/serviceContainer.js`（新增） | 内聚 8 个服务/注册表的惰性工厂、单例缓存、IM 路由装配、`eventBus` 订阅、日志清理定时任务与统一 `dispose()`。 |
| `src/http/server.js`（重构瘦身） | 移除具体服务工厂与接线，持有 `server.services`，保留 HTTP 监听、路由派发与请求体解析；提供 `_opcXxx` 代理。 |

### 10.3 装配与依赖流

```
[startServer] 
     │
     ▼
[createServiceContainer] ───────► 持有 8 个服务的惰性工厂与接线胶水
     │                                 │
     ▼                                 ▼
[server.services]                [Lazy Factories] (on first call)
     │                                 ├── getSessionStore()
     ▼                                 ├── getAgentRouter()
[handleRequest]                        ├── getSseRegistry()
     │                                 ├── getConfirmationService()
     ├── handleSettings (via services) ├── getPermissionBridge()
     ├── handleAgentSessions (via services) ├── getModeService()
     └── handleAgentConfirmations (via services) ├── getAgentService()
                                       └── getCardRenderer()
```

### 10.4 接口契约

`createServiceContainer(options)` 返回的对象结构：

```js
{
  // 惰性工厂 Getters
  getSessionStore: () => SessionStore,
  getAgentRouter: () => AgentRouter,
  getSseRegistry: () => SseSubscriptionRegistry,
  getConfirmationService: () => ConfirmationService,
  getPermissionBridge: () => PermissionBridge,
  getModeService: () => ModeService,
  getAgentService: async () => AgentService,
  getCardRenderer: () => CardRenderer,
  peekAgentService: () => AgentService | null,

  // 生命周期管理
  start: async () => void, // 执行孤儿恢复、schedule 加载、purge 调度等
  dispose: async () => void, // 释放所有资源、停子进程、销毁 cron
}
```

### 10.5 关键决策

- **D1：Container 随 server 实例创建**：每个 `server` 拥有专属的 `container` 实例，天然保障同进程多实例测试隔离。
- **D2：纯粹搬迁与行为保全**：所有服务的创建参数、回调闭包（如 `notifyResult`、`onPermissionAsk`、`onSessionCreated` 等）与既有逻辑逐字节一致，不改动业务语义。
- **D3：`_opcXxx` 代理层兼容**：在 `server` 对象上通过 `Object.defineProperty` 或 proxy 暴露 `_opcXxx` 属性，测试中的 getter/setter 读取和替换自动同步到 `container`。
- **D4：`server.js` 行数硬约束（≤250 行）**：通过静态测试固化瘦身成果，防止装配逻辑重新蔓延回路由层。
- **D5：`_opcXxx` 代理为 deprecated 兼容层**：代理仅服务于 3 个既有测试的零改动迁移；`server.services` 是唯一正规 DI seam。代理上标注 deprecation 注释，禁止新代码继续依赖 `_opcXxx`；既有测试迁移完成后应删除代理（删除本身不纳入本 story 范围）。
- **D6：`container.dispose()` 与 `stopServer` 生命周期拆分不重不漏**：`dispose()` 只关容器内资源（定时器、agent 子进程、eventBus 订阅、runner.reset、closeDb、channelManager.stop、schedulerService.removeAll）；HTTP 监听关闭留在 `stopServer`。实施时逐一核对每个资源只在一个入口被清理，避免双重清理或遗漏。

---

## 11. 测试决策（含覆盖接缝）

### 11.1 覆盖接缝

| 块 ID | 接缝（Seam） | 载体与测试内容 |
|---|---|---|
| **B1** | `serviceContainer.js` 单元直测 | `tests/capabilities/workspace-management/server/2026-08-16-deepen-service-container/unit/serviceContainer.test.js`：测试 8 个服务的惰性初始化、单例复用、`peekAgentService` 状态转移、参数解析。 |
| **B2** | 容器生命周期 `dispose` 单元直测 | 验证 `dispose()` 对定时器、事件总线、以及已启动 agentService 的清理与停止。 |
| **B3** | `server.js` 结构与兼容性直测 | `tests/capabilities/workspace-management/server/2026-08-16-deepen-service-container/api/serverAssembly.test.js`：验证 `server.services` 注入、`server._opcXxx` 兼容代理的读写行为、以及 `server.js` 行数 ≤ 250 行与 import 依赖方向约束。 |
| 全量 | 全仓回归面 | 运行全量 `npm run test:unit` 与 E2E 测试，验证既有端点与 3 个直接使用 `_opcXxx` 的测试零改动全绿。 |

---

## 12. 范围外

- 重构各服务模块本身的内部实现（如 `agentService.js`、`confirmationService.js` 等）。
- 更改 HTTP REST API 路径与参数格式。
- 修改数据库 Schema。

---

## 13. 补充说明

- 关联 ADR：
  - ADR-008（services 注入模式）
  - ADR-009（惰性模块初始化）
  - ADR-030（sessionDomain 收编与依赖方向回正）
  - 本 story 实施完成后，将沉淀独立的 ADR（`ADR-035：Service Container 独立装配容器与 server.js 纯化`）。

---

## 14. PRD 完整性自检查

- [x] 每个稳定块至少有一条 happy path（写入第 6 节）。
- [x] 涉及用户输入的稳定块有字段级验证规则（写入第 7 节）。
- [x] 每个稳定块有 ≥1 条具体预期值锚点（例子表，写入第 6.3 节）；§7 每条规则有有效/无效例子。
- [x] 每个稳定块有失败场景或显式 N/A（写入第 8 节）。
- [x] 跨模块/外部依赖调用有错误状态定义（写入第 8 节）。
- [x] 复杂度已分级并给出理由（写入第 9 节，simple）。
- [x] 第 10 节“技术方案”：simple 高层已完整说明模块划分、接口契约与关键决策。
- [x] 第 11 节“覆盖接缝”：每个稳定块至少一个 seam（写入第 11.1 节）。
- [x] 自检查结果：**全项 PASS，无悬空缺口。**
