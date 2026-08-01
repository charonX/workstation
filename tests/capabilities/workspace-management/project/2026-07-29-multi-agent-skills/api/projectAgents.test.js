// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-WORKSPACE-011, 2026-07-29-multi-agent-skills/REQ-WORKSPACE-013
// REQ-VERSION: v1-hash:8e41121222f9276d64083118cdb9070c5346ec47a4e66a6d10622c1f4c2fcab8
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: project
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-07-29 assertion signoff)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import * as settingsService from "../../../../../../src/services/settingsService.js";

// agentRegistryService 尚不存在（BUILD 产物）：动态 import，让本文件可加载、测试以 RED 失败而非 import 崩溃。
async function registrySvc() {
  return import("../../../../../../src/services/agentRegistryService.js");
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function createProject(baseUrl, { name = "Proj", localPath, agentTypes } = {}) {
  const body = { name, localPath: localPath ?? makeTempDir("opc-agent-proj-") };
  if (agentTypes !== undefined) body.agentTypes = agentTypes;
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });
  return res;
}

async function putProject(baseUrl, projectId, body) {
  return fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });
}

describe("Project agentTypes (field CRUD / validation / registry drift)", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  // ---------- REQ-WORKSPACE-011 项目 agentTypes 字段 ----------

  it("REQ-WORKSPACE-011: new project without agentTypes defaults to [] and round-trips via GET", async () => {
    const res = await createProject(serverCtx.baseUrl);
    assert.equal(res.status, 201);
    const project = await res.json();
    assert.deepEqual(project.agentTypes, []);

    const get = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`);
    assert.equal(get.status, 200);
    assert.deepEqual((await get.json()).agentTypes, []);
  });

  it("REQ-WORKSPACE-011: creating a project with valid agentTypes stores them", async () => {
    const res = await createProject(serverCtx.baseUrl, { agentTypes: ["claude-code", "codex"] });
    assert.equal(res.status, 201);
    assert.deepEqual((await res.json()).agentTypes, ["claude-code", "codex"]);
  });

  it("REQ-WORKSPACE-011: unknown agent keys are rejected with 400 and not stored", async () => {
    const res = await createProject(serverCtx.baseUrl);
    const project = await res.json();

    const put = await putProject(serverCtx.baseUrl, project.id, { agentTypes: ["claude-code", "bogus-agent"] });
    assert.equal(put.status, 400);
    const data = await put.json();
    assert.equal(data.error, "INVALID_AGENT_TYPES");
    assert.ok(data.invalidAgents.includes("bogus-agent"), "error body must list the invalid agent keys");

    const get = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`);
    assert.deepEqual((await get.json()).agentTypes, [], "rejected update must not be stored");
  });

  it("REQ-WORKSPACE-011: duplicate agent keys are deduped on write", async () => {
    const res = await createProject(serverCtx.baseUrl);
    const project = await res.json();

    const put = await putProject(serverCtx.baseUrl, project.id, { agentTypes: ["claude-code", "claude-code", "codex"] });
    assert.equal(put.status, 200);
    const get = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`);
    assert.deepEqual((await get.json()).agentTypes, ["claude-code", "codex"]);
  });

  it("REQ-WORKSPACE-011: non-array agentTypes is rejected with 400", async () => {
    const res = await createProject(serverCtx.baseUrl);
    const project = await res.json();

    const put = await putProject(serverCtx.baseUrl, project.id, { agentTypes: "claude-code" });
    assert.equal(put.status, 400);
  });

  it("REQ-WORKSPACE-011: empty array is a legal value (declare-no-distribution)", async () => {
    const res = await createProject(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
    const project = await res.json();

    const put = await putProject(serverCtx.baseUrl, project.id, { agentTypes: [] });
    assert.equal(put.status, 200);
    const get = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`);
    assert.deepEqual((await get.json()).agentTypes, []);
  });

  it("REQ-WORKSPACE-011: projects created before this story migrate to agentTypes []", async () => {
    // 造一个旧 schema（无 agentTypes 列）的 DB，启动时迁移。
    const tempDir = makeTempDir("opc-agent-migrate-");
    const legacyDbPath = path.join(tempDir, "legacy.db");
    const legacy = new Database(legacyDbPath);
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        sourceType TEXT NOT NULL,
        repoUrl TEXT,
        branch TEXT,
        localPath TEXT,
        updatedAt TEXT NOT NULL
      );
      INSERT INTO projects (id, name, sourceType, localPath, updatedAt)
        VALUES ('legacy-p1', 'Legacy Project', 'local', '/tmp/legacy-p1', '2026-07-01T00:00:00.000Z');
    `);
    legacy.close();

    // reset:false 保留旧库；隔离 settings 到临时 config 目录
    await stopServer(serverCtx);
    const prevConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = path.join(tempDir, "config");
    settingsService.resetSettings();
    let migratedCtx;
    try {
      migratedCtx = await startServer({ reset: false, dbPath: legacyDbPath });
      const res = await fetch(`${migratedCtx.baseUrl}/api/projects/legacy-p1`);
      assert.equal(res.status, 200);
      const project = await res.json();
      assert.equal(project.name, "Legacy Project");
      assert.deepEqual(project.agentTypes, [], "migrated project must gain agentTypes []");
    } finally {
      if (migratedCtx) await stopServer(migratedCtx);
      if (prevConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
      else process.env.OPC_WORKSTATION_CONFIG_DIR = prevConfigDir;
      settingsService.resetSettings();
      fs.rmSync(tempDir, { recursive: true, force: true });
      serverCtx = await startServer();
    }
  });

  // ---------- REQ-WORKSPACE-013 registry 漂移处理 ----------

  /** 把 registry 快照换成缺少 claude-code 的 fixture，测试后恢复。 */
  function withDriftedRegistry(fn) {
    return async () => {
      const snapshotOverride = process.env.OPC_AGENT_REGISTRY_SNAPSHOT;
      const fixture = path.join(os.tmpdir(), `opc-drift-registry-${process.pid}.json`);
      const current = JSON.parse(fs.readFileSync(path.resolve("src/services/agentRegistry.json"), "utf-8"));
      fs.writeFileSync(fixture, JSON.stringify({
        ...current,
        agents: current.agents.filter((a) => a.name !== "claude-code")
      }));
      process.env.OPC_AGENT_REGISTRY_SNAPSHOT = fixture;
      const agentRegistryService = await registrySvc();
      agentRegistryService.resetAgentRegistryCache();
      try {
        await fn(agentRegistryService);
      } finally {
        if (snapshotOverride === undefined) delete process.env.OPC_AGENT_REGISTRY_SNAPSHOT;
        else process.env.OPC_AGENT_REGISTRY_SNAPSHOT = snapshotOverride;
        agentRegistryService.resetAgentRegistryCache();
        fs.rmSync(fixture, { force: true });
      }
    };
  }

  it("REQ-WORKSPACE-013: drifted declaration is preserved and convergence skips the missing agent", withDriftedRegistry(async () => {
    const res = await createProject(serverCtx.baseUrl, { agentTypes: ["claude-code", "codex"] });
    assert.equal(res.status, 201);
    const project = await res.json();

    // AC1：声明原样保留
    const get = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`);
    assert.deepEqual((await get.json()).agentTypes, ["claude-code", "codex"]);

    // AC2：收敛跳过失效 key，其余正常执行
    const put = await putProject(serverCtx.baseUrl, project.id, { agentTypes: ["claude-code", "codex"] });
    assert.equal(put.status, 200, "drifted key must not fail the update");
    const body = await put.json();
    const claude = body.convergence.agents.find((a) => a.agent === "claude-code");
    assert.equal(claude.invalid, true, "drifted agent must be marked invalid in convergence result");
    assert.deepEqual(claude.linked, []);
  }));

  it("REQ-WORKSPACE-013: agent recovers when a snapshot update brings the key back", withDriftedRegistry(async (agentRegistryService) => {
    const res = await createProject(serverCtx.baseUrl, { agentTypes: ["claude-code"] });
    const project = await res.json();

    const putDrifted = await putProject(serverCtx.baseUrl, project.id, { agentTypes: ["claude-code"] });
    const drifted = (await putDrifted.json()).convergence.agents.find((a) => a.agent === "claude-code");
    assert.equal(drifted.invalid, true);

    // 恢复快照（模拟上游更新带回该 key）
    delete process.env.OPC_AGENT_REGISTRY_SNAPSHOT;
    agentRegistryService.resetAgentRegistryCache();

    const putRecovered = await putProject(serverCtx.baseUrl, project.id, { agentTypes: ["claude-code"] });
    const recovered = (await putRecovered.json()).convergence.agents.find((a) => a.agent === "claude-code");
    assert.ok(!recovered.invalid, "recovered agent must converge normally again");
  }));
});
