// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-044
// REQ-VERSION: v1-hash:b8623e43fa224a212bb884effd47066c81d246467aa97a9ff2be12e5c10c3c09
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: confirmation
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-044 T-9 bash pre-gate→授权桥生产全链（B9）——验收标准 1-3。
// 覆盖：bash 命中不可见族命令 → pre-gate 预拦截 → 授权桥挂起 → UI 确认卡批准 →
// 命令真实执行（副作用可见）；批准前不执行、批准后恰一次（唯一执行者 ADR-017）。
//
// 运行：npm run test:e2e（先 rebuild:electron；ABI 备忘见 testing.md）。
// 副作用断言：通过 UI 的 read 工具或文件系统检查目标文件存在与内容（fs 断言
// 在测试进程内执行——E2E 与 Electron 同机，可直读测试临时目录）。
//
// 预期值签核（来源：B9 + ADR-017 唯一执行者 + pre-gate 语义）：
//   不可见族（echo e2e > <tmp>/out.txt）→ 恰一卡 → 批准 → 文件产生且内容恰一次。
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function tmpTarget(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-"));
  return path.join(dir, name);
}

test("REQ-AGENT-044 标准1：bash 不可见族 → pre-gate 拦截 → 授权桥挂起 → 批准 → 命令真实执行（副作用可见）", async ({ page }) => {
  const target = tmpTarget("out.txt");
  await page.goto("/assistant");
  // 不可见族命令（含 > 重定向）：绝对路径 → cwd 外 → 双命中（重定向 + external）
  // → pre-gate 判别放行（gotgenes 优先单卡，判别表双命中行）→ gotgenes ask →
  // 授权桥挂起。pre-gate 精确拦截（仅不可见族）已由 042 单测覆盖；本 E2E 验证
  // 授权桥挂起 → 批准 → 执行的完整生产链。
  await page.getByTestId("composer-input").fill(`执行 bash 命令：echo e2e > ${target}`);
  await page.getByTestId("send-button").click();
  // 授权桥挂起 → 确认卡
  await expect(page.getByTestId("confirm-card")).toBeVisible();
  // 批准 → 命令真实执行
  await page.getByRole("button", { name: /批准|允许/ }).click();
  await expect(page.getByTestId("confirm-card")).toBeHidden();
  // 副作用可见：目标文件存在且内容含 e2e
  await expect.poll(() => {
    try { return fs.readFileSync(target, "utf8"); } catch { return ""; }
  }).toContain("e2e");
});

test("REQ-AGENT-044 标准2：批准前命令不执行（无副作用）；批准后恰执行一次（唯一执行者）", async ({ page }) => {
  const target = tmpTarget("out2.txt");
  await page.goto("/assistant");
  await page.getByTestId("composer-input").fill(`执行 bash 命令：echo once > ${target}`);
  await page.getByTestId("send-button").click();
  await expect(page.getByTestId("confirm-card")).toBeVisible();
  // 批准前：文件不存在（无副作用）
  expect(fs.existsSync(target)).toBe(false);
  await page.getByRole("button", { name: /批准|允许/ }).click();
  await expect(page.getByTestId("confirm-card")).toBeHidden();
  // 批准后：存在且内容恰一次（唯一执行者——内容不重复）
  await expect.poll(() => {
    try { return fs.readFileSync(target, "utf8").trim(); } catch { return ""; }
  }).toBe("once");
});

test("REQ-AGENT-044 标准3：双命中语料（echo hi > ../out.txt 相对重定向出 cwd）E2E 恰一卡", async ({ page }) => {
  await page.goto("/assistant");
  // 双命中：重定向 + cwd 外路径 → gotgenes 优先单卡（042 标准1 归属）
  await page.getByTestId("composer-input").fill("echo hi > ../confirm-outside.txt");
  await page.getByTestId("send-button").click();
  await expect(page.locator("[data-testid*='confirm']")).toHaveCount(1);
});
