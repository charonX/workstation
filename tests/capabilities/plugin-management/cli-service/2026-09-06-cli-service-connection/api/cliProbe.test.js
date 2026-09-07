// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-002, 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-003
// REQ-VERSION: v1-hash:1f616dc91b7e8d80569503c5ce12f190ddf066f699394496ea8a815e61593119
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.3 块 2, §7, §8 E2/E3, §10.3 流 1, §10.5 决策 3
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadCliService() {
  const mod = await import("../../../../../../src/services/cliService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/cliService.js 尚未实现（REQ-CLI-SERVICE-002/003）");
  assert.equal(typeof mod.createCliService, "function", "导出 createCliService 工厂函数");
  return mod;
}

describe("REQ-CLI-SERVICE-002/003 本机环境实时探测与渠道版本检查", () => {
  let workdir;
  let svc;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-probe-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const { createCliService } = await loadCliService();
    svc = await createCliService({ configDir: workdir });
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("探测已安装的 CLI：成功解析版本字符串并返回 installed: true", async () => {
    // 注入 stub spawn 执行器模拟 claude --version 输出
    svc._stubExecFile = async (cmd, args) => {
      if (cmd === "claude") {
        return { stdout: "1.0.80 (Claude Code)\n", stderr: "", exitCode: 0 };
      }
      const err = new Error("Command not found");
      err.code = "ENOENT";
      throw err;
    };

    // EXPECTED-TRACE: prd.md §6.3 块 2 row 1
    const res = await svc.probe("claude");
    assert.equal(res.id, "claude");
    assert.equal(res.installed, true);
    assert.equal(res.version, "1.0.80");
  });

  it("探测未安装的 CLI：ENOENT 时返回 installed: false, version: null 且不抛错", async () => {
    svc._stubExecFile = async () => {
      const err = new Error("Command not found");
      err.code = "ENOENT";
      throw err;
    };

    // EXPECTED-TRACE: prd.md §6.3 块 2 row 2
    const res = await svc.probe("codex");
    assert.equal(res.id, "codex");
    assert.equal(res.installed, false);
    assert.equal(res.version, null);
  });

  it("探测失败或超时：返回 probeError 错误码标签", async () => {
    svc._stubExecFile = async () => {
      const err = new Error("Timed out after 5000ms");
      err.code = "ETIMEDOUT";
      throw err;
    };

    // EXPECTED-TRACE: prd.md §6.2 异常行 2, §8 E2
    const res = await svc.probe("crawl4ai");
    assert.equal(res.id, "crawl4ai");
    assert.equal(res.installed, false);
    assert.ok(res.probeError && res.probeError.startsWith("E-CLI-PROBE-FAILED"), "包含 E-CLI-PROBE-FAILED 前缀");
  });

  it("60s TTL 短缓存：相同 id 连续探测直接命中缓存，不重复执行 spawn", async () => {
    let callCount = 0;
    svc._stubExecFile = async () => {
      callCount++;
      return { stdout: "1.0.80 (Claude Code)\n", stderr: "", exitCode: 0 };
    };

    // EXPECTED-TRACE: prd.md §6.3 块 2 row 3
    const first = await svc.probe("claude");
    const second = await svc.probe("claude");
    assert.equal(callCount, 1, "缓存期内只调用一次底层 spawn");
    assert.deepEqual(second, first, "两次探测结果一致");

    // refresh: true 强制重探
    const refreshed = await svc.probe("claude", { refresh: true });
    assert.equal(callCount, 2, "refresh: true 绕过缓存重新执行 spawn");
    assert.equal(refreshed.installed, true);
  });

  it("并发合并与限流：同 id 并发请求合并，跨条目全局并发 ≤ 4", async () => {
    let activeCalls = 0;
    let maxActiveCalls = 0;
    let totalCalls = 0;

    svc._stubExecFile = async () => {
      activeCalls++;
      totalCalls++;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((r) => setTimeout(r, 20));
      activeCalls--;
      return { stdout: "1.0.0\n", stderr: "", exitCode: 0 };
    };

    // 同一 id 的 3 次并发调用合并为 1 次底层执行
    await Promise.all([svc.probe("claude"), svc.probe("claude"), svc.probe("claude")]);
    assert.equal(totalCalls, 1, "同一 id 并发请求去重合并为一个 in-flight");

    // 跨条目探测验证并发上限 ≤ 4
    await Promise.all([
      svc.probe("claude", { refresh: true }),
      svc.probe("codex", { refresh: true }),
      svc.probe("crawl4ai", { refresh: true }),
    ]);
    assert.ok(maxActiveCalls <= 4, "全局探测并发执行必须 ≤ 4");

    // 严格压测 ConcurrencyLimiter 全局并发上限 ≤ 4（发起 8 个并发任务）
    activeCalls = 0;
    maxActiveCalls = 0;
    const tasks = Array.from({ length: 8 }, () =>
      svc._limiter.run(async () => {
        activeCalls++;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        await new Promise((r) => setTimeout(r, 25));
        activeCalls--;
      })
    );
    await Promise.all(tasks);
    assert.ok(maxActiveCalls <= 4, "峰值活跃并发数严禁超过 4");
    assert.equal(maxActiveCalls, 4, "4 个并发槽位应被充分打满");
  });

  it("渠道最新版本检查：当 latestVersion > localVersion 时标记 updateAvailable: true", async () => {
    svc._stubFetchLatest = async (pkg, channel) => {
      if (channel === "npm" && pkg === "@anthropic-ai/claude-code") {
        return "1.0.90";
      }
      return null;
    };

    // 本地版本为 1.0.80，npm 最新为 1.0.90
    // EXPECTED-TRACE: prd.md §6.3 块 2 row 4
    const info = await svc.checkLatestVersion({
      id: "claude",
      channel: "npm",
      package: "@anthropic-ai/claude-code",
      version: "1.0.80",
      installed: true,
    });

    assert.equal(info.latestVersion, "1.0.90");
    assert.equal(info.updateAvailable, true, "1.0.90 > 1.0.80 触发 updateAvailable: true");
  });

  it("渠道检查网络失败时优雅降级：返回 latestVersion: unknown 且不抛出系统错误", async () => {
    svc._stubFetchLatest = async () => {
      throw new Error("Network unreachable");
    };

    // EXPECTED-TRACE: prd.md §6.2 异常行 3, §8 E3
    const info = await svc.checkLatestVersion({
      id: "crawl4ai",
      channel: "pypi",
      package: "crawl4ai",
      version: "0.4.0",
      installed: true,
    });

    assert.equal(info.latestVersion, "unknown");
    assert.equal(info.updateAvailable, false);
  });

  it("渠道契约解析验证：defaultFetchLatest 正确拼装 npm 与 PyPI 端点并解析 JSON 响应（TEST-F7）", async () => {
    const { defaultFetchLatest } = await loadCliService();
    assert.equal(typeof defaultFetchLatest, "function", "导出 defaultFetchLatest 函数");

    const originalFetch = global.fetch;
    const requestedUrls = [];

    global.fetch = async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes("registry.npmjs.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: "@anthropic-ai/claude-code",
            version: "1.0.95",
            "dist-tags": { latest: "1.0.95" },
          }),
        };
      }
      if (String(url).includes("pypi.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            info: {
              name: "crawl4ai",
              version: "0.4.8",
            },
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    try {
      // 1. 验证 npm scoped 包 URL 转义与 version 解析
      const npmVersion = await defaultFetchLatest("@anthropic-ai/claude-code", "npm");
      assert.equal(npmVersion, "1.0.95", "正确解析 npm registry 的 version 字段");
      assert.ok(
        requestedUrls[0].includes("registry.npmjs.org/@anthropic-ai%2Fclaude-code/latest"),
        "npm 包名 scoped 斜杠需被 URL 编码为 %2F"
      );

      // 2. 验证 PyPI JSON API URL 与 info.version 解析
      const pypiVersion = await defaultFetchLatest("crawl4ai", "pypi");
      assert.equal(pypiVersion, "0.4.8", "正确解析 PyPI 的 info.version 字段");
      assert.ok(
        requestedUrls[1].includes("pypi.org/pypi/crawl4ai/json"),
        "PyPI 端点需为 /pypi/<pkg>/json"
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
