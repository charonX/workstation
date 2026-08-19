# 需求访谈笔记：深化服务装配架构（Service Container）

- **Story ID**: `2026-08-16-deepen-service-container`
- **日期**: 2026-08-19
- **来源**: `/improve-codebase-architecture` 架构走查候选 #7（`architecture-review-2026-08-16.html`）

---

## 1. 痛点与初衷

- **现状痛点**：`src/http/server.js`（638 行）身兼三重职责：
  1. HTTP 路由分发与请求传输（handleRequest, parseBody, CORS）。
  2. 隐式 DI 容器（8 个服务的惰性工厂、闭包变量与 `server._opcXxx` 属性挂载）。
  3. 复杂生命周期与接线管理（imRouter 编排、eventBus 跨服务事件订阅、每日定时日志清理、stopServer 逐一停机）。
  读者必须并行追踪闭包与 `_opc` 属性两条状态路径，装配知识没有自己的归宿。
- **初衷（一句话）**：装配知识没有自己的家，路由文件里藏着隐式 DI 容器；需将服务工厂、依赖接线与生命周期收归独立的 Service Container。

---

## 2. 澄清决议（Round 1）

1. **容器模块与形态**：
   - 在 `src/services/serviceContainer.js` 提供 `createServiceContainer({ port, configDir, baseUrl, ... })` 工厂。
   - 容器实例对外暴露统一的惰性 Getter（`getSessionStore()`、`getAgentRouter()`、`getSseRegistry()`、`getConfirmationService()`、`getPermissionBridge()`、`getModeService()`、`getAgentService()`、`getCardRenderer()`、`peekAgentService()` 等）以及统一生命周期方法 `dispose()` / `stop()`。
2. **`server` 对象上的属性与向后兼容**：
   - `server.services`（或 `server.container`）作为正式的 DI Seam。
   - 在 `server` 上保留一层薄 getter/setter 代理转发到 container（平滑兼容既有 3 个测试文件中对 `_opcXxx` 的直接访问），实现零破坏性迁移。
3. **事件总线订阅与 IM 路由接线**：
   - 全部收归 `serviceContainer.js` 内部，作为装配胶水（Wiring）的内聚部分，在 `container.dispose()` 时统一清理。
4. **定时任务与清理调度**：
   - 每日日志清理 cron 任务纳入容器生命周期管理。
5. **`server.js` 瘦身目标**：
   - 行数降至 ≤250 行，仅负责 HTTP 传输、路由分发与最顶层的 `startServer`/`stopServer` 编排。

---

## 3. 边界与非目标（Out of Scope）

- **不改动**任何服务的内部业务实现逻辑（如 `agentService`、`confirmationService` 等）。
- **不改动**现有 REST API 契约与 HTTP 端点路径/行为。
- **不改动**数据库 Schema 与底层存储方式。
- **不破坏**同进程多 `server` 实例的测试隔离性（每个 server 对应独立的 container 实例）。
- **严格遵循 ADR-009**：所有重依赖（如 agent 子进程、SQLite 数据库打开等）均维持惰性初始化。

---

## 4. 潜在风险与假设失效层级

- 若方向错误，最可能出现的假设失效层在于：**测试隔离性或测试 Mock Seam 覆盖不全**（少数测试若绕过代理直写深层未暴露属性可能引发异常）。通过保留 `_opcXxx` 代理层与 `server.services` 完整暴露可有效规避。
