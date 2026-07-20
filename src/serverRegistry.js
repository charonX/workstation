import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function getConfigDir() {
  return path.join(os.homedir(), ".opc-workstation");
}

export function getServerInfoFile() {
  return path.join(getConfigDir(), "server.json");
}

function getRegistryLockFile() {
  return path.join(getConfigDir(), "server.json.lock");
}

function sleepMs(ms) {
  const buffer = new SharedArrayBuffer(4);
  const array = new Int32Array(buffer);
  Atomics.wait(array, 0, 0, ms);
}

export function acquireRegistryLock(timeoutMs = 2000) {
  fs.mkdirSync(getConfigDir(), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return fs.openSync(getRegistryLockFile(), "wx");
    } catch {
      sleepMs(10);
    }
  }
  throw new Error("Timed out acquiring server registry lock");
}

export function releaseRegistryLock(fd) {
  try {
    fs.closeSync(fd);
  } catch {
    // Ignore.
  }
  try {
    fs.unlinkSync(getRegistryLockFile());
  } catch {
    // Ignore.
  }
}

export function readServerInfoRaw() {
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

export function writeServerInfo(records) {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    const tempFile = `${getServerInfoFile()}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(records, null, 2));
    fs.renameSync(tempFile, getServerInfoFile());
  } catch {
    // Ignore write failures in restricted environments.
  }
}

export function pruneDeadServerRecords(deadPids) {
  if (!deadPids || deadPids.length === 0) return;
  const deadSet = new Set(deadPids);
  const fd = acquireRegistryLock();
  try {
    const records = readServerInfoRaw();
    const kept = records.filter(r => !deadSet.has(r.pid));
    if (kept.length !== records.length) {
      writeServerInfo(kept);
    }
  } finally {
    releaseRegistryLock(fd);
  }
}

export function registerServerRecord(port, pid, owner) {
  owner = String(owner);
  const fd = acquireRegistryLock();
  try {
    const records = readServerInfoRaw().filter(r => r.owner !== owner);
    records.push({ port, pid: pid ?? process.pid, owner, startedAt: new Date().toISOString() });
    writeServerInfo(records);
  } finally {
    releaseRegistryLock(fd);
  }
}

export function unregisterServerRecord(owner) {
  owner = String(owner);
  const fd = acquireRegistryLock();
  try {
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
  } finally {
    releaseRegistryLock(fd);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isServerReachable(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/settings`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function takeoverExistingServer({ port, pid, timeoutMs = 5000 }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;

  // Ask the existing server to shut down gracefully.
  try {
    await fetch(`${baseUrl}/api/server/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs))
    });
  } catch {
    // Shutdown request may fail if the server is already going away; verify by polling below.
  }

  while (Date.now() < deadline) {
    if (pid && !isProcessAlive(pid)) {
      return;
    }
    if (!(await isServerReachable(port))) {
      return;
    }
    await sleep(150);
  }

  const err = new Error(`E-SERVER-TAKEOVER-TIMEOUT: existing server at ${baseUrl} did not shut down within ${timeoutMs}ms`);
  err.code = "E-SERVER-TAKEOVER-TIMEOUT";
  throw err;
}
