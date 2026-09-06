// src/services/cliService.js
// REQ-CLI-SERVICE-002: 本机环境实时探测、超时与短缓存
// REQ-CLI-SERVICE-003: 分发渠道最新版本查询与更新检测
// REQ-CLI-SERVICE-004: CLI 服务配置持久化与两层启用
// REQ-CLI-SERVICE-005: 环境变量配置加密存储与安全回显
// EXPECTED-TRACE: prd.md §6.3 块 2/3, §7, §7.1, §8 E1/E2/E3/E4, §10.3 流 1, §10.4 接口 1/2/3/4, §10.5 决策 3/4

import fs from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { getDb } from "../db.js";
import { encryptSecret, decryptSecret } from "./secretStore.js";
import { findRegistryItem, getRegistry } from "./cliRegistry.js";
import * as projectService from "./projectService.js";
import * as skillService from "./skillService.js";
import { buildProjectBashRules } from "../agent/policyRules.js";
import { expandTilde } from "./pathUtils.js";

const PROBE_CACHE_TTL_MS = 60_000; // 60s
const LATEST_CACHE_TTL_MS = 3_600_000; // 1h
const PROBE_TIMEOUT_MS = 5_000; // 5s
const PROBE_ERROR_PREFIX = "E-CLI-PROBE-FAILED";
const DEFAULT_TIMEOUT_SEC = 120;
const MIN_TIMEOUT_SEC = 10;
const MAX_TIMEOUT_SEC = 600;
const MAX_ENV_ENTRIES = 50;
const MAX_ENV_KEY_LENGTH = 128;
const MAX_ENV_VALUE_LENGTH = 4096;
const ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

/**
 * 格式化探测错误信息
 * @param {string} reason
 * @returns {string}
 */
function formatProbeError(reason) {
  return `${PROBE_ERROR_PREFIX}:${reason}`;
}

/**
 * 判断错误是否属于可执行命令未找到（如未安装）
 * @param {any} err
 * @returns {boolean}
 */
function isCommandNotFoundError(err) {
  return (
    err?.code === "ENOENT" ||
    Boolean(err?.message && (err.message.includes("ENOENT") || err.message.includes("Command not found")))
  );
}

/**
 * 校验缓存条目是否在有效期内
 * @param {{ timestamp: number } | undefined} cached
 * @param {number} ttlMs
 * @param {number} [now]
 * @returns {boolean}
 */
function isCacheValid(cached, ttlMs, now = Date.now()) {
  return Boolean(cached && now - cached.timestamp < ttlMs);
}

/**
 * 从命令标准输出中提取语义版本号
 * @param {string} output
 * @param {string} [pattern]
 * @returns {string | null}
 */
function parseVersionFromOutput(output, pattern) {
  const regex = new RegExp(pattern || "(\\d+\\.\\d+\\.\\d+)");
  const match = output.match(regex);
  if (!match) return null;
  return match[1] || match[0];
}

/**
 * 并发限制器（支持最大并发数与排队唤醒）
 */
class ConcurrencyLimiter {
  constructor(limit = 4) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.active >= this.limit) {
      await new Promise((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      } else {
        this.active--;
      }
    }
  }
}

/**
 * 默认底层 spawn 执行器（execFile，无 shell，5s 超时）
 */
