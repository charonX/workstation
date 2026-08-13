// src/services/extensionService.js
// REQ-AGENT-079/080/081：插件（extension）三来源安装 / 清单读取 / 项目级启用停用。
//
// 真相 = <agentDir>/settings.json（全局插件清单），经 pi `SettingsManager` 公开 setter 读写：
//   - 本地路径来源：只登记 resolved 绝对路径（不拷贝、不调 packageManager）；
//   - npm/git 来源：经 `DefaultPackageManager.installAndPersist`（可注入 stub 隔离网络），
//     成功后再登记进全局 `extensions` 清单（官方失败不写 settings → 不留半成品）。
// 项目启用：写 <projectDir>/.pi/settings.json 的 `extensions` 数组，启用写 `+<resolved-source>`
// （先剔除同目标旧行，幂等）；停用剔除该行（不写 `-`，回到全局继承态）。——签核 D1/D2。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SettingsManager, DefaultPackageManager } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// 来源解析与校验（PRD §7）
// ---------------------------------------------------------------------------

// 合法 npm 包名：可选 @scope/ 前缀 + 小写字母/数字/hyphen/dot/underscore/tilde。
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
// 可选版本后缀：非空白、非 @ 的字符串（semver 或 range，如 1.4.0 / ^1.0.0）。
const VERSION_RE = /^[^\s@]+$/;
const GIT_SCHEME_RE = /^(https?|ssh|git):\/\//i;
const LOCAL_FILE_RE = /\.(ts|js|mjs|cjs)$/i;

/** 解析 `npm:<spec>` 的包名/版本。非法返回 null。 */
function parseNpmSpec(spec) {
  let namePart = spec;
  let version;
  if (spec.startsWith("@")) {
    const slashIdx = spec.indexOf("/");
    if (slashIdx === -1) return null;
    const atIdx = spec.indexOf("@", slashIdx);
    if (atIdx !== -1) {
      namePart = spec.slice(0, atIdx);
      version = spec.slice(atIdx + 1);
    } else {
      namePart = spec;
    }
  } else {
    const atIdx = spec.indexOf("@");
    if (atIdx !== -1) {
      namePart = spec.slice(0, atIdx);
      version = spec.slice(atIdx + 1);
    } else {
      namePart = spec;
    }
  }
  if (!NPM_NAME_RE.test(namePart)) return null;
  if (version !== undefined && !VERSION_RE.test(version)) return null;
  return { name: namePart, version };
}

/** `git:` 前缀 shorthand（git:github.com:user/repo 等）。 */
function isGitShorthand(source) {
  return source.startsWith("git:");
}

/** https/ssh/git 协议 URL。 */
function isGitUrl(source) {
  return GIT_SCHEME_RE.test(source);
}

/** 形如 URL（含 `://`）但非支持协议 → 视为格式非法（如 `ht tp://???`）。 */
function looksLikeUrl(source) {
  return source.includes("://");
}

/** 从 git 来源切出尾部 `@ref`。ref 可含 `/`，故取「最后一个 @ 且位于路径之后」。 */
function splitGitRef(source) {
  const slashIdx = source.lastIndexOf("/");
  const atIdx = source.lastIndexOf("@");
  if (atIdx !== -1 && atIdx > slashIdx) {
    return { url: source.slice(0, atIdx), ref: source.slice(atIdx + 1) };
  }
  return { url: source };
}

function gitDisplayName(url) {
  let u = String(url).replace(/^git:/, "");
  u = u.replace(/^(https?|ssh|git):\/\//i, "");
  u = u.replace(/^.*@/, ""); // scp-like user@host → host
  u = u.replace(/\.git$/i, "");
  const parts = u.split(/[/:]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : u;
}

function localName(resolved, isDir) {
  if (isDir) return path.basename(resolved);
  return path.basename(resolved, path.extname(resolved));
}

/**
 * 解析并校验来源 → { kind, source, resolved, name, version }。
 * 非法 → 抛错（消息含 `格式不正确`/`invalid source`，测试锚点），不落盘。
 */
function parseSource(source) {
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error(`Invalid source: 来源格式不正确（${String(source)}）`);
  }
  const trimmed = source.trim();

  if (trimmed.startsWith("npm:")) {
    const parsed = parseNpmSpec(trimmed.slice(4).trim());
    if (!parsed) {
      throw new Error(`Invalid source: npm 包名格式不正确（${source}）`);
    }
    return { kind: "npm", source: trimmed, resolved: trimmed, name: parsed.name, version: parsed.version };
  }

  if (isGitShorthand(trimmed) || isGitUrl(trimmed)) {
    const { url, ref } = splitGitRef(trimmed);
    if (!url || /\s/.test(url) || !(isGitShorthand(url) || isGitUrl(url))) {
      throw new Error(`Invalid source: git 地址格式不正确（${source}）`);
    }
    return {
      kind: "git",
      source: trimmed,
      resolved: trimmed,
      url,
      ref,
      name: gitDisplayName(url),
      version: ref,
    };
  }

  // 形如 URL（含 ://）但非支持协议 → 格式非法。
  if (looksLikeUrl(trimmed)) {
    throw new Error(`Invalid source: 来源格式不正确（${source}）`);
  }

  // 本地路径：必须存在且为目录或 .ts/.js 文件。
  const resolved = path.resolve(trimmed);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`Invalid source: 路径不存在（${resolved}）`);
  }
  if (stat.isDirectory()) {
    return { kind: "local", source: resolved, resolved, name: localName(resolved, true), version: undefined };
  }
  if (stat.isFile() && LOCAL_FILE_RE.test(resolved)) {
    return { kind: "local", source: resolved, resolved, name: localName(resolved, false), version: undefined };
  }
  throw new Error(`Invalid source: 来源格式不正确（${resolved}）`);
}

