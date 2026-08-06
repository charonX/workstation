// REQ-TRACE: codex-harness-desktop/REQ-WORKSPACE-003, REQ-WORKSPACE-004, REQ-WORKSPACE-007, REQ-WORKSPACE-008, REQ-I18N-001, REQ-I18N-002
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: workspace-management, internationalization-theme
// ENTITY-TRACE: project, settings, theme, language
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// 2026-07-29-multi-agent-skills：旧"Project Detail 复选框关联 skill"测试（REQ-WORKSPACE-006）
// 与 npm fixture 播种已随旧关联模型移除，由
// skill-management/skill/2026-07-29-multi-agent-skills/e2e/skillLibrary.test.cjs 接替。
//
// 2026-08-05 适配：Settings tab 化（REQ-AGENT-023 AC4 测试侧接替）——右上角全局
// 保存移除，改用通用 tab（默认选中）区内保存按钮；断言语义不变。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

// T-8 适配（2026-08-06）：默认落地 = 会话区（/assistant）——管理区左导不在会话区；
// 启动态首次进入设置/工作区页统一先 goto 目标路由（管理区壳，AC5）；断言语义不变。
async function openSettingsPage(firstWindow) {
  await goToAdminRoute(firstWindow, "#/settings");
}
async function openWorkspacePage(firstWindow) {
  await goToAdminRoute(firstWindow, "#/workspace");
}

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
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("user can configure workspace and skill repository in Settings", async () => {
    await openSettingsPage(firstWindow);
    await expect(firstWindow.locator(locators.SETTINGS_FORM)).toBeVisible();

    await firstWindow.fill(locators.WORKSPACE_ROOT_INPUT, `${userDataDir}/workspace`);
    await firstWindow.fill(locators.SKILL_REPO_PATH_INPUT, `${userDataDir}/skills`);
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);

    // Expected: settings persisted and reflected in the form after reload
    await firstWindow.reload();
    await expect(firstWindow.locator(locators.WORKSPACE_ROOT_INPUT)).toHaveValue(`${userDataDir}/workspace`);
    await expect(firstWindow.locator(locators.SKILL_REPO_PATH_INPUT)).toHaveValue(`${userDataDir}/skills`);
  });

  test("user can add a local project from Workspace", async () => {
    await openWorkspacePage(firstWindow);
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

    await openSettingsPage(firstWindow);
    await firstWindow.fill(locators.WORKSPACE_ROOT_INPUT, `${userDataDir}/workspace`);
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);

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
    const consoleMessages = [];
    firstWindow.on("console", (msg) => consoleMessages.push(msg.text()));

    try {
      await openWorkspacePage(firstWindow);
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

      // Verify via API that the project was deleted.
      const projectsAfter = await (await fetch(`${apiBaseUrl}/api/projects`)).json();
      expect(projectsAfter.some(p => p.name === "Delete Me Project")).toBe(false);

      await expect(projectCard).not.toBeVisible();
    } finally {
      if (consoleMessages.length > 0) {
        console.log("Renderer console:", consoleMessages.join("\n"));
      }
    }
  });

  test("theme toggle updates document data-theme", async () => {
    await openSettingsPage(firstWindow);
    await firstWindow.selectOption(locators.THEME_SELECT, "dark");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);

    // Expected: root html attribute reflects dark theme
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "dark");

    await firstWindow.selectOption(locators.THEME_SELECT, "light");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("language toggle updates html lang", async () => {
    await openSettingsPage(firstWindow);
    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "zh-CN");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);

    // Expected: html lang attribute changes and UI text reflects Chinese
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "zh-CN");

    await firstWindow.selectOption(locators.LANGUAGE_SELECT, "en-US");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);
    await expect(firstWindow.locator("html")).toHaveAttribute("lang", "en-US");
  });

  test("density toggle updates data-density", async () => {
    await openSettingsPage(firstWindow);
    await firstWindow.selectOption(locators.DENSITY_SELECT, "compact");
    await firstWindow.click(locators.SAVE_GENERAL_SETTINGS_BUTTON);

    // Expected: root html attribute reflects compact density
    await expect(firstWindow.locator("html")).toHaveAttribute("data-density", "compact");
  });
});
