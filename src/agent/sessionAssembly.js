// src/agent/sessionAssembly.js
// worker 会话装配接入官方发现链路（REQ-AGENT-082/085/089，B1/B2/B8 worker 侧）。
//
// 人裁决 B1（2026-08-13）：装配层每项目启用过滤。官方 `SettingsManager.create` +
// `DefaultPackageManager.resolve()` 无条件把全局 `extensions` 裸路径加载到每个项目；
// 项目 `.pi/settings.json` 写 `+<任意路径>` 对非 `.pi/extensions/` 自动发现目录的
// 插件是 no-op（父代理 spike 实证）。因此本模块的 `resolved` **不是**纯官方 resolve()
// 输出，而是「本项目启用的插件集」：
//
//   assembleSessionExtensions({ cwd, agentDir, mcpSnapshot?, packageManager?,
//     bridgeFactory?, gotgenesFactory? })
//     → { resolved, factories, diagnostics, handle }
//
// - resolved：本项目启用插件条目数组（读 `<cwd>/.pi/settings.json` 的 `extensions`
//   数组，取 `+<source>` 条目，去 `+` 前缀 → resolved 绝对路径）；每项
//   { enabled: true, scope: "project", source, path }。通用空间/无 .pi → resolved 空。
// - factories：内联 extensionFactories，固定序且每项带稳定 name：
//   ["opc-permission-bridge", "gotgenes-permission-system", "pi-mcp-adapter"]。
//   授权桥/桥工厂可由 worker 注入（session 闭包）——bridgeFactory/gotgenesFactory
//   缝；缺省由本模块加载（gotgenes 经 jiti 对齐 worker 先例；桥经 jiti 加载
//   pi-mcp-adapter）。MCP 桥仅在有 mcpSnapshot 时可用；畸形快照 → 桥剔除 + 诊断。
// - diagnostics：诊断记录数组（{ message }）。单插件加载错误（per-extension 隔离——
//   probe/import 探测每个项目启用插件入口，BAD_EXT 顶层 throw → 记诊断而非致命）；
//   桥自身加载失败。
// - 缺包（settings 声明但磁盘缺失，如 `npm:ghost-missing-pkg`）：装配整体抛错，
//   错误消息含包名 + 「插件」（指引到插件页重装）；packageManager 注入缝存在时
//   0 次安装调用（onMissing="error" 语义，不发网络安装）。
//
// worker 实际加载（B1）：装配缝产出「本项目 effective extensions 列表」（resolved），
// worker 用它构造 SettingsManager（inMemory 种子，避免对全局 settings.json 落盘——
// 官方 loader 内部 reload 会 flush writeQueue，setExtensionPaths 会误写全局清单）喂
// DefaultResourceLoader（noExtensions:false 即自动发现开）——保证 worker 只加载本项目
// 启用的插件；官方 loader 仍负责发现/加载/错误隔离。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createJiti } from "jiti";
import { SettingsManager, DefaultPackageManager } from "@earendil-works/pi-coding-agent";

const workerRequire = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// gotgenes 工厂加载（jiti）——对齐 worker 现有 loadGotgenesFactory 先例
// ---------------------------------------------------------------------------

let gotgenesFactoryPromise = null;
export function loadGotgenesFactory() {
  if (!gotgenesFactoryPromise) {
    gotgenesFactoryPromise = (async () => {
      const serviceEntry = workerRequire.resolve("@gotgenes/pi-permission-system");
      const entryDir = path.dirname(serviceEntry);
      const pkgDir = path.basename(entryDir) === "src" ? path.dirname(entryDir) : entryDir;
      const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
      const [factory, serviceModule] = await Promise.all([
        jiti.import(path.join(pkgDir, "src", "index.ts"), { default: true }),
        jiti.import(path.join(pkgDir, "src", "service.ts")),
      ]);
      if (typeof factory !== "function" || typeof serviceModule?.getPermissionsService !== "function") {
        throw new Error("gotgenes 工厂/服务导出异常");
      }
      return { factory, getPermissionsService: serviceModule.getPermissionsService };
    })();
  }
  return gotgenesFactoryPromise;
}

// ---------------------------------------------------------------------------
// pi-mcp-adapter 加载（jiti，可加载 TS 源包）——对齐 worker 加载 gotgenes 先例
// ---------------------------------------------------------------------------

let mcpAdapterModulePromise = null;
function loadMcpAdapterModule() {
  if (!mcpAdapterModulePromise) {
    mcpAdapterModulePromise = (async () => {
      const entry = workerRequire.resolve("pi-mcp-adapter");
      const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
      const mod = await jiti.import(entry);
      if (typeof mod?.createMcpAdapter !== "function") {
        throw new Error("pi-mcp-adapter 导出 createMcpAdapter 异常");
      }
      return mod;
    })();
  }
  return mcpAdapterModulePromise;
}

