// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-WORKSPACE-012, 2026-07-29-multi-agent-skills/REQ-WORKSPACE-013
// REQ-VERSION: v1-hash:2a55ba61c735de5ace6ceaf30e9b4aede312c1419bb3505b5795b38eba7bdc49
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: project
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-07-29 assertion signoff)

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const PINNED = ["claude-code", "codex", "opencode", "cursor", "kimi-code-cli"];

async function makeProjectDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "opc-agenttypes-e2e-"));
}

test.describe("Agent Type Multi-Select", () => {
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

  async function openCreateProjectModal() {
    await firstWindow.click(locators.WORKSPACE_LINK);
    await firstWindow.click(locators.ADD_PROJECT_BUTTON);
    await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).toBeVisible();
  }

  test("REQ-WORKSPACE-012: selector lists the full registry with pinned agents first and nothing pre-selected", async () => {
    await openCreateProjectModal();

    const multiselect = firstWindow.locator(locators.AGENT_TYPE_MULTISELECT);
    await expect(multiselect).toBeVisible();

    const options = multiselect.locator(locators.AGENT_TYPE_OPTION);
    await expect.poll(async () => options.count()).toBe(75);

    // 置顶分组按约定顺序
    const pinnedGroup = multiselect.locator(locators.AGENT_TYPE_PINNED_GROUP);
    await expect(pinnedGroup).toBeVisible();
    const pinnedNames = await pinnedGroup.locator(locators.AGENT_TYPE_OPTION).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-agent-name"))
    );
    expect(pinnedNames).toEqual(PINNED);

    // 无默认预选
    const checked = await multiselect.locator(`${locators.AGENT_TYPE_OPTION} input[type='checkbox']:checked`).count();
    expect(checked).toBe(0);
  });

  test("REQ-WORKSPACE-012: search filters options by name and displayName (case-insensitive)", async () => {
    await openCreateProjectModal();
    const multiselect = firstWindow.locator(locators.AGENT_TYPE_MULTISELECT);
    const options = multiselect.locator(locators.AGENT_TYPE_OPTION);
    const total = await options.count();

    await firstWindow.fill(locators.AGENT_TYPE_SEARCH_INPUT, "claude");
    await expect.poll(async () => options.count()).toBeLessThan(total);
    const visibleNames = await options.evaluateAll((els) =>
      els.map((el) => `${el.getAttribute("data-agent-name")} ${el.textContent}`.toLowerCase())
    );
    expect(visibleNames.length).toBeGreaterThan(0);
    for (const text of visibleNames) {
      expect(text).toContain("claude");
    }

    await firstWindow.fill(locators.AGENT_TYPE_SEARCH_INPUT, "");
    await expect.poll(async () => options.count()).toBe(total);
  });

  test("REQ-WORKSPACE-012: creating a project with selected agents persists agentTypes", async () => {
    const projectDir = await makeProjectDir();
    await openCreateProjectModal();

    await firstWindow.fill(locators.PROJECT_NAME_INPUT, "Agent E2E Project");
    await firstWindow.fill(locators.PROJECT_LOCAL_PATH_INPUT, projectDir);

    const multiselect = firstWindow.locator(locators.AGENT_TYPE_MULTISELECT);
    for (const name of ["claude-code", "codex"]) {
      await multiselect.locator(`${locators.AGENT_TYPE_OPTION}[data-agent-name='${name}'] input[type='checkbox']`).check();
    }
    await firstWindow.click(locators.SUBMIT_PROJECT_BUTTON);
    await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).not.toBeVisible();

    // AC5：保存后 API 侧 agentTypes 与勾选一致
    const res = await fetch(`${apiBaseUrl}/api/projects`);
    const projects = await res.json();
    const created = projects.find((p) => p.name === "Agent E2E Project");
    expect(created).toBeTruthy();
    expect([...created.agentTypes].sort()).toEqual(["claude-code", "codex"]);

    await fs.rm(projectDir, { recursive: true, force: true });
  });

  test("REQ-WORKSPACE-012: edit view echoes the saved agentTypes", async () => {
    const projectDir = await makeProjectDir();
    await createProject(apiBaseUrl, { name: "Echo Project", localPath: projectDir, agentTypes: ["claude-code", "kimi-code-cli"] });

    await firstWindow.click(locators.WORKSPACE_LINK);
    const card = firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: "Echo Project" });
    await card.locator(locators.EDIT_PROJECT_BUTTON).click();
    await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).toBeVisible();

    const multiselect = firstWindow.locator(locators.AGENT_TYPE_MULTISELECT);
    for (const name of ["claude-code", "kimi-code-cli"]) {
      await expect(
        multiselect.locator(`${locators.AGENT_TYPE_OPTION}[data-agent-name='${name}'] input[type='checkbox']`)
      ).toBeChecked();
    }
    await expect(
      multiselect.locator(`${locators.AGENT_TYPE_OPTION}[data-agent-name='codex'] input[type='checkbox']`)
    ).not.toBeChecked();

    await fs.rm(projectDir, { recursive: true, force: true });
  });

  test("REQ-WORKSPACE-013: a saved agent key missing from the registry shows an invalid badge", async () => {
    // 阶段 1：正常 registry 下创建含 claude-code 的项目（复用当前 app 的 userData）
    const projectDir = await makeProjectDir();
    await createProject(apiBaseUrl, { name: "Drift Project", localPath: projectDir, agentTypes: ["claude-code"] });
    const sharedUserDataDir = userDataDir;
    await stopElectronApp(electronApp, null);
    electronApp = null;

    // 阶段 2：用缺少 claude-code 的快照覆盖重启（复用同一 userData → 同一 DB）
    const snapshotPath = path.resolve("src/services/agentRegistry.json");
    const current = JSON.parse(await fs.readFile(snapshotPath, "utf-8"));
    const drifted = path.join(os.tmpdir(), `opc-drifted-registry-${process.pid}.json`);
    await fs.writeFile(drifted, JSON.stringify({
      ...current,
      agents: current.agents.filter((a) => a.name !== "claude-code")
    }));

    const ctx = await startElectronApp({ extraEnv: { OPC_AGENT_REGISTRY_SNAPSHOT: drifted }, userDataDir: sharedUserDataDir });
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    userDataDir = ctx.userDataDir;
    try {
      await firstWindow.click(locators.WORKSPACE_LINK);
      const card = firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: "Drift Project" });
      await card.locator(locators.EDIT_PROJECT_BUTTON).click();
      await expect(firstWindow.locator(locators.PROJECT_FORM_MODAL)).toBeVisible();

      // 失效 key 不消失、带失效标记、仍处于勾选态
      const invalidOption = firstWindow.locator(`${locators.AGENT_TYPE_OPTION}[data-agent-name='claude-code']`);
      await expect(invalidOption).toBeVisible();
      await expect(invalidOption.locator(locators.AGENT_TYPE_INVALID_BADGE)).toBeVisible();
      await expect(invalidOption.locator("input[type='checkbox']")).toBeChecked();
    } finally {
      await fs.rm(drifted, { force: true });
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });
});
