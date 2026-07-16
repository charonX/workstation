// REQ-TRACE: codex-harness-desktop/REQ-SKILL-001, codex-harness-desktop/REQ-SKILL-002, codex-harness-desktop/REQ-SKILL-003, codex-harness-desktop/REQ-SKILL-004
// REQ-VERSION: v1-hash:762b9b7ff4d4891a26d57bdd0dd7ead507d8e0b23271665ae1ff317e3cfa9493
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill-repo, skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { installSkill } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const NPM_SKILL_FIXTURE = path.resolve("tests/fixtures/npm-skill");

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

    // Configure a per-test skill repository so installs are isolated and assertable.
    const skillRepoPath = path.join(userDataDir, "skill-repo");
    await fs.mkdir(skillRepoPath, { recursive: true });
    const res = await fetch(`${apiBaseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillRepoPath })
    });
    if (!res.ok) {
      throw new Error(`Failed to set skillRepoPath: ${res.status}`);
    }
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("user can install a skill repo from npm and see live install logs", async () => {
    const skillRepoPath = path.join(userDataDir, "skill-repo");

    await firstWindow.click(locators.SKILLS_LINK);
    await expect(firstWindow.locator(locators.SKILL_TABLE)).toBeVisible();

    await firstWindow.click(locators.INSTALL_SKILL_BUTTON);
    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).toBeVisible();

    await firstWindow.selectOption(locators.SKILL_SOURCE_SELECT, "npm");
    await firstWindow.fill(locators.SKILL_IDENTIFIER_INPUT, NPM_SKILL_FIXTURE);
    await firstWindow.click(locators.SUBMIT_INSTALL_SKILL_BUTTON);

    const logPanel = firstWindow.locator(locators.INSTALL_SKILL_LOG_PANEL);
    await expect(logPanel).toBeVisible();
    await expect.poll(async () => (await logPanel.textContent())?.trim().length || 0).toBeGreaterThan(0);

    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).not.toBeVisible();

    // Expected: repo group appears with the installed skills listed under it.
    const repoRow = firstWindow.locator(locators.REPO_ROW);
    await expect(repoRow).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "npm-fixture-skill" })).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "helper-skill" })).toBeVisible();

    const installedSkillMd = path.join(skillRepoPath, "test-skill", "skills", "npm-fixture-skill", "SKILL.md");
    await expect.poll(async () => {
      try {
        await fs.access(installedSkillMd);
        return true;
      } catch {
        return false;
      }
    }).toBe(true);
  });

  test("Skill Detail shows Overview / Parameters / Examples / README tabs", async () => {
    await installSkill(apiBaseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });

    await firstWindow.click(locators.SKILLS_LINK);
    await firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "npm-fixture-skill" }).click();

    await expect(firstWindow.locator(locators.SKILL_DETAIL_MODAL)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_OVERVIEW)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_PARAMETERS)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_EXAMPLES)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_TAB_README)).toBeVisible();

    await firstWindow.click(locators.SKILL_TAB_README);
    await expect(firstWindow.locator(locators.SKILL_DETAIL_MODAL)).toContainText("This skill is only used to verify");
  });

  test("Skill Detail shows metadata when present and hides absent rows", async () => {
    await installSkill(apiBaseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });

    await firstWindow.click(locators.SKILLS_LINK);
    await firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "npm-fixture-skill" }).click();

    await expect(firstWindow.locator(locators.SKILL_DETAIL_MODAL)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_META_VERSION)).toContainText("1.0.0");
    await expect(firstWindow.locator(locators.SKILL_META_AUTHOR)).toContainText("Test Author");
    await expect(firstWindow.locator(locators.SKILL_META_CATEGORY)).toContainText("Test");
    await expect(firstWindow.locator(locators.SKILL_META_TAGS)).toContainText("test, fixture");

    await firstWindow.locator(locators.SKILL_DETAIL_MODAL).locator(".btn-ghost").click();

    await firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "helper-skill" }).click();
    await expect(firstWindow.locator(locators.SKILL_DETAIL_MODAL)).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_META_VERSION)).not.toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_META_AUTHOR)).not.toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_META_CATEGORY)).not.toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_META_TAGS)).not.toBeVisible();
  });

  test("user can delete a skill repo with confirmation", async () => {
    const { repo } = await installSkill(apiBaseUrl, { source: "npm", identifier: NPM_SKILL_FIXTURE });

    await firstWindow.click(locators.SKILLS_LINK);
    const repoRow = firstWindow.locator(locators.REPO_ROW).filter({ hasText: repo.name });
    await repoRow.locator(locators.REPO_DELETE_BUTTON).click();

    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).toBeVisible();
    await firstWindow.click(locators.CONFIRM_OK_BUTTON);
    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).not.toBeVisible();
    await expect(repoRow).not.toBeVisible();
  });
});
