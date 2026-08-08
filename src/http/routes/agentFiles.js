// src/http/routes/agentFiles.js
// 图片文件端点（REQ-AGENT-051 / tech-design 数据流 6 访问机制 I-3）。
//
//   GET /api/agent/files/image?projectId=<pid>&path=<rel-or-abs> → 图片二进制
//
// 白名单判定全部在主进程（I-3 裁决：renderer 侧判定为弱防线，主进程按项目目录边界
// + 扩展名白名单校验后放行；I-5 口径：相对路径按 <projectDir>/<path> 解析、项目目录
// 内绝对路径可渲染）：
//   1. 解析根 = projectId → projects 表 localPath（projectService，与
//      agentService.resolveSpaceAssembly 同源——项目已删除/无本地目录 → 无根 → 404）；
//   2. 扩展名白名单：png/jpg/jpeg/gif/webp/svg（大小写不敏感）；
//   3. 解析后 realpath 必须在项目目录内（isInsideOrEqual + realpathBestEffort：
//      `..` 遍历与 symlink 逃逸均被 containment 拒绝）；
//   4. 不存在/读取失败 → 404（不泄露错误细节）。
// 越权/不存在/非白名单 → 404 { error: "NOT_FOUND" }（renderer 侧统一转占位/回退文本）。
//
// 路径解析纯函数（导出供 harness 自验）：resolveProjectRoot / resolveAllowedImagePath。

import fs from "node:fs";
import path from "node:path";
import * as projectService from "../../services/projectService.js";
import { expandTilde, realpathBestEffort, isInsideOrEqual } from "../../services/pathUtils.js";

// 扩展名白名单（I-3/I-4 裁决）+ 对应 Content-Type（读文件 → 二进制回传，renderer 转 blob URL）。
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const IMAGE_CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

// 项目目录解析根（I-5）：projectId → projects 表 localPath → 规范化绝对路径。
// 与 agentService.resolveSpaceAssembly 同源（getProjectDetail + expandTilde +
// path.resolve + realpathBestEffort）；项目缺失/无 localPath → null（无解析根）。
export function resolveProjectRoot(projectId) {
  if (typeof projectId !== "string" || projectId === "") return null;
  const project = projectService.getProjectDetail(projectId);
  if (!project || typeof project.localPath !== "string" || project.localPath === "") {
    return null;
  }
  return realpathBestEffort(path.resolve(expandTilde(project.localPath)));
}

// 白名单判定 + 解析：返回 { resolvedPath, contentType } 或 null（越权/非白名单/无根）。
// - 相对路径 → path.resolve(root, path)；绝对路径 → path.resolve(path)（I-5）；
// - 解析后 realpath 必须在 root 内（防 `..` 遍历 + symlink 逃逸）；扩展名白名单判定。
export function resolveAllowedImagePath(root, imagePath) {
  if (!root || typeof imagePath !== "string" || imagePath === "") return null;
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return null;
  const resolved = path.isAbsolute(imagePath) ? path.resolve(imagePath) : path.resolve(root, imagePath);
  const real = realpathBestEffort(resolved);
  if (!isInsideOrEqual(real, root)) return null;
  return { resolvedPath: real, contentType: IMAGE_CONTENT_TYPES[ext] };
}

export async function handleAgentFiles(req, res, subPath) {
  if (subPath[0] !== "image" || req.method !== "GET") {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const projectId = url.searchParams.get("projectId") ?? "";
  const imagePath = url.searchParams.get("path") ?? "";
  const root = resolveProjectRoot(projectId);
  const allowed = resolveAllowedImagePath(root, imagePath);
  if (!allowed) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "NOT_FOUND", message: "Image not allowed" }));
  }
  let data;
  try {
    data = await fs.promises.readFile(allowed.resolvedPath);
  } catch {
    // 不存在/读取失败：404（不区分错误细节，E3 占位由 renderer 侧呈现）。
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "NOT_FOUND", message: "Image not found" }));
  }
  res.writeHead(200, {
    "Content-Type": allowed.contentType,
    "Content-Length": data.length,
    // 图片经 renderer 转 blob URL 一次消费，不落浏览器 HTTP 缓存。
    "Cache-Control": "no-store",
  });
  return res.end(data);
}
