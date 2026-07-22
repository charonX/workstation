// Electron main-process environment bootstrap.
//
// BUG-007 FIX: ESM static imports are hoisted and their top-level code runs
// BEFORE any statements in the importing file. Importing this module FIRST in
// src/main/main.js (before ../db.js, ../cli/server.js, or anything that
// transitively loads settingsService) ensures process.env.OPC_WORKSTATION_CONFIG_DIR
// and DB_PATH point at app.getPath("userData") by the time those modules'
// top-level readSettings() / defaultDbPath() run.
//
// Without this bootstrap, settingsService reads ~/.opc-workstation/settings.json
// on startup but saveChannelCredentials() writes to userData/settings.json
// (because env is set later), so channel credentials silently disappear on restart.

import { app } from "electron";
import path from "node:path";

// app.getPath("userData") is safe to call here: Electron registers path
// providers synchronously during the app module initialization, before the
// ready event fires.
const userData = app.getPath("userData");
process.env.OPC_WORKSTATION_CONFIG_DIR = userData;

// Set DB_PATH BEFORE any import of db.js so defaultDbPath() resolves to
// userData/data.db. migrateLegacyDb is called from main.js after this module
// has run (so the target path is already pinned).
const resolvedDbPath = path.join(userData, "data.db");
if (!process.env.DB_PATH) {
  process.env.DB_PATH = resolvedDbPath;
}
