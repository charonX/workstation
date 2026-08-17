// REQ-TRACE: 2026-08-16-deepen-turn-event-pipeline/REQ-AGENT-110
// REQ-VERSION: v2-hash:ce30bc5a5b38a48fb78ab31fd56d388918e59094597535cdedd97028604f5d15
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// 256KB 截断单真源 + 主进程行为修复（ADR-029 决策 5，人拍板 Q2）。
//
// seam 1（单元）：limitSize 从 turnEventPipeline 模块直接 import——四分支直测
//   （≤ 原样 / content / delta / 工具 input|output 迭代收紧保契约字段 / 无载体兜底）。
// seam 2（集成）：agentService inMemory 内核（createAgentService({inMemory:true})，
//   agentDialogue.test.js 同构先例）——脚本化 provider 返回超限事件经 runTurn 出口
//   （原 enforceSizeLimit 调用点 346）→ 断言主进程侧不再整条降级（工具事件保契约
//   字段）+ 文本事件行为不变。
//
// 背景：worker.js:529-530 注释实证主进程旧 enforceSizeLimit 无工具数据载体分支——
//   工具事件超限整条降级 {type, truncated} 丢 toolCallId/name/status/isError。
//   单源后 agentService 三调用点（248/346/963）import limitSize。
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const pipelineMod = await import("../../../../../../src/agent/turnEventPipeline.js").catch(() => null);
const agentMod = await import("../../../../../../src/services/agentService.js").catch(() => null);

const MAX = 262144; // EXPECTED-TRACE: prd.md §6.3-6/7（MAX_IPC_BYTES = 256×1024 = 262144）
const big = (n, ch = "x") => ch.repeat(n);
const textEndOf = (content) => ({ type: "text_end", content });
const toolEndOf = (output, input) => ({
  type: "tool_execution_end",
  name: "settings get",
  status: "completed",
  toolCallId: "call_42",
  output,
  input,
  isError: false,
});

function loadLimitSize() {
  assert.ok(pipelineMod, "seam 未就绪：src/agent/turnEventPipeline.js 尚未实现（REQ-AGENT-110，ADR-029）");
  assert.equal(typeof pipelineMod.limitSize, "function", "应导出 limitSize");
  assert.equal(pipelineMod.MAX_IPC_BYTES, MAX, "MAX_IPC_BYTES 应导出 262144（单真源常量）");
  return pipelineMod.limitSize;
}

describe("REQ-AGENT-110 256KB 截断单真源——limitSize 四分支直测（单元）", () => {
  const limitSize = loadLimitSize();

  it("AC1：≤ 262144 原样返回（行为等价即可，review 修订：不约束引用同一性）", () => {
    const ev = textEndOf("小文本");
    const out = limitSize(ev);
    // EXPECTED-TRACE: prd.md §10.4 接口 7（≤ 原样返回——契约承诺行为语义不承诺引用）
    assert.deepEqual(out, ev, "小事件应原样返回（形状相等）");
    assert.equal(out.truncated, undefined, "不应有 truncated 字段");
  });

  it("AC2：content=300KB → content 截断 + truncated:true + 序列化 ≤ 262144", () => {
    // EXPECTED-TRACE: prd.md §6.3-7
    const out = limitSize(textEndOf(big(300 * 1024)));
    assert.equal(out.truncated, true, "应标 truncated");
    assert.ok(out.content.length < 300 * 1024, "content 应被截断");
    assert.ok(JSON.stringify(out).length <= MAX, `出站 JSON 应 ≤ ${MAX}，实际 ${JSON.stringify(out).length}`);
  });

  it("AC3：delta=300KB → delta 截断 + truncated:true", () => {
    const out = limitSize({ type: "text_delta", delta: big(300 * 1024) });
    assert.equal(out.truncated, true);
    assert.ok(out.delta.length < 300 * 1024, "delta 应被截断");
    assert.ok(JSON.stringify(out).length <= MAX);
  });

  it("AC4：工具事件 300KB output → 保 toolCallId/name/status/isError + output 截断 + truncated:true（迭代收紧）", () => {
    // EXPECTED-TRACE: prd.md §6.3-6（工具事件保契约字段，worker.js:524-538 迭代收紧语义）
    const out = limitSize(toolEndOf(big(300 * 1024)));
    assert.equal(out.type, "tool_execution_end", "type 保留");
    assert.equal(out.name, "settings get", "name 保留");
    assert.equal(out.status, "completed", "status 保留");
    assert.equal(out.toolCallId, "call_42", "toolCallId 保留（旧实现整条降级会丢）");
    assert.equal(out.isError, false, "isError 保留");
    assert.equal(out.truncated, true);
    assert.ok(out.output.length < 300 * 1024, "output 数据载体应被截断");
    assert.ok(JSON.stringify(out).length <= MAX, `出站 JSON 应恒 ≤ ${MAX}，实际 ${JSON.stringify(out).length}`);
  });

  it("AC4b：工具事件 input 载体同样迭代收紧（优先 input）", () => {
    const out = limitSize(toolEndOf("small", big(300 * 1024)));
    assert.equal(out.toolCallId, "call_42");
    assert.equal(out.output, "small", "output 未超限不动");
    assert.ok(out.input.length < 300 * 1024, "input 应被截断");
    assert.equal(out.truncated, true);
    assert.ok(JSON.stringify(out).length <= MAX);
  });

  it("AC5：无载体字段的超限事件 → {type, truncated:true} 兜底（保持现状）", () => {
    const out = limitSize({ type: "weird_event", payload: big(300 * 1024) });
    assert.deepEqual(out, { type: "weird_event", truncated: true }, "无载体分支应整条降级保 type");
  });
});

