import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let db = null;
let currentPath = null;

export function defaultDbPath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  return path.join(os.homedir(), ".opc-workstation", "data.db");
}

function wrapDbUnwritableError(message, cause) {
  const err = new Error(`${message} (E-DB-UNWRITABLE)`);
  err.code = "E-DB-UNWRITABLE";
  err.cause = cause;
  return err;
}

export function getDb(dbPath) {
  const target = dbPath || defaultDbPath();
  if (db && currentPath === target) {
    return db;
  }
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
  }
  if (target !== ":memory:") {
    const targetDir = path.dirname(target);
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      // Verify the directory is actually writable by creating a sentinel file.
      const sentinel = path.join(targetDir, `.write-check-${process.pid}`);
      fs.writeFileSync(sentinel, "");
      fs.unlinkSync(sentinel);
    } catch (err) {
      throw wrapDbUnwritableError(`database directory is not writable: ${targetDir}`, err);
    }
  }
  try {
    db = new Database(target);
  } catch (err) {
    if (target !== ":memory:") {
      throw wrapDbUnwritableError(`cannot open database at ${target}`, err);
    }
    throw err;
  }
  currentPath = target;
  initSchema(db);
  migrateSchema(db);
  return db;
}

export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
    currentPath = null;
  }
}

export function resetDb(dbPath) {
  const database = getDb(dbPath ?? currentPath ?? ":memory:");
  database.exec(`
    DROP TABLE IF EXISTS execution_nodes;
    DROP TABLE IF EXISTS logs;
    DROP TABLE IF EXISTS executions;
    DROP TABLE IF EXISTS schedules;
    DROP TABLE IF EXISTS flows;
    DROP TABLE IF EXISTS project_skills;
    DROP TABLE IF EXISTS skills;
    DROP TABLE IF EXISTS skill_repos;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS notifications;
    DROP TABLE IF EXISTS content_sources;
    DROP TABLE IF EXISTS channel_bindings;
    DROP TABLE IF EXISTS channel_messages;
    DROP TABLE IF EXISTS agent_sessions;
    DROP TABLE IF EXISTS agent_space_meta;
    DROP TABLE IF EXISTS agent_confirmations;
  `);
  initSchema(database);
}

export function migrateLegacyDb({ legacyPath, targetPath, logger }) {
  if (!legacyPath || !targetPath) {
    return { migrated: false };
  }
  if (fs.existsSync(targetPath)) {
    return { migrated: false };
  }
  if (!fs.existsSync(legacyPath)) {
    return { migrated: false };
  }
  const start = Date.now();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(legacyPath, targetPath);
  const durationMs = Date.now() - start;
  const logEntry = {
    event: "legacy-db-migration",
    source: legacyPath,
    target: targetPath,
    durationMs
  };
  if (logger) {
    logger(logEntry);
  }
  return { migrated: true };
}

// REQ-FLOW-028 / tech-design §5.6：节点级执行记录，经 executionId 关联 executions。
// initSchema 与 migrateSchema 共用同一 DDL（CREATE IF NOT EXISTS 幂等，旧库补建安全）。
const EXECUTION_NODES_DDL = `
  CREATE TABLE IF NOT EXISTS execution_nodes (
    id TEXT PRIMARY KEY,
    executionId TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    nodeName TEXT,
    inputVariables TEXT,
    outputVariables TEXT,
    branchTaken TEXT,
    error TEXT,
    attemptCount INTEGER NOT NULL DEFAULT 1,
    prompt TEXT,
    output TEXT,
    model TEXT,
    provider TEXT,
    status TEXT,
    durationMs INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_execution_nodes_execution ON execution_nodes(executionId);
`;