/**
 * 官方身份规则（REQ-079 标准 4）：npm 包名 / git URL 去 ref / 本地 resolved 路径。
 * 用于全局去重与「未安装先启用」判定。
 */
function sourceIdentity(source) {
  const s = String(source);
  if (s.startsWith("npm:")) {
    const parsed = parseNpmSpec(s.slice(4).trim());
    return parsed ? `npm:${parsed.name}` : s;
  }
  if (isGitShorthand(s) || isGitUrl(s)) {
    const { url } = splitGitRef(s);
    return `git:${url}`;
  }
  return path.resolve(s);
}

/** 剥离 `+`/`-`/`!` 覆盖前缀（项目 settings 行匹配用）。 */
function stripPattern(entry) {
  if (typeof entry !== "string") return "";
  if (entry.startsWith("+") || entry.startsWith("-") || entry.startsWith("!")) return entry.slice(1);
  return entry;
}

// ---------------------------------------------------------------------------
// 清单行 / 错误态探测（spike ①：轻量 import 探测本地插件顶层 throw）
// ---------------------------------------------------------------------------

function rowFor(parsed) {
  return {
    name: parsed.name,
    source: parsed.source,
    version: parsed.version,
    scope: "global",
    enabled: true,
  };
}

/** 解析本地目录/文件的扩展入口文件。 */
function resolveEntryFile(p) {
  if (!fs.existsSync(p)) return null;
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return null;
  }
  if (stat.isFile()) return p;
  if (stat.isDirectory()) {
    const pkgPath = path.join(p, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (typeof pkg.main === "string" && pkg.main) {
          const mainPath = path.resolve(p, pkg.main);
          if (fs.existsSync(mainPath)) return mainPath;
        }
      } catch {
        // 忽略损坏的 package.json，回落 index.* 探测
      }
    }
    for (const name of ["index.js", "index.mjs", "index.cjs", "index.ts"]) {
      const f = path.join(p, name);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

/** spike ① 实证选型：`await import(entryPath)` 能把 BAD_EXT 顶层 throw 捕为 error 字段，且 GOOD_EXT import 无副作用。 */
async function probeLocalExtension(p) {
  const entry = resolveEntryFile(p);
  if (!entry) return "未找到扩展入口文件";
  try {
    await import(pathToFileURL(entry).href);
    return undefined;
  } catch (err) {
    return err?.message ?? String(err);
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

/**
 * createExtensionService({ agentDir, packageManager? })
 *   - agentDir：全局插件清单目录（<agentDir>/settings.json）。
 *   - packageManager：npm/git 安装注入缝（测试给 stub）；缺省用官方 DefaultPackageManager。
 */
export function createExtensionService({ agentDir, packageManager } = {}) {
  if (!agentDir) throw new Error("createExtensionService: agentDir is required");
  const resolvedAgentDir = path.resolve(agentDir);

  /** 全局 settings 读写：经官方 SettingsManager 公开 setter（复刻 pi config 持久化）。 */
  function createGlobalSettings() {
    return SettingsManager.create(resolvedAgentDir, resolvedAgentDir);
  }

  /** 项目 settings：global 仍在 agentDir，project 在 <projectDir>/.pi/settings.json。 */
  function createProjectSettings(projectDir) {
    return SettingsManager.create(path.resolve(projectDir), resolvedAgentDir);
  }

  function getPackageManager(settings) {
    if (packageManager) return packageManager;
    return new DefaultPackageManager({
      cwd: resolvedAgentDir,
      agentDir: resolvedAgentDir,
      settingsManager: settings,
    });
  }

  async function flushChecked(settings) {
    await settings.flush();
    const errs = settings.drainErrors();
    if (errs.length > 0) throw errs[0].error;
  }

  function readGlobalExtensions(settings) {
    return [...(settings.getGlobalSettings().extensions ?? [])];
  }

  function readGlobalPackages(settings) {
    const pkgs = settings.getGlobalSettings().packages ?? [];
    return pkgs.map((p) => (typeof p === "string" ? p : p?.source)).filter((s) => typeof s === "string" && s.length > 0);
  }

  /** 幂等登记：按官方身份规则去重后写入全局 extensions 数组。 */
  async function registerGlobal(source) {
    const settings = createGlobalSettings();
    const current = readGlobalExtensions(settings);
    const identity = sourceIdentity(source);
    const exists = current.some((s) => sourceIdentity(s) === identity);
    if (!exists) {
      settings.setExtensionPaths([...current, source]);
      await flushChecked(settings);
    }
  }

  async function removeGlobal(source) {
    const settings = createGlobalSettings();
    const identity = sourceIdentity(source);
    const current = readGlobalExtensions(settings).filter((s) => sourceIdentity(s) !== identity);
    settings.setExtensionPaths(current);
    await flushChecked(settings);
  }

  async function add(source) {
    const parsed = parseSource(source);

    if (parsed.kind === "local") {
      // 本地来源不调用 packageManager（只登记，不拷贝）。
      await registerGlobal(parsed.resolved);
      return rowFor(parsed);
    }

    // npm / git：先安装（stub 记录调用；官方失败不写 settings → 不留半成品），成功再登记清单。
    const settings = createGlobalSettings();
    const pm = getPackageManager(settings);
    if (pm && typeof pm.installAndPersist === "function") {
      await pm.installAndPersist(parsed.source);
      // 官方 installAndPersist 经其 settingsManager 写 `packages`（写队列），先落盘再登记 extensions。
      await flushChecked(settings);
    }
    await registerGlobal(parsed.source);
    return rowFor(parsed);
  }

  async function remove(source) {
    const parsed = parseSource(source);
    await removeGlobal(parsed.source);
    return { ...rowFor(parsed), enabled: false };
  }

  /** REQ-080：从全局 settings 读配置插件 → PluginRow[]；本地插件做错误态探测（spike ①）。 */
  async function list() {
    const settings = createGlobalSettings();
    const extensionSources = readGlobalExtensions(settings);
    const packageSources = readGlobalPackages(settings);
    const seen = new Set();
    const rows = [];
    const candidates = [...extensionSources, ...packageSources];
    for (const raw of candidates) {
      if (raw.startsWith("+") || raw.startsWith("-") || raw.startsWith("!")) continue; // 覆盖模式行不是声明
      const identity = sourceIdentity(raw);
      if (seen.has(identity)) continue;
      seen.add(identity);
      let parsed;
      try {
        parsed = parseSource(raw);
      } catch {
        // 配置了但来源已不可用 → 以错误态行呈现，不消失。
        rows.push({
          name: path.basename(String(raw)),
          source: String(raw),
          version: undefined,
          scope: "global",
          enabled: true,
          error: "来源不可用或格式非法",
        });
        continue;
      }
      const row = rowFor(parsed);
      if (parsed.kind === "local") {
        const err = await probeLocalExtension(parsed.source);
        if (err) row.error = err;
      }
      rows.push(row);
    }
    return rows;
  }

  /** REQ-081：项目级启用/停用。启用写 `+<resolved-source>`（幂等先剔后写）；停用剔除行（不写 `-`）。 */
  async function setProjectEnabled(projectDir, source, enabled) {
    const settings = createGlobalSettings();
    const installed = readGlobalExtensions(settings);
    const installedPackages = readGlobalPackages(settings);
    const identity = sourceIdentity(source);
    const globalSource =
      installed.find((s) => sourceIdentity(s) === identity) ||
      installedPackages.find((s) => sourceIdentity(s) === identity);
    if (!globalSource) {
      const err = new Error(`插件未安装，无法启用: ${String(source)}（not installed）`);
      err.code = "E-EXTENSION-NOT-INSTALLED";
      throw err;
    }
    if (!projectDir) throw new Error("setProjectEnabled: projectDir is required");

    const projectSettings = createProjectSettings(projectDir);
    const currentProject = [...(projectSettings.getProjectSettings().extensions ?? [])];
    const stripped = currentProject.filter((s) => sourceIdentity(stripPattern(s)) !== identity);
    const next = enabled ? [...stripped, `+${globalSource}`] : stripped;
    projectSettings.setProjectExtensionPaths(next);
    await flushChecked(projectSettings);

    let name;
    try {
      name = parseSource(globalSource).name;
    } catch {
      name = path.basename(String(globalSource));
    }
    return { name, source: globalSource, enabled: Boolean(enabled), scope: "project" };
  }

  return { add, remove, list, setProjectEnabled };
}