describe("REQ-AGENT-110 截断单真源——agentService 出口行为（集成，inMemory 内核）", () => {
  it("AC6：inMemory runTurn 出口——超限工具事件保契约字段（主进程侧不再整条降级）", async () => {
    assert.ok(agentMod, "seam 未就绪：src/services/agentService.js");
    const svc = agentMod.createAgentService({ inMemory: true });
    const events = [];
    const session = svc.createSession({
      spaceKey: "feishu:oc_1",
      provider: {
        async respond() {
          return [toolEndOf(big(300 * 1024))];
        },
      },
    });
    session.on("session-event", (e) => events.push(e));
    await svc.prompt("feishu:oc_1", "触发超限工具事件");
    assert.equal(events.length, 1, "应出站 1 条 session-event");
    const ev = events[0];
    // EXPECTED-TRACE: prd.md §6.3-6 + §8（主进程兜底超限）+ §10.5（截断取强，人拍板 Q2）
    assert.equal(ev.type, "tool_execution_end");
    assert.equal(ev.name, "settings get", "name 保留（旧 enforceSizeLimit 会丢）");
    assert.equal(ev.status, "completed", "status 保留");
    assert.equal(ev.toolCallId, "call_42", "toolCallId 保留");
    assert.equal(ev.isError, false, "isError 保留");
    assert.equal(ev.truncated, true);
    assert.ok(ev.output.length < 300 * 1024);
    assert.ok(JSON.stringify(ev).length <= MAX, `出站应 ≤ ${MAX}，实际 ${JSON.stringify(ev).length}`);
  });

  it("AC7：inMemory runTurn 出口——超限文本 text_end → content 截断 + truncated（文本行为与旧实现等价）", async () => {
    const svc = agentMod.createAgentService({ inMemory: true });
    const events = [];
    const session = svc.createSession({
      spaceKey: "feishu:oc_2",
      provider: {
        async respond() {
          return [textEndOf(big(300 * 1024))];
        },
      },
    });
    session.on("session-event", (e) => events.push(e));
    await svc.prompt("feishu:oc_2", "触发超限文本事件");
    assert.equal(events.length, 1);
    const ev = events[0];
    assert.equal(ev.type, "text_end");
    assert.equal(ev.truncated, true, "文本事件超限应截断");
    assert.ok(ev.content.length < 300 * 1024);
    assert.ok(JSON.stringify(ev).length <= MAX);
  });
});
