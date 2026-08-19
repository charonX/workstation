# 需求 — 2026-08-16-deepen-service-container

> 契约锚点：prd.md §6.3 预期值锚点（全机器断言）+ §10.4 接口契约 + §7 验证规则。
> Service Container 独立服务容器——装配知识收归与 server.js 纯化；平滑向后兼容。

## REQ 概览

| REQ-ID | 标题 | 优先级 | 必须性 | scope | 测试类型 | capability | entity |
|---|---|---|---|---|---|---|---|
| REQ-WORKSPACE-017 | 独立服务容器模块（8 服务惰性工厂、接线与定时任务） | P1 | 必须 | intra-module | 单元 | workspace-management | server |
| REQ-WORKSPACE-018 | 容器生命周期统一管理与资源清理（dispose） | P1 | 必须 | intra-module | 单元 | workspace-management | server |
| REQ-WORKSPACE-019 | server.js 瘦身、server.services 注入与 _opcXxx 兼容代理 | P1 | 必须 | cross-module | 单元+集成 | workspace-management | server |

## 稳定块 → REQ 映射

| PRD 块 | REQ |
|---|---|
| B1 独立服务容器 | REQ-WORKSPACE-017 |
| B2 容器生命周期统一管理 | REQ-WORKSPACE-018 |
| B3 server.js 瘦身与依赖注入 Seam | REQ-WORKSPACE-019 |

---

## REQ-WORKSPACE-017：独立服务容器模块

新建 `src/services/serviceContainer.js`，通过 `createServiceContainer` 工厂内聚 8 个服务的惰性单例工厂、`peekAgentService`、`imRouter` 接线、`eventBus` 订阅与日志定时清理。

- capability: `workspace-management`；entity: `server`
- scope: `intra-module`；modules: `src/services/serviceContainer.js`
- 测试路径：`tests/capabilities/workspace-management/server/2026-08-16-deepen-service-container/unit/serviceContainer.test.js`

### AC1 — createServiceContainer 暴露完整服务 Getter
`createServiceContainer(options)` 返回包含 `getSessionStore`、`getAgentRouter`、`getSseRegistry`、`getConfirmationService`、`getPermissionBridge`、`getModeService`、`getAgentService`、`getCardRenderer`、`peekAgentService`、`start`、`dispose` 的容器对象。
EXPECTED-TRACE：prd.md §10.4 接口契约。

### AC2 — 惰性单例同容器多次调用返回同一实例
同一容器内，`getSessionStore() === getSessionStore()`、`getModeService() === getModeService()`、`getSseRegistry() === getSseRegistry()`、`getConfirmationService() === getConfirmationService()`（`strictEqual`）。
EXPECTED-TRACE：prd.md §6.3（单例复用锚点）。

### AC3 — peekAgentService 状态窥探不触发提前拉起
未调用 `getAgentService()` 前，`peekAgentService()` 返回 `null`（不启动 agent 子进程，遵循 ADR-009）；调用 `getAgentService()` 成功后，`peekAgentService()` 返回该 agentService 实例。
EXPECTED-TRACE：prd.md §6.3（peekAgentService 状态转移锚点）。

### AC4 — 跨服务接线（Wiring）内聚绑定
容器在 `start()`（或初始化）时完成 `imRouter` 注册，并向 `eventBus` 订阅 `execution:started`、`execution:progress`、`execution:completed` 转发至 `cardRenderer`。
EXPECTED-TRACE：prd.md §6.1 / §10.3。

### AC5 — 定时日志清理任务持有与调度
容器在 `start()`（或初始化）时执行首次 `runExecutionLogPurge`，并登记 `PURGE_CRON_SCHEDULE` 定时任务（`purgeTask`）。
EXPECTED-TRACE：prd.md §6.1 / §8。

**接口契约（intra-module）**：
```ts
function createServiceContainer(options: {
  port: number;
  configDir?: string;
  baseUrl?: string;
  owner?: string;
  resetDbOnStart?: boolean;
}): ServiceContainer
```

