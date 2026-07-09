// REQ-TRACE: codex-harness-desktop/REQ-SKILL-002, REQ-SKILL-003
// REQ-VERSION: v1-hash:d430fc9129f2087e72c0880464a7bd5430c420753cace446dc54475760bc46c1
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp");
const locators = require("../../../../../e2e/helpers/locators");

test.describe("Skill Install", () => {
  let electronApp;
  let firstWindow;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("user can install a skill from npm/npx source", async () => {
    await firstWindow.click(locators.SKILLS_LINK);
    await expect(firstWindow.locator(locators.SKILL_TABLE)).toBeVisible();

    await firstWindow.click(locators.INSTALL_SKILL_BUTTON);
    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).toBeVisible();

    // TODO: HUMAN ASSERTION — use a real public npm package or a mocked local package
    await firstWindow.selectOption(locators.SKILL_SOURCE_SELECT, "npm");
    await firstWindow.fill(locators.SKILL_IDENTIFIER_INPUT, "@example/opc-skill-demo");
    await firstWindow.click(locators.SUBMIT_INSTALL_SKILL_BUTTON);

    // Expected: modal closes and the new skill appears in the table
    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).not.toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "@example/opc-skill-demo" })).toBeVisible();
  });

  test("user can install a skill from a local file", async () => {
    await firstWindow.click(locators.SKILLS_LINK);
    await firstWindow.click(locators.INSTALL_SKILL_BUTTON);

    // TODO: HUMAN ASSERTION — use a real local skill path
    await firstWindow.selectOption(locators.SKILL_SOURCE_SELECT, "local");
    await firstWindow.fill(locators.SKILL_IDENTIFIER_INPUT, "/tmp/opc-skills/local-skill");
    await firstWindow.click(locators.SUBMIT_INSTALL_SKILL_BUTTON);

    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).not.toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "local-skill" })).toBeVisible();
  });

  test("Skill Detail shows Overview / Parameters / Examples / README tabs", async () => {
    // TODO: HUMAN ASSERTION — seed a skill via API or install via UI first
    await firstWindow.click(locators.SKILLS_LINK);
    await firstWindow.locator(locators.SKILL_ROW).first().click();

    await expect(firstWindow.locator(locators.SKILL_DETAIL_MODAL)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_OVERVIEW)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_PARAMETERS)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_EXAMPLES)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_README)).toBeVisible();

    // TODO: HUMAN ASSERTION — verify tab content expectations
    await firstWindow.click(locators.SKILL_TAB_README);
    await expect(firstWindow.locator(locators.SKILL_DETAIL_MODAL)).toContainText("README");
  });
});
