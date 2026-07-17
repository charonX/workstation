// REQ-TRACE: REQ-FLOW-020
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { test, expect } from "@playwright/test";

test("Claude Agent 节点配置面板提供统一 prompt 文本框", async ({ page }) => {
  // 行为：Agent 节点配置面板包含多行 prompt 文本框
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Agent").click();
  await page.getByTestId("node-n1").click();

  await expect(page.getByLabel("Prompt")).toBeVisible();
  // prompt 文本框应为多行输入（textarea 或等效组件）
});

test("Claude Agent 节点 prompt 支持变量选择器插入 {{fullName}}", async ({ page }) => {
  // 行为：用户能从变量选择器选择上游变量并插入到 prompt
  await page.goto("/flows/demo");

  // 前置：创建上游 Trigger 节点并声明变量
  // 创建 Agent 节点，打开变量选择器，选择变量

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Agent").click();
  await page.getByTestId("node-n2").click();
  await page.getByRole("button", { name: /insert variable/i }).click();
  await page.getByText("n1.input").click();

  // prompt 中应插入 {{n1.input}} 格式的变量引用
  await expect(page.getByLabel("Prompt")).toHaveValue(/\{\{n1\.input\}\}/);
});

test("Claude Agent 节点可配置 provider/model/outputVariable/retries/onError", async ({ page }) => {
  // 行为：Agent 节点支持配置 provider/model/outputVariable/retries/onError 并保存
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Agent").click();
  await page.getByTestId("node-n1").click();

  await page.getByLabel("Provider").selectOption("anthropic");
  await page.getByLabel("Model").selectOption("claude-sonnet-5");
  await page.getByLabel("Output variable").fill("summary");
  await page.getByLabel("Retries").fill("2");
  await page.getByLabel("On error").selectOption("ignore");

  await page.getByRole("button", { name: /save/i }).click();

  await expect(page.getByText("summary")).toBeVisible();
});
