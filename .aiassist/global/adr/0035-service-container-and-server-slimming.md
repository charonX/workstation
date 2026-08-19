# ADR-035: 独立服务容器 ServiceContainer 与 Server 纯传输化

## 背景与痛点
在重构前，`src/http/server.js`（638 行）同时承担了 HTTP 传输监听、路由分发、依赖注入（DI）容器、服务生命周期 Owner 四重职责：
1. **隐式 DI 容器**：8 个核心服务（`sessionStore`, `agentRouter`, `sseRegistry`, `confirmationService`, `permissionBridge`, `modeService`, `agentService`, `cardRenderer`）的构造工厂、回调闭包直接散落在 `server.js` 的顶层与局部闭包中，并挂载在 `server` 对象的 `_opcXxx` 属性上。
2. **装配逻辑外溢与混乱**：跨服务接线（如 `imRouter` 注册、`eventBus` 订阅、确认回调注入）在 `startServer` 过程中交织，读者必须并行追踪闭包变量与 `_opcXxx` 属性两条路径。
3. **生命周期不自洽**：日志清理定时任务（`purgeExpiredExecutions` cron）在 server 启动时调度并在停止时销毁，生命周期与 HTTP 服务混淆。

---

## 架构决策

### 1. 抽取独立服务容器模块（`src/services/serviceContainer.js`）
- 提供 `createServiceContainer(options)` 工厂函数，返回统一服务容器实例。
- **8 个核心服务统一惰性初始化**：容器暴露 8 个统一的 getter 方法（`getSessionStore`, `getAgentRouter`, `getSseRegistry`, `getConfirmationService`, `getPermissionBridge`, `getModeService`, `getAgentService`, `getCardRenderer`），单例按需加载，多次获取返回同一实例。
- **状态窥探不提前拉起**：提供 `peekAgentService()` 方法，允许在不触发子进程拉起的前提下读取当前存活的 `agentService` 状态。
- **跨服务接线内聚**：在 `container.start()` 中内聚绑定 `imRouter`、订阅 `eventBus`（如 `execution:started`/`completed` 联动 `cardRenderer`）。
- **生命周期统一清理**：持有每日日志清理定时任务（`PURGE_CRON_SCHEDULE = "17 3 * * *"`），`container.dispose()` 中统一安全容错销毁定时器、关停通道管理器、停止 agentService 子进程并重置 runner/db。

### 2. `server.js` 纯传输化与硬约束瘦身
- `src/http/server.js` 移除所有具体服务工厂 import，代码行数从 638 行瘦身至 **238 行**，通过静态架构测试严格断言 **≤ 250 行**。
- `startServer` 中装配并拉起 `server.services = createServiceContainer(...)`。
- `handleRequest` 经 `server.services` 注入下游路由模块（`projects`, `flows`, `executions`, `skills`, `agents`, `agentSessions`, `channel` 等）。
- `stopServer` 统一联动 `server.services.dispose()`。

### 3. DI 契约与 `_opcXxx` 兼容代理层
- `server.services` 成为系统中唯一正规的 DI seam。
- 为了让既有测试（如 mock 某服务工厂）无需任何修改即可运行，在 `server.js` 中通过 `attachLegacyOpcProxies(server, container)` 挂载 `_opcXxx` 属性代理，代理内部读写联动至 `container`。
- `attachLegacyOpcProxies` 显式标注 `@deprecated` JSDoc 注释，禁止新代码依赖，仅作为既有测试的平滑过渡层。

---

## 权衡与影响

- **收益**：
  - 装配知识归位到 services 层，HTTP 路由层恢复为纯粹的请求转发与状态码响应。
  - 服务生命周期可在脱离 HTTP Server 的独立上下文（如测试、无头 CLI 脚本）中独立创建、启动与安全销毁。
  - 彻底消除了闭包变量与对象属性双轨持有的隐式 DI 陷阱。
- **代价**：
  - 既有测试保留了一层 `@deprecated` `_opcXxx` 属性代理，后续如有计划可逐步将测试用例重构为直接注入 `server.services`。

---

## 相关文件与 REQ
- `src/services/serviceContainer.js`
- `src/http/server.js`
- `REQ-WORKSPACE-017`（独立服务容器模块）
- `REQ-WORKSPACE-018`（容器生命周期管理）
- `REQ-WORKSPACE-019`（server.js 瘦身与兼容代理）