// ---------------------------------------------------------------------------
// 来源/探测工具
// ---------------------------------------------------------------------------

/** 剥离 `+`/`-`/`!` 覆盖前缀（settings 行匹配用）。 */
function stripPattern(entry) {
  if (typeof entry !== "string") return "";
  if (entry.startsWith("+") || entry.startsWith("-") || entry.startsWith("!")) return entry.slice(1);
  return entry;
}

function isPattern(entry) {
  return typeof entry === "string" && (entry.startsWith("+") || entry.startsWith("-") || entry.startsWith("!"));
}

/** 是否本地路径形态（绝对路径 / 相对路径 / 文件或目录）。npm:/git: 非本地。 */
function isLocalPathLike(source) {
  if (typeof source !== "string" || source === "") return false;
  if (source.startsWith("npm:") || source.startsWith("git:")) return false;
  if (source.startsWith("http://") || source.startsWith("https://")) return false;
  return true;
}

/** 来源身份（去重/剔除用）：本地按 resolved 绝对路径，npm/git 按规格串。 */
function identityOf(source, baseDir) {
  return isLocalPathLike(source) ? path.resolve(baseDir ?? process.cwd(), source) : String(source);
}

/** 解析本地目录/文件的扩展入口文件（对齐 extensionService spike ①）。 */
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

/** 探测本地插件入口：顶层 throw → 返回错误信息（per-extension 隔离）。 */
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

/** 畸形 mcpSnapshot：servers 必须是 map（普通对象），非对象/数组 → 畸形。 */
function isMalformedMcpSnapshot(snapshot) {
  if (snapshot === undefined || snapshot === null) return false;
  const servers = snapshot.servers;
  if (servers === undefined || servers === null) return false;
  return typeof servers !== "object" || Array.isArray(servers);
}

/** 工厂命名包装（不改变原函数引用，只保证 .name 稳定——extensionFactories 顺序契约）。 */
function nameFactory(fn, name) {
  const actual = typeof fn === "function" ? fn : () => {};
  const named = (...args) => actual(...args);
  Object.defineProperty(named, "name", { value: name });
  return named;
}