// REQ-AGENT-016 接口契约：agent_confirmations（确认挂起队列，SQLite 为真相）。
// confirmId 唯一（幂等：同一确认回调只执行一次）；状态 pending|approved|rejected；
// args 为命令参数 JSON（LLM flags 归一化后的 kebab-case 形式）。initSchema 与
// migrateSchema（旧库补建）共用同一 DDL（CREATE IF NOT EXISTS 幂等，防漂移）。
const CONFIRMATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS agent_confirmations (
    confirmId TEXT PRIMARY KEY,
    sessionKey TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '{}',
    riskLevel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_confirmations_status ON agent_confirmations(status);
`;

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sourceType TEXT NOT NULL,
      repoUrl TEXT,
      branch TEXT,
      localPath TEXT,
      agentTypes TEXT NOT NULL DEFAULT '[]',
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      nodeList TEXT NOT NULL DEFAULT '[]',
      edges TEXT NOT NULL DEFAULT '[]',
      scheduleEnabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      publishedNodeList TEXT NOT NULL DEFAULT '[]',
      publishedEdges TEXT NOT NULL DEFAULT '[]',
      publishedAt TEXT,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      flowId TEXT NOT NULL,
      cron TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      variables TEXT NOT NULL DEFAULT '{}',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      flowId TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      endedAt TEXT,
      duration TEXT,
      nodesRun INTEGER NOT NULL DEFAULT 0,
      variables TEXT,
      output TEXT,
      branchPath TEXT,
      iterations TEXT,
      logs TEXT,
      artifacts TEXT,
      parentExecutionId TEXT,
      parentNodeId TEXT,
      depth INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      executionId TEXT NOT NULL,
      at TEXT NOT NULL,
      node TEXT,
      status TEXT,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      executionId TEXT,
      createdAt TEXT NOT NULL,
      readAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_createdAt ON notifications(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_readAt ON notifications(readAt);

    CREATE TABLE IF NOT EXISTS content_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_sources_createdAt ON content_sources(createdAt DESC);

    CREATE TABLE IF NOT EXISTS channel_bindings (
      id TEXT PRIMARY KEY,
      channelType TEXT NOT NULL UNIQUE,
      flowId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_bindings_channelType ON channel_bindings(channelType);

    CREATE TABLE IF NOT EXISTS channel_messages (
      messageId TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_messages_createdAt ON channel_messages(createdAt DESC);

    -- REQ-AGENT-008 接口契约：agent_sessions（对话空间 ↔ PI session 引用）。
    -- SQLite 为真相；spaceKey 唯一（feishu:<chatId> / ui:copilot:<sid> /
    -- ui:project:<pid>:<sid>）；sessionRef = JSONL 路径。
    -- REQ-AGENT-027（ADR-016 空间=会话）：title 附加列——首条用户消息截断
    -- （slice(0,40) 无省略号，signoff 裁决 4）；旧行 NULL 兼容（迁移补列）。
    CREATE TABLE IF NOT EXISTS agent_sessions (
      spaceKey TEXT PRIMARY KEY,
      sessionRef TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      lastActiveAt TEXT NOT NULL,
      summaryRef TEXT,
      title TEXT
    );

    -- REQ-AGENT-016 接口契约：agent_confirmations（确认挂起队列，SQLite 为真相）。
    -- confirmId 唯一（幂等：同一确认回调只执行一次）；状态 pending|approved|rejected；
    -- args 为命令参数 JSON（LLM flags 归一化后的 kebab-case 形式）。
    ${CONFIRMATIONS_DDL}

    -- REQ-AGENT-029（signoff 裁决 10 候选 A）：agent_space_meta（通道空间显示名侧表）。
    -- spaceKey 唯一 = agent_sessions.spaceKey（飞书 chat）；写入在 M3 通道侧，UI 侧只读。
    CREATE TABLE IF NOT EXISTS agent_space_meta (
      spaceKey TEXT PRIMARY KEY,
      displayName TEXT
    );

    ${EXECUTION_NODES_DDL}
  `);
}

function hasColumn(database, table, column) {
  const info = database.prepare(`PRAGMA table_info(${table})`).all();
  return info.some(col => col.name === column);
}

