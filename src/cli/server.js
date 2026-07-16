import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer as startInProcessServer } from "../http/server.js";
import {
  readServerInfoRaw,
  pruneDeadServerRecords,
  registerServerRecord,
  unregisterServerRecord
} from "../serverRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let managedServer = null;

export { readServerInfo } from "../serverRegistry.js";

function getOwner() {
  return String(process.ppid || process.pid);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function discoverServer() {
  const owner = getOwner();
  const records = readServerInfoRaw();
  const deadPids = [];
  let match = null;
  for (const info of records) {
    if (!info.port || !info.pid || !isProcessAlive(info.pid)) {
      if (info.pid) deadPids.push(info.pid);
      continue;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${info.port}/api/settings`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) {
        deadPids.push(info.pid);
        continue;
      }
      if (!match && info.owner === owner) {
        match = { port: info.port, baseUrl: `http://127.0.0.1:${info.port}`, managed: false };
      }
    } catch {
      // Server not reachable.
      if (info.pid) deadPids.push(info.pid);
    }
  }
  pruneDeadServerRecords(deadPids);
  return match;
}

export async function startHeadlessServer() {
  const owner = getOwner();
  let existing = await discoverServer();
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const serverScript = path.resolve(__dirname, "headless-server.js");
    const child = spawn(process.execPath, [serverScript], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OPC_SERVER_OWNER: String(owner) }
    });

    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });

    child.unref();

    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for headless server to start. stderr: ${stderr}`));
    }, 8000);

    const check = async () => {
      existing = await discoverServer();
      if (existing) {
        clearTimeout(timeout);
        resolve(existing);
        return;
      }
      setTimeout(check, 150);
    };

    setTimeout(check, 200);
  });
}

export async function ensureServer() {
  const existing = await discoverServer();
  if (existing) return existing;

  try {
    return await startHeadlessServer();
  } catch (err) {
    // Fall back to an in-process server for this CLI invocation if spawning is restricted.
    const ctx = await startInProcessServer({ reset: false });
    managedServer = ctx.server;
    return { baseUrl: ctx.baseUrl, managed: true };
  }
}

export async function stopManagedServer() {
  if (managedServer) {
    await new Promise((resolve) => managedServer.close(resolve));
    managedServer = null;
  }
}