---

## REQ-WORKSPACE-018：容器生命周期统一管理与资源清理

容器提供统一的 `dispose()`（或 `stop()`）方法，在关停时释放所有持有的资源、停子进程、清理订阅与定时器。

- capability: `workspace-management`；entity: `server`
- scope: `intra-module`；modules: `src/services/serviceContainer.js`
- 测试路径：`tests/capabilities/workspace-management/server/2026-08-16-deepen-service-container/unit/serviceContainer.test.js`

### AC1 — 销毁日志清理定时器
调用 `container.dispose()` 时，内部持有的 `purgeTask`（cron 任务）被安全 `destroy()`。
EXPECTED-TRACE：prd.md §6.3。

### AC2 — 安全停止已拉起的 AgentService
若 `agentService` 已被惰性创建，`container.dispose()` await 调用 `agentService.stop()` 确保子进程安全退出；若未创建则为 safe no-op。
EXPECTED-TRACE：prd.md §6.3。

### AC3 — 全局与协作服务清理
`container.dispose()` 统一协调 `schedulerService.removeAll()`、`eventBus.clearSubscribers()`、`runner.reset()`、`closeDb()`、`channelManager.stop()` 的释放。
EXPECTED-TRACE：prd.md §6.1 / §10.4。

### AC4 — 容错清理不阻断
单个子服务释放抛出异常时，`dispose()` 捕获并忽略/记录，确保剩余清理项与 HTTP server.close 顺利完成。
EXPECTED-TRACE：prd.md §8。

---

## REQ-WORKSPACE-019：server.js 瘦身、server.services 注入与 _opcXxx 兼容代理

`src/http/server.js` 纯化为 HTTP 路由与传输分发，持有 `server.services`，并通过 `_opcXxx` 代理平滑兼容既有测试。

- capability: `workspace-management`；entity: `server`
- scope: `cross-module`；modules: `src/http/server.js`, `src/services/serviceContainer.js`
- 测试路径：`tests/capabilities/workspace-management/server/2026-08-16-deepen-service-container/api/serverAssembly.test.js`

### AC1 — startServer 创建并挂载 server.services
`startServer` 启动监听成功后，创建 `createServiceContainer` 实例并挂载到 `server.services`，启动返回值 `{ server, baseUrl, owner }` 保持不变。
EXPECTED-TRACE：prd.md §6.3（server.services 存在性锚点）。

### AC2 — handleRequest 经 server.services 注入路由
`handleRequest` 处理 `settings`、`agent/sessions`、`agent/mode/last`、`agent/confirmations` 等路由时，从 `server.services` 获取各服务的 getter 注入对应 handler。
EXPECTED-TRACE：prd.md §10.3 数据流。

### AC3 — _opcXxx 属性代理与双向兼容
在 `server` 对象上挂载 `_opcSessionStoreFactory`、`_opcSseRegistryFactory`、`_opcConfirmationServiceFactory`、`_opcPermissionBridgeFactory`、`_opcModeServiceFactory`、`_opcAgentService`、`_opcAgentServiceFactory`、`_opcAgentRouter` 属性代理，测试直接读写 `server._opcXxx` 能与 `server.services` 正确联动，既有测试全绿。
EXPECTED-TRACE：prd.md §6.3（兼容代理锚点）。

### AC4 — stopServer 联动 container.dispose 关停
`stopServer({ server })` 内部调用 `server.services.dispose()`，注销 `unregisterServerRecord` 并关闭 HTTP 监听。
EXPECTED-TRACE：prd.md §6.1 主路径。

### AC5 — server.js 架构约束与行数瘦身
`server.js` 行数 ≤ 250 行；且 `server.js` 源码中不得直接 import `createSessionStore`、`createCardRenderer`、`createConfirmationService`、`createPermissionBridge`、`createModeService`、`createAgentService` 具体工厂函数。
EXPECTED-TRACE：prd.md §6.3（行数阈值 ≤250 行 & import 依赖方向约束）。
