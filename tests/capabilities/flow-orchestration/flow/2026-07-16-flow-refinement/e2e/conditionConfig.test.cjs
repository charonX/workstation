// REQ-TRACE: REQ-FLOW-019
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { test, expect } from "@playwright/test";

test("Condition 节点配置面板提供表达式输入框和变量选择器", async ({ page }) => {
  // 行为：Condition 节点配置面板包含表达式输入框和变量选择器
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Condition").click();
  await page.getByTestId("node-n1").click();

  await expect(page.getByLabel("Expression")).toBeVisible();
  await expect(page.getByRole("button", { name: /insert variable/i })).toBeVisible();
});

test("Condition 节点画布上显示 true/false 两个输出端口", async ({ page }) => {
  // 行为：画布上 Condition 节点有两个明确标识的输出端口
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Condition").click();

  // true/false 端口应在画布上可见，具体标识方式由实现决定
  await expect(page.getByTestId("node-n1-output-true")).toBeVisible();
  await expect(page.getByTestId("node-n1-output-false")).toBeVisible();
});

test("Condition 节点保存时前端校验表达式非空", async ({ page }) => {
  // 行为：表达式为空时保存被阻止，并显示错误提示
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Condition").click();
  await page.getByTestId("node-n1").click();

  await page.getByLabel("Expression").fill("");
  await page.getByRole("button", { name: /save/i }).click();

  await expect(page.getByText(/expression is required/i)).toBeVisible();
});

test("变量选择器可从上游节点选择变量并插入 fullName", async ({ page }) => {
  // 行为：用户能从变量选择器选择上游变量并插入到表达式
  await page.goto("/flows/demo");

  // 前置：创建上游 Trigger 节点并声明变量
  // 创建 Condition 节点，打开变量选择器，选择变量

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Condition").click();
  await page.getByTestId("node-n2").click();
  await page.getByRole("button", { name: /insert variable/i }).click();
  await page.getByText("n1.count").click();

  // 表达式输入框中应包含插入的 fullName
  await expect(page.getByLabel("Expression")).toHaveValue(/n1\.count/);
});
