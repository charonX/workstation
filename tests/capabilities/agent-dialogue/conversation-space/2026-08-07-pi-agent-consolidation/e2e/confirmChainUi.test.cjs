// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-043
// REQ-VERSION: v1-hash:2bc5b491ca5f1826acb810baef5baacbdb70e369ddb71546103967c9aeccdf8b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: confirmation
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-043 T-7 UI confirm 生产全链（B8）——验收标准 1-3。
// 覆盖：worker confirm 级工具调用 → IPC confirm-request → UI 内联确认卡 → 批准 submit
// → 工具执行 → 结果回投对话窗（真实 Electron 生产链，非直桥 seam）。
//
// 运行：npm run test:e2e（先 rebuild:electron；ABI 备忘见 testing.md）。
// UX 参照：.aiassist/stories/2026-08-02-ui-copilot/ux/assistant.html（内联确认卡）。
// locator 沿用既有 assistantConfirm.test.cjs 约定（data-testid / data-message-role）。
//
// 预期值签核（来源：ui-copilot assistantConfirm E2E 既有 locator 约定）：
//   [data-testid='composer-input'] / [data-testid='send-button'] /
//   [data-testid*='confirm']（内联确认卡）/ [data-message-role='agent']。
const { test, expect } = require("@playwright/test");

test("REQ-AGENT-043 标准1：UI 空间 confirm 级工具 → 内联确认卡渲染 → 批准 → 工具执行 → 结果回投对话窗", async ({ page }) => {
  // 进入 UI 会话区（/assistant），打开通用/项目空间会话，输入可触发 confirm 的工具调用
  //（项目空间 write/bash 工具走 worker confirm 级，非直桥）。
  // 进入某项目空间会话的点击路径沿用 assistantChat.test.cjs 既有约定（实现者接线时确认）。
  await page.goto("/assistant");
  await page.getByTestId("composer-input").fill("在项目目录写入文件 confirm-e2e.txt 内容为 ok");
  await page.getByTestId("send-button").click();

  // 1. 内联确认卡出现（含工具描述）
  await expect(page.getByTestId("confirm-card")).toBeVisible();
  // 2. 批准 → 工具执行
  await page.getByRole("button", { name: /批准|允许/ }).click();
  await expect(page.getByTestId("confirm-card")).toBeHidden();
  // 3. 结果回投对话窗
  await expect(page.locator("[data-message-role='agent']").last()).toContainText(/执行完成|完成|ok/i);
});

test("REQ-AGENT-043 标准2：拒绝路径——拒绝 → 工具不执行 → 对话窗可见拒绝回执", async ({ page }) => {
  await page.goto("/assistant");
  await page.getByTestId("composer-input").fill("在项目目录写入文件 confirm-reject.txt");
  await page.getByTestId("send-button").click();
  await expect(page.getByTestId("confirm-card")).toBeVisible();
  // 拒绝
  await page.getByRole("button", { name: /拒绝|取消/ }).click();
  await expect(page.getByTestId("confirm-card")).toBeHidden();
  // 对话窗可见拒绝回执（无副作用断言在标准2 集成面——E2E 断言回执文案）
  await expect(page.locator("[data-message-role='agent']").last()).toContainText(/拒绝|已取消|未执行/i);
});

test("REQ-AGENT-043 标准3：全链恰好一张确认卡（REQ-AGENT-042 契约 E2E 层对应）", async ({ page }) => {
  await page.goto("/assistant");
  // 双命中语料（重定向 + cwd 外，见 042 标准1）
  await page.getByTestId("composer-input").fill("echo hi > ../confirm-outside.txt");
  await page.getByTestId("send-button").click();
  // 恰一卡
  await expect(page.locator("[data-testid*='confirm']")).toHaveCount(1);
});
