# 构建进度：2026-08-16-deepen-service-container

## 目标
落地 Story 2026-08-16-deepen-service-container：抽取独立服务容器 `src/services/serviceContainer.js`，管理 8 个核心服务的惰性单例、跨服务接线、定时日志清理任务与统一销毁，将 `src/http/server.js` 瘦身为纯 HTTP 传输与路由分发（≤ 250 行），并通过 `server.services` 与 `_opcXxx` 代理层保持完全向后兼容。

---

## 切片规划与执行

### Slice 1：独立服务容器模块实现（`REQ-WORKSPACE-017` / `REQ-WORKSPACE-018`）
- [x] 新建 `src/services/serviceContainer.js`（338 行）：
  - 暴露完整 Getter（`getSessionStore`, `getAgentRouter`, `getSseRegistry`, `getConfirmationService`, `getPermissionBridge`, `getModeService`, `getAgentService`, `getCardRenderer`）
  - 实现惰性单例与跨服务 Wiring（`eventBus` 订阅、`imRouter` 注册）
  - 实现 `peekAgentService()` 状态窥探（不提前拉起）
  - 定时日志清理任务持有与调度（`PURGE_CRON_SCHEDULE = "17 3 * * *"`）
  - 统一生命周期管理与安全容错 `dispose()`
- [x] 验证测试：`tests/capabilities/workspace-management/server/2026-08-16-deepen-service-container/unit/serviceContainer.test.js`（9/9 PASS）
- [x] Commit: `abb114b [build] story 2026-08-16-deepen-service-container slice 1：serviceContainer.js 服务容器模块（REQ-WORKSPACE-017/018）`

### Slice 2：`server.js` 重构瘦身与兼容代理（`REQ-WORKSPACE-019`）
- [x] 重构 `src/http/server.js`（瘦身至 234 行，≤ 250 行）：
  - 移除所有具体服务工厂 import，引入 `createServiceContainer`
  - `startServer` 中挂载 `server.services = container` 并启动
  - 挂载 `_opcXxx` 兼容代理层（读写联动至 `container`）
  - `handleRequest` 经 `server.services` 注入路由
  - `stopServer` 联动 `server.services.dispose()`
- [x] 验证测试：`tests/capabilities/workspace-management/server/2026-08-16-deepen-service-container/api/serverAssembly.test.js`（5/5 PASS）
- [x] 全仓回归：`npm run test:unit`（1019/1019 PASS，零破坏零回归）

---

## 阶段结果
全部切片实现完毕，14/14 故事测试全绿，1019/1019 全仓单元与集成测试全绿，进入 QA 阶段。
