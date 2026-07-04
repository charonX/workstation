import Database from "better-sqlite3";

let db = null;

export function getDb(path = ":memory:") {
  if (!db) {
    db = new Database(path);
    initSchema(db);
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDb() {
  const database = getDb();
  database.exec(`
    DROP TABLE IF EXISTS logs;
    DROP TABLE IF EXISTS executions;
    DROP TABLE IF EXISTS schedules;
    DROP TABLE IF EXISTS flows;
    DROP TABLE IF EXISTS project_skills;
    DROP TABLE IF EXISTS skills;
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

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      repoPath TEXT NOT NULL,
      version TEXT,
      dependencies TEXT
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
      updatedAt TEXT NOT NULL
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
  `);
}

// Initialize the default in-memory database on first import.
getDb();
