// REQ-TRACE: codex-harness-desktop/REQ-SKILL-002, codex-harness-desktop/REQ-SKILL-003, codex-harness-desktop/REQ-SKILL-004
// REQ-VERSION: v1-hash:4b1313dc9c3b59ccfee20bf82bc8fb49d36a5b86a2006abff3f9c33d56cc3035
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

  test("user can install a skill from a local file and see command logs", async () => {
    // Create a minimal local skill fixture outside the configured repo.
    const skillRepoPath = path.join(userDataDir, "skill-repo");
    const sourceDir = path.join(userDataDir, "skill-source", "local-demo-skill");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "SKILL.md"),
      ["---", "name: local-demo-skill", "description: A local demo skill for E2E tests", "---", "", "# Local Demo Skill"].join("\n")
    );

    await firstWindow.click(locators.SKILLS_LINK);
    await expect(firstWindow.locator(locators.SKILL_TABLE)).toBeVisible();

    await firstWindow.click(locators.INSTALL_SKILL_BUTTON);
    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).toBeVisible();

    await firstWindow.selectOption(locators.SKILL_SOURCE_SELECT, "local");
    await firstWindow.fill(locators.SKILL_IDENTIFIER_INPUT, sourceDir);
    await firstWindow.click(locators.SUBMIT_INSTALL_SKILL_BUTTON);

    // Expected: a scrollable log panel appears and receives command output.
    const logPanel = firstWindow.locator(locators.INSTALL_SKILL_LOG_PANEL);
    await expect(logPanel).toBeVisible();
    await expect.poll(async () => (await logPanel.textContent())?.trim().length || 0).toBeGreaterThan(0);

    // Expected: modal closes and the new skill appears in the table
    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).not.toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "local-demo-skill" })).toBeVisible();

    // Expected: source directory was copied into skillRepoPath and contains SKILL.md
    const installedSkillMd = path.join(skillRepoPath, "local-demo-skill", "SKILL.md");
    await expect.poll(async () => {
      try {
        await fs.access(installedSkillMd);
        return true;
      } catch {
        return false;
      }
    }).toBe(true);
  });

  test("user can install a skill from npm and see live install logs", async () => {
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
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "npm-fixture-skill" })).toBeVisible();

    const installedSkillMd = path.join(skillRepoPath, "npm-fixture-skill", "SKILL.md");
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
