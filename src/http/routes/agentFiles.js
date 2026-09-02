// src/http/routes/agentFiles.js
// 图片文件端点（REQ-AGENT-051 / tech-design 数据流 6 访问机制 I-3）+
// 文件预览服务端点（story 2026-08-31-file-preview / REQ-PREVIEW-010/008/004，
// ADR-042 决策 1：HTTP API 通道，prd.md §10.4 接口 1/2/3）：
//
//   GET    /api/agent/files/image?projectId=<pid>&path=<rel-or-abs> → 图片二进制（既有）
//   GET    /api/agent/files/read?projectId&path   → {kind, content?, language?, size, mtimeMs}
//   GET    /api/agent/files/list?projectId&dir    → {entries:[{name,type,size?}]}
//   POST   /api/agent/files/watch  {projectId, path} → {watchId}（同键幂等）
//   DELETE /api/agent/files/watch/:watchId → 204（幂等吞掉）
//
// 图片端点白名单判定全部在主进程（I-3 裁决：renderer 侧判定为弱防线，主进程按项目目录边界
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
// 预览 read/list/watch 端点（E-PREVIEW-* 错误码，prd.md §8 错误表；封套沿袭
// agentSessions.js sendError 同型 {error, message}）：
//   - 根约束：projectId → resolveProjectRoot（无根 → E-PREVIEW-NO-ROOT）；路径
//     normalize + realpath 双检（resolveInsideRootInsecure → 越界/symlink 逃逸 →
//     E-PREVIEW-OUTSIDE-ROOT，不触达内容读取）；
//   - read：不存在/非文件 → E-PREVIEW-NOT-FOUND；size > 1,048,576 B（含本数边界，
//     §6.3 块 5）→ E-PREVIEW-TOO-LARGE 不读内容；类型判定：.md/.markdown →
//     markdown；代码扩展名集（hljs 语言键对齐 MarkdownRenderer HIGHLIGHT_LANGUAGES
//     注册集）→ code+language；图片白名单（jpeg/png/gif/webp/bmp/heic/heif，ADR-042
//     决策 3 对齐附件清单）→ image（不带 content，面板走既有 image 端点取 blob，
//     不受 1MB 文本上限约束）；SVG → E-PREVIEW-UNSUPPORTED（注意既有 image 端点
//     白名单含 svg——read 端点必须拒）；已知二进制扩展名 → E-PREVIEW-UNSUPPORTED；
//     其余/无扩展名 → UTF-8 嗅探（fatal 解码）：可解码 → code（language=plaintext
//     兜底，§10.5 决策 6），不可解码 → E-PREVIEW-UNSUPPORTED；
//   - list：目录在前、同类按 name localeCompare；噪音目录硬编码清单
//     （.git/node_modules/dist，prd.md §6.3 块 3）不出现；dir="" = 根；dir 越界 →
//     400 E-PREVIEW-OUTSIDE-ROOT（§10.4 接口 1 锚定状态码）；dir 不存在或非目录 →
//     E-PREVIEW-NOT-FOUND；空目录 → {entries:[]}；
//   - watch：边界校验同 read（E2 不存在不注册）；注册/防抖/SSE 推送语义见
//     services/filePreviewWatchService.js；
//   - I/O 失败 → E-PREVIEW-READ-FAILED。
// 日志（§10.7）：E-PREVIEW-* 错误打主进程日志，含 projectId+path，不含文件内容。
//
// 路径解析纯函数（导出供 harness 自验）：resolveProjectRoot / resolveAllowedImagePath /
// resolveInsideRoot。

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

// —— 文件预览端点共享常量与助手（REQ-PREVIEW-010/008）——

// 1MB 文本读取上限（含本数，prd.md §6.3 块 5：1,048,576 B 正常 / +1 B 拒读）。
const MAX_PREVIEW_BYTES = 1024 * 1024;

// 图片白名单（ADR-042 决策 3：对齐附件清单 IMAGE_MIME_TYPES，SVG 拒收——read 端点
// 显式拒 svg，不继承上方 image 端点白名单）。
const PREVIEW_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif"]);

// Markdown 扩展名（prd.md §10.3 流 A 步骤 3）。
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

// 代码扩展名 → hljs 语言键（对齐 MarkdownRenderer HIGHLIGHT_LANGUAGES 注册集与别名，
// §10.5 决策 6「观感与聊天围栏块一致」）。
const CODE_LANGUAGE_BY_EXTENSION = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  py: "python",
  sh: "bash", bash: "bash", zsh: "bash",
  json: "json",
  yml: "yaml", yaml: "yaml",
  html: "xml", htm: "xml", xml: "xml",
  css: "css", scss: "scss",
  sql: "sql",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  diff: "diff", patch: "diff",
  ini: "ini", cfg: "ini", conf: "ini",
};

