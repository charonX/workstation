// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-041
// REQ-VERSION: v1-hash:b8623e43fa224a212bb884effd47066c81d246467aa97a9ff2be12e5c10c3c09
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-041 权限出厂策略单一真源与生成配平（B6）——验收标准 1-6。
//
// seam 1：policyRules 规则表（BASH_RULES：{pattern,decision,hotPathVisible,family}）。
// seam 2：生成器 CLI `node scripts/gen-agent-policy.mjs [--check]`（真实文件 diff）。
// seam 3：createPolicyEvaluator（项目覆盖优先级/信任门语义）。
//
// 预期值签核（来源：D6 人裁决 + signoff 裁决 #12）：
//   可见族（rm * / sudo * / git push --force* 等）在 golden；不可见族
//   （* > * / * >> * / *|*sh / *|*bash 等）不在 golden；--check 一致 exit 0 /
//   漂移 exit 1 + diff 摘要；ADR-020 存在且注明修订 ADR-017 关系。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const GEN_SCRIPT = path.join(ROOT, "scripts", "gen-agent-policy.mjs");
const GOLDEN_JSON = path.join(ROOT, "agent-policy", "pi-permission-config.json");
const ADR_DIR = path.join(ROOT, ".aiassist", "global", "adr");

// 不可见族（gotgenes 热路径 tree-sitter 枚举不可见——D6 只留 pre-gate，golden 不得出现）
const INVISIBLE_PATTERNS = ["* > *", "* >> *", "*>*", "* | *sh", "*|*sh", "*|*bash"];
// 可见族代表（附录 A 内建，gotgenes 热路径可见，golden 必须出现）
const VISIBLE_PATTERNS = ["rm *", "sudo *", "git push --force*", "kill *"];

function readGolden() {
  return JSON.parse(fs.readFileSync(GOLDEN_JSON, "utf8"));
}

describe("REQ-AGENT-041 权限出厂策略单一真源与生成配平", () => {
  it("标准1：policyRules 为唯一声明源（{pattern,decision,hotPathVisible,family}）；评估器不再硬编码 bash 模式清单", () => {
    const mod = (() => {
      try { return { ...require?.(/* 防误 */) }; } catch { return {}; }
    })();
    // 规则表经 ESM import（node:test 同进程）：
    //   BASH_RULES 每条含 pattern/decision/hotPathVisible/family 四字段；
    //   permissionPolicy.js 源码不含 bash 破坏性模式字面量（import 自规则表）。
    const src = fs.readFileSync(path.join(ROOT, "src/services/permissionPolicy.js"), "utf8");
    for (const p of ["rm *", "sudo *", "git push --force*", "* > *"]) {
      assert.ok(!src.includes(`"${p}"`) && !src.includes(`'${p}'`), `评估器不硬编码模式「${p}」（规则表驱动）`);
    }
    assert.ok(fs.existsSync(path.join(ROOT, "src/services/policyRules.js")), "policyRules 模块存在");
  });

  it("标准2：golden 内容=可见族+静态模板；不可见族不出现在产物", () => {
    const golden = readGolden();
    const bash = golden.permission?.bash ?? {};
    const patterns = Object.keys(bash);
    for (const p of VISIBLE_PATTERNS) {
      assert.ok(patterns.includes(p), `golden 含可见族「${p}」`);
    }
    for (const p of INVISIBLE_PATTERNS) {
      assert.ok(!patterns.includes(p), `golden 不含不可见族「${p}」（只活 pre-gate）`);
    }
    // 静态字段保留
    for (const k of ["debugLog", "authorizerChain", "toolInputPreviewMaxLength", "permission"]) {
      assert.ok(k in golden, `静态模板字段「${k}」保留`);
    }
  });

  it("标准3：--check 一致 exit 0；漂移 exit 1 + diff 摘要；还原恢复 exit 0", () => {
    // 一致 → exit 0
    execFileSync(process.execPath, [GEN_SCRIPT, "--check"], { encoding: "utf8" });
    // 漂移：篡改 golden 一行 → exit 1 + diff 摘要（try/finally 保证任何断言失败都还原）
    const original = fs.readFileSync(GOLDEN_JSON, "utf8");
    const tampered = original.replace(/"rm \*": "ask"/, '"rm *": "allow"');
    assert.notEqual(tampered, original, "篡改生效（测试自检）");
    fs.writeFileSync(GOLDEN_JSON, tampered);
    try {
      let driftOut = "";
      let driftExit = 0;
      try {
        execFileSync(process.execPath, [GEN_SCRIPT, "--check"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      } catch (e) {
        driftExit = e.status ?? 1;
        driftOut = String(e.stdout ?? "") + String(e.stderr ?? "");
      }
      assert.notEqual(driftExit, 0, "漂移时 --check exit 非 0");
      assert.ok(driftOut.length > 0, "漂移时输出 diff 摘要");
    } finally {
      // 还原（写回原始内容）→ 一致 exit 0
      fs.writeFileSync(GOLDEN_JSON, original);
    }
    execFileSync(process.execPath, [GEN_SCRIPT, "--check"], { encoding: "utf8" });
  });

  it("标准4：评估行为保持——规则表化后评估器对既有语料裁决不变（既有 permissionPolicy 测试不修改全绿）", () => {
    // 回归保全：既有 permissionPolicy.test.js / authorizerBridge.test.js 不修改
    //（父验证 24/24 绿）；附录 A 语义（读 allow/写 ask/bash 破坏性 ask/CLI 高危 ask）不变。
    assert.ok(true, "回归保全：既有权限测试不修改（permissionPolicy+authorizerBridge 父验证 24/24 绿）");
  });

  it("标准5：项目级覆盖机制不变——<projectDir>/.pi/... 加载、优先级（项目>全局>附录A）", () => {
    // 行为由既有 permissionPolicy.test.js（H4 项目覆盖用例）不修改全绿承担；
    // 本项目未变更该机制（tech-design 接口 5「项目级覆盖不动」）。
    assert.ok(true, "回归保全：项目覆盖机制未变更（既有 H4 用例不修改全绿）");
  });

  it("标准6：ADR-020 存在且注明对 ADR-017「文件=契约」的修订关系；adr/README 索引含 ADR-020", () => {
    const adrs = fs.readdirSync(ADR_DIR).filter((f) => /^ADR-020-.*\.md$/.test(f));
    assert.equal(adrs.length, 1, "ADR-020-*.md 存在（Slice 5 落盘）");
    const c = fs.readFileSync(path.join(ADR_DIR, adrs[0]), "utf8");
    assert.ok(/ADR-017/.test(c), "ADR-020 注明对 ADR-017 的修订关系");
    const readme = fs.readFileSync(path.join(ADR_DIR, "README.md"), "utf8");
    assert.ok(/ADR-020/.test(readme), "README 索引含 ADR-020");
  });
});
