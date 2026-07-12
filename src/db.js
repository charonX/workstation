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
      dependencies TEXT,
      category TEXT,
      installSource TEXT,
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
  `);
}