// 已知二进制扩展名 → 直接 E-PREVIEW-UNSUPPORTED，不进 UTF-8 嗅探（ASCII 头部的
// 二进制格式如 PDF 嗅探会误判为文本——§10.4 接口 2「异常类型」锚点 spec.pdf）。
const BINARY_EXTENSIONS = new Set([
  "pdf", "zip", "gz", "bz2", "xz", "7z", "rar", "tar",
  "exe", "dll", "so", "dylib", "class", "jar", "wasm",
  "db", "sqlite", "sqlite3", "ico", "icns",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "avi", "mkv", "wav", "flac", "ogg", "webm",
]);

// 噪音目录硬编码清单（prd.md §6.3 块 3 / §10.4 接口 1：list 不出现）。
const NOISE_DIRS = new Set([".git", "node_modules", "dist"]);

// 预览路径解析（normalize + realpath 双检，复用 isArtifactPathAllowed 语义）：
// 相对路径 → resolve(root, p)；根内绝对路径允许（§10.4 接口 2 输入行）；解析后
// realpath 必须落在 root 内（`..` 穿越与 symlink 逃逸均拒）→ 越界返回 null。
export function resolveInsideRoot(root, p) {
  if (!root || typeof p !== "string") return null;
  const resolved = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
  const real = realpathBestEffort(resolved);
  if (!isInsideOrEqual(real, root)) return null;
  return real;
}

// 错误封套（沿袭 agentSessions.js sendError 同型 {error, message}）+ §10.7 日志
// （含 projectId+path，不含内容）。
function sendPreviewError(res, status, code, message, logContext) {
  console.log(JSON.stringify({ event: "file-preview-error", error: code, ...logContext }));
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: code, message }));
}

function sendPreviewJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// 解析根公共前置：无根 → E-PREVIEW-NO-ROOT（E5）；返回 root 或 null（已响应）。
function requireProjectRoot(res, projectId, logContext) {
  const root = resolveProjectRoot(projectId);
  if (!root) {
    sendPreviewError(res, 404, "E-PREVIEW-NO-ROOT", "当前会话无项目空间", logContext);
    return null;
  }
  return root;
}

function isNotFoundError(err) {
  return err?.code === "ENOENT" || err?.code === "ENOTDIR";
}

// 边界解析公共前置（read/list/watch 共用）：越界/symlink 逃逸 → 400
// E-PREVIEW-OUTSIDE-ROOT（不触达内容读取）；返回 abs 或 null（已响应）。
function resolveInsideRootOrReject(res, root, relPath, logContext) {
  const abs = resolveInsideRoot(root, relPath);
  if (!abs) {
    sendPreviewError(res, 400, "E-PREVIEW-OUTSIDE-ROOT", "仅支持预览项目内文件", logContext);
  }
  return abs;
}

// fs I/O 错误统一映射：ENOENT/ENOTDIR → 404 E-PREVIEW-NOT-FOUND（notFoundMessage
// 按资源形态区分文件/目录）；其余 → 500 E-PREVIEW-READ-FAILED。
function sendFsError(res, err, logContext, notFoundMessage) {
  if (isNotFoundError(err)) {
    return sendPreviewError(res, 404, "E-PREVIEW-NOT-FOUND", notFoundMessage, logContext);
  }
  return sendPreviewError(res, 500, "E-PREVIEW-READ-FAILED", "读取失败", logContext);
}

// stat 既有文件公共前置（read/watch 共用）：不存在/非文件 → E-PREVIEW-NOT-FOUND；
// 返回 stat 或 null（已响应）。
async function statExistingFile(res, abs, logContext) {
  let stat;
  try {
    stat = await fs.promises.stat(abs);
  } catch (err) {
    sendFsError(res, err, logContext, "文件不存在");
    return null;
  }
  if (!stat.isFile()) {
    sendPreviewError(res, 404, "E-PREVIEW-NOT-FOUND", "文件不存在", logContext);
    return null;
  }
  return stat;
}

