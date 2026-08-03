// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-006, 2026-08-02-builtin-agent/REQ-AGENT-007
// REQ-VERSION: v1-hash:1a95cf23677ba5e4cea1a2eb2157896aeef22713b6de03f9c5119c49f3830e2b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// seam：agent 适配层（fauxProvider 注入，H3 假设）+ 内存版 IPC 快速路径。
// 对话回路不真调 DeepSeek/Kimi——所有测试经脚本化 provider（等价于 pi-ai fauxProvider，
// signoff H3 已证 registerNativeProvider + model 注入）驱动，零网络。

// seam：agentService（tech-design「agentService（主进程）」+ signoff 事件契约）。
// 建议落点 src/services/agentService.js，导出 createAgentService({ inMemory: true }) →
// svc.createSession({ spaceKey, provider, identity? }) → session（on("session-event")），
// svc.prompt(spaceKey, text)。session-event 序列对齐签核事件契约：
// text_delta.delta / text_end.content / tool_execution_*（name/status）/ error（code/userMessage）。
async function loadDialogueAdapter() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-006/007）");
  assert.equal(typeof mod.createAgentService, "function", "agentService 应导出 createAgentService()");
  return mod.createAgentService;
}

describe("REQ-AGENT-006 对话回路与流式事件", () => {
  it("prompt → faux LLM → 回复经 session-event 回传", async () => {
    const createAgentService = await loadDialogueAdapter();
    const svc = createAgentService({ inMemory: true });
    const events = [];
    const session = svc.createSession({
      spaceKey: "feishu:oc_1",
      provider: {
        async respond() {
          return [
            { type: "text_delta", delta: "执行" },
            { type: "text_delta", delta: "列表：" },
            { type: "text_end", content: "执行列表：共 3 条" }
          ];
        }
      }
    });
    session.on("session-event", (e) => events.push(e));
    await svc.prompt("feishu:oc_1", "列出今天的任务");
    assert.equal(events.filter((e) => e.type === "text_delta").length, 2, "增量事件应全部回传");
    const final = events.find((e) => e.type === "text_end");
    assert.ok(final, "应有 text_end 事件");
    assert.equal(final.content, "执行列表：共 3 条", "回复文本应经 session-event 回传（text_end.content）");
    assert.equal(events[0].type, "text_delta", "增量事件应按序回传");
  });

  it("同空间并发 prompt 排队串行；跨空间并行互不阻塞", async () => {
    const createAgentService = await loadDialogueAdapter();
    const svc = createAgentService({ inMemory: true });
    // A 空间慢（100ms），B 空间快（20ms）。
    const slowA = {
      async respond() { await new Promise((r) => setTimeout(r, 100)); return [{ type: "text_end", content: "A 回复" }]; }
    };
    const fastB = {
      async respond() { await new Promise((r) => setTimeout(r, 20)); return [{ type: "text_end", content: "B 回复" }]; }
    };
    const sessionA = svc.createSession({ spaceKey: "feishu:oc_a", provider: slowA });
    const sessionB = svc.createSession({ spaceKey: "feishu:oc_b", provider: fastB });
    const completed = [];
    sessionA.on("session-event", (e) => { if (e.type === "text_end") completed.push("A"); });
    sessionB.on("session-event", (e) => { if (e.type === "text_end") completed.push("B"); });
    const pA = svc.prompt("feishu:oc_a", "任务一");
    const pB = svc.prompt("feishu:oc_b", "任务二");
    await Promise.all([pA, pB]);
    assert.equal(completed.filter((c) => c === "A").length, 1, "A 空间应完成");
    assert.equal(completed.filter((c) => c === "B").length, 1, "B 空间应完成");
    assert.ok(completed.indexOf("B") < completed.indexOf("A"),
      `慢空间 A 未完成时 B 应已并行完成（跨空间互不阻塞），完成序: ${completed.join(",")}`);

    // 同空间排队串行：A2 空间两连发（不 await 第一发），应按到达顺序完成（streamingBehavior: followUp）。
    const order = [];
    let n = 0;
    const seqProvider = {
      async respond() {
        n += 1;
        if (n === 1) await new Promise((r) => setTimeout(r, 50));
        return [{ type: "text_end", content: `第${n}发` }];
      }
    };
    const seqSession = svc.createSession({ spaceKey: "feishu:oc_a2", provider: seqProvider });
    seqSession.on("session-event", (e) => { if (e.type === "text_end") order.push(e.content); });
    const p1 = svc.prompt("feishu:oc_a2", "第一发");
    const p2 = svc.prompt("feishu:oc_a2", "第二发");
    await Promise.all([p1, p2]);
    assert.deepEqual(order, ["第1发", "第2发"], "同空间并发 prompt 应排队串行（按到达顺序处理）");
  });

  it("流式增量事件（text_delta）按序回传", async () => {
    const createAgentService = await loadDialogueAdapter();
    const svc = createAgentService({ inMemory: true });
    const deltas = ["执行", "列表", "如下：", "3 条"];
    const session = svc.createSession({
      spaceKey: "feishu:oc_1",
      provider: {
        async respond() {
          return [
            ...deltas.map((d) => ({ type: "text_delta", delta: d })),
            { type: "text_end", content: deltas.join("") }
          ];
        }
      }
    });
    const received = [];
    session.on("session-event", (e) => { if (e.type === "text_delta") received.push(e.delta); });
    await svc.prompt("feishu:oc_1", "测试流式");
    assert.deepEqual(received, deltas, "text_delta 应按序完整回传（无乱序/丢帧，REQ-AGENT-006 标准 3）");
    const final = received.length;
    assert.equal(final, deltas.length, "不应丢帧");
  });

  it("工具调用事件含工具名与状态", async () => {
    const createAgentService = await loadDialogueAdapter();
    const svc = createAgentService({ inMemory: true });
    const session = svc.createSession({
      spaceKey: "feishu:oc_1",
      provider: {
        async respond() {
          return [
            { type: "tool_execution_start", name: "task list", status: "running" },
            { type: "tool_execution_end", name: "task list", status: "completed" },
            { type: "text_end", content: "完成" }
          ];
        }
      }
    });
    const toolEvents = [];
    session.on("session-event", (e) => { if (e.type.startsWith("tool_execution")) toolEvents.push(e); });
    await svc.prompt("feishu:oc_1", "查看任务");
    assert.ok(toolEvents.length >= 2, `应回传 tool_execution_* 事件，实际 ${toolEvents.length} 条`);
    for (const e of toolEvents) {
      assert.equal(e.name, "task list", "工具事件应含工具名");
      assert.ok(typeof e.status === "string" && e.status.length > 0, "工具事件应含状态（REQ-AGENT-006 标准 4）");
    }
  });

  it("单条 IPC 消息 ≤ 256KB，超限截断或降级文件引用", async () => {
    const createAgentService = await loadDialogueAdapter();
    const svc = createAgentService({ inMemory: true });
    const big = "x".repeat(300 * 1024); // 300KB > 256KB（签核决策 15）
    const session = svc.createSession({
      spaceKey: "feishu:oc_1",
      provider: {
        async respond() {
          return [{ type: "text_end", content: big }];
        }
      }
    });
    const events = [];
    session.on("session-event", (e) => events.push(e));
    await svc.prompt("feishu:oc_1", "超长输出");
    assert.ok(events.length >= 1, "应有事件回传");
    for (const e of events) {
      const size = JSON.stringify(e).length;
      assert.ok(size <= 256 * 1024, `单条 session-event 应 ≤ 256KB，实际 ${size} bytes`);
    }
    // 超限消息应带降级标记（截断或文件引用）。
    const final = events.find((e) => e.type === "text_end") ?? events.at(-1);
    assert.ok(final.truncated === true || final.fileRef, "超限消息应截断或降级为文件引用");
  });
});

