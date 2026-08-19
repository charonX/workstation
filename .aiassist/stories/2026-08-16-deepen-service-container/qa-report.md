# QA 质量验收报告：2026-08-16-deepen-service-container

## 1. 摘要
- **Story ID**: `2026-08-16-deepen-service-container`
- **Story 目标**: 抽取独立服务容器 `src/services/serviceContainer.js`，内聚 8 个核心服务的惰性工厂、跨服务接线、定时日志清理任务与安全销毁；将 `src/http/server.js` 瘦身为纯 HTTP 传输与路由分发（≤250 行），挂载 `server.services` 与 `_opcXxx` 兼容代理层。
- **QA 验收结论**: **PASS（全部 14/14 故事验收用例全绿，全仓 1019/1019 单元与集成测试全绿，0 失败 0 回归）**。

---

## 2. 故事验收测试（14/14 PASS）

### REQ-WORKSPACE-017 独立服务容器模块（5/5 PASS）
- [x] AC1: `createServiceContainer` 暴露完整服务 Getter 与生命周期方法
- [x] AC2: 惰性单例同容器多次调用返回同一实例
- [x] AC3: `peekAgentService` 状态窥探不触发提前拉起
- [x] AC4: 跨服务接线（Wiring）内聚绑定与 `eventBus` 订阅
- [x] AC5: 定时日志清理任务持有与调度

### REQ-WORKSPACE-018 容器生命周期统一管理与资源清理（4/4 PASS）
- [x] AC1: 销毁日志清理定时器
- [x] AC2: 安全停止已拉起的 `AgentService`（未拉起时 safe no-op）
- [x] AC3: 全局与协作服务清理统一触发
- [x] AC4: 容错清理不阻断（`try...finally` 安全恢复真实底层 cron 销毁）

### REQ-WORKSPACE-019 server.js 瘦身、server.services 注入与 _opcXxx 兼容代理（5/5 PASS）
- [x] AC1: `startServer` 创建并挂载 `server.services`
- [x] AC2: `handleRequest` 经 `server.services` 注入路由并正常响应
- [x] AC3: `_opcXxx` 兼容代理层可读且可写联动
- [x] AC4: `stopServer` 联动 `container.dispose` 关停并释放端口
- [x] AC5: `server.js` 架构约束与行数瘦身（当前 238 行，严格 ≤250 行）

---

## 3. 关联架构断言与全仓回归测试

1. **依赖方向回正（ADR-030 静态断言）**:
   - `tests/capabilities/agent-dialogue/conversation-space/2026-08-16-deepen-session-domain/api/dependencyDirection.test.js`: **4/4 PASS**
   - 验证 `server.js` 零死导入，领域依赖正向交由 `services/serviceContainer.js` 承接。
2. **全仓测试套件回归**:
   - `npm run test:unit`: **1019/1019 PASS（suites 245, pass 1019, fail 0, skipped 0）**。
   - 耗时: 88.6s。

---

## 4. 质量与缺陷分析
- **Story 内发现与修复的缺陷**:
  1. **REQ-018 AC4 容错测试中的 node-cron 销毁泄漏**：测试在模拟 cron destroy 异常时未在 finally 中恢复原函数并销毁底层 interval，导致单独运行测试事件循环未清空。已在 `serviceContainer.test.js` 中通过 `try...finally` 完美修复并恢复。
  2. **D5 规范补齐**：`server.js` 的 `attachLegacyOpcProxies` 补齐 `@deprecated` JSDoc 注释。
  3. **死导入清理**：移除 `server.js` 残留的 `buildSessionConfig` 与 `createSseSubscriptionRegistry` 导入。