// GET read（§10.4 接口 2）。
async function handleFileRead(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const projectId = url.searchParams.get("projectId") ?? "";
  const previewPath = url.searchParams.get("path") ?? "";
  const logContext = { projectId, path: previewPath };

  const root = requireProjectRoot(res, projectId, logContext);
  if (!root) return;
  const abs = resolveInsideRootOrReject(res, root, previewPath, logContext);
  if (!abs) return;

  const stat = await statExistingFile(res, abs, logContext);
  if (!stat) return;

  const ext = path.extname(previewPath).slice(1).toLowerCase();

  // 图片：不带 content（面板走既有 image 端点取 blob），不受 1MB 文本上限约束
  // （REQ-PREVIEW-004 AC1）。
  if (PREVIEW_IMAGE_EXTENSIONS.has(ext)) {
    return sendPreviewJson(res, 200, { kind: "image", size: stat.size, mtimeMs: stat.mtimeMs });
  }
  // 管线顺序对齐 §10.3 流 A 步骤 3：stat → E2 → E3 → 类型判定（图片分支前置豁免除外，
  // image 不受 1MB 约束）。超上限的 SVG/已知二进制按 E3 拒读，不进类型判定。
  // 1MB 上限（含本数）：超上限不读内容（§8 E3）。
  if (stat.size > MAX_PREVIEW_BYTES) {
    return sendPreviewError(res, 413, "E-PREVIEW-TOO-LARGE", "文件过大", logContext);
  }
  // SVG 显式拒收（ADR-042 决策 3）；已知二进制扩展名不进嗅探。
  if (ext === "svg" || BINARY_EXTENSIONS.has(ext)) {
    return sendPreviewError(res, 415, "E-PREVIEW-UNSUPPORTED", "不支持预览该类型", logContext);
  }

  let buffer;
  try {
    buffer = await fs.promises.readFile(abs);
  } catch (err) {
    return sendFsError(res, err, logContext, "文件不存在");
  }

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return sendPreviewJson(res, 200, { kind: "markdown", content: buffer.toString("utf8"), size: stat.size, mtimeMs: stat.mtimeMs });
  }
  const language = CODE_LANGUAGE_BY_EXTENSION[ext];
  if (language) {
    return sendPreviewJson(res, 200, { kind: "code", language, content: buffer.toString("utf8"), size: stat.size, mtimeMs: stat.mtimeMs });
  }
  // 其余/无扩展名 → UTF-8 嗅探：可解码 → code（plaintext 兜底）；不可解码 → E4。
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return sendPreviewJson(res, 200, { kind: "code", language: "plaintext", content, size: stat.size, mtimeMs: stat.mtimeMs });
  } catch {
    return sendPreviewError(res, 415, "E-PREVIEW-UNSUPPORTED", "不支持预览该类型", logContext);
  }
}

// GET list（§10.4 接口 1）。
async function handleFileList(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const projectId = url.searchParams.get("projectId") ?? "";
  const dir = url.searchParams.get("dir") ?? "";
  const logContext = { projectId, path: dir };

  const root = requireProjectRoot(res, projectId, logContext);
  if (!root) return;
  // dir="" = 根；否则 normalize + realpath 双检（dir="../" → 400 锚定状态码）。
  const abs = dir === "" ? root : resolveInsideRootOrReject(res, root, dir, logContext);
  if (!abs) return;

  let dirents;
  try {
    dirents = await fs.promises.readdir(abs, { withFileTypes: true });
  } catch (err) {
    // dir 不存在或指向文件（ENOTDIR）→ E-PREVIEW-NOT-FOUND（接口 1 业务错误行）。
    return sendFsError(res, err, logContext, "目录不存在");
  }

  const dirs = [];
  const files = [];
  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      if (NOISE_DIRS.has(dirent.name)) continue; // 噪音目录隐藏
      dirs.push({ name: dirent.name, type: "dir" });
    } else if (dirent.isFile()) {
      const entry = { name: dirent.name, type: "file" };
      try {
        entry.size = (await fs.promises.stat(path.join(abs, dirent.name))).size;
      } catch {
        // 竞态删除/不可读：size 字段契约可选（size?: number），省略不拒整表。
      }
      files.push(entry);
    }
    // symlink/其他类型：略过（不跟随，规避逃逸面）。
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  dirs.sort(byName);
  files.sort(byName);
  return sendPreviewJson(res, 200, { entries: [...dirs, ...files] });
}

// POST watch（§10.4 接口 3）：边界校验同 read；E2 不存在不注册。
async function handleWatchRegister(req, res, body, context) {
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const watchPath = typeof body?.path === "string" ? body.path : "";
  const logContext = { projectId, path: watchPath };

  const root = requireProjectRoot(res, projectId, logContext);
  if (!root) return;
  const abs = resolveInsideRootOrReject(res, root, watchPath, logContext);
  if (!abs) return;
  // 文件不存在 → 不注册（注册后落盘不得产生事件，§10.4 接口 3「边界」行）。
  const stat = await statExistingFile(res, abs, logContext);
  if (!stat) return;

  const svc = context?.getFilePreviewWatchService?.();
  if (!svc) {
    return sendPreviewError(res, 500, "E-PREVIEW-READ-FAILED", "watch 服务未接线", logContext);
  }
  try {
    const { watchId } = svc.register(projectId, watchPath, abs);
    return sendPreviewJson(res, 200, { watchId });
  } catch {
    return sendPreviewError(res, 500, "E-PREVIEW-READ-FAILED", "监听注册失败", logContext);
  }
}

// DELETE watch/:watchId（§10.4 接口 3）：恒 204（幂等吞掉重复/不存在）。
function handleWatchUnregister(res, context, watchId) {
  const svc = context?.getFilePreviewWatchService?.();
  svc?.unregister(watchId);
  res.writeHead(204);
  res.end();
}

export async function handleAgentFiles(req, res, subPath, body, context) {
  const head = subPath[0];
  if (head === "read" && req.method === "GET") return handleFileRead(req, res);
  if (head === "list" && req.method === "GET") return handleFileList(req, res);
  if (head === "watch" && subPath.length === 1 && req.method === "POST") {
    return handleWatchRegister(req, res, body, context);
  }
  if (head === "watch" && subPath.length === 2 && req.method === "DELETE") {
    return handleWatchUnregister(res, context, decodeURIComponent(subPath[1]));
  }
  if (head !== "image" || req.method !== "GET") {
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
