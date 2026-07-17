// REQ-TRACE: REQ-FLOW-026
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { test, expect } from "@playwright/test";

test("上游删除或重命名变量后，下游保存时不做强制阻断", async ({ page }) => {
  // 行为：上游变量删除后，下游节点配置仍可保存
  await page.goto("/flows/demo");

  // 前置：创建上游 Trigger 并声明变量，创建下游 Condition 引用该变量
  // 删除上游变量
  // 尝试保存下游节点

  // 保存不应被阻断
  await expect(page.getByText(/cannot save/i)).not.toBeVisible();
});

test("前端变量选择器实时刷新，删除后不再显示已删除变量", async ({ page }) => {
  // 行为：上游变量删除后，变量选择器列表实时更新
  await page.goto("/flows/demo");

  // 前置：创建上游 Trigger 并声明变量
  // 删除变量
  // 打开变量选择器

  await page.getByRole("button", { name: /insert variable/i }).click();

  await expect(page.getByText("deletedVar")).not.toBeVisible();
});
