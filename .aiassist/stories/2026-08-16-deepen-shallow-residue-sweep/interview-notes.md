# 需求洞察笔记：浅残留清理（Shallow Residue Sweep）

> 故事 ID：`2026-08-16-deepen-shallow-residue-sweep`
> 日期：2026-08-19
> 来源：架构深化评审报告候选 #8 (`.aiassist/global/architecture-reviews/architecture-review-2026-08-16.html`)

---

## 1. 核心初衷与痛点

在前期快速迭代中，代码库中残留了若干携带隐式假设、伪造成功或宿主错位的浅残留：
1. **Agent 静默 Mock 假成功**：`src/flowEngine/agentAdapter.js` 固定返回 mock success；未配置 provider 的 flow 在 `agentExecutor.js` 中静默走 mock 假装执行成功，掩盖了真实缺少 provider 的配置错误。
2. **5 个路由重复定义响应/错误映射助手**：`routes/{mcp,plugins,skills,projects,settings}.js` 重复实现 `ok`/`badRequest`/`mapError`/`notFound` 等 helper，默认状态码存在不一致，且 `plugins.js` 反向依赖 `mcp.js` 导出。
3. **Cron 描述助手宿主错位**：`taskService.js` 承载了 `getCronDescription` 纯 cron 字符串解析描述逻辑，而真正的 cron 校验与调度归属 `schedulerService.js`。
4. **flowService 残留废弃 UI 助手**：`flowService.js` 中包含 `toggleRun`、`zoomIn`、`zoomOut`、`resetZoom`、`getNodeCategories`、`getEditableFields` 等纯前端画布计算函数，现已全无活跃调用方。
5. **死别名/死导入残留**：CLI 与 Service 层清理后遗留的部分未用导入与转发。

**一句话痛点**：一批浅残留各自携带隐藏语义，每处都通过 Deletion Test，需系统性清理消除技术债务。

---

## 2. 确认的处置策略

1. **Agent 节点缺 Provider 报错**：
   - 彻底删除 `src/flowEngine/agentAdapter.js`。
   - `agentExecutor.js` 中，当 `node.config.provider` 未提供或为空时，返回显式错误状态 `E-AGENT-NO-PROVIDER`（或 `Agent provider is required`），不再静默 mock 成功。
   - 测试环境统一使用已有的 Seam `executionRunner.setAgentExecutorForTests` 注入测试 mock。
2. **统一 HTTP 响应助手**：
   - 提炼 `src/http/responders.js`，集中提供 `ok`, `noContent`, `badRequest`, `notFound`, `mapError`, `decodeParam`, `normalizeBool`。
   - 统一 `mapError` 规则（默认 400，E- 开头业务码透传），各路由收敛统一引用。
3. **Cron 描述助手归位**：
   - 将 `getCronDescription` 移至 `src/services/schedulerService.js`，`schedules.js` 路由改从 `schedulerService` 导入。
   - 从 `taskService.js` 中移除该函数（或保留单行转发）。
4. **删除 flowService 废弃 UI 助手**：
   - 删除 `toggleRun`, `zoomIn`, `zoomOut`, `resetZoom`, `getNodeCategories`, `getEditableFields`。
5. **清理死导入**：
   - 扫描并清理 `mcp.js`, `plugin.js`, `taskService.js` 等模块中未使用的导入。
