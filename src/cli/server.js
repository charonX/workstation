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

// 显式 baseUrl 覆盖（C2 注入 seam）：agent 工具面 / 测试直连指定的 HTTP API
// （REQ-AGENT-012 标准 3「进程内 import 命令模块 → HTTP API」——命令模块内部
// 调 ensureServer，覆盖层使其命中注入的 server）。优先级高于注册表发现；
// null 恢复默认发现（生产 agent 子进程按 ppid 归属经注册表发现主进程 server）。
let baseUrlOverride = null;

export function setServerBaseUrlOverride(baseUrl) {
  baseUrlOverride = baseUrl ? String(baseUrl) : null;
}

export function getServerBaseUrlOverride() {
  return baseUrlOverride;
}

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

export async function discoverServer({ allowAnyOwner = false } = {}) {
  const owner = getOwner();
  const records = readServerInfoRaw();
  const deadPids = [];
  let match = null;
  let fallback = null;
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
      const candidate = { port: info.port, baseUrl: `http://127.0.0.1:${info.port}`, managed: false };
      if (info.owner === owner) {
        match = candidate;
      } else if (allowAnyOwner && !fallback) {
        fallback = candidate;
      }
    } catch {
      // Server not reachable.
      if (info.pid) deadPids.push(info.pid);
    }
  }
  pruneDeadServerRecords(deadPids);
  return match || fallback;
}

export async function startHeadlessServer() {
  const owner = getOwner();
  let existing = await discoverServer();
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const serverScript = path.resolve(__dirname, "headless-server.js");
    // In test mode, don't detach the headless server so it is terminated
    // together with the CLI process and does not leak across test cases.
    const child = spawn(process.execPath, [serverScript], {
      detached: process.env.NODE_ENV !== "test",
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
  // 显式覆盖优先（agent 工具面注入 / 测试 seam）：跳过注册表发现与 headless 兜底。
  if (baseUrlOverride) {
    return { baseUrl: baseUrlOverride, managed: false, owner: "override" };
  }
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

