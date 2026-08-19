// src/http/routes/plugins.js
// REQ-AGENT-090（支撑）：插件 HTTP API——extensionService 之上加 HTTP 面（ADR-001
// CLI/HTTP 共享服务层，CLI 即测试 seam）。
//
//   GET    /api/plugins                  → 插件清单（service list() + HTTP 层合成内置 pi-mcp-adapter 行）
//   GET    /api/plugins?project=<id>     → 项目感知清单（按 <projectDir>/.pi settings `+` 条目计算 enabled/scope）
//   POST   /api/plugins { source }       → extensionService.add
//   DELETE /api/plugins/:source          → extensionService.remove
//   POST   /api/plugins/:name/project-enable { projectId, enabled } → 按 name 查插件 → setProjectEnabled
//
// 内置 pi-mcp-adapter 行（UI/E2E 契约，build-progress 记录）：service list() 空态 = []
//（契约不污染），内置行由 HTTP 层合成（UI 展示面），scope="global"、enabled=true、builtin=true、
// 不可停用。版本从 node_modules/pi-mcp-adapter/package.json 惰性读取（读取失败回落 2.23.0）。
//
// projectDir 解析（关键约定，build-progress 记录）：`--project <id>` 可能指向不存在的项目
//（CLI 测试用 "demo"）→ projectService.getProjectDetail(id) 存在且有 localPath → 用 localPath；
// 否则合成 <configDir>/projects/<id>（mkdir -p，隔离、跨操作一致）。
//
// agentDir 解析：HTTP 层 extensionService 用 <configDir>/agent-home（configDir =
// OPC_WORKSTATION_CONFIG_DIR 或 ~/.opc-workstation）。CLI 测试设 OPC_WORKSTATION_CONFIG_DIR
// 到 temp → 插件落 <temp>/agent-home/settings.json（测试隔离）。

import fs from "node:fs";
import path from "node:path";
import { createExtensionService } from "../../services/extensionService.js";
import * as projectService from "../../services/projectService.js";
import * as settingsService from "../../services/settingsService.js";
import { ok, badRequest, mapError, notFound, decodeParam, normalizeBool } from "../responders.js";

let cachedBuiltinVersion;
function builtinVersion() {
  if (cachedBuiltinVersion !== undefined) return cachedBuiltinVersion;
  let version = "2.23.0";
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, "../../../node_modules/pi-mcp-adapter/package.json"),
        "utf8"
      )
    );
    if (typeof pkg.version === "string" && pkg.version) version = pkg.version;
  } catch {
    // 包未就位（受限环境）→ 回落固定版本，不影响内置行合成。
  }
  cachedBuiltinVersion = version;
  return version;
}

const BUILTIN_ROW = () => ({
  name: "pi-mcp-adapter",
  source: "npm:pi-mcp-adapter",
  version: builtinVersion(),
  scope: "global",
  enabled: true,
  builtin: true,
});

// agentDir 真源 = <cwd>/.agent-home（与 worker 装配 OPC_AGENT_HOME 同源，2026-08-14
// 人裁决 A：生产一致，避免「插件页装了但会话读不到」）。优先级：
//   OPC_AGENT_HOME 显式注入 > OPC_WORKSTATION_CONFIG_DIR（测试隔离 → <configDir>/agent-home）
//   > path.join(process.cwd(), ".agent-home")（生产，匹配 agentService spawn 的 OPC_AGENT_HOME）。
function configDir() {
  return settingsService.configDir();
}

function agentDir() {
  if (process.env.OPC_AGENT_HOME) return process.env.OPC_AGENT_HOME;
  if (process.env.OPC_WORKSTATION_CONFIG_DIR) return path.join(configDir(), "agent-home");
  return path.join(process.cwd(), ".agent-home");
}

function getService() {
  return createExtensionService({ agentDir: agentDir() });
}

// 解析项目目录：真实项目 localPath 优先；否则合成 <configDir>/projects/<id>（mkdir -p）。
function resolveProjectDir(projectId) {
  if (typeof projectId !== "string" || projectId.trim() === "") {
    const err = new Error("projectId is required");
    err.status = 400;
    err.code = "E-PROJECT-ID-REQUIRED";
    throw err;
  }
  const project = projectService.getProjectDetail(projectId);
  if (project && typeof project.localPath === "string" && project.localPath) {
    return project.localPath;
  }
  const dir = path.join(configDir(), "projects", projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 读取项目 .pi/settings.json 中启用（`+` 前缀）的来源串集合（extensionService
// setProjectEnabled 写入 `+<globalSource>`，globalSource 与 list() 行的 source 同串）。
function readProjectEnabledSources(projectDir) {
  const file = path.join(projectDir, ".pi", "settings.json");
  const enabled = new Set();
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const extensions = Array.isArray(data?.extensions) ? data.extensions : [];
    for (const entry of extensions) {
      const s = String(entry);
      if (s.startsWith("+")) enabled.add(s.slice(1));
    }
  } catch {
    // 无 .pi settings（未启用过）→ 空集合。
  }
  return enabled;
}

async function listRows(projectId) {
  const svc = getService();
  const rows = await svc.list();
  let result = rows;
  if (projectId) {
    // 项目感知：`+` 命中 → enabled=true scope="project"；否则 enabled=false scope="project"。
    const enabledSources = readProjectEnabledSources(resolveProjectDir(projectId));
    result = rows.map((row) => ({ ...row, enabled: enabledSources.has(row.source), scope: "project" }));
  }
  // 内置行恒在（全局/项目感知均不可停用）。
  result.push(BUILTIN_ROW());
  return result;
}

export async function handlePlugins(req, res, body, pathParts) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const projectId = url.searchParams.get("project") || undefined;

  if (pathParts.length === 0) {
    if (req.method === "GET") {
      try {
        return ok(res, await listRows(projectId));
      } catch (err) {
        return mapError(res, err);
      }
    }
    if (req.method === "POST") {
      const source = body?.source;
      if (typeof source !== "string" || source.trim() === "") {
        return badRequest(res, "source is required");
      }
      try {
        return ok(res, await getService().add(source));
      } catch (err) {
        return mapError(res, err);
      }
    }
    return notFound(res);
  }

  if (pathParts.length === 1 && req.method === "DELETE") {
    const source = decodeParam(pathParts[0]);
    try {
      return ok(res, await getService().remove(source));
    } catch (err) {
      return mapError(res, err);
    }
  }

  if (pathParts.length === 2 && pathParts[1] === "project-enable" && req.method === "POST") {
    const name = decodeParam(pathParts[0]);
    const { projectId: pid, enabled } = body || {};
    if (!pid) return badRequest(res, "projectId is required");
    try {
      const svc = getService();
      const rows = await svc.list();
      const row = rows.find((r) => r.name === name);
      if (!row) return notFound(res, `Plugin not found: ${name}`);
      const projectDir = resolveProjectDir(pid);
      return ok(res, await svc.setProjectEnabled(projectDir, row.source, normalizeBool(enabled)));
    } catch (err) {
      return mapError(res, err);
    }
  }

  return notFound(res);
}
