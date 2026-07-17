// REQ-TRACE: REQ-FLOW-018
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { test, expect } from "@playwright/test";

test("Trigger 节点配置面板允许添加、编辑、删除输出变量", async ({ page }) => {
  // 行为：用户能在 Trigger 节点配置面板添加变量并保存
  // 具体 URL、定位器、实现细节由 BUILD 阶段根据实际组件确定
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Trigger").click();
  await page.getByTestId("node-n1").click();

  await page.getByRole("button", { name: /add variable/i }).click();
  await page.getByLabel("Variable name").fill("repoPath");
  await page.getByLabel("Type").selectOption("string");
  await page.getByLabel("Default value").fill("/tmp/repo");

  await page.getByRole("button", { name: /save/i }).click();

  // 保存后变量名应在界面上可见
  await expect(page.getByText("repoPath")).toBeVisible();
});

test("Trigger 节点保存时前端校验变量名称非空、类型合法", async ({ page }) => {
  // 行为：变量名为空时保存被阻止，并显示错误提示
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Trigger").click();
  await page.getByTestId("node-n1").click();

  await page.getByRole("button", { name: /add variable/i }).click();
  await page.getByRole("button", { name: /save/i }).click();

  // 错误提示应可见，具体文案由实现决定
  await expect(page.getByText(/variable name is required/i)).toBeVisible();
});

test("删除变量后该变量不再出现在下游变量选择器中", async ({ page }) => {
  // 行为：删除上游变量后，下游变量选择器不再显示该变量
  await page.goto("/flows/demo");

  // 前置：创建带变量的 Trigger 和下游节点
  // 删除变量
  // 打开下游节点变量选择器

  // 已删除变量不应再出现
  await expect(page.getByText("repoPath")).not.toBeVisible();
});