function defaultExecFile(command, args) {
  return new Promise((resolve, reject) => {
    try {
      execFile(command, args, { timeout: PROBE_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error) {
          if (error.killed && !error.code) {
            error.code = "ETIMEDOUT";
          }
          error.stdout = stdout;
          error.stderr = stderr;
          return reject(error);
        }
        resolve({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 });
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 语义化版本解析
 */
export function parseSemver(v) {
  if (!v || typeof v !== "string") return null;
  const clean = v.trim().replace(/^v/, "");
  const match = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: match[2] !== undefined ? parseInt(match[2], 10) : 0,
    patch: match[3] !== undefined ? parseInt(match[3], 10) : 0,
    prerelease: match[4] || null,
  };
}

/**
 * 语义化版本比较：a > b 返回 1，a === b 返回 0，a < b 返回 -1
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && !pb.prerelease) return -1;
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease.localeCompare(pb.prerelease);
  }
  return 0;
}

/**
 * 带超时的 JSON HTTP 请求辅助函数
 * @param {string} url
 * @param {number} [timeoutMs]
 */
async function fetchJsonWithTimeout(url, timeoutMs = PROBE_TIMEOUT_MS) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Registry returned HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * 格式化 npm registry API URL
 * @param {string} pkg
 * @returns {string}
 */
function formatNpmPackageUrl(pkg) {
  const encodedPkg = pkg.startsWith("@")
    ? `@${encodeURIComponent(pkg.slice(1))}`
    : encodeURIComponent(pkg);
  return `https://registry.npmjs.org/${encodedPkg}/latest`;
}

/**
 * 格式化 PyPI API URL
 * @param {string} pkg
 * @returns {string}
 */
function formatPypiPackageUrl(pkg) {
  return `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`;
}

/**
 * 默认渠道最新版本请求器（npm registry / PyPI）
 */
async function defaultFetchLatest(pkg, channel) {
  if (channel === "npm") {
    const data = await fetchJsonWithTimeout(formatNpmPackageUrl(pkg));
    if (!data?.version) throw new Error("Invalid npm registry response");
    return data.version;
  }
  if (channel === "pypi") {
    const data = await fetchJsonWithTimeout(formatPypiPackageUrl(pkg));
    if (!data?.info?.version) throw new Error("Invalid PyPI response");
    return data.info.version;
  }
  throw new Error(`Unsupported channel: ${channel}`);
}

/**
 * 执行底层探测命令并格式化探测结果
 * @param {import("./cliRegistry.js").CliRegistryItem} item
 * @param {Function} execFn
 * @param {ConcurrencyLimiter} limiter
 */
async function executeProbe(item, execFn, limiter) {
  try {
    const result = await limiter.run(async () => {
      return await execFn(item.command, item.versionArgs);
    });

    if (result && result.exitCode !== undefined && result.exitCode !== 0) {
      return {
        id: item.id,
        installed: false,
        version: null,
        probeError: formatProbeError(`exit code ${result.exitCode}`),
      };
    }

    const output = (result?.stdout || "") + (result?.stderr || "");
    const version = parseVersionFromOutput(output, item.versionRegex);
    if (!version) {
      return {
        id: item.id,
        installed: false,
        version: null,
        probeError: formatProbeError("Cannot parse version from output"),
      };
    }

    return {
      id: item.id,
      installed: true,
      version,
    };
  } catch (err) {
    if (isCommandNotFoundError(err)) {
      return {
        id: item.id,
        installed: false,
        version: null,
      };
    }
    const reason = err?.code || err?.message || "execution failed";
    return {
      id: item.id,
      installed: false,
      version: null,
      probeError: formatProbeError(reason),
    };
  }
}

/**
 * 解析数据库路径（优先 DB_PATH，回退 configDir/data.db）
 * @param {string} [configDir]
 * @returns {string}
 */
function resolveDbPath(configDir) {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const dir = configDir || process.env.OPC_WORKSTATION_CONFIG_DIR || path.join(os.homedir(), ".opc-workstation");
  return path.join(dir, "data.db");
}

/**
 * 安全解析 JSON 文本
 * @param {any} value
 * @param {any} fallback
 * @returns {any}
 */
function jsonParse(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * 创建带标准错误码的 Error 对象
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function createCliError(code, message) {
  const err = new Error(`${message} (${code})`);
  err.code = code;
  return err;
}

/**
 * 校验条目在内置清单中存在
 * @param {string} id
 * @returns {import("./cliRegistry.js").CliRegistryItem}
 */
function assertKnownCli(id) {
  const item = findRegistryItem(id);
  if (!item) {
    throw createCliError("E-CLI-UNKNOWN-ID", `未知 CLI 服务: ${id}`);
  }
  return item;
}

/**
 * 校验超时时长（10–600 秒整数）
 * @param {number} timeoutSec
 */
function validateTimeout(timeoutSec) {
  if (
    typeof timeoutSec !== "number" ||
    !Number.isInteger(timeoutSec) ||
    timeoutSec < MIN_TIMEOUT_SEC ||
    timeoutSec > MAX_TIMEOUT_SEC
  ) {
    throw createCliError("E-CLI-INVALID-TIMEOUT", "超时需在 10–600 秒之间");
  }
}

/**
 * 校验环境变量字典合法性
 * @param {Record<string, string>} env
 */
function validateEnvMap(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw createCliError("E-CLI-INVALID-ENV-KEY", "环境变量 KEY 非法");
  }
  const entries = Object.entries(env);
  if (entries.length > MAX_ENV_ENTRIES) {
    throw createCliError("E-CLI-INVALID-ENV-KEY", "单个 CLI 最多 50 条 env");
  }
  for (const [k, v] of entries) {
    if (typeof k !== "string" || k.length === 0 || k.length > MAX_ENV_KEY_LENGTH || !ENV_KEY_REGEX.test(k)) {
      throw createCliError("E-CLI-INVALID-ENV-KEY", `环境变量 KEY 非法: ${k}`);
    }
    if (typeof v !== "string" || v.length === 0 || v.length > MAX_ENV_VALUE_LENGTH) {
      throw createCliError(
        "E-CLI-INVALID-ENV-KEY",
        "环境变量 KEY 非法: VALUE 不能为空且长度不能超过 4096"
      );
    }
  }
}

/**
 * 将明文环境变量字典逐项加密
 * @param {Record<string, string>} env
 * @returns {Record<string, string>}
 */
function encryptEnvMap(env) {
  const encrypted = {};
  for (const [k, v] of Object.entries(env)) {
    encrypted[k] = encryptSecret(v);
  }
  return encrypted;
}

/**
 * 将密文环境变量字典逐项解密
 * @param {Record<string, string>} encryptedMap
 * @returns {Record<string, string>}
 */
function decryptEnvMap(encryptedMap) {
  const decrypted = {};
  for (const [k, enc] of Object.entries(encryptedMap)) {
    decrypted[k] = decryptSecret(enc);
  }
  return decrypted;
}

/**
 * 从数据库行提取脱敏 envKeys 列表
 * @param {any} row
 * @returns {string[]}
 */
function extractEnvKeys(row) {
  if (!row?.env) return [];
  const parsed = jsonParse(row.env, {});
  return Object.keys(parsed);
}

/**
 * 校验 CLI 是否已安装，未安装时阻断启用
 * @param {string} id
 * @param {Function} probeFn
 */
async function assertInstalled(id, probeFn) {
  const probeRes = await probeFn(id);
  if (!probeRes?.installed) {
    throw createCliError("E-CLI-NOT-INSTALLED", "未安装无法启用");
  }
}

/**
 * 创建 CLI 服务实例
 * @param {Object} [options]
 * @param {string} [options.configDir] - 配置目录
 * @param {string} [options.dbPath] - 自定义数据库路径
 */
export async function createCliService(options = {}) {
  const configDir =
    options.configDir || process.env.OPC_WORKSTATION_CONFIG_DIR || path.join(os.homedir(), ".opc-workstation");
  const dbPath = options.dbPath || resolveDbPath(configDir);
  const db = () => getDb(dbPath);
  const resolveProbeFn = (ctx) =>
    ctx && typeof ctx.probe === "function" ? ctx.probe.bind(ctx) : svc.probe;

  const svc = {
    configDir,
    _stubExecFile: null,
    _stubFetchLatest: null,
    _probeCache: new Map(),
    _inFlightProbes: new Map(),
    _latestVersionCache: new Map(),
    _limiter: new ConcurrencyLimiter(4),

    /**
     * 探测指定 CLI 命令的本机安装与版本状态
     * @param {string} id - 条目 id
     * @param {Object} [probeOptions]
     * @param {boolean} [probeOptions.refresh] - 是否绕过缓存强制重探
     * @returns {Promise<{ id: string, installed: boolean, version: string | null, probeError?: string }>}
     */
    async probe(id, probeOptions = {}) {
      const item = findRegistryItem(id);
      if (!item) {
        return {
          id,
          installed: false,
          version: null,
          probeError: formatProbeError(`Unknown CLI: ${id}`),
        };
      }

      const refresh = Boolean(probeOptions?.refresh);
      const cached = svc._probeCache.get(id);

      if (!refresh && isCacheValid(cached, PROBE_CACHE_TTL_MS)) {
        return { ...cached.data };
      }

      if (svc._inFlightProbes.has(id)) {
        return svc._inFlightProbes.get(id);
      }

      const probePromise = (async () => {
        try {
          const execFn = svc._stubExecFile || defaultExecFile;
          const out = await executeProbe(item, execFn, svc._limiter);
          svc._probeCache.set(id, { timestamp: Date.now(), data: out });
          return out;
        } finally {
          svc._inFlightProbes.delete(id);
        }
      })();

      svc._inFlightProbes.set(id, probePromise);
      return probePromise;
    },

    /**
     * 检查条目的渠道最新版本与是否有可用更新
     * @param {Object} target
     * @param {string} [target.id]
     * @param {string} [target.channel]
     * @param {string} [target.package]
     * @param {string} [target.version]
     * @param {boolean} [target.installed]
     * @param {Object} [checkOptions]
     * @param {boolean} [checkOptions.refresh]
     * @returns {Promise<Object>}
     */
    async checkLatestVersion(target, checkOptions = {}) {
      const targetObj = typeof target === "string" ? { id: target } : { ...target };
      const regItem = targetObj.id ? findRegistryItem(targetObj.id) : null;
      const channel = targetObj.channel || regItem?.channel;
      const pkg = targetObj.package || regItem?.package;
      const version = targetObj.version;
      const installed = targetObj.installed ?? false;

      let latestVersion = "unknown";
      let updateAvailable = false;

      if (channel && pkg) {
        const cacheKey = `${channel}:${pkg}`;
        const refresh = Boolean(checkOptions?.refresh);
        const cached = svc._latestVersionCache.get(cacheKey);

        if (!refresh && isCacheValid(cached, LATEST_CACHE_TTL_MS)) {
          latestVersion = cached.version;
        } else {
          try {
            const fetchFn = svc._stubFetchLatest || defaultFetchLatest;
            const fetched = await fetchFn(pkg, channel);
            if (fetched) {
              latestVersion = fetched;
              svc._latestVersionCache.set(cacheKey, { timestamp: Date.now(), version: fetched });
            }
          } catch {
            latestVersion = "unknown";
          }
        }
      }

      if (installed && version && latestVersion !== "unknown") {
        updateAvailable = compareSemver(latestVersion, version) > 0;
      }

      return {
        ...targetObj,
        latestVersion,
        updateAvailable,
      };
    },

    /**
     * 设置 CLI 服务全局启用开关
     * @param {string} id - 条目 id
     * @param {boolean} enabled - 是否全局启用
     * @returns {Promise<Object>}
     */
    async setGlobalEnabled(id, enabled) {
      assertKnownCli(id);
      const isEnabled = Boolean(enabled);
      if (isEnabled) {
        await assertInstalled(id, resolveProbeFn(this));
      }

      const d = db();
      const now = new Date().toISOString();
      d.prepare(`
        INSERT INTO cli_services (id, enabled, env, timeout_sec, updated_at)
        VALUES (?, ?, '{}', 120, ?)
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(id, isEnabled ? 1 : 0, now);

      return await svc.getConfig(id);
    },

    /**
     * 设置 CLI 服务在指定项目内的启用开关
     * @param {string} projectId - 项目 ID
     * @param {string} id - 条目 id
     * @param {boolean} enabled - 是否在项目内启用
     * @returns {Promise<Object>}
     */
    async setProjectEnabled(projectId, id, enabled) {
      if (!projectId) {
        throw createCliError("E-INVALID-ARGS", "setProjectEnabled: projectId is required");
      }
      assertKnownCli(id);

      const d = db();
      const globalRow = d.prepare("SELECT enabled FROM cli_services WHERE id = ?").get(id);
      const isEnabled = Boolean(enabled);
      if (isEnabled && (!globalRow || globalRow.enabled !== 1)) {
        throw createCliError("E-CLI-GLOBALLY-DISABLED", "全局未启用禁止在项目内启用");
      }

      const now = new Date().toISOString();
      d.prepare(`
        INSERT INTO cli_service_project_enablement (project_id, service_id, enabled, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(service_id, project_id) DO UPDATE SET
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(projectId, id, isEnabled ? 1 : 0, now);

      // 查询该项目所有已启用的 CLI 服务 ID 集合
      const enabledRows = d.prepare(`
        SELECT service_id
        FROM cli_service_project_enablement
        WHERE project_id = ? AND enabled = 1
      `).all(projectId);
      const enabledServiceIds = enabledRows.map((r) => r.service_id);

      const enabledCliSlugs = [];
      const enabledCliCommands = [];
      for (const sid of enabledServiceIds) {
        const item = findRegistryItem(sid);
        if (item) {
          enabledCliSlugs.push(item.builtinSkillSlug);
          enabledCliCommands.push(item.command);
        } else {
          enabledCliSlugs.push(sid);
          enabledCliCommands.push(sid);
        }
      }

      // 获取项目的实际目录（通过 projectService 或项目对象）
      let projectDir = null;
      try {
        const project = projectService.getProjectDetail?.(projectId);
        if (project?.localPath) {
          projectDir = path.resolve(expandTilde(project.localPath));
        }
      } catch {
        // ignore
      }
      if (!projectDir && (path.isAbsolute(projectId) || projectId.startsWith(".") || projectId.includes(path.sep))) {
        projectDir = path.resolve(projectId);
      }

      // 调用 skillService.syncProjectCliSkills(projectDir, { enabledCliSlugs }) 自动收敛技能软链
      // 调用 buildProjectBashRules({ enabledCliCommands }) 获取未启用 CLI 的 deny 规则，并同步更新项目配置
      if (projectDir) {
        await skillService.syncProjectCliSkills(projectDir, { enabledCliSlugs });

        if (fs.existsSync(projectDir)) {
          const denyRules = buildProjectBashRules({ enabledCliCommands });
          const configPath = path.join(projectDir, ".pi", "extensions", "pi-permission-system", "config.json");
          let config = {};
          if (fs.existsSync(configPath)) {
            try {
              config = JSON.parse(fs.readFileSync(configPath, "utf-8")) || {};
            } catch {
              config = {};
            }
          }
          if (!config.permission || typeof config.permission !== "object") {
            config.permission = {};
          }
          if (!config.permission.bash || typeof config.permission.bash !== "object") {
            config.permission.bash = {};
          }
          for (const cmd of ["claude", "codex", "crwl"]) {
            delete config.permission.bash[`${cmd} *`];
            delete config.permission.bash[cmd];
          }
          for (const rule of denyRules) {
            config.permission.bash[rule.pattern] = rule.action || rule.decision || "deny";
          }
          try {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
          } catch (err) {
            console.warn?.(`[cliService] 更新项目权限配置失败 ${configPath}: ${err?.message ?? err}`);
          }
        }
      }

      return {
        projectId,
        id,
        serviceId: id,
        enabled: isEnabled,
        updatedAt: now,
      };
    },

    /**
     * 更新指定 CLI 服务的配置（启用状态、环境变量、超时）
     * @param {string} id - 条目 id
     * @param {Object} patch - 补丁对象
     * @param {boolean} [patch.enabled] - 全局启用开关
     * @param {Record<string, string>} [patch.env] - 环境变量字典（全量替换）
     * @param {number} [patch.timeoutSec] - 执行超时（秒）
     * @returns {Promise<Object>}
     */
    async updateConfig(id, patch = {}) {
      assertKnownCli(id);

      if (patch.timeoutSec !== undefined) {
        validateTimeout(patch.timeoutSec);
      }
      if (patch.env !== undefined) {
        validateEnvMap(patch.env);
      }
      if (patch.enabled === true) {
        await assertInstalled(id, resolveProbeFn(this));
      }

      const d = db();
      const existing = d.prepare("SELECT * FROM cli_services WHERE id = ?").get(id);
      const now = new Date().toISOString();

      const nextEnabled =
        patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (existing?.enabled ?? 0);
      const nextTimeoutSec =
        patch.timeoutSec !== undefined ? patch.timeoutSec : (existing?.timeout_sec ?? DEFAULT_TIMEOUT_SEC);
      const nextEnvJson =
        patch.env !== undefined ? JSON.stringify(encryptEnvMap(patch.env)) : (existing?.env ?? "{}");

      d.prepare(`
        INSERT INTO cli_services (id, enabled, env, timeout_sec, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          env = excluded.env,
          timeout_sec = excluded.timeout_sec,
          updated_at = excluded.updated_at
      `).run(id, nextEnabled, nextEnvJson, nextTimeoutSec, now);

      return await svc.getConfig(id);
    },

    /**
     * 获取指定 CLI 服务的脱敏安全配置（不回显明文与密文 env）
     * @param {string} id - 条目 id
     * @returns {Promise<Object>}
     */
    async getConfig(id) {
      assertKnownCli(id);

      const d = db();
      const row = d.prepare("SELECT * FROM cli_services WHERE id = ?").get(id);

      return {
        id,
        enabled: row ? row.enabled === 1 : false,
        timeoutSec: row?.timeout_sec ?? DEFAULT_TIMEOUT_SEC,
        envKeys: extractEnvKeys(row),
        updatedAt: row?.updated_at ?? null,
      };
    },

    /**
     * 计算项目有效生效的 CLI 服务列表（解密 env 快照注入唯一发生点）
     * @param {string} projectId - 项目 ID
     * @returns {Promise<Array<{ id: string, command: string, env: Record<string, string>, timeoutSec: number }>>}
     */
    async effectiveConfig(projectId) {
      if (!projectId) return [];
      const d = db();
      const rows = d
        .prepare(`
          SELECT s.*
          FROM cli_services s
          JOIN cli_service_project_enablement e ON e.service_id = s.id
          WHERE s.enabled = 1 AND e.project_id = ? AND e.enabled = 1
          ORDER BY s.id
        `)
        .all(projectId);

      const result = [];
      const probeFn = resolveProbeFn(this);

      for (const row of rows) {
        const item = findRegistryItem(row.id);
        if (!item) continue;
        const probeRes = await probeFn(row.id);
        if (!probeRes?.installed) continue;

        const rawEnv = jsonParse(row.env, {});
        result.push({
          id: row.id,
          command: item.command,
          env: decryptEnvMap(rawEnv),
          timeoutSec: row.timeout_sec ?? DEFAULT_TIMEOUT_SEC,
        });
      }

      return result;
    },

    /**
     * 直接查询 SQLite 原始数据行（供测试断言密文落盘）
     * @param {string} id - 条目 id
     * @returns {Promise<Object | undefined>}
     */
    async _getRawDbRow(id) {
      const d = db();
      return d.prepare("SELECT * FROM cli_services WHERE id = ?").get(id);
    },

    /**
     * 获取全部内置 CLI 服务列表、检测状态与项目级启用态
     * @param {Object} [listOptions]
     * @param {boolean} [listOptions.refresh] - 是否刷新探测缓存
     * @param {string} [listOptions.projectId] - 若指定项目 ID 则返回该项目启用态
     * @returns {Promise<Array<Object>>}
     */
    async list(listOptions = {}) {
      const d = db();
      const refresh = Boolean(listOptions.refresh);
      const projectId = listOptions.projectId;
      const items = getRegistry();
      const results = [];
      const probeFn = resolveProbeFn(this);

      for (const item of items) {
        const probeRes = await probeFn(item.id, { refresh });
        const versionRes = await svc.checkLatestVersion(
          {
            id: item.id,
            version: probeRes.version,
            installed: probeRes.installed,
          },
          { refresh }
        );

        const row = d.prepare("SELECT * FROM cli_services WHERE id = ?").get(item.id);

        let enabled = row ? row.enabled === 1 : false;
        if (projectId) {
          const projRow = d
            .prepare("SELECT enabled FROM cli_service_project_enablement WHERE service_id = ? AND project_id = ?")
            .get(item.id, projectId);
          enabled = projRow ? projRow.enabled === 1 : false;
        }

        results.push({
          id: item.id,
          displayName: item.displayName,
          command: item.command,
          installed: probeRes.installed,
          version: probeRes.version,
          latestVersion: versionRes.latestVersion,
          updateAvailable: versionRes.updateAvailable,
          enabled,
          envKeys: extractEnvKeys(row),
          timeoutSec: row?.timeout_sec ?? DEFAULT_TIMEOUT_SEC,
          installHint: item.installHint,
          ...(probeRes.probeError ? { probeError: probeRes.probeError } : {}),
        });
      }
      return results;
    },
  };

  return svc;
}