describe("REQ-AGENT-007 LLM 错误结构化", () => {
  it("供应商失败 → 错误消息回传，会话存活可继续", async () => {
    const createAgentService = await loadDialogueAdapter();
    const svc = createAgentService({ inMemory: true });
    let first = true;
    const session = svc.createSession({
      spaceKey: "feishu:oc_1",
      provider: {
        async respond() {
          if (first) {
            first = false;
            return { error: { code: "E-AGENT-LLM-FAIL", reason: "provider timeout" } };
          }
          return [{ type: "text_end", content: "恢复后回复" }];
        }
      }
    });
    const errors = [];
    session.on("session-event", (e) => { if (e.type === "error") errors.push(e); });
    await svc.prompt("feishu:oc_1", "第一次");
    const errEvent = errors[0];
    assert.ok(errEvent, "失败应回传错误事件");
    assert.ok(JSON.stringify(errEvent).includes("E-AGENT-LLM-FAIL"), "错误事件应含 E-AGENT-LLM-FAIL（透传原因）");
    assert.ok(JSON.stringify(errEvent).includes("provider timeout"), "应透传供应商失败原因");
    // 进程不崩、会话存活可继续（REQ-AGENT-007 标准 1）。
    const secondEvents = [];
    session.on("session-event", (e) => secondEvents.push(e));
    await svc.prompt("feishu:oc_1", "第二次");
    assert.ok(secondEvents.some((e) => e.type === "text_end" && e.content === "恢复后回复"), "下一条 prompt 应正常");
  });

  it("重试语义（408/409/429/5xx）与耗尽路径", async () => {
    const createAgentService = await loadDialogueAdapter();
    const svc = createAgentService({ inMemory: true });
    // 两次 429 后成功（pi 内置重试语义生效，REQ-AGENT-007 标准 2）。
    let calls = 0;
    const retried = svc.createSession({
      spaceKey: "feishu:oc_1",
      provider: {
        async respond() {
          calls += 1;
          if (calls <= 2) return { error: { code: "E-AGENT-LLM-FAIL", status: 429, reason: "rate limited" } };
          return [{ type: "text_end", content: "重试后成功" }];
        }
      }
    });
    retried.on("session-event", () => {});
    const replyEvents = [];
    retried.on("session-event", (e) => { if (e.type === "text_end") replyEvents.push(e); });
    await svc.prompt("feishu:oc_1", "触发重试");
    assert.ok(calls >= 3, `应发生重试（实际调用 ${calls} 次）`);
    assert.ok(replyEvents.some((e) => e.content === "重试后成功"), "429 重试后应成功");

    // 一直失败 → 重试耗尽后进入错误消息路径（会话不崩）。
    const exhausted = svc.createSession({
      spaceKey: "feishu:oc_2",
      provider: {
        async respond() {
          return { error: { code: "E-AGENT-LLM-FAIL", status: 429, reason: "rate limited" } };
        }
      }
    });
    const errors = [];
    exhausted.on("session-event", (e) => { if (e.type === "error") errors.push(e); });
    await svc.prompt("feishu:oc_2", "一直失败");
    assert.ok(errors.length >= 1, "重试耗尽应进入错误消息路径");
    assert.ok(JSON.stringify(errors[0]).includes("E-AGENT-LLM-FAIL"), "耗尽后错误应结构化（E-AGENT-LLM-FAIL）");
  });

  it("错误响应含用户文案与内部错误码", async () => {
    const createAgentService = await loadDialogueAdapter();
    const svc = createAgentService({ inMemory: true });
    const session = svc.createSession({
      spaceKey: "feishu:oc_1",
      provider: {
        async respond() {
          return { error: { code: "E-AGENT-LLM-FAIL", reason: "quota exceeded" } };
        }
      }
    });
    const errors = [];
    session.on("session-event", (e) => { if (e.type === "error") errors.push(e); });
    await svc.prompt("feishu:oc_1", "触发错误");
    const errEvent = errors[0];
    assert.ok(errEvent, "应有错误事件");
    assert.ok(typeof errEvent.userMessage === "string" && errEvent.userMessage.length > 0,
      "错误应含用户可展示文案（REQ-AGENT-007 标准 3）");
    assert.ok(typeof errEvent.code === "string" && errEvent.code.startsWith("E-AGENT-"),
      `错误应含内部错误码（E-AGENT-*），实际: ${errEvent.code}`);
    assert.notEqual(errEvent.userMessage, errEvent.code, "用户文案与内部错误码应区分（业务/系统错误）");
  });
});
