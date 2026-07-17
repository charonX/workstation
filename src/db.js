import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let db = null;
let currentPath = null;

function defaultDbPath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  return ":memory:";
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
    fs.mkdirSync(targetDir, { recursive: true });
  }
  db = new Database(target);
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

export function resetDb() {
  const database = getDb();
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
  `);
  initSchema(database);
}

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
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repoPath TEXT NOT NULL,
      installSource TEXT NOT NULL,
      originalIdentifier TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      repoId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      repoPath TEXT NOT NULL,
      version TEXT,
      dependencies TEXT,
      category TEXT,
      author TEXT,
      tags TEXT,
      parameters TEXT,
      examples TEXT,
      readme TEXT
    );

    CREATE TABLE IF NOT EXISTS project_skills (
      projectId TEXT NOT NULL,
      skillId TEXT NOT NULL,
      PRIMARY KEY (projectId, skillId)
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
      enabled INTEGER NOT NULL DEFAULT 1
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
      logs TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      executionId TEXT NOT NULL,
      at TEXT NOT NULL,
      node TEXT,
      status TEXT,
      message TEXT
    );

    -- REQ-FLOW-028 / tech-design §5.6：节点级执行记录，经 executionId 关联 executions。
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
  // Skill repo information architecture migration.
  database.exec(`
    CREATE TABLE IF NOT EXISTS skill_repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repoPath TEXT NOT NULL,
      installSource TEXT NOT NULL,
      originalIdentifier TEXT,
      createdAt TEXT NOT NULL
    )
  `);
  if (!hasColumn(database, "skills", "repoId")) {
    database.exec(`ALTER TABLE skills ADD COLUMN repoId TEXT`);
  }
  // REQ-FLOW-028: execution_nodes 表（旧库补建，与 initSchema 同 DDL，幂等）。
  database.exec(`
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
  `);
  // Clean up orphan skills left over from before the skill-repo information architecture.
  // Skills must belong to a valid skill_repo; those without a repoId are no longer reachable.
  database.exec(`
    DELETE FROM project_skills WHERE skillId IN (SELECT id FROM skills WHERE repoId IS NULL);
    DELETE FROM skills WHERE repoId IS NULL;
  `);
}
