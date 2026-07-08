import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer as startInProcessServer } from "../http/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let managedServer = null;

export function getConfigDir() {
  return path.join(os.homedir(), ".opc-workstation");
}

export function getServerInfoFile() {
  return path.join(getConfigDir(), "server.json");
}

function readServerInfoRaw() {
  try {
    const data = fs.readFileSync(getServerInfoFile(), "utf8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

export function readServerInfo() {
  return readServerInfoRaw();
}

function writeServerInfo(records) {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(getServerInfoFile(), JSON.stringify(records, null, 2));
  } catch {
    // Ignore write failures in restricted environments.
  }
}

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
  for (const info of records) {
    if (info.owner !== owner) continue;
    if (!info.port || !info.pid) continue;
    if (!isProcessAlive(info.pid)) continue;
    try {
      const res = await fetch(`http://127.0.0.1:${info.port}/api/settings`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        return { port: info.port, baseUrl: `http://127.0.0.1:${info.port}`, managed: false };
      }
    } catch {
      // Server not reachable.
    }
  }
  return null;
}

export async function startHeadlessServer() {
  const owner = getOwner();
  let existing = await discoverServer();
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const serverScript = path.resolve(__dirname, "headless-server.js");
    const child = spawn(process.execPath, [serverScript], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, OPC_SERVER_OWNER: String(owner) }
    });

    child.unref();

    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for headless server to start"));
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

export function registerServerRecord(port, pid, owner = getOwner()) {
  owner = String(owner);
  const records = readServerInfoRaw().filter(r => r.owner !== owner);
  records.push({ port, pid, owner, startedAt: new Date().toISOString() });
  writeServerInfo(records);
}

export function unregisterServerRecord(owner = getOwner()) {
  owner = String(owner);
  const records = readServerInfoRaw().filter(r => r.owner !== owner);
  if (records.length === 0) {
    try {
      fs.unlinkSync(getServerInfoFile());
    } catch {
      // Ignore.
    }
  } else {
    writeServerInfo(records);
  }
}