function migrateSchema(database) {
  // BUG-007: add soft-delete column to flows created before logical delete was introduced.
  if (!hasColumn(database, "flows", "deletedAt")) {
    database.exec(`ALTER TABLE flows ADD COLUMN deletedAt TEXT`);
  }
  if (!hasColumn(database, "flows", "status")) {
    database.exec(`ALTER TABLE flows ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'`);
  }
  if (!hasColumn(database, "flows", "publishedNodeList")) {
    database.exec(`ALTER TABLE flows ADD COLUMN publishedNodeList TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!hasColumn(database, "flows", "publishedEdges")) {
    database.exec(`ALTER TABLE flows ADD COLUMN publishedEdges TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!hasColumn(database, "flows", "publishedAt")) {
    database.exec(`ALTER TABLE flows ADD COLUMN publishedAt TEXT`);
  }
  if (!hasColumn(database, "schedules", "variables")) {
    database.exec(`ALTER TABLE schedules ADD COLUMN variables TEXT NOT NULL DEFAULT '{}'`);
  }
  if (!hasColumn(database, "schedules", "error")) {
    database.exec(`ALTER TABLE schedules ADD COLUMN error TEXT`);
  }
  if (!hasColumn(database, "executions", "artifacts")) {
    database.exec(`ALTER TABLE executions ADD COLUMN artifacts TEXT`);
  }
  // REQ-FLOW-040: nested execution records (parentExecutionId / parentNodeId / depth).
  if (!hasColumn(database, "executions", "parentExecutionId")) {
    database.exec(`ALTER TABLE executions ADD COLUMN parentExecutionId TEXT`);
  }
  if (!hasColumn(database, "executions", "parentNodeId")) {
    database.exec(`ALTER TABLE executions ADD COLUMN parentNodeId TEXT`);
  }
  if (!hasColumn(database, "executions", "depth")) {
    database.exec(`ALTER TABLE executions ADD COLUMN depth INTEGER NOT NULL DEFAULT 0`);
  }
  database.exec(`CREATE INDEX IF NOT EXISTS idx_executions_parentExecutionId ON executions(parentExecutionId)`);
  // REQ-SKILL-017 / ADR-011: the skill install-state tables are gone. Skill
  // library truth now lives on disk (skill repo path scans); drop the legacy
  // tables from any pre-existing database.
  database.exec(`
    DROP TABLE IF EXISTS project_skills;
    DROP TABLE IF EXISTS skills;
    DROP TABLE IF EXISTS skill_repos;
  `);
  // REQ-WORKSPACE-011: projects declare agent types (JSON array of registry keys).
  if (!hasColumn(database, "projects", "agentTypes")) {
    database.exec(`ALTER TABLE projects ADD COLUMN agentTypes TEXT NOT NULL DEFAULT '[]'`);
  }
  // REQ-FLOW-028: execution_nodes 表（旧库补建，与 initSchema 同 DDL，幂等）。
  database.exec(EXECUTION_NODES_DDL);
  // REQ-CHANNEL-004/002: channel bindings and inbound message deduplication.
  database.exec(`
    CREATE TABLE IF NOT EXISTS channel_bindings (
      id TEXT PRIMARY KEY,
      channelType TEXT NOT NULL UNIQUE,
      flowId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_bindings_channelType ON channel_bindings(channelType);
    CREATE TABLE IF NOT EXISTS channel_messages (
      messageId TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_messages_createdAt ON channel_messages(createdAt DESC);
  `);
  // REQ-AGENT-016: confirmation pending queue (legacy DBs get the table on migration).
  database.exec(CONFIRMATIONS_DDL);
  // REQ-AGENT-027 (ADR-016 空间=会话): title 附加列（首条用户消息截断 40 字）。
  // 旧库 ALTER TABLE 补列；既有行（含 feishu:*）title = NULL 无损兼容
  // （REQ-AGENT-027 标准 6：迁移后旧行 title NULL）。
  if (!hasColumn(database, "agent_sessions", "title")) {
    database.exec(`ALTER TABLE agent_sessions ADD COLUMN title TEXT`);
  }
  // REQ-AGENT-029（signoff 裁决 10 候选 A）：agent_space_meta 侧表（旧库补建，
  // 与 initSchema 同 DDL，CREATE IF NOT EXISTS 幂等）。
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_space_meta (
      spaceKey TEXT PRIMARY KEY,
      displayName TEXT
    );
  `);
}
