// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003, REQ-WORKSPACE-004, REQ-WORKSPACE-006, REQ-WORKSPACE-007, REQ-WORKSPACE-008, REQ-I18N-001, REQ-I18N-002
// REQ-VERSION: v1-hash:9ef9310da8e2e2737ea32e521ee7f83fcee2c5d30f8d7d435ae367124e240b22
// CAPABILITY-TRACE: workspace-management, internationalization-theme
// ENTITY-TRACE: project, settings, theme, language
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { installSkill } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

async function createLocalGitRepo(baseDir, repoName) {
  const repoPath = path.join(baseDir, repoName);
  await fs.mkdir(repoPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), `# ${repoName}\n`);
  execFileSync("git", ["add", "."], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoPath });
  return { repoPath, repoUrl: `file://${repoPath}/.git` };
}

test.describe("Onboarding", () => {
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

    // Seed a local skill fixture so Configure Skills has something to link.
    const skillDir = path.join(userDataDir, "skills", "demo-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      ["---", "name: demo-skill", "description: A demo skill for E2E tests", "---", "", "# Demo Skill"].join("\n")
    );
    await installSkill(apiBaseUrl, { source: "local", identifier: skillDir });
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("user can configure workspace and skill repository in Settings", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await expect(firstWindow.locator(locators.SETTINGS_FORM)).toBeVisible();

    await firstWindow.fill(locators.WORKSPACE_ROOT_INPUT, `${userDataDir}/workspace`);
    await firstWindow.fill(locators.SKILL_REPO_PATH_INPUT, `${userDataDir}/skills`);
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);

    // Expected: settings persisted and reflected in the form after reload
    await firstWindow.reload();
    await expect(firstWindow.locator(locators.WORKSPACE_ROOT_INPUT)).toHaveValue(`${userDataDir}/workspace`);
    await expect(firstWindow.locator(locators.SKILL_REPO_PATH_INPUT)).toHaveValue(`${userDataDir}/skills`);
  });

  test("user can add a local project from Workspace", async () => {
    await firstWindow.click(locators.WORKSPACE_LINK);
    await firstWindow.click(locators.ADD_PROJECT_BUTTON);
    await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).toBeVisible();

    await firstWindow.fill(locators.PROJECT_NAME_INPUT, "Demo Project");
    await firstWindow.fill(locators.PROJECT_LOCAL_PATH_INPUT, `${userDataDir}/workspace/demo-project`);
    await firstWindow.click(locators.SUBMIT_PROJECT_BUTTON);

    // Expected: modal closes and project card appears
    await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).not.toBeVisible();
    await expect(firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: "Demo Project" })).toBeVisible();
  });

  test("user can add a git project from Workspace", async () => {
    const { repoUrl } = await createLocalGitRepo(userDataDir, "git-demo-project");

    await firstWindow.click(locators.SETTINGS_LINK);
    await firstWindow.fill(locators.WORKSPACE_ROOT_INPUT, `${userDataDir}/workspace`);
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);

    await firstWindow.click(locators.WORKSPACE_LINK);
    await firstWindow.click(locators.ADD_PROJECT_BUTTON);
    await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).toBeVisible();

    // Switch to Git source.
    await firstWindow.getByRole("button", { name: "Git Repository" }).click();
    await firstWindow.fill(locators.PROJECT_NAME_INPUT, "Git Demo Project");
    await firstWindow.fill(locators.PROJECT_REPO_URL_INPUT, repoUrl);
    await firstWindow.click(locators.SUBMIT_PROJECT_BUTTON);

    // Expected: modal closes and project card appears, and the repo is cloned locally.
    await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).not.toBeVisible();
    await expect(firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: "Git Demo Project" })).toBeVisible();
    await expect(fs.access(path.join(userDataDir, "workspace", "git-demo-project", ".git"))).resolves.toBeUndefined();
  });

  test("user can delete a project from Workspace with confirmation", async () => {
    await firstWindow.click(locators.WORKSPACE_LINK);
    await firstWindow.click(locators.ADD_PROJECT_BUTTON);
    await firstWindow.fill(locators.PROJECT_NAME_INPUT, "Delete Me Project");
    await firstWindow.fill(locators.PROJECT_LOCAL_PATH_INPUT, `${userDataDir}/workspace/delete-me-project`);
    await firstWindow.click(locators.SUBMIT_PROJECT_BUTTON);

    const projectCard = firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: "Delete Me Project" });
    await projectCard.locator(locators.PROJECT_DELETE_BUTTON).click();

    // Confirmation dialog should appear; cancel keeps the project.
    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).toBeVisible();
    await firstWindow.click(locators.CONFIRM_CANCEL_BUTTON);
    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).not.toBeVisible();
    await expect(projectCard).toBeVisible();

    // Confirm delete removes the project.
    await projectCard.locator(locators.PROJECT_DELETE_BUTTON).click();
    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).toBeVisible();
    await firstWindow.click(locators.CONFIRM_OK_BUTTON);
    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).not.toBeVisible();
    await expect(projectCard).not.toBeVisible();
  });

  test("user can configure skills in Project Detail", async () => {
    await firstWindow.click(locators.WORKSPACE_LINK);
    await firstWindow.click(locators.ADD_PROJECT_BUTTON);
    await firstWindow.fill(locators.PROJECT_NAME_INPUT, "Skill Test Project");
    await firstWindow.fill(locators.PROJECT_LOCAL_PATH_INPUT, `${userDataDir}/workspace/skill-test-project`);
    await firstWindow.click(locators.SUBMIT_PROJECT_BUTTON);

    const projectCard = firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: "Skill Test Project" });
    await projectCard.locator(locators.CONFIGURE_SKILLS_BUTTON).click();
    await expect(firstWindow.locator(locators.PROJECT_DETAIL_MODAL)).toBeVisible();

    const skillCheckbox = firstWindow.locator(locators.SKILL_LINK_CHECKBOX).filter({ hasText: "demo-skill" });
    await skillCheckbox.check();
    await expect(skillCheckbox).toBeChecked();
    await skillCheckbox.uncheck();
    await expect(skillCheckbox).not.toBeChecked();

    // Expected: association state toggles without error
    await expect(firstWindow.locator(locators.PROJECT_DETAIL_MODAL)).toBeVisible();
  });

  test("theme toggle updates document data-theme", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await firstWindow.selectOption(locators.THEME_SELECT, "dark");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);

    // Expected: root html attribute reflects dark theme
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "dark");

    await firstWindow.selectOption(locators.THEME_SELECT, "light");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("language toggle updates html lang", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "zh-CN");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);

    // Expected: html lang attribute changes and UI text reflects Chinese
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "zh-CN");

    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "en-US");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "en-US");
  });

  test("density toggle updates data-density", async () => {
    await firstWindow.click(locators.SETTINGS_LINK);
    await firstWindow.selectOption(locators.DENSITY_SELECT, "compact");
    await firstWindow.click(locators.SAVE_SETTINGS_BUTTON);

    // Expected: root html attribute reflects compact density
    await expect(firstWindow.locator("html")).toHaveAttribute("data-density", "compact");
  });
});
