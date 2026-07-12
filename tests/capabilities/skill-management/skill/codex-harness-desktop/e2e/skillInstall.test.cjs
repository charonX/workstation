// REQ-TRACE: codex-harness-desktop/REQ-SKILL-002, REQ-SKILL-003, REQ-SKILL-004
// REQ-VERSION: v1-hash:9ef9310da8e2e2737ea32e521ee7f83fcee2c5d30f8d7d435ae367124e240b22
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { installSkill } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

test.describe("Skill Install", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("user can install a skill from a local file", async () => {
    // Create a minimal local skill fixture.
    const skillDir = path.join(userDataDir, "skills", "local-demo-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      ["---", "name: local-demo-skill", "description: A local demo skill for E2E tests", "---", "", "# Local Demo Skill"].join("\n")
    );

    await firstWindow.click(locators.SKILLS_LINK);
    await expect(firstWindow.locator(locators.SKILL_TABLE)).toBeVisible();

    await firstWindow.click(locators.INSTALL_SKILL_BUTTON);
    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).toBeVisible();

    await firstWindow.selectOption(locators.SKILL_SOURCE_SELECT, "local");
    await firstWindow.fill(locators.SKILL_IDENTIFIER_INPUT, skillDir);
    await firstWindow.click(locators.SUBMIT_INSTALL_SKILL_BUTTON);

    // Expected: modal closes and the new skill appears in the table
    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).not.toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "local-demo-skill" })).toBeVisible();
  });

  test("Skill Detail shows Overview / Parameters / Examples / README tabs", async () => {
    // Seed a local skill via API so the detail view has data.
    const skillDir = path.join(userDataDir, "skills", "detail-demo-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      ["---", "name: detail-demo-skill", "description: A detail demo skill for E2E tests", "---", "", "# Detail Demo Skill\n\nThis is the README."].join("\n")
    );
    await installSkill(apiBaseUrl, { source: "local", identifier: skillDir });

    await firstWindow.click(locators.SKILLS_LINK);
    await firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "detail-demo-skill" }).click();

    await expect(firstWindow.locator(locators.SKILL_DETAIL_MODAL)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_OVERVIEW)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_PARAMETERS)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_EXAMPLES)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_README)).toBeVisible();

    await firstWindow.click(locators.SKILL_TAB_README);
    await expect(firstWindow.locator(locators.SKILL_DETAIL_MODAL)).toContainText("This is the README.");
  });

  test("user can delete a skill with confirmation", async () => {
    const skillDir = path.join(userDataDir, "skills", "delete-demo-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      ["---", "name: delete-demo-skill", "description: A skill to delete in E2E tests", "---", "", "# Delete Demo Skill"].join("\n")
    );
    await installSkill(apiBaseUrl, { source: "local", identifier: skillDir });

    await firstWindow.click(locators.SKILLS_LINK);
    const skillRow = firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "delete-demo-skill" });
    await skillRow.locator(locators.SKILL_DELETE_BUTTON).click();

    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).toBeVisible();
    await firstWindow.click(locators.CONFIRM_OK_BUTTON);
    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).not.toBeVisible();
    await expect(skillRow).not.toBeVisible();
  });
});
