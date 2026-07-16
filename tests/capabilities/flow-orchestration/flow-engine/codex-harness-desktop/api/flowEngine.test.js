// REQ-TRACE: codex-harness-desktop/REQ-FLOW-007, codex-harness-desktop/REQ-FLOW-008, codex-harness-desktop/REQ-FLOW-009, codex-harness-desktop/REQ-FLOW-010
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("FlowEngine", () => {
  it("REQ-FLOW-007: condition node routes to true branch", async () => {
    const result = await run({
      nodes: [{ id: "cond", type: "Condition", config: { expression: "1 + 1 === 2" } }],
      edges: []
    }, { maxIterations: 10, maxDepth: 10 });
    assert.equal(result.branch, "true");
  });

  it("REQ-FLOW-007: condition node routes to false branch when expression is falsy", async () => {
    const result = await run({
      nodes: [{ id: "cond", type: "Condition", config: { expression: "false" } }],
      edges: []
    }, { maxIterations: 10, maxDepth: 10 });
    assert.equal(result.branch, "false");
  });

  it("REQ-FLOW-007: invalid condition expression returns fatal", async () => {
    await assert.rejects(async () => await run({
      nodes: [{ id: "cond", type: "Condition", config: { expression: "not valid js" } }],
      edges: []
    }, { maxIterations: 10, maxDepth: 10 }), /fatal/i);
  });

  it("REQ-FLOW-008: forEach iterates over array", async () => {
    const result = await run({
      nodes: [{ id: "loop", type: "ForEach", config: { array: "[1,2,3]" } }],
      edges: []
    }, { maxIterations: 10, maxDepth: 10 });
    assert.equal(result.iterations, 3);
  });

  it("REQ-FLOW-009: while loop repeats while expression is true", async () => {
    const result = await run({
      nodes: [{ id: "loop", type: "While", config: { expression: "ctx.count < 3" } }],
      edges: []
    }, { maxIterations: 10, maxDepth: 10 }, { count: 0 });
    assert.equal(result.iterations, 3);
  });

  it("REQ-FLOW-010: maxIterations prevents infinite loops", async () => {
    await assert.rejects(async () => await run({
      nodes: [{ id: "loop", type: "While", config: { expression: "true" } }],
      edges: []
    }, { maxIterations: 5, maxDepth: 10 }), /maxIterations/i);
  });

  it("BUG-014: trigger node has a pass-through executor", async () => {
    const result = await run({
      nodeList: [{ id: "t1", type: "trigger", name: "Manual" }],
      edges: []
    }, { maxIterations: 10, maxDepth: 10 });
    assert.equal(result.status, "success");
    assert.equal(result.nodesRun, 1);
  });
});
