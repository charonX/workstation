# 测试计划 — 2026-08-16-deepen-service-container

- **Story**: `2026-08-16-deepen-service-container`
- **能力域**: `workspace-management`
- **实体**: `server`
- **版本哈希**: `e34004c13ba54416d2b9151f375ae0daedea3adee9adc4d2f3a6ddfbbd00c56a`

---

## 1. 测试用例与 REQ 映射

| REQ-ID | 场景 / AC | 接缝（Seam） | 测试文件 | 预期行为 / 锚点 |
|---|---|---|---|---|
| **REQ-WORKSPACE-017** | AC1: 暴露完整 Getter 与生命周期 | `serviceContainer.js` | `unit/serviceContainer.test.js` | `getSessionStore` / `getModeService` / `getSseRegistry` / `getConfirmationService` / `getPermissionBridge` / `getAgentService` / `getCardRenderer` / `peekAgentService` / `start` / `dispose` 为函数 |
| **REQ-WORKSPACE-017** | AC2: 惰性单例同容器复用 | `serviceContainer.js` | `unit/serviceContainer.test.js` | 同一 container 多次调用各 getter 返回同一实例引用（`strictEqual`） |
| **REQ-WORKSPACE-017** | AC3: peekAgentService 状态窥探 | `serviceContainer.js` | `unit/serviceContainer.test.js` | 未调用 `getAgentService()` 时返回 `null`（ADR-009 惰性保证） |
| **REQ-WORKSPACE-017** | AC4: 跨服务接线（Wiring）与订阅 | `serviceContainer.js` | `unit/serviceContainer.test.js` | 容器 `start()` 后，`eventBus` 的 `execution:started` 被 `cardRenderer` 正常接收处理 |
| **REQ-WORKSPACE-017** | AC5: 定时日志清理任务持有 | `serviceContainer.js` | `unit/serviceContainer.test.js` | 容器 `start()` 后持有 `purgeTask` 定时任务 |
| **REQ-WORKSPACE-018** | AC1: 销毁日志清理定时器 | `serviceContainer.js` | `unit/serviceContainer.test.js` | `container.dispose()` 销毁 `purgeTask`（`destroy()` 被调用且置空） |
| **REQ-WORKSPACE-018** | AC2: 安全停止 AgentService | `serviceContainer.js` | `unit/serviceContainer.test.js` | `container.dispose()` 安全停止已拉起的服务，未拉起时为 safe no-op |
| **REQ-WORKSPACE-018** | AC3: 全局与协作服务清理 | `serviceContainer.js` | `unit/serviceContainer.test.js` | `container.dispose()` 触发 `eventBus.clearSubscribers` 等 |
| **REQ-WORKSPACE-018** | AC4: 容错清理不阻断 | `serviceContainer.js` | `unit/serviceContainer.test.js` | 单个子项销毁异常时 `dispose()` 不中断 |
| **REQ-WORKSPACE-019** | AC1: startServer 挂载 server.services | `server.js` (startServer) | `api/serverAssembly.test.js` | `startServer` 返回的 `server.services` 挂载有效 container 实例 |
| **REQ-WORKSPACE-019** | AC2: handleRequest 经 services 注入 | `server.js` (HTTP API) | `api/serverAssembly.test.js` | `GET /api/settings` 经容器依赖注入后正常返回 200 JSON |
| **REQ-WORKSPACE-019** | AC3: _opcXxx 兼容代理层 | `server.js` (server._opc*) | `api/serverAssembly.test.js` | `server._opcXxx` 属性可读且赋值可替换容器内工厂（平滑兼容既有 3 个测试） |
| **REQ-WORKSPACE-019** | AC4: stopServer 联动关停 | `server.js` (stopServer) | `api/serverAssembly.test.js` | `stopServer` 联动 `container.dispose()` 关停并释放资源 |
| **REQ-WORKSPACE-019** | AC5: server.js 架构约束与瘦身 | `server.js` 源码静态检查 | `api/serverAssembly.test.js` | `server.js` 行数 ≤ 250 行，且不直接 import 具体服务工厂 |

---

## 2. 回归测试矩阵

- 既有使用 `server._opc*` 的关键测试（零破坏性验证）：
  - `tests/capabilities/agent-dialogue/confirmation/2026-08-02-builtin-agent/api/confirmation.test.js`
  - `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/api/uiConfirmation.test.js`
  - `tests/capabilities/plugin-management/mcp-server/2026-08-12-pi-mcp-plugin/api/mcpBridge.test.js`
- 全量单元测试：`npm run test:unit`（1000+ 测试零回归）。
