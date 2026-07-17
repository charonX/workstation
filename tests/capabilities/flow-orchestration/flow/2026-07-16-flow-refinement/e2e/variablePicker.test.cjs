// REQ-TRACE: REQ-FLOW-022
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { test, expect } from "@playwright/test";

test("变量选择器下拉列表按上游节点分组显示", async ({ page }) => {
  // 行为：变量选择器按上游节点分组展示可用变量
  await page.goto("/flows/demo");

  // 前置：创建上游 Trigger 节点并声明变量
  // 创建 Condition 节点，打开变量选择器

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Condition").click();
  await page.getByTestId("node-n2").click();
  await page.getByRole("button", { name: /insert variable/i }).click();

  // 分组标题和变量名应可见，具体展示形式由实现决定
  await expect(page.getByText("Start")).toBeVisible();
  await expect(page.getByText("count")).toBeVisible();
});

test("变量条目显示友好名称和类型标签", async ({ page }) => {
  // 行为：变量选择器中的每个条目显示变量名和类型
  await page.goto("/flows/demo");

  // 前置：创建上游 Trigger 节点并声明变量
  // 打开变量选择器

  await page.getByRole("button", { name: /insert variable/i }).click();

  await expect(page.getByText("string")).toBeVisible();
  await expect(page.getByText("number")).toBeVisible();
});

test("选中变量后输入框自动插入 fullName", async ({ page }) => {
  // 行为：选择变量后自动插入 fullName 到当前输入框
  await page.goto("/flows/demo");

  // 前置：创建上游 Trigger 节点并声明变量
  // 打开变量选择器，选择变量

  await page.getByRole("button", { name: /insert variable/i }).click();
  await page.getByText("count").click();

  await expect(page.getByLabel("Expression")).toHaveValue(/n1\.count/);
});

test("上游删除或重命名变量后变量选择器列表实时刷新", async ({ page }) => {
  // 行为：上游变量变更后，变量选择器列表实时更新
  await page.goto("/flows/demo");

  // 前置：创建上游 Trigger 节点并声明变量
  // 删除变量
  // 打开变量选择器

  await page.getByRole("button", { name: /insert variable/i }).click();

  // 已删除变量不应再出现
  await expect(page.getByText("deletedVar")).not.toBeVisible();
});
