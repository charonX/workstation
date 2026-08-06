// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-031
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-031 项目空间 SKILL.md 注入（S6，M2）。
//
// 前置 spike 依赖：H5（多 AgentSession 各持独立 DefaultResourceLoader 共存不串扰）。
// H5 未过 → 本文件整体应以「seam 未就绪」失败信息注明，不得静默绿。
//
// seam 1（主）：createAgentService({ cwd, sessionDir, entry }) —— entry 指向自建
// fake worker 脚本（BUG-004/005 同型），真实 spawn 走完整 ready→session-config
// 下发路径，捕获 session-config 的扩展字段 skillPaths（tech-design IPC 契约节）。
// agentService 须按 spaceKey（ui:project:<pid>:*）经 projectService/skillService
// 关联查询解析项目 skills，组装技能库绝对路径列表下发。
//
// seam 2（available_skills 渐进披露，REQ-AGENT-031 标准 3/4）：worker 按 skillPaths
// 装配 additionalSkillPaths 后由 PI 生成 system prompt 的 available_skills 段。
// 该段在 worker 进程内组装，fake worker 观测不到；此处断言 public seam——
// 建议落点 src/agent/skillAssembly.js，导出
//   listAvailableSkills({ skillPaths }) → [{ name, description }]
// （读取各 skillPath 下 SKILL.md frontmatter，等价于 PI 渐进披露段的输入）。
// seam 具体形态以 implementer 提供的等价 public seam 为准；FAUX 全链（真 worker +
// 真 PI system prompt）由 E2E/worker 集成层可选覆盖，本文件不断言。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resetDb, closeDb } from "../../../../../../src/db.js";

// fake worker：真实 spawn 的子进程入口。不做 LLM，只把收到的 session-config
// 扩展字段记录到 CAPTURE 文件并回 config-ack（协议最小实现：ready/ping/pong/shutdown）。
// 未实现的扩展字段记录为 null —— 测试据此以「seam 未就绪」清晰失败。
const FAKE_WORKER_SRC = `import fs from "node:fs";
import readline from "node:readline";
const captureFile = process.env.OPC_FAKE_CAPTURE;
const rl = readline.createInterface({ input: process.stdin });
process.stdout.write(JSON.stringify({ type: "ready", pid: process.pid }) + "\\n");
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === "session-config") {
    if (captureFile) {
      fs.appendFileSync(captureFile, JSON.stringify({
        type: "session-config",
        sessionKey: msg.sessionKey,
        skillPaths: Array.isArray(msg.skillPaths) ? msg.skillPaths : null,
        cwd: typeof msg.cwd === "string" ? msg.cwd : null,
        permissionProfile: typeof msg.permissionProfile === "string" ? msg.permissionProfile : null,
      }) + "\\n");
    }
    process.stdout.write(JSON.stringify({ type: "config-ack", sessionKey: msg.sessionKey }) + "\\n");
  } else if (msg.type === "ping") {
    process.stdout.write(JSON.stringify({ type: "pong" }) + "\\n");
  } else if (msg.type === "shutdown") {
    process.exit(0);
  }
});
`;

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-031）");
  assert.equal(typeof mod.createAgentService, "function", "agentService 应导出 createAgentService()");
  return mod.createAgentService;
}

async function loadSkillAssembly() {
  const mod = await import("../../../../../../src/agent/skillAssembly.js").catch(() => null);
  assert.ok(
    mod,
    "seam 未就绪：src/agent/skillAssembly.js 尚未实现（REQ-AGENT-031 标准 3/4：available_skills 渐进披露的 public seam，形态以 implementer 等价 seam 为准）"
  );
  assert.equal(
    typeof mod.listAvailableSkills,
    "function",
    "skillAssembly 应导出 listAvailableSkills({ skillPaths })（REQ-AGENT-031 标准 3/4）"
  );
  return mod.listAvailableSkills;
}

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`等待超时：${label}`);
}

