# QA 报告 — 2026-08-16-deepen-permission-adjudication

> 故事 ID：`2026-08-16-deepen-permission-adjudication`  
> 验证日期：2026-08-18  
> 测试环境：macOS, Node.js 22, Electron / Playwright  

---

## 1. 单元与集成测试（Unit & Integration）

- **结果**：PASS (988/988 通过，0 失败)
- **命令**：`npm run test:unit`
- **本 Story 验收与回归测试**（共 16 项用例）：
  - `permissionPolicy.test.js`：5/5 通过（纯函数直测、Fail-Closed、破坏性/读写模式、pre-gate 运算符）
  - `permissionAdjudicator.test.js`：4/4 通过（Per-Instance 构造、挂起持久化、唯一执行者 zero execute、reject 语义与幂等）
  - `permissionBridge.test.js`：3/3 通过（Worker 桥接、即时 Promise 唤醒、pre-gate 接入）
  - `serverPermissionWiring.test.js`：4/4 通过（含 strict 行为断言、`bridge.handlePermissionAsk` 统一承载、静态检查 `server.js` 零手写 strict if-else）

## 2. E2E 测试（Playwright Electron）

- **结果**：PASS (236/236 通过)
- **命令**：`npm run test:e2e`

## 3. 代码质量与 Lint

- **结果**：PASS (0 errors, 37 warnings)
- **命令**：`npm run lint`

## 4. 架构与安全不变量核验

- [x] **strict 语义归一**：`createPolicyEvaluator({ mode: "strict" })` 全量返回 `"ask"`；`permissionBridge.handlePermissionAsk` 统一调度；`server.js` 的 `onPermissionAsk` 仅做单行转发。
- [x] **真实行为断言**：`serverPermissionWiring.test.js` 包含 strict 模式真实生成挂起单并在 approve 后放行的全链路行为断言，静态检查 `server.js` 不含 `getModeService().getMode(...) === "strict"`。
- [x] **单一评估**：pre-gate 与 gotgenes gate 职责清晰，重定向运算符预拦截，常规命令不双 ask。
- [x] **单一询问**：一个操作生成唯一 confirmId，按 `ui:*` / `feishu:*` 空间单向分流。
- [x] **唯一执行者**：授权桥 approve 决议仅通知 Worker 放行，主进程零调用 execute。
- [x] **严格降级 Fail-Closed**：未知工具面与损坏配置默认判定为 ask，零零确认漏洞。
- [x] **消除 20ms 轮询与全局 Map**：内存 Promise 注册表即时唤醒，实例状态闭包隔离。

---

## 结论

- [ ] **等待人（用户）最终验收确认（门 2：REFLECT）**。
