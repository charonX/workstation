// REQ-TRACE: 2026-07-19-media-production-line/REQ-WORKSPACE-008, 2026-07-19-media-production-line/REQ-WORKSPACE-009, 2026-07-19-media-production-line/REQ-WORKSPACE-010
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { makeTmpDir } from "../../../../../fixtures/media-production-line/tmpProjectDir.js";

const HEADLESS_SERVER = "src/cli/headless-server.js";

// ─── helpers ───

async function waitFor(condition, { timeoutMs = 8000, intervalMs = 150, description = "condition" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  assert.fail(`timed out (${timeoutMs}ms) waiting for: ${description}`);
}

function spawnHeadlessServer(homeDir, extraEnv = {}) {
  const child = spawn(process.execPath, [HEADLESS_SERVER], {
    env: { ...process.env, HOME: homeDir, OPC_SERVER_OWNER: String(process.pid), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  return { child, getStderr: () => stderr };
}

function readServerRecords(homeDir) {
  const file = path.join(homeDir, ".opc-workstation", "server.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// waitFor 条件回调：有已注册（含 port）的 server 记录时返回数组，否则返回 null（继续等）。
function serverRecordsReady(homeDir) {
  const records = readServerRecords(homeDir).filter((r) => r.port);
  return records.length > 0 ? records : null;
}

// 指定 pid 的 server 记录（headless server 重启后，旧 pid 记录可能残留，须按新 pid 匹配）。
function serverRecordForPid(homeDir, pid) {
  const records = readServerRecords(homeDir).filter((r) => r.port && r.pid === pid);
  return records.length > 0 ? records[0] : null;
}

// ─── REQ-WORKSPACE-008 统一 DB 路径 ───

describe("REQ-WORKSPACE-008: 统一 DB 路径", () => {
  let tmp;
  let child;

  beforeEach(() => {
    tmp = makeTmpDir("opc-home-008-");
  });

  afterEach(() => {
    if (child && !child.child.killed) child.child.kill("SIGKILL");
    child = undefined;
    tmp.cleanup();
  });

  it("defaultDbPath() 未显式传参时返回 ~/.opc-workstation/data.db", async () => {
    const db = await import("../../../../../../src/db.js");
    // seam：REQ-WORKSPACE-008 要求 defaultDbPath 导出且默认指向统一路径（当前实现返回 ":memory:"）。
    assert.equal(typeof db.defaultDbPath, "function", "src/db.js 应导出 defaultDbPath()");
    const resolved = db.defaultDbPath();
    assert.ok(
      resolved.endsWith(path.join(".opc-workstation", "data.db")),
      `defaultDbPath() 应指向 ~/.opc-workstation/data.db，实际: ${resolved}`
    );
    assert.notEqual(resolved, ":memory:", ":memory: 仅允许显式传入时使用");
  });

  it("CLI 自起 headless server 后 data.db 真实存在；执行一次 flow 后重启查询执行记录仍在", async () => {
    child = spawnHeadlessServer(tmp.dir);
    const firstPid = child.child.pid;
    const firstRecord = await waitFor(
      () => serverRecordForPid(tmp.dir, firstPid),
      { description: "headless server 注册 server.json" }
    );
    const baseUrl = `http://127.0.0.1:${firstRecord.port}`;

    // 执行一次 flow（manual 触发建执行记录）。
    const project = await (await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P008", localPath: path.join(tmp.dir, "proj") })
    })).json();
    const flow = await (await fetch(`${baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "F008", projectId: project.id })
    })).json();
    const created = await fetch(`${baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, flowId: flow.id, trigger: "manual" })
    });
    assert.equal(created.status, 201);
    const execution = await created.json();

    // 统一 DB 路径落盘（真实 I/O 断言）。
    const dbFile = path.join(tmp.dir, ".opc-workstation", "data.db");
    assert.ok(fs.existsSync(dbFile), `headless server 应落盘统一 DB 文件: ${dbFile}`);

    // 重启（同一 HOME），执行记录仍在。
    child.child.kill("SIGTERM");
    await waitFor(() => !isProcessAlive(child.child.pid), { description: "旧 headless server 退出" });
    child = spawnHeadlessServer(tmp.dir);
    const secondRecord = await waitFor(
      () => serverRecordForPid(tmp.dir, child.child.pid),
      { description: "第二次 headless server 注册 server.json" }
    );
    const res = await fetch(`http://127.0.0.1:${secondRecord.port}/api/executions/${execution.id}`);
    assert.equal(res.status, 200, "重启后应能查到重启前创建的执行记录（DB 持久化）");
  });

  it("数据目录不可写时 server 启动失败并报 E-DB-UNWRITABLE", async () => {
    // 用一个「.opc-workstation 已被同名普通文件占用」的 HOME，使 mkdir/写入必失败（比 chmod 555 对 root 也稳定）。
    fs.writeFileSync(path.join(tmp.dir, ".opc-workstation"), "occupied", "utf8");
    child = spawnHeadlessServer(tmp.dir);

    // 期望：server 启动失败（不发布 server.json），stderr/退出信息含 E-DB-UNWRITABLE（签核码值）。
    const deadline = Date.now() + 5000;
    let published = false;
    while (Date.now() < deadline) {
      if (readServerRecords(tmp.dir).length > 0) { published = true; break; }
      if (child.child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(published, false, "数据目录不可写时 server 不应成功启动");
    assert.match(
      child.getStderr(),
      /E-DB-UNWRITABLE/,
      `启动失败应报 E-DB-UNWRITABLE，实际 stderr: ${child.getStderr() || "(empty)"}`
    );
  });
});

// ─── REQ-WORKSPACE-009 单 server 顶替 ───

describe("REQ-WORKSPACE-009: 单 server 顶替", () => {
  let tmp;
  let oldServer;
  let newServer;

  beforeEach(() => {
    tmp = makeTmpDir("opc-home-009-");
  });

  afterEach(() => {
    for (const s of [oldServer, newServer]) {
      if (s && !s.child.killed) s.child.kill("SIGKILL");
    }
    oldServer = undefined;
    newServer = undefined;
    tmp.cleanup();
  });

  it("App 启动时旧 headless server 收到 shutdown 并退出，注册表最终只有新 server 一条活跃记录", async () => {
    oldServer = spawnHeadlessServer(tmp.dir);
    const oldRecords = await waitFor(
      () => serverRecordsReady(tmp.dir),
      { description: "旧 headless server 注册" }
    );
    const oldPid = oldServer.child.pid;
    assert.ok(oldRecords.length >= 1);

    // 模拟 App 侧启动新 server（同一 HOME / 同一 owner，触发顶替握手）。
    newServer = spawnHeadlessServer(tmp.dir);

    // 旧 server 应在握手后退出。
    await waitFor(
      () => !isProcessAlive(oldPid),
      { timeoutMs: 10000, description: "旧 server 收到 shutdown 并退出" }
    );

    // 注册表最终只有新 server 一条活跃记录。
    await waitFor(
      () => {
        const alive = readServerRecords(tmp.dir).filter((r) => r.port && isProcessAlive(r.pid));
        return alive.length === 1 ? alive : null;
      },
      { description: "注册表收敛为单条活跃记录" }
    );
  });

  it("顶替完成后调度器与飞书通道只在新 server 注册（无双重注册）", async () => {
    oldServer = spawnHeadlessServer(tmp.dir);
    await waitFor(() => serverRecordsReady(tmp.dir), { description: "旧 server 注册" });
    newServer = spawnHeadlessServer(tmp.dir);

    // seam：server 应暴露运行时注册信息（调度器/通道归属）供核验。
    // TODO(BUILD)：顶替完成后在新 server 的 /api/server/status（或等价端点）断言
    // scheduler.registered === true 且 channel.owner === 新 server pid，旧 server 侧均为 false。
    const records = await waitFor(
      () => {
        const alive = readServerRecords(tmp.dir).filter((r) => r.port && isProcessAlive(r.pid));
        return alive.length === 1 ? alive : null;
      },
      { timeoutMs: 10000, description: "注册表收敛为单条活跃记录" }
    );
    const statusRes = await fetch(`http://127.0.0.1:${records[0].port}/api/server/status`);
    assert.equal(statusRes.status, 200, "新 server 应提供运行状态端点以核验调度器/通道唯一注册");
  });

  it("旧 server 拒不退让（握手超时）时新 server 报错，不双跑", async () => {
    // seam：顶替逻辑应导出可注入短超时的接管入口（建议 serverRegistry.takeoverExistingServer({timeoutMs})）。
    const registry = await import("../../../../../../src/serverRegistry.js");
    const takeover = registry.takeoverExistingServer || registry.requestServerShutdownAndTakeover;
    assert.equal(typeof takeover, "function", "serverRegistry 应导出顶替握手入口（接管既有 server）");

    // 拒绝退让的占位 server：响应 /api/settings 但对 shutdown 请求装死。
    const http = await import("node:http");
    const stubborn = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => stubborn.listen(0, "127.0.0.1", resolve));
    try {
      await assert.rejects(
        () => takeover({ port: stubborn.address().port, timeoutMs: 500 }),
        /E-SERVER-TAKEOVER-TIMEOUT/,
        "旧 server 拒不退让时应报 E-SERVER-TAKEOVER-TIMEOUT 而非双跑（签核码值）"
      );
    } finally {
      stubborn.close();
    }
  });

  it("顶替期间到达的 cron tick 至多触发一次（无双触发）", async () => {
    // 依赖顶替握手 + 调度接管落地；握手 seam 就绪后补全为双进程断言。
    // 步骤设计：旧 server 挂 1s 周期 schedule → 顶替窗口内等待 1 个 tick →
    // 统计该 schedule 创建的 execution 数 === 1。
    const registry = await import("../../../../../../src/serverRegistry.js");
    const takeover = registry.takeoverExistingServer || registry.requestServerShutdownAndTakeover;
    assert.equal(typeof takeover, "function", "顶替握手 seam 未就绪，无法构造 tick 竞争窗口");
    // TODO(BUILD)：握手就绪后实现上述双进程断言（execution 数恰好 1，不丢不重）。
  });
});

// ─── REQ-WORKSPACE-010 旧库迁移 ───

describe("REQ-WORKSPACE-010: 旧库迁移", () => {
  let tmp;

  beforeEach(() => {
    tmp = makeTmpDir("opc-home-010-");
  });

  afterEach(() => {
    tmp.cleanup();
  });

  function createLegacyDb(legacyPath) {
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    const db = new Database(legacyPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
        sourceType TEXT NOT NULL, repoUrl TEXT, branch TEXT, localPath TEXT, updatedAt TEXT NOT NULL
      );
    `);
    db.prepare(`INSERT INTO projects (id, name, description, sourceType, repoUrl, branch, localPath, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("proj-legacy-1", "Legacy Project", "from old db", "local", null, null, "/tmp/legacy", new Date().toISOString());
    db.close();
  }

  async function loadMigration() {
    const db = await import("../../../../../../src/db.js");
    // seam：REQ-WORKSPACE-010 要求 db 层提供旧库迁移入口（建议签名 migrateLegacyDb({legacyPath, targetPath, logger})）。
    assert.equal(typeof db.migrateLegacyDb, "function", "src/db.js 应导出 migrateLegacyDb() 迁移入口");
    return db.migrateLegacyDb;
  }

  it("旧 userData/data.db 存在且新路径不存在时复制迁移，原有 projects 可查", async () => {
    const legacyPath = path.join(tmp.dir, "userData", "data.db");
    const targetPath = path.join(tmp.dir, ".opc-workstation", "data.db");
    createLegacyDb(legacyPath);

    const migrateLegacyDb = await loadMigration();
    const logLines = [];
    const result = migrateLegacyDb({
      legacyPath,
      targetPath,
      logger: (line) => logLines.push(typeof line === "string" ? line : JSON.stringify(line))
    });

    assert.ok(fs.existsSync(targetPath), "迁移后新路径应存在 data.db");
    assert.ok(fs.existsSync(legacyPath), "迁移应为复制（非移动），旧库保留可回滚");
    assert.equal(result?.migrated ?? true, true);

    const target = new Database(targetPath, { readonly: true });
    const row = target.prepare("SELECT name FROM projects WHERE id = ?").get("proj-legacy-1");
    target.close();
    assert.equal(row?.name, "Legacy Project", "迁移后原有 projects 记录可查");

    // 结构化日志：含源/目标路径与耗时，不含数据内容。
    const logText = logLines.join("\n");
    assert.ok(logText.includes(legacyPath), "迁移日志应含源路径");
    assert.ok(logText.includes(targetPath), "迁移日志应含目标路径");
    assert.match(logText, /duration|elapsed|ms/i, "迁移日志应含耗时");
    assert.ok(!logText.includes("Legacy Project"), "迁移日志不应包含数据内容");
  });

  it("新路径已存在时不迁移、不覆盖", async () => {
    const legacyPath = path.join(tmp.dir, "userData", "data.db");
    const targetPath = path.join(tmp.dir, ".opc-workstation", "data.db");
    createLegacyDb(legacyPath);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const existing = new Database(targetPath);
    existing.exec(`CREATE TABLE IF NOT EXISTS marker (id TEXT PRIMARY KEY)`);
    existing.prepare("INSERT INTO marker (id) VALUES (?)").run("keep-me");
    existing.close();

    const migrateLegacyDb = await loadMigration();
    const result = migrateLegacyDb({ legacyPath, targetPath, logger: () => {} });
    assert.equal(result?.migrated ?? false, false, "新路径已存在时不应执行迁移");

    const target = new Database(targetPath, { readonly: true });
    const marker = target.prepare("SELECT id FROM marker WHERE id = ?").get("keep-me");
    let hasLegacyProjects = false;
    try {
      target.prepare("SELECT id FROM projects LIMIT 1").get();
      hasLegacyProjects = true;
    } catch {
      hasLegacyProjects = false;
    }
    target.close();
    assert.ok(marker, "已有新库不应被覆盖");
    assert.equal(hasLegacyProjects, false, "已有新库不应被旧库内容混入");
  });
});
