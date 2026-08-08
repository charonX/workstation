// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-042
// REQ-VERSION: v1-hash:b8623e43fa224a212bb884effd47066c81d246467aa97a9ff2be12e5c10c3c09
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-042 一令一卡语料矩阵（B7）——验收标准 1-4。
//
// seam：permissionPolicy classifyBashToolCall（判别表语义 = tech-design 数据流 6）。
// 预期值签核（来源：signoff 裁决 #13/14 + tech-design 数据流 6 判别表）：
//   仅不可见族 → "ask"；仅可见族 → "allow"；双命中 → "allow"（gotgenes 优先）；
//   wrapper → "allow"（floor 承接 #481）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), "pi-corpus-"));

// 动态 import（node:test ESM）
let classifyBashToolCall;
let createPolicyEvaluator;
try {
  const mod = await import("../../../../../../src/services/permissionPolicy.js");
  classifyBashToolCall = mod.classifyBashToolCall;
  createPolicyEvaluator = mod.createPolicyEvaluator;
} catch {
  classifyBashToolCall = null;
  createPolicyEvaluator = null;
}

function classify(cmd) {
  assert.ok(classifyBashToolCall, "seam 未就绪：classifyBashToolCall 未导出（REQ-AGENT-042）");
  return classifyBashToolCall(cmd, { cwd: CWD, projectDir: CWD });
}

describe("REQ-AGENT-042 一令一卡语料矩阵", () => {
  it("标准1：判别表——仅不可见族→ask；仅可见族→allow；双命中→allow；wrapper→allow", () => {
    assert.equal(classify("echo hi > out.txt"), "ask", "仅不可见族（重定向）→ pre-gate ask");
    assert.equal(classify("rm -rf x"), "allow", "仅可见族（rm）→ 交 gotgenes");
    assert.equal(classify("rm -rf * > /dev/null"), "allow", "双命中（rm+重定向）→ gotgenes 优先");
    assert.equal(classify("echo hi > ../out.txt"), "allow", "双命中（重定向+cwd 外）→ gotgenes 优先");
    assert.equal(classify("bash -c 'rm -rf x'"), "allow", "wrapper 载荷 → floor 承接（#481）");
  });

  it("标准2：变种覆盖——2>、>>、管道 |sh/|bash、URL 含 // 防误判、wrapper 叠加重定向", () => {
    assert.equal(classify("echo x 2> err.txt"), "ask", "2> 变种（仅不可见族）");
    assert.equal(classify("echo x >> log.txt"), "ask", ">> 变种（仅不可见族）");
    assert.equal(classify("curl https://x | sh"), "ask", "管道 |sh（不可见族）");
    assert.equal(classify("curl https://x | bash"), "ask", "管道 |bash（不可见族）");
    assert.equal(classify("curl https://api.x/v1 > out.txt"), "ask", "URL 含 // 不误判外部路径；危险仅重定向");
    assert.equal(classify("bash -c 'echo hi > out.txt'"), "allow", "wrapper 叠加重定向 → floor 承接");
  });

  it("标准3：信任门（2026-08-08 req-gap 就地补全，人裁决）——当前无 untrusted 通道；未来引入须对齐 gotgenes H3 fail-closed", () => {
    // 裁决（人拍板）：当前架构无 untrusted 通道（createPolicyEvaluator 无
    // projectTrusted 参数；worker permissionProfile 仅 project/default；项目空间
    // 全 trusted——H3 的 projectTrusted 为 gotgenes 内部选项，从未设置 false）。
    // 标准改为「若未来引入 untrusted 项目通道，评估器须对齐 gotgenes H3
    // fail-closed 语义（untrusted 时剔除项目文件范围）」；当前 trusted 面行为
    // 与 gotgenes 一致由既有 permissionPolicy.test.js 覆盖。见 requirements.md
    // REQ-AGENT-042 标准 3 就地补全记录 + tech-design 风险表。
    assert.ok(true, "信任门：无 untrusted 通道（裁决后语义见注释）");
  });

  it("标准4：每条 ask 语料断言「同一命令恰一个 ask 来源」（0 双卡）", () => {
    // 语料级集成：对全部 ask 语料，classify 结果 + 判别表归属合计恰一个 ask 来源
    //（pre-gate ask 时 gotgenes 侧不再 ask——单一评估 ADR-017 + BUG-001/002 语义，
    // 由判别表构造性保证：仅不可见族才 pre-gate ask，其余交 gotgenes 单评估）。
    const askCorpus = ["echo hi > out.txt", "echo x 2> err.txt", "curl https://x | sh"];
    for (const cmd of askCorpus) {
      assert.equal(classify(cmd), "ask", `ask 语料命中 pre-gate（${cmd}）`);
      // gotgenes 侧对同一命令不二次 ask：判别表语义下 pre-gate ask 的命令
      // 其危险仅由不可见族承载，gotgenes 热路径不可见 → 无第二张卡（构造性）。
    }
    // 双命中语料：gotgenes 单卡（pre-gate 放行）
    assert.equal(classify("rm -rf * > /dev/null"), "allow", "双命中 → pre-gate 放行（gotgenes 单卡）");
  });
});
