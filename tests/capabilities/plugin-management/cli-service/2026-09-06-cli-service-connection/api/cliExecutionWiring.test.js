// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-008, 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-009
// REQ-VERSION: v1-hash:1f616dc91b7e8d80569503c5ce12f190ddf066f699394496ea8a815e61593119
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.3 块 5, §8 E5/E6, §10.2, §10.4 接口 4, §10.5 决策 1/4, ADR-043
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");

async function loadPolicyRules() {
  const mod = await import("../../../../../../src/agent/policyRules.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/policyRules.js");
  return mod;
}

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js");
  return mod;
}

async function loadCliEnvResolver() {
  const mod = await import("../../../../../../src/agent/cliEnvResolver.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/cliEnvResolver.js");
  return mod;
}

async function loadToolAdapter() {
  const mod = await import("../../../../../../src/agent/toolAdapter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/toolAdapter.js");
  return mod;
}

describe("REQ-CLI-SERVICE-008/009 权限策略出厂规则、项目覆盖与 session-config 快照注入", () => {
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-exec-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("policyRules 出厂规则包含清单命令且默认判定为 ask", async () => {
    const { BASH_RULES } = await loadPolicyRules();
    assert.ok(Array.isArray(BASH_RULES), "BASH_RULES 必须为数组");

    // EXPECTED-TRACE: prd.md §10.2, §10.5 决策 1, ADR-043
    const targets = ["claude", "codex"];
    for (const cmd of targets) {
      const rule = BASH_RULES.find((r) => r.pattern && r.pattern.startsWith(`${cmd} `));
      assert.ok(rule, `BASH_RULES 必须包含 ${cmd} 命令的出厂规则`);
      assert.equal(rule.action, "ask", `${cmd} 出厂规则默认必须为 ask（需要确认）`);
    }
  });

  it("项目层权限覆盖：未启用 CLI 生成 deny 覆盖；已启用 CLI 回落默认层", async () => {
    const { buildProjectBashRules } = await loadPolicyRules();
    assert.equal(typeof buildProjectBashRules, "function", "导出 buildProjectBashRules 函数");

    // 当项目未启用 codex 时，项目层规则判定为 deny
    const disabledRules = buildProjectBashRules({
      enabledCliCommands: ["claude"], // 仅 claude 启用，codex 未启用
    });

    const codexRule = disabledRules.find((r) => r.pattern && r.pattern.startsWith("codex "));
    assert.ok(codexRule, "未启用的 codex 必须有项目层覆盖规则");
    assert.equal(codexRule.action, "deny", "未启用 CLI 判定为 deny");

    // 已启用的 claude 不被 deny 覆盖，回落默认出厂层
    const claudeDenyRule = disabledRules.find((r) => r.pattern && r.pattern.startsWith("claude ") && r.action === "deny");
    assert.equal(claudeDenyRule, undefined, "已启用的 claude 不得被项目层 deny 覆盖");
  });

  it("buildConfigMessage 在 session-config 中单点解密注入 cliServices 快照", async () => {
    const agentSvc = await loadAgentService();
    assert.equal(typeof agentSvc.buildConfigMessage, "function", "导出 buildConfigMessage");

    // 构造测试有效配置
    const mockEffectiveCli = [
      {
        id: "claude",
        command: "claude",
        env: { ANTHROPIC_API_KEY: "sk-ant-plaintext-secret" },
        timeoutSec: 120,
      },
    ];

    const configMsg = await agentSvc.buildConfigMessage("proj-1", {
      stubCliServices: mockEffectiveCli,
    });

    // EXPECTED-TRACE: prd.md §10.4 接口 4, §10.5 决策 4, ADR-043
    assert.ok(configMsg && Array.isArray(configMsg.cliServices), "configMsg 包含 cliServices 数组");
    assert.equal(configMsg.cliServices.length, 1);
    assert.equal(configMsg.cliServices[0].command, "claude");
    assert.equal(configMsg.cliServices[0].env.ANTHROPIC_API_KEY, "sk-ant-plaintext-secret", "快照包含解密后的环境变量");
  });

  it("worker 在执行匹配命令时合并对应 CLI 的环境变量，未启用命令不注入（TEST-F8: 对齐 cliEnvResolver seam）", async () => {
    const { resolveCliEnvForCommand } = await loadCliEnvResolver();
    assert.equal(typeof resolveCliEnvForCommand, "function", "导出 resolveCliEnvForCommand 辅助函数");

    const cliServicesSnapshot = [
      {
        id: "claude",
        command: "claude",
        env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      },
    ];

    // 调用 claude 命令：合并 env
    const claudeEnv = resolveCliEnvForCommand("claude --version", cliServicesSnapshot);
    assert.equal(claudeEnv.ANTHROPIC_API_KEY, "sk-ant-test");

    // 调用未纳管或未启用的命令：不合并
    const otherEnv = resolveCliEnvForCommand("ls -la", cliServicesSnapshot);
    assert.deepEqual(otherEnv, {});

    // agentService 兼容性导出一致性
    const agentSvc = await loadAgentService();
    assert.equal(agentSvc.resolveCliEnvForCommand, resolveCliEnvForCommand, "agentService 统一复用 cliEnvResolver 导出");
  });

  it("未启用清单 CLI 时通过策略评估器拦截为 deny（E5：权限链拒绝，无进程产生）", async () => {
    const { createPolicyEvaluator } = await import("../../../../../../src/services/permissionPolicy.js");
    const { buildProjectBashRules } = await loadPolicyRules();

    // 模拟项目未启用清单 CLI 时写入的项目级策略
    const configDir = path.join(workdir, ".pi", "extensions", "pi-permission-system");
    fs.mkdirSync(configDir, { recursive: true });
    const denyRules = buildProjectBashRules({ enabledCliCommands: [] });
    const bashConfig = {};
    for (const rule of denyRules) {
      bashConfig[rule.pattern] = rule.action || "deny";
    }
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ permission: { bash: bashConfig } }, null, 2)
    );

    const evaluator = createPolicyEvaluator({ projectDir: workdir });
    // EXPECTED-TRACE: prd.md §8 E5
    const verdict = evaluator.evaluate({ tool: "bash", input: { command: "claude --version" } });
    assert.equal(verdict, "deny", "未启用清单 CLI 时权限策略必须返回 deny 拦截");
    const verdictBare = evaluator.evaluate({ tool: "bash", input: { command: "claude" } });
    assert.equal(verdictBare, "deny", "未启用清单 CLI 时裸命令亦必须返回 deny 拦截");
  });

  it("CLI 服务超时触发 E-CLI-TIMEOUT（surface 接线：timeoutSec → execFile timeout）", async () => {
    const { createSessionToolSurface } = await loadToolAdapter();

    // mock 命令正常响应 SIGTERM：验证快照 timeoutSec 传递到 execFile 并映射错误码
    const binDir = path.join(workdir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const mockClaude = path.join(binDir, "claude");
    fs.writeFileSync(mockClaude, "#!/bin/sh\nsleep 10\n", { mode: 0o755 });

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath}`;

    try {
      const surface = createSessionToolSurface({
        profile: "project",
        cwd: workdir,
        boundaryAuthorized: true,
        cliServices: [
          {
            id: "claude",
            command: "claude",
            env: {},
            timeoutSec: 1, // 1 秒超时
          },
        ],
      });

      // EXPECTED-TRACE: prd.md §8 E6
      const started = Date.now();
      const res = await surface.execute("bash", { command: "claude" });
      const elapsed = Date.now() - started;
      assert.equal(res?.errorCode, "E-CLI-TIMEOUT", "超时返回 E-CLI-TIMEOUT");
      assert.ok(elapsed < 5000, `SIGTERM 敏感的进程应在超时后即结算（实际 ${elapsed}ms）`);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("SIGTERM 被无视时 runBash 在超时 +500ms 升级 SIGKILL（诚实断言）", async () => {
    const { runBash } = await loadToolAdapter();
    assert.equal(typeof runBash, "function", "runBash 作为测试 seam 导出");

    // `trap '' TERM` 使直接子进程（bash 自身）免疫 SIGTERM：只有 SIGKILL 升级路径
    // 生效才能让 Promise 结算——能 reject 即证明 SIGKILL 真实发出（否则悬挂至测试超时）。
    // EXPECTED-TRACE: prd.md §8 E6
    const started = Date.now();
    await assert.rejects(
      runBash("trap '' TERM; sleep 10", workdir, { timeout: 1000, isCliService: true }),
      (err) => err?.code === "E-CLI-TIMEOUT"
    );
    const elapsed = Date.now() - started;
    assert.ok(
      elapsed >= 1400,
      `SIGTERM 被无视时须等待 +500ms 的 SIGKILL 升级才结算（实际 ${elapsed}ms；若仅 SIGTERM 生效应约 1000ms 内返回）`
    );
  });

  it("gen-agent-policy.mjs --check 自动化一致性回归验证", () => {
    const checkOut = execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts/gen-agent-policy.mjs"), "--check"],
      { encoding: "utf-8" }
    );
    assert.ok(
      checkOut.includes("--check: 一致"),
      "策略生成器一致性检查必须通过"
    );
  });
});
