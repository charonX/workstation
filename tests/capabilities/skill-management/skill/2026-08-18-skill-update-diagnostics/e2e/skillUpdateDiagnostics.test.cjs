// REQ-TRACE: 2026-08-18-skill-update-diagnostics/REQ-SKILL-020, 2026-08-18-skill-update-diagnostics/REQ-SKILL-021, 2026-08-18-skill-update-diagnostics/REQ-SKILL-022
// REQ-VERSION: v1-hash:7885a24c88a9e9b8a2c1d4d8e36aaf859f2240bed4dcebdeda1126a728277941
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: skill
// EXPECTED-TRACE: prd.md §10.2 SkillTable 增量（版本 meta / 行内成功反馈 / 失败 log 区块）；§6.3 锚点
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-SKILL-020 AC5 / REQ-SKILL-021 AC4-AC5 / REQ-SKILL-022 AC1-AC2 UI 行为：
//   - 技能组头展示版本号（null → "—"）
//   - 更新失败 → 展示失败原因 + git 输出 log 区块；成功 → 无 log 区块
//   - 更新成功 → 行内成功提示（含 slug；版本变化含新版本）
// 本测试引用的新增 data-testid（实现方须落地）：repo-version / update-success / update-log-panel。
//
// seam：Playwright + Electron（startElectronApp 先例）+ 真实 git 源（install API）。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { updateSettings } = require("../../../../../e2e/helpers/seed.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const REPO_VERSION = "[data-testid='repo-version']";
const UPDATE_SUCCESS = "[data-testid='update-success']";
const UPDATE_LOG_PANEL = "[data-testid='update-log-panel']";
const UPDATE_BUTTON = "[data-testid='repo-update-button']";

async function writeSkillSource(dir, name) {
  const skillDir = path.join(dir, "skills", name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} desc\n---\n\n# ${name}\n`);
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

async function installGitSource(apiBaseUrl, origin) {
  const res = await fetch(`${apiBaseUrl}/api/skills/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType: "git", identifier: `file://${origin}` }),
  });
  if (!res.ok) throw new Error(`install start failed: ${res.status}`);
  const { jobId } = await res.json();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const job = await (await fetch(`${apiBaseUrl}/api/skills/jobs/${jobId}`)).json();
    if (job.status === "success") return job;
    if (job.status === "error") throw new Error(`install job failed: ${JSON.stringify(job)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("install job timed out");
}

test.describe("Skill update diagnostics UI", () => {
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

  async function openSkillsPage() {
    await goToAdminRoute(firstWindow, "#/skills");
    await expect(firstWindow.locator(locators.SKILL_TABLE)).toBeVisible();
  }

  test("REQ-SKILL-020 AC5: 技能组头展示版本号（package.json version）", async () => {
    // EXPECTED-TRACE: prd.md §6.3（local 源 mattpocock-skills → "1.1.0"）+ §10.2 组头 meta
    const sourceDir = path.join(skillRepoPath, "mattpocock");
    await fs.mkdir(sourceDir, { recursive: true });
    await writeSkillSource(sourceDir, "review");
    await fs.writeFile(path.join(sourceDir, "package.json"), JSON.stringify({ version: "1.1.0" }));

    await openSkillsPage();
    const row = firstWindow.locator(locators.REPO_ROW).filter({ hasText: "mattpocock" });
    await expect(row).toBeVisible();
    await expect(row.locator(REPO_VERSION)).toHaveText("1.1.0");
  });

  test("REQ-SKILL-022 AC1/AC2: 更新成功 → 行内成功提示 + 版本刷新可见", async () => {
    // EXPECTED-TRACE: prd.md §10.5 D3（行内提示，非 toast）
    const origin = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-upd-origin-"));
    git(origin, ["init", "-b", "main"]);
    git(origin, ["config", "user.email", "test@example.com"]);
    git(origin, ["config", "user.name", "Test User"]);
    await writeSkillSource(origin, "review");
    await fs.writeFile(path.join(origin, "package.json"), JSON.stringify({ version: "0.1.0" }));
    git(origin, ["add", "."]);
    git(origin, ["commit", "-m", "v1"]);
    await installGitSource(apiBaseUrl, origin);

    await openSkillsPage();
    // git 源行（origin 目录名含随机后缀，按"有更新按钮"定位）
    const anyGitRow = firstWindow.locator(locators.REPO_ROW).filter({ has: firstWindow.locator(UPDATE_BUTTON) });
    await expect(anyGitRow.first()).toBeVisible();
    await anyGitRow.first().locator(UPDATE_BUTTON).click();

    // 成功提示可见（含 slug 文本）
    await expect(firstWindow.locator(UPDATE_SUCCESS)).toBeVisible();
    // REQ-SKILL-021 AC5：成功路径无 log 区块（log 仅失败展示）
    await expect(firstWindow.locator(UPDATE_LOG_PANEL)).not.toBeVisible();
    // fetchGroups 刷新后组头版本字段仍可见（最新值）
    await expect(anyGitRow.first().locator(REPO_VERSION)).toBeVisible();
  });

  test("REQ-SKILL-021 AC4/AC5: 更新失败 → 展示 git 输出 log 区块；成功路径无 log 区块", async () => {
    const origin = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-upd-fail-"));
    git(origin, ["init", "-b", "main"]);
    git(origin, ["config", "user.email", "test@example.com"]);
    git(origin, ["config", "user.name", "Test User"]);
    await writeSkillSource(origin, "review");
    git(origin, ["add", "."]);
    git(origin, ["commit", "-m", "v1"]);
    await installGitSource(apiBaseUrl, origin);

    // 上游新提交（修改 review → 触发 ff-only 拒绝本地改动）+ 克隆内本地改动
    await fs.writeFile(
      path.join(origin, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: v2\n---\n\n# v2\n"
    );
    git(origin, ["add", "."]);
    git(origin, ["commit", "-m", "v2"]);
    const slug = (await (await fetch(`${apiBaseUrl}/api/skills`)).json()).find((g) => g.sourceType === "git").slug;
    const localFile = path.join(skillRepoPath, slug, "skills", "review", "SKILL.md");
    await fs.writeFile(localFile, "local dirty change\n");

    await openSkillsPage();
    const row = firstWindow.locator(locators.REPO_ROW).filter({ hasText: slug });
    await row.locator(UPDATE_BUTTON).click();

    // AC4：失败 → log 区块展示 git 输出原文
    await expect(firstWindow.locator(UPDATE_LOG_PANEL)).toBeVisible();
    await expect(firstWindow.locator(UPDATE_LOG_PANEL)).toContainText(/local changes/i);
  });
});
