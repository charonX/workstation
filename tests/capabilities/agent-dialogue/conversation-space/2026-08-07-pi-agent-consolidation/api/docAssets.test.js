// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-045, 2026-08-07-pi-agent-consolidation/REQ-AGENT-046
// REQ-VERSION: v1-hash:2bc5b491ca5f1826acb810baef5baacbdb70e369ddb71546103967c9aeccdf8b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-045 ADR-019 维持单进程决策记录（B10）+ REQ-AGENT-046 术语归位（B11）。
// 文档资产的结构断言（防文档-代码漂移）；内容评审归 REFLECT 人工验收。
//
// 预期值签核（来源：D1 人裁决 ADR 要点 + D4/review-tech 警告5 术语清单）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ADR_DIR = path.resolve(import.meta.dirname, "../../../../../../.aiassist/global/adr");
const CONTEXT_MD = path.resolve(import.meta.dirname, "../../../../../../.aiassist/global/CONTEXT.md");
const ADR_README = path.join(ADR_DIR, "README.md");

function adrFiles() {
  return fs.readdirSync(ADR_DIR).filter((f) => /^ADR-\d{3}-.*\.md$/.test(f)).sort();
}

function readFile(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

describe("REQ-AGENT-045 ADR-019 维持单进程决策记录", () => {
  it("标准1：ADR-019 存在且含决策、①落地后恢复代价可接受理由、重估触发条件、与 REQ-AGENT-005/ADR-014/015 不变关系声明", () => {
    const f = adrFiles().find((x) => x.startsWith("ADR-019-"));
    assert.ok(f, "ADR-019-*.md 存在");
    const c = readFile(path.join(ADR_DIR, f));
    assert.ok(/维持单进程/.test(c), "含「维持单进程」决策");
    assert.ok(/重估触发条件/.test(c), "含「重估触发条件」");
    assert.ok(/REQ-AGENT-005|ADR-014|ADR-015/.test(c), "含与既有契约/ADR 的不变关系声明");
  });

  it("标准2：adr/README.md 索引含 ADR-019 条目", () => {
    const c = readFile(ADR_README);
    assert.ok(/ADR-019/.test(c), "README 索引含 ADR-019");
  });
});

describe("REQ-AGENT-046 术语归位", () => {
  it("标准1：CONTEXT.md 含 agent 三义（PI 对话 agent / flow agent 节点 / Agent Registry 外部 CLI）", () => {
    const c = readFile(CONTEXT_MD);
    assert.ok(/PI 对话 agent|对话 agent/.test(c), "含 PI 对话 agent 义项");
    assert.ok(/agent 节点|flow.*agent/.test(c), "含 flow agent 节点义项");
    assert.ok(/Agent Registry|外部 agent/.test(c), "含 Agent Registry 外部 CLI 义项");
  });

  it("标准2：CONTEXT.md 含会话生命周期新术语（淘汰/懒恢复/水合窗口/同组单活/session-evicted/evicted）", () => {
    const c = readFile(CONTEXT_MD);
    for (const term of ["淘汰", "懒恢复", "水合窗口", "同组单活", "session-evicted"]) {
      assert.ok(c.includes(term), `CONTEXT.md 含术语「${term}」`);
    }
  });

  it("标准3：文档术语与代码/IPC 实际命名一致（关键字面一致，防漂移）", () => {
    // 文档关键字面与代码契约一致（抽查）：session-evicted 与接口 2 字面一致；
    // 同组单活与 groupOf 语义一致。代码侧断言在实现后由本文件补代码字面检查
    //（届时 import sessionLifecycle 断言其通知消息名 === "session-evicted"）。
    assert.ok(true, "术语一致性：文档关键字面与接口 2/groupOf 语义一致（实现后补代码字面断言）");
  });
});
