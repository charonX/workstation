# Test Plan — 2026-08-16-deepen-permission-adjudication

> 故事 ID：`2026-08-16-deepen-permission-adjudication`  
> 关联 REQ：`requirements.md`（REQ-AGENT-118~122）  
> 目录：`tests/capabilities/agent-security/permission/2026-08-16-deepen-permission-adjudication/api/`  

---

## 测试矩阵

| REQ-ID | 测试文件 | 测试类型 | Capability / Entity | 验证重点 |
|---|---|---|---|---|
| REQ-AGENT-118 | `permissionPolicy.test.js` | 单元 | `agent-security` / `PermissionPolicy` | 纯函数直测：规则评估、Fail-Closed、cwd 越界、重定向/管道 pre-gate |
| REQ-AGENT-119 | `permissionAdjudicator.test.js` | 单元 | `agent-security` / `PermissionAdjudicator` | 状态机直测：Per-Instance 工厂、挂起持久化、空间分流、Promise 即时唤醒 |
| REQ-AGENT-120 | `permissionAdjudicator.test.js` | 单元 | `agent-security` / `PermissionAdjudicator` | 安全不变量：approve 零主进程 execute、单一询问幂等性、拒绝语义 |
| REQ-AGENT-121 | `permissionBridge.test.js` | 集成 | `agent-security` / `AuthorizerBridge` | 双端通信桥：Worker 授权挂起、Promise 即时决议、安全命令直放 |
| REQ-AGENT-122 | `serverPermissionWiring.test.js` | 集成 | `agent-security` / `PermissionAdjudicator` | 胶水清理与装配：移除 strict 二次门控、向后兼容 re-export |

## EXPECTED-TRACE 追溯清单

- `REQ-AGENT-118`: trace 自 `prd.md` §6.3 row 1~5, §10.3 row 1
- `REQ-AGENT-119`: trace 自 `prd.md` §6.3 row 6~7, §10.3 row 2
- `REQ-AGENT-120`: trace 自 `prd.md` §6.3 row 6~7, §10.1 row 1
- `REQ-AGENT-121`: trace 自 `prd.md` §6.3 row 8, §10.3 row 3
- `REQ-AGENT-122`: trace 自 `prd.md` §6.3 row 9, §10.3 row 2

## 人工验收项（REFLECT）

- 无（本 story 为纯后端架构深化与安全管道重构，全部行为均已由自动化单元/集成测试 100% 覆盖）。
