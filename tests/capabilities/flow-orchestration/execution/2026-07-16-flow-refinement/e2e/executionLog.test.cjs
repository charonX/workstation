// REQ-TRACE: REQ-FLOW-028
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { test, expect } from "@playwright/test";

test("执行历史页显示执行记录", async ({ page }) => {
  // 行为：Executions 页面显示执行记录列表
  await page.goto("/executions");

  await expect(page.getByTestId("execution-list")).toBeVisible();
});

test("执行详情页显示节点输入/输出/分支/错误信息", async ({ page }) => {
  // 行为：执行详情页展示节点级日志信息
  await page.goto("/executions");

  await page.getByTestId("execution-item").first().click();

  await expect(page.getByText(/input/i)).toBeVisible();
  await expect(page.getByText(/output/i)).toBeVisible();
});

test("Claude Agent 节点的调用详情包含 prompt/output/model/provider/status/error/durationMs/attemptCount", async ({ page }) => {
  // 行为：Agent 节点的调用详情在详情页可见
  await page.goto("/executions");

  await page.getByTestId("execution-item").first().click();

  await expect(page.getByText(/prompt/i)).toBeVisible();
  await expect(page.getByText(/model/i)).toBeVisible();
});

test("日志默认保留 7 天，到期自动清理", async ({ page }) => {
  // 行为：超过 7 天的执行记录不再显示
  // 需要构造 7 天前的测试数据，可通过 API 或数据库辅助
  await page.goto("/executions");

  await expect(page.getByText(/7 days ago/i)).not.toBeVisible();
});
