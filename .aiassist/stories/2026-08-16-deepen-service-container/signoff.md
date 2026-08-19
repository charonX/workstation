# 签核记录 — 2026-08-16-deepen-service-container

## Assertion（门 1，2026-08-19）

### 检查清单

- [x] PRD §14 无 GAP 悬空（B1/B2/B3 全就地补；移动块 §5——无；范围外 §12——各服务内部重构、REST API 变更、DB schema 变更）
- [x] 每个 REQ-ID 都有对应测试（REQ-WORKSPACE-017/018/019 → `unit/serviceContainer.test.js` 与 `api/serverAssembly.test.js` 2 文件 14 用例）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`（v1-hash:e34004c1）、`CAPABILITY-TRACE`、`ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、`ASSERTIONS-SIGNED`（机械核验）
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致（workspace-management/server，已追加 2026-08-16-deepen-service-container 路径与 REQ-017~019）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（grep 0 命中）
- [x] 预期值来源清晰：每条 expected 值 trace 到 prd.md §6.3/§8/§10.3/§10.4 锚点
- [x] 无快照当判定依据（全部字面值/行为/静态约束断言）
- [x] 边界/错误 case 已覆盖（ADR-009 惰性保证、dispose 容错清理、兼容代理层读写联动、静态行数与 import 约束）

### expected 值交叉验证（EXPECTED-TRACE ↔ prd.md 锚点）

| 断言组 | 锚点来源 | 值一致 |
|---|---|---|
| createServiceContainer 暴露完整服务 Getter | §10.4 接口契约 | ✅ |
| 惰性单例同容器多次调用返回同一实例 | §6.3（单例复用锚点） | ✅ |
| peekAgentService 未拉起返回 null | §6.3（peekAgentService 状态转移锚点 & ADR-009） | ✅ |
| 跨服务接线（Wiring）与 eventBus 订阅转发 | §6.1 / §10.3 | ✅ |
| 定时日志清理任务持有与调度 | §6.1 / §8 | ✅ |
| container.dispose() 销毁 purgeTask | §6.3（dispose 释放） | ✅ |
| container.dispose() 安全停止 AgentService | §6.3（dispose 安全停止） | ✅ |
| container.dispose() 统一清理全局与协作服务 | §6.1 / §10.4 | ✅ |
| container.dispose() 容错清理不阻断 | §8（错误状态与容错清理） | ✅ |
| startServer 创建并挂载 server.services | §6.3（server.services 存在性锚点） | ✅ |
| handleRequest 经 services 注入路由 | §10.3 数据流 | ✅ |
| _opcXxx 兼容代理层可读且可写联动 | §6.3（兼容代理锚点） | ✅ |
| stopServer 联动 container.dispose 关停 | §6.1 主路径 | ✅ |
| server.js 架构约束与行数瘦身（≤250 行） | §6.3（行数阈值 ≤250 行 & import 依赖方向约束） | ✅ |

### 升级点结果

- 无升级点触发（无初衷漂移、无跨模块歧义、无推导不出断言、无未决范围决策）。

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-WORKSPACE-017 | `unit/serviceContainer.test.js`（AC1-AC5） | workspace-management/server |
| REQ-WORKSPACE-018 | `unit/serviceContainer.test.js`（AC1-AC4） | workspace-management/server |
| REQ-WORKSPACE-019 | `api/serverAssembly.test.js`（AC1-AC5） | workspace-management/server |

既有测试承载（零改动硬约束验收面）：
- `tests/capabilities/agent-dialogue/confirmation/2026-08-02-builtin-agent/api/confirmation.test.js`
- `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/api/uiConfirmation.test.js`
- `tests/capabilities/plugin-management/mcp-server/2026-08-12-pi-mcp-plugin/api/mcpBridge.test.js`
- 全量 `npm run test:unit`（1000+ 测试零回归）。

### 签核状态

签核时测试全 RED（seam 未就绪门：`src/services/serviceContainer.js` 尚未实现，`server.js` 尚未重构）。无误红，无升级点遗留。
signer = **AI**。门 1 签核通过，解锁 BUILD。