/** 缺省授权桥工厂（无注入缝时占位；worker 装配时注入真实桥——session 闭包需 IPC）。 */
function defaultBridgeFactory() {
  return () => {};
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

export async function assembleSessionExtensions({
  cwd,
  agentDir,
  mcpSnapshot,
  packageManager,
  bridgeFactory,
  gotgenesFactory,
} = {}) {
  if (!cwd) throw new Error("assembleSessionExtensions: cwd is required");
  if (!agentDir) throw new Error("assembleSessionExtensions: agentDir is required");
  const resolvedCwd = path.resolve(cwd);
  const resolvedAgentDir = path.resolve(agentDir);
  const diagnostics = [];
  const settings = SettingsManager.create(resolvedCwd, resolvedAgentDir);
  // 官方 resolve 语义的 installed 探测（npm/git 按 agentDir 安装路径；本地按 exists）。
  // 注入缝 packageManager 不用于探测（0 次安装调用契约——onMissing="error" 不联网）。
  const pm = new DefaultPackageManager({
    cwd: resolvedCwd,
    agentDir: resolvedAgentDir,
    settingsManager: settings,
  });

  const globalExtensions = [...(settings.getGlobalSettings().extensions ?? [])];
  const projectExtensions = [...(settings.getProjectSettings().extensions ?? [])];
  const globalPackages = [...(settings.getGlobalSettings().packages ?? [])];

  // ---- 缺包检查（settings 声明但磁盘缺失 → 装配整体抛错，E1 变体） ----
  // 覆盖：全局 extensions（裸声明）+ 全局 packages + 项目 `+` 启用来源。
  const declared = [];
  for (const e of globalExtensions) {
    if (isPattern(e)) continue;
    if (typeof e === "string" && e.length > 0) declared.push(e);
  }
  for (const p of globalPackages) {
    const s = typeof p === "string" ? p : p?.source;
    if (typeof s === "string" && s.length > 0) declared.push(s);
  }
  for (const e of projectExtensions) {
    if (typeof e === "string" && e.startsWith("+") && e.length > 1) declared.push(e.slice(1));
  }
  const seenMissing = new Set();
  for (const source of declared) {
    if (seenMissing.has(source)) continue;
    // 本地路径：磁盘不存在即缺；npm/git：安装路径不存在即缺。
    const installed = pm.getInstalledPath(source, "user");
    if (installed === undefined) {
      seenMissing.add(source);
      const err = new Error(
        `插件缺失，无法装配: ${source}（请到 管理区 → 插件 页重新安装）`
      );
      err.code = "E-EXTENSION-MISSING";
      throw err;
    }
  }

  // ---- resolved：本项目启用插件集（B1 per-project 过滤） ----
  // 语义（对齐 workerAssembly.test.js 契约）：
  // - 项目 `+<source>` 条目 → 项目级启用（scope "project"，B1 核心）；
  // - 项目 `-<source>` 条目 → 剔除同源；
  // - 项目存在 `.pi/settings.json`（有项目 settings 的项目空间）→ 继承全局声明
  //   （scope "global"，官方 resolve() 默认语义——项目空间继承全局启用面）；
  //   通用空间/无 .pi → 不继承（resolved 不含任何项目级插件，workerAssembly 标准
  //   1 B 侧、标准 4）。
  // worker 实际加载（B1）只取 scope==="project"（过滤后的项目启用来源），保证
  // worker 只加载本项目启用的插件；scope==="global" 条目仅供清单/测试契约可见。
  const projectSettingsPath = path.join(resolvedCwd, ".pi", "settings.json");
  const hasProjectSettings = fs.existsSync(projectSettingsPath);
  const removedSet = new Set(
    projectExtensions
      .filter((e) => typeof e === "string" && e.startsWith("-"))
      .map((e) => stripPattern(e))
  );
  const candidates = [];
  // 项目 `+` 优先（scope "project"；B1 过滤后的项目启用来源）。
  for (const entry of projectExtensions) {
    if (typeof entry === "string" && entry.startsWith("+") && entry.length > 1) {
      candidates.push({ source: entry.slice(1), scope: "project" });
    }
  }
  // 全局继承（仅项目空间有 .pi；未被项目 `+` 启用且未被 `-` 剔除的全局声明）。
  if (hasProjectSettings) {
    for (const e of globalExtensions) {
      if (typeof e !== "string" || e.length === 0 || isPattern(e)) continue;
      const identity = identityOf(e, resolvedCwd);
      if (removedSet.has(e)) continue;
      if (candidates.some((c) => identityOf(c.source, resolvedCwd) === identity)) continue;
      candidates.push({ source: e, scope: "global" });
    }
  }
  const resolved = [];
  const seen = new Set();
  for (const { source, scope } of candidates) {
    if (source === "") continue;
    const identity = identityOf(source, resolvedCwd);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const isPath = isLocalPathLike(source);
    if (isPath) {
      const abs = path.resolve(resolvedCwd, source);
      const probeErr = await probeLocalExtension(abs);
      if (probeErr) {
        // 单插件加载错误（E3/B8 per-extension 隔离）：记诊断，不进 resolved，
        // 会话与其余插件不受影响。
        diagnostics.push({ message: `${source}: ${probeErr}` });
        continue;
      }
      resolved.push({ enabled: true, scope, source: abs, path: abs });
    } else {
      // npm/git 来源：source 保留规格，path 取安装路径（信息面）。
      const installed = pm.getInstalledPath(source, "user");
      resolved.push({ enabled: true, scope, source, ...(installed ? { path: installed } : {}) });
    }
  }

  // ---- factories：固定序 [授权桥, gotgenes, MCP桥] ----
  const factories = [];
  factories.push(nameFactory(bridgeFactory ?? defaultBridgeFactory(), "opc-permission-bridge"));

  let handle = null;
  try {
    if (gotgenesFactory) {
      handle = { factory: gotgenesFactory };
    } else {
      handle = await loadGotgenesFactory();
    }
  } catch (err) {
    handle = null;
    diagnostics.push({ message: `gotgenes 加载失败: ${err?.message ?? String(err)}` });
  }
  factories.push(nameFactory(handle?.factory ?? (() => {}), "gotgenes-permission-system"));

  if (isMalformedMcpSnapshot(mcpSnapshot)) {
    diagnostics.push({ message: "mcp 快照畸形，MCP 桥已剔除（授权链保留）" });
  } else {
    try {
      const adapterModule = await loadMcpAdapterModule();
      // mcpService 快照形态 { servers: { [name]: ServerEntry } } → 桥 config 形态
      // { mcpServers: { [name]: ServerEntry } }（build-progress slice 1 实证：工厂创建
      // doesNotThrow；init 时桥按 mcpServers 键读 server——servers 键在 init 期无 server）。
      const adapterConfig = { mcpServers: mcpSnapshot?.servers ?? {} };
      const mcpFactory = adapterModule.createMcpAdapter({ config: adapterConfig });
      factories.push(nameFactory(mcpFactory, "pi-mcp-adapter"));
    } catch (err) {
      diagnostics.push({ message: `mcp 桥加载失败: ${err?.message ?? String(err)}` });
    }
  }

  return { resolved, factories, diagnostics, handle };
}