// macOS /var→/private/var 等符号链接前缀：契约 = 绝对路径，按 realpath 归一化比较。
function realpathNorm(p) {
  return fs.realpathSync(p);
}

describe("REQ-AGENT-031 项目空间 SKILL.md 注入", () => {
  let workdir;
  let sessionDir;
  let configDir;
  let libRoot;
  let projectDir;
  let entry;
  let captureFile;
  let agentService;
  let project;
  const SKILL_A_DIR_REL = path.join("acme-tools", "skills", "review");
  const SKILL_B_DIR_REL = path.join("beta-tools", "skills", "plan");

  function writeSkill(dir, { name, description }) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`
    );
  }

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-injection-"));
    sessionDir = path.join(workdir, "sessions");
    configDir = path.join(workdir, "config");
    libRoot = path.join(workdir, "skill-lib");
    projectDir = path.join(workdir, "project-a");
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(libRoot, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    entry = path.join(workdir, "fake-worker.mjs");
    captureFile = path.join(workdir, "capture.jsonl");
    fs.writeFileSync(entry, FAKE_WORKER_SRC);
    // 测试隔离：settings/DB 落临时目录（不污染真实用户配置与数据）。
    process.env.OPC_WORKSTATION_CONFIG_DIR = configDir;
    process.env.OPC_FAKE_CAPTURE = captureFile;
    process.env.DB_PATH = path.join(workdir, "data.db");
    resetDb(process.env.DB_PATH);

    // 造项目关联数据：技能库两个来源各一个 skill；项目 A 声明 claude-code 并关联 skill A。
    writeSkill(path.join(libRoot, SKILL_A_DIR_REL), { name: "review", description: "Review code" });
    writeSkill(path.join(libRoot, SKILL_B_DIR_REL), { name: "plan", description: "Plan work" });
    const settingsService = await import("../../../../../../src/services/settingsService.js");
    settingsService.resetSettings();
    settingsService.saveSettings({ skillRepoPath: libRoot });
    const projectService = await import("../../../../../../src/services/projectService.js");
    project = projectService.createLocalProject({
      name: "项目A",
      localPath: projectDir,
      agentTypes: ["claude-code"],
    });
    const skillService = await import("../../../../../../src/services/skillService.js");
    skillService.linkSkillToProject(project, { slug: "acme-tools", skillName: "review" });
    agentService = null;
  });

  afterEach(async () => {
    delete process.env.OPC_FAKE_CAPTURE;
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    await agentService?.stop();
    closeDb();
    delete process.env.DB_PATH;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function readConfigs() {
    if (!fs.existsSync(captureFile)) return [];
    return fs
      .readFileSync(captureFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((m) => m.type === "session-config");
  }

  async function startAndCapture(spaceKey) {
    const createAgentService = await loadAgentService();
    if (!agentService) {
      agentService = createAgentService({ cwd: workdir, sessionDir, entry });
      const ready = [];
      agentService.on("ready", () => ready.push(1));
      await agentService.start();
      await waitUntil(() => ready.length === 1, { label: "worker ready" });
    }
    const before = readConfigs().length;
    agentService.createSession({ spaceKey, provider: "deepseek", apiKey: "sk-test" });
    await waitUntil(() => readConfigs().length > before, { label: `session-config 下发（${spaceKey}）` });
    const configs = readConfigs();
    return configs[configs.length - 1];
  }

  function assertSkillPathsSeam(config) {
    assert.notEqual(
      config.skillPaths,
      null,
      `seam 未就绪：session-config 未携带 skillPaths 数组（REQ-AGENT-031 标准 1，tech-design IPC 契约节）。实际: ${JSON.stringify(config)}`
    );
  }

  it("项目空间会话的 session-config.skillPaths = 项目关联 skills 的技能库绝对路径列表（标准 1）", async () => {
    const config = await startAndCapture(`ui:project:${project.id}:s1`);
    assertSkillPathsSeam(config);
    const actual = config.skillPaths.map(realpathNorm).sort();
    const expected = [realpathNorm(path.join(libRoot, SKILL_A_DIR_REL))];
    assert.deepEqual(
      actual,
      expected,
      `skillPaths 应 = 项目 A 已关联 skills 的技能库绝对路径列表（projectService/skillService 关联查询）。实际: ${JSON.stringify(config.skillPaths)}`
    );
  });

  it("通用空间会话的 session-config.skillPaths = 空数组（标准 1）", async () => {
    const config = await startAndCapture("ui:copilot:s1");
    assertSkillPathsSeam(config);
    assert.deepEqual(config.skillPaths, [], "通用空间不注入任何项目 skills");
  });

  it("飞书会话的 session-config.skillPaths = 空数组（标准 1）", async () => {
    const config = await startAndCapture("feishu:oc_1");
    assertSkillPathsSeam(config);
    assert.deepEqual(config.skillPaths, [], "飞书空间不注入任何项目 skills");
  });

  it("项目空间 available_skills 段含项目 skill 的 name/description（标准 3，渐进披露）", async () => {
    // Arrange：以标准 1 已断言的 skillPaths 契约作为装配输入。
    const skillPaths = [path.join(libRoot, SKILL_A_DIR_REL)];
    const listAvailableSkills = await loadSkillAssembly();
    // Act：worker 装配层生成 available_skills 段输入（name/description 来自 SKILL.md frontmatter）。
    const skills = listAvailableSkills({ skillPaths });
    // Assert：渐进披露段含项目 skill 的 name/description（全文经 read 工具读取，不在此断言）。
    assert.ok(
      skills.some((s) => s.name === "review" && typeof s.description === "string" && s.description.includes("Review code")),
      `available_skills 段应含项目 skill 的 name/description，实际: ${JSON.stringify(skills)}`
    );
  });

  it("通用空间 available_skills 不含任何项目 skills（标准 4，空间隔离）", async () => {
    // Arrange：通用空间 skillPaths 契约 = 空数组（上文已断言）。
    const listAvailableSkills = await loadSkillAssembly();
    // Act
    const skills = listAvailableSkills({ skillPaths: [] });
    // Assert：无任何项目 skill 泄漏进通用空间。
    assert.ok(
      !skills.some((s) => s.name === "review" || s.name === "plan"),
      `通用空间 available_skills 不得含项目 skills（空间隔离），实际: ${JSON.stringify(skills)}`
    );
  });

  it("项目关联变更后新建的会话生效（标准 5；已建会话热更新不断言）", async () => {
    // Arrange：s1 在关联变更前创建。
    const before = await startAndCapture(`ui:project:${project.id}:s1`);
    assertSkillPathsSeam(before);
    // Act：关联第二个 skill 后新建同项目会话 s2。
    const skillService = await import("../../../../../../src/services/skillService.js");
    skillService.linkSkillToProject(project, { slug: "beta-tools", skillName: "plan" });
    const after = await startAndCapture(`ui:project:${project.id}:s2`);
    // Assert：新会话 skillPaths 含两个关联 skill。
    assertSkillPathsSeam(after);
    const actual = after.skillPaths.map(realpathNorm).sort();
    const expected = [
      realpathNorm(path.join(libRoot, SKILL_A_DIR_REL)),
      realpathNorm(path.join(libRoot, SKILL_B_DIR_REL)),
    ].sort();
    assert.deepEqual(
      actual,
      expected,
      `关联变更后新建会话应携带最新关联列表。实际: ${JSON.stringify(after.skillPaths)}`
    );
    // 降级决策（REQ-AGENT-031 标准 5）：已建会话（s1）的热更新不断言——
    // 已建会话经 PI session.reload() 语义刷新，验收以变更后新会话为准。
  });
});
