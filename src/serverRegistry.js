import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function getConfigDir() {
  if (process.env.OPC_WORKSTATION_CONFIG_DIR) {
    return process.env.OPC_WORKSTATION_CONFIG_DIR;
  }
  return path.join(os.homedir(), ".opc-workstation");
}

// ADR-0040（BUG-001）：注册表锚点固定机器级 ~/.opc-workstation/server.json，与
// configDir 解耦——注册表的本职就是跨进程、跨 configDir 的机器级发现（Electron app 把
// OPC_WORKSTATION_CONFIG_DIR 指向 userData，per-configDir 锚点使 app 与外部 CLI 互不可见）。
// OPC_SERVER_REGISTRY_FILE 为覆盖 seam（测试/E2E per-instance 隔离用）。
// 注意：getConfigDir 保留给 configDir 语义的消费方（DB、agent-sessions 等），注册表不再走它。
export function getServerInfoFile() {
  if (process.env.OPC_SERVER_REGISTRY_FILE) {
    return process.env.OPC_SERVER_REGISTRY_FILE;
  }
  return path.join(os.homedir(), ".opc-workstation", "server.json");
}

function getRegistryDir() {
  return path.dirname(getServerInfoFile());
}

function getRegistryLockFile() {
  // 锁文件与注册表同路径（<file>.lock）：覆盖 seam 下锁随注册表走，不留 configDir 残余。
  return `${getServerInfoFile()}.lock`;
}

function sleepMs(ms) {
  const buffer = new SharedArrayBuffer(4);
  const array = new Int32Array(buffer);
  Atomics.wait(array, 0, 0, ms);
}

export function acquireRegistryLock(timeoutMs = 2000) {
  fs.mkdirSync(getRegistryDir(), { recursive: true });
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
    fs.mkdirSync(getRegistryDir(), { recursive: true });
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

// ADR-0040 决策 4：app 重启保端口的选择函数 seam——机器级注册表混有 headless/测试
// 记录，只从 owner="app" 的记录取最近一条端口；无 app 记录回退 0（随机端口）。
export function pickAppPreferredPort(records) {
  if (!Array.isArray(records)) return 0;
  const appRecords = records.filter(r => r && r.owner === "app" && Number.isInteger(r.port) && r.port > 0);
  return appRecords.length > 0 ? appRecords[appRecords.length - 1].port : 0;
}

function sleepAsync(ms) {
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
    await sleepAsync(150);
  }

  const err = new Error(`E-SERVER-TAKEOVER-TIMEOUT: existing server at ${baseUrl} did not shut down within ${timeoutMs}ms`);
  err.code = "E-SERVER-TAKEOVER-TIMEOUT";
  throw err;
}
