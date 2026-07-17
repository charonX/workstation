// REQ-TRACE: REQ-FLOW-021
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { test, expect } from "@playwright/test";

test("Trigger/Condition/Claude Agent 节点均显示重试次数和失败时下拉选择", async ({ page }) => {
  // 行为：三个核心节点的配置面板都包含错误处理配置项
  await page.goto("/flows/demo");

  // Trigger
  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Trigger").click();
  await page.getByTestId("node-n1").click();
  await expect(page.getByLabel("Retries")).toBeVisible();
  await expect(page.getByLabel("On error")).toBeVisible();

  // Condition
  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Condition").click();
  await page.getByTestId("node-n2").click();
  await expect(page.getByLabel("Retries")).toBeVisible();
  await expect(page.getByLabel("On error")).toBeVisible();

  // Agent
  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Agent").click();
  await page.getByTestId("node-n3").click();
  await expect(page.getByLabel("Retries")).toBeVisible();
  await expect(page.getByLabel("On error")).toBeVisible();
});

test("retries 默认值为 1，可配置为 0 或正整数", async ({ page }) => {
  // 行为：retries 字段默认值为 1，可修改为 0 或其他正整数
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Agent").click();
  await page.getByTestId("node-n1").click();

  await expect(page.getByLabel("Retries")).toHaveValue("1");

  await page.getByLabel("Retries").fill("0");
  await page.getByRole("button", { name: /save/i }).click();

  await expect(page.getByLabel("Retries")).toHaveValue("0");
});

test("onError 默认值为 fail，可选 ignore", async ({ page }) => {
  // 行为：onError 字段默认值为 fail，可切换为 ignore
  await page.goto("/flows/demo");

  await page.getByRole("button", { name: /add node/i }).click();
  await page.getByText("Agent").click();
  await page.getByTestId("node-n1").click();

  await expect(page.getByLabel("On error")).toHaveValue("fail");

  await page.getByLabel("On error").selectOption("ignore");
  await page.getByRole("button", { name: /save/i }).click();

  await expect(page.getByLabel("On error")).toHaveValue("ignore");
});
