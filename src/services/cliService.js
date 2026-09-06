// src/services/cliService.js
// REQ-CLI-SERVICE-002: 本机环境实时探测、超时与短缓存
// REQ-CLI-SERVICE-003: 分发渠道最新版本查询与更新检测
// EXPECTED-TRACE: prd.md §6.3 块 2, §7, §8 E2/E3, §10.3 流 1, §10.5 决策 3

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { findRegistryItem } from "./cliRegistry.js";

const PROBE_CACHE_TTL_MS = 60_000; // 60s
const LATEST_CACHE_TTL_MS = 3_600_000; // 1h
const PROBE_TIMEOUT_MS = 5_000; // 5s

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
 * 默认渠道最新版本请求器（npm registry / PyPI）
 */
async function defaultFetchLatest(pkg, channel) {
  if (channel === "npm") {
    const encodedPkg = pkg.startsWith("@")
      ? `@${encodeURIComponent(pkg.slice(1))}`
      : encodeURIComponent(pkg);
    const url = `https://registry.npmjs.org/${encodedPkg}/latest`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.version) throw new Error("Invalid npm registry response");
    return data.version;
  } else if (channel === "pypi") {
    const url = `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`PyPI registry returned HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.info || !data.info.version) throw new Error("Invalid PyPI response");
    return data.info.version;
  }
  throw new Error(`Unsupported channel: ${channel}`);
}

/**
 * 创建 CLI 服务实例
 * @param {Object} [options]
 * @param {string} [options.configDir] - 配置目录
 */
export async function createCliService(options = {}) {
  const configDir =
    options.configDir || process.env.OPC_WORKSTATION_CONFIG_DIR || path.join(os.homedir(), ".opc-workstation");

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
          probeError: `E-CLI-PROBE-FAILED:Unknown CLI: ${id}`,
        };
      }

      const refresh = Boolean(probeOptions?.refresh);
      const now = Date.now();

      if (!refresh && svc._probeCache.has(id)) {
        const cached = svc._probeCache.get(id);
        if (now - cached.timestamp < PROBE_CACHE_TTL_MS) {
          return { ...cached.data };
        }
      }

      if (svc._inFlightProbes.has(id)) {
        return svc._inFlightProbes.get(id);
      }

      const probePromise = (async () => {
        try {
          const result = await svc._limiter.run(async () => {
            const execFn = svc._stubExecFile || defaultExecFile;
            return await execFn(item.command, item.versionArgs);
          });

          if (result && result.exitCode !== undefined && result.exitCode !== 0) {
            const out = {
              id: item.id,
              installed: false,
              version: null,
              probeError: `E-CLI-PROBE-FAILED:exit code ${result.exitCode}`,
            };
            svc._probeCache.set(id, { timestamp: Date.now(), data: out });
            return out;
          }

          const stdout = (result?.stdout || "") + (result?.stderr || "");
          const regex = new RegExp(item.versionRegex || "(\\d+\\.\\d+\\.\\d+)");
          const match = stdout.match(regex);
          if (!match) {
            const out = {
              id: item.id,
              installed: false,
              version: null,
              probeError: "E-CLI-PROBE-FAILED:Cannot parse version from output",
            };
            svc._probeCache.set(id, { timestamp: Date.now(), data: out });
            return out;
          }

          const version = match[1] || match[0];
          const out = {
            id: item.id,
            installed: true,
            version,
          };
          svc._probeCache.set(id, { timestamp: Date.now(), data: out });
          return out;
        } catch (err) {
          if (
            err.code === "ENOENT" ||
            err.message?.includes("ENOENT") ||
            err.message?.includes("Command not found")
          ) {
            const out = {
              id: item.id,
              installed: false,
              version: null,
            };
            svc._probeCache.set(id, { timestamp: Date.now(), data: out });
            return out;
          }
          const reason = err.code || err.message || "execution failed";
          const out = {
            id: item.id,
            installed: false,
            version: null,
            probeError: `E-CLI-PROBE-FAILED:${reason}`,
          };
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
        const now = Date.now();
        const refresh = Boolean(checkOptions?.refresh);
        const cached = svc._latestVersionCache.get(cacheKey);

        if (!refresh && cached && now - cached.timestamp < LATEST_CACHE_TTL_MS) {
          latestVersion = cached.version;
        } else {
          try {
            const fetchFn = svc._stubFetchLatest || defaultFetchLatest;
            const fetched = await fetchFn(pkg, channel);
            if (fetched) {
              latestVersion = fetched;
              svc._latestVersionCache.set(cacheKey, { timestamp: now, version: fetched });
            } else {
              latestVersion = "unknown";
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
  };

  return svc;
}
