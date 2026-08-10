// REQ-TRACE: 2026-08-10-pi-permission-config-ui/REQ-AGENT-069
// REQ-VERSION: v1-hash:4b944146fd166a4f60e5ba65080efefeb75690ff7be837718c867c2d2c01b77d
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 保存即生效（REQ-AGENT-069）：改项目文件后，同一会话内权限评估结果变化——
// 证明"我们保存的文件被运行时正确消费"。
//
// seam：permissionPolicy.createPolicyEvaluator({ cwd: projectDir })——每次调用
// 都执行 loadPermissionRules(projectFile)（源码实证：工厂函数体内读文件），
// 改文件后重新创建 evaluator → 评估按新文件。这是 pre-gate 评估器（worker
// 内授权桥同型消费；gotgenes 侧 T3 实证每次评估 stat 文件，两侧均感知）。
//
// 不选 evaluateBashToolCall 作 seam：它走 classifyBashToolCall（纯函数分类，
// 只兜重定向/管道不可见族，不读项目文件）——rm * 的 ask/allow 文件覆盖
// 它测不到（测试设计修正，2026-08-10）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PI_REL = path.join(".pi", "extensions", "pi-permission-system", "config.json");

async function loadPolicyEvaluator() {
  const mod = await import("../../../../../../src/services/permissionPolicy.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/permissionPolicy.js 尚未实现");
  assert.ok(typeof mod.createPolicyEvaluator === "function", "permissionPolicy 应导出 createPolicyEvaluator");
  return mod.createPolicyEvaluator;
}

describe("REQ-AGENT-069 保存即生效（pre-gate 评估器读项目文件）", () => {
  let workdir;
  let projectDir;
  let createPolicyEvaluator;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-eff-"));
    projectDir = path.join(workdir, "proj");
    fs.mkdirSync(projectDir, { recursive: true });
    createPolicyEvaluator = await loadPolicyEvaluator();
  });

  afterEach(async () => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function writeProjectPolicy(config) {
    const p = path.join(projectDir, PI_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(config, null, 2));
  }

  // 每次新建 evaluator = 模拟运行时每次评估重新读文件（工厂体内 loadPermissionRules）
  function evaluateCommand(command) {
    const evaluator = createPolicyEvaluator({ cwd: projectDir });
    return evaluator.evaluate({ tool: "bash", input: { command } });
  }

  it("REQ-AGENT-069 标准 1：ask → allow（改文件后评估变化，不重启）", async () => {
    // Arrange：项目策略 rm * = ask（与全局一致），基线评估应为 ask
    await writeProjectPolicy({ permission: { bash: { "rm *": "ask" } } });
    const before = evaluateCommand("rm file.txt");
    assert.equal(before, "ask", "基线：rm * 应评估为 ask");

    // Act：模拟 UI 保存（改文件 rm * → allow）
    await writeProjectPolicy({ permission: { bash: { "rm *": "allow" } } });

    // Assert：改文件后（无重启 worker）评估变化
    // TODO: HUMAN ASSERTION — 确认改文件后评估立即变 allow
    const after = evaluateCommand("rm file.txt");
    assert.equal(after, "allow", "保存后评估应变 allow");
  });

  it("REQ-AGENT-069 标准 2：allow → ask（反向）", async () => {
    await writeProjectPolicy({ permission: { bash: { "rm *": "allow" } } });
    const before = evaluateCommand("rm file.txt");
    assert.equal(before, "allow", "基线：rm * 应评估为 allow");

    await writeProjectPolicy({ permission: { bash: { "rm *": "ask" } } });

    const after = evaluateCommand("rm file.txt");
    assert.equal(after, "ask", "保存后评估应变 ask");
  });

  it("REQ-AGENT-069 标准 3：未覆盖字段回落全局（写文件只含覆盖项仍正确合并）", async () => {
    // 项目文件只写 rm *（最小覆盖集），sudo 未写 → 回落全局 ask（附录 A 内建）
    await writeProjectPolicy({ permission: { bash: { "rm *": "allow" } } });
    const sudo = evaluateCommand("sudo ls /");
    // TODO: HUMAN ASSERTION — 确认 sudo 未覆盖 → 全局（附录 A）ask
    assert.equal(sudo, "ask", "未覆盖字段应回落全局（ask）");
  });
});
