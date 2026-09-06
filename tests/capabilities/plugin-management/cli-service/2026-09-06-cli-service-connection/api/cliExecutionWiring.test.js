// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-008, 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-009
// REQ-VERSION: v1-hash:7a08fa0c5ef0d0de30c2e6ac387f5cfc7b3534a2baebed30b2dc11edbe6563a9
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.3 块 5, §8 E5/E6, §10.2, §10.4 接口 4, §10.5 决策 1/4, ADR-043
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    const targets = ["claude", "codex", "crwl"];
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
      enabledCliCommands: ["claude"], // 仅 claude 启用，codex 和 crwl 未启用
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

  it("worker 在执行匹配命令时合并对应 CLI 的环境变量，未启用命令不注入", async () => {
    const { resolveCliEnvForCommand } = await loadAgentService();
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
  });
});
