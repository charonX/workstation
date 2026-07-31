// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-SKILL-006, 2026-07-29-multi-agent-skills/REQ-SKILL-008, 2026-07-29-multi-agent-skills/REQ-SKILL-009, 2026-07-29-multi-agent-skills/REQ-SKILL-010, 2026-07-29-multi-agent-skills/REQ-SKILL-012, 2026-07-29-multi-agent-skills/REQ-SKILL-013, 2026-07-29-multi-agent-skills/REQ-SKILL-014, 2026-07-29-multi-agent-skills/REQ-SKILL-015
// REQ-VERSION: v1-hash:2a55ba61c735de5ace6ceaf30e9b4aede312c1419bb3505b5795b38eba7bdc49
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-07-29 assertion signoff)

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, updateSettings } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

async function writeSkillSource(dir, skills) {
  for (const name of skills) {
    const skillDir = path.join(dir, "skills", name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} desc\n---\n\n# ${name}\n`
    );
  }
}

async function installLocalSource(apiBaseUrl, identifier) {
  const res = await fetch(`${apiBaseUrl}/api/skills/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType: "local", identifier })
  });
  if (!res.ok) throw new Error(`install start failed: ${res.status}`);
  const { jobId } = await res.json();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const jobRes = await fetch(`${apiBaseUrl}/api/skills/jobs/${jobId}`);
    const job = await jobRes.json();
    if (job.status === "success") return job;
    if (job.status === "error") throw new Error(`install job failed: ${JSON.stringify(job)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("install job timed out");
}

async function linkSkillViaApi(apiBaseUrl, projectId, slug, skillName) {
  const res = await fetch(`${apiBaseUrl}/api/projects/${projectId}/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, skillName })
  });
  if (!res.ok) throw new Error(`link failed: ${res.status}`);
  return res.json();
}

test.describe("Skill Library UI (install / link / converge / resync / external / remove)", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;
  let skillRepoPath;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;

    skillRepoPath = path.join(userDataDir, "skill-repo");
    await fs.mkdir(skillRepoPath, { recursive: true });
    await updateSettings(apiBaseUrl, { skillRepoPath });
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  async function openProjectDetail(projectName) {
    await firstWindow.click(locators.WORKSPACE_LINK);
    const card = firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: projectName });
    await card.locator(locators.CONFIGURE_SKILLS_BUTTON).click();
    await expect(firstWindow.locator(locators.PROJECT_DETAIL_MODAL)).toBeVisible();
    await expect(firstWindow.locator(locators.PROJECT_SKILLS_SECTION)).toBeVisible();
  }

  test("REQ-SKILL-009: install modal offers only git and local sources", async () => {
    await firstWindow.click(locators.SKILLS_LINK);
    await firstWindow.click(locators.INSTALL_SKILL_BUTTON);
    await expect(firstWindow.locator(locators.INSTALL_SKILL_MODAL)).toBeVisible();

    const values = await firstWindow.locator(`${locators.SKILL_SOURCE_SELECT} option`).evaluateAll((els) =>
      els.map((el) => el.value)
    );
    expect([...values].sort()).toEqual(["git", "local"]);
  });

  test("REQ-SKILL-006/008: user installs a local skill source via UI and sees the grouped view", async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-local-src-"));
    await writeSkillSource(source, ["alpha-skill", "beta-skill"]);

    await firstWindow.click(locators.SKILLS_LINK);
    await firstWindow.click(locators.INSTALL_SKILL_BUTTON);
    await firstWindow.selectOption(locators.SKILL_SOURCE_SELECT, "local");
    await firstWindow.fill(locators.SKILL_IDENTIFIER_INPUT, source);
    await firstWindow.click(locators.SUBMIT_INSTALL_SKILL_BUTTON);

    // 安装完成后来源分组与 skill 行可见
    const repoRow = firstWindow.locator(locators.REPO_ROW).first();
    await expect(repoRow).toBeVisible({ timeout: 15000 });
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "alpha-skill" }).first()).toBeVisible();
    await expect(firstWindow.locator(locators.SKILL_ROW).filter({ hasText: "beta-skill" }).first()).toBeVisible();

    await expect.poll(async () => {
      try {
        await fs.access(path.join(skillRepoPath, path.basename(source), "skills", "alpha-skill", "SKILL.md"));
        return true;
      } catch {
        return false;
      }
    }).toBe(true);

    await fs.rm(source, { recursive: true, force: true });
  });

  test("REQ-SKILL-010: user links a library skill to a project and the symlink appears on disk", async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-local-src-"));
    await writeSkillSource(source, ["alpha-skill"]);
    await installLocalSource(apiBaseUrl, source);
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-proj-"));
    await createProject(apiBaseUrl, { name: "Link Project", localPath: projectDir, agentTypes: ["claude-code"] });

    await openProjectDetail("Link Project");
    const row = firstWindow.locator(locators.PROJECT_SKILL_ROW).filter({ hasText: "alpha-skill" }).first();
    await row.locator(locators.SKILL_LINK_BUTTON).click();

    // 行状态变为已关联（出现取消关联按钮）
    await expect(row.locator(locators.SKILL_UNLINK_BUTTON)).toBeVisible();

    // 磁盘上软链真实存在且解析进技能库
    const linkPath = path.join(projectDir, ".claude", "skills", "alpha-skill");
    const resolved = await fs.realpath(linkPath);
    const expected = await fs.realpath(path.join(skillRepoPath, path.basename(source), "skills", "alpha-skill"));
    expect(resolved).toBe(expected);

    await fs.rm(source, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  test("REQ-SKILL-013: changing agentTypes in the edit view converges links on disk", async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-local-src-"));
    await writeSkillSource(source, ["alpha-skill"]);
    await installLocalSource(apiBaseUrl, source);
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-proj-"));
    const project = await createProject(apiBaseUrl, { name: "Converge Project", localPath: projectDir, agentTypes: ["claude-code"] });
    await linkSkillViaApi(apiBaseUrl, project.id, path.basename(source), "alpha-skill");

    // 编辑页追加 codex → 保存 → 收敛摘要可见
    await firstWindow.click(locators.WORKSPACE_LINK);
    const card = firstWindow.locator(locators.PROJECT_CARD).filter({ hasText: "Converge Project" });
    await card.locator(locators.EDIT_PROJECT_BUTTON).click();
    const multiselect = firstWindow.locator(locators.AGENT_TYPE_MULTISELECT);
    await multiselect.locator(`${locators.AGENT_TYPE_OPTION}[data-agent-name='codex'] input[type='checkbox']`).check();
    await firstWindow.click(locators.SUBMIT_PROJECT_BUTTON);
    await expect(firstWindow.locator(locators.CONVERGENCE_SUMMARY)).toBeVisible();

    // codex 的 skillsDir 从 registry 获取，断言新目录下出现软链
    const agents = await (await fetch(`${apiBaseUrl}/api/agents`)).json();
    const codexDir = agents.find((a) => a.name === "codex").skillsDir;
    const resolved = await fs.realpath(path.join(projectDir, codexDir, "alpha-skill"));
    const expected = await fs.realpath(path.join(skillRepoPath, path.basename(source), "skills", "alpha-skill"));
    expect(resolved).toBe(expected);

    await fs.rm(source, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  test("REQ-SKILL-014: resync button rebuilds a manually deleted link", async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-local-src-"));
    await writeSkillSource(source, ["alpha-skill"]);
    await installLocalSource(apiBaseUrl, source);
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-proj-"));
    const project = await createProject(apiBaseUrl, { name: "Resync Project", localPath: projectDir, agentTypes: ["claude-code"] });
    await linkSkillViaApi(apiBaseUrl, project.id, path.basename(source), "alpha-skill");

    // 手工删掉软链
    const linkPath = path.join(projectDir, ".claude", "skills", "alpha-skill");
    await fs.rm(linkPath);

    await openProjectDetail("Resync Project");
    await firstWindow.click(locators.RESYNC_SKILLS_BUTTON);
    await expect(firstWindow.locator(locators.CONVERGENCE_SUMMARY)).toBeVisible();

    const resolved = await fs.realpath(linkPath);
    const expected = await fs.realpath(path.join(skillRepoPath, path.basename(source), "skills", "alpha-skill"));
    expect(resolved).toBe(expected);

    await fs.rm(source, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  test("REQ-SKILL-012: external entries are labeled in the project skills view", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-proj-"));
    const externalSkillDir = path.join(projectDir, ".claude", "skills", "my-external-skill");
    await fs.mkdir(externalSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(externalSkillDir, "SKILL.md"),
      `---\nname: my-external-skill\ndescription: not managed by workstation\n---\n`
    );
    await createProject(apiBaseUrl, { name: "External Project", localPath: projectDir, agentTypes: ["claude-code"] });

    await openProjectDetail("External Project");
    const externalRow = firstWindow.locator(locators.PROJECT_SKILL_ROW).filter({ hasText: "my-external-skill" }).first();
    await expect(externalRow).toBeVisible();
    await expect(externalRow.locator(locators.EXTERNAL_SKILL_BADGE)).toBeVisible();

    await fs.rm(projectDir, { recursive: true, force: true });
  });

  test("REQ-SKILL-015: deleting a source asks for confirmation and removes the group", async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-local-src-"));
    await writeSkillSource(source, ["alpha-skill"]);
    await installLocalSource(apiBaseUrl, source);

    await firstWindow.click(locators.SKILLS_LINK);
    const repoRow = firstWindow.locator(locators.REPO_ROW).filter({ hasText: path.basename(source) });
    await expect(repoRow).toBeVisible();
    await repoRow.locator(locators.REPO_DELETE_BUTTON).click();

    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).toBeVisible();
    await firstWindow.click(locators.CONFIRM_OK_BUTTON);
    await expect(firstWindow.locator(locators.CONFIRM_DIALOG)).not.toBeVisible();
    await expect(repoRow).not.toBeVisible();

    await fs.rm(source, { recursive: true, force: true });
  });
});
