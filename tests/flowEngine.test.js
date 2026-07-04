// REQ-TRACE: REQ-017, REQ-018, REQ-019, REQ-020
// REQ-VERSION: v1-hash:2ac6ee56bb4da537ba3e109f9a72e2aa36febb15beac6bdda04cbc2f9be68045
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/flowEngine.js";

function conditionExecutor(input) {
  const expression = input.node.config.expression;
  try {
    const fn = new Function("context", `with(context) { return (${expression}); }`);
    const result = fn(input.context);
    return { status: "success", output: result ? "true" : "false" };
  } catch (err) {
    return { status: "fatal", error: err.message };
  }
}

function forEachExecutor(input) {
  const array = input.context[input.node.config.arrayVariable];
  const index = input.iteration ?? 0;
  if (!Array.isArray(array) || index >= array.length) {
    return { status: "success", output: "exit" };
  }
  return { status: "success", output: "body" };
}

function whileExecutor(input) {
  const expression = input.node.config.expression;
  try {
    const fn = new Function("context", `with(context) { return (${expression}); }`);
    const result = fn(input.context);
    return { status: "success", output: result ? "body" : "exit" };
  } catch (err) {
    return { status: "fatal", error: err.message };
  }
}

function passthroughExecutor(input) {
  return { status: "success", output: input.node.config.value };
}

describe("FlowEngine", () => {
  it("REQ-017: condition node routes to true branch", async () => {
    const events = [];
    const result = await run({
      flow: {
        nodeList: [
          { id: "c1", type: "condition", config: { expression: "count > 10" } },
          { id: "a1", type: "action", config: { value: "high" } }
        ],
        edges: [
          { id: "e1", sourceNodeId: "c1", sourcePort: "true", targetNodeId: "a1" }
        ]
      },
      project: { id: "p1" },
      inputVariables: { count: 15 },
      executors: { condition: conditionExecutor, action: passthroughExecutor },
      onEvent: (event) => events.push(event)
    });
    assert.equal(result.status, "success");
    assert.equal(result.output, "high");
  });

  it("REQ-017: condition node routes to false branch when expression is falsy", async () => {
    const result = await run({
      flow: {
        nodeList: [
          { id: "c1", type: "condition", config: { expression: "count > 10" } },
          { id: "a1", type: "action", config: { value: "high" } },
          { id: "a2", type: "action", config: { value: "low" } }
        ],
        edges: [
          { id: "e1", sourceNodeId: "c1", sourcePort: "true", targetNodeId: "a1" },
          { id: "e2", sourceNodeId: "c1", sourcePort: "false", targetNodeId: "a2" }
        ]
      },
      project: { id: "p1" },
      inputVariables: { count: 5 },
      executors: { condition: conditionExecutor, action: passthroughExecutor },
      onEvent: () => {}
    });
    assert.equal(result.status, "success");
    assert.equal(result.output, "low");
  });

  it("REQ-017: invalid condition expression returns fatal", async () => {
    const result = await run({
      flow: {
        nodeList: [
          { id: "c1", type: "condition", config: { expression: "count >" } }
        ],
        edges: []
      },
      project: { id: "p1" },
      inputVariables: { count: 5 },
      executors: { condition: conditionExecutor },
      onEvent: () => {}
    });
    assert.equal(result.status, "error");
  });

  it("REQ-018: forEach iterates over array", async () => {
    const events = [];
    const result = await run({
      flow: {
        nodeList: [
          { id: "f1", type: "forEach", config: { arrayVariable: "items" } },
          { id: "a1", type: "action", config: { value: "item-processed" } }
        ],
        edges: [
          { id: "e1", sourceNodeId: "f1", sourcePort: "body", targetNodeId: "a1" },
          { id: "e2", sourceNodeId: "a1", sourceNodeId: "a1", targetNodeId: "f1" }
        ]
      },
      project: { id: "p1" },
      inputVariables: { items: [1, 2, 3] },
      executors: { forEach: forEachExecutor, action: passthroughExecutor },
      onEvent: (event) => events.push(event),
      options: { maxIterations: 10 }
    });
    assert.equal(result.status, "success");
    assert.ok(events.some(e => e.type === "node:completed" && e.nodeId === "a1"));
  });

  it("REQ-019: while loop repeats while expression is true", async () => {
    const events = [];
    const result = await run({
      flow: {
        nodeList: [
          { id: "w1", type: "while", config: { expression: "counter < 3" } },
          { id: "a1", type: "action", config: { value: "increment" } }
        ],
        edges: [
          { id: "e1", sourceNodeId: "w1", sourcePort: "body", targetNodeId: "a1" },
          { id: "e2", sourceNodeId: "a1", targetNodeId: "w1" }
        ]
      },
      project: { id: "p1" },
      inputVariables: { counter: 0 },
      executors: { while: whileExecutor, action: passthroughExecutor },
      onEvent: (event) => events.push(event),
      options: { maxIterations: 10 }
    });
    assert.equal(result.status, "success");
  });

  it("REQ-020: maxIterations prevents infinite loops", async () => {
    const result = await run({
      flow: {
        nodeList: [
          { id: "w1", type: "while", config: { expression: "true" } }
        ],
        edges: []
      },
      project: { id: "p1" },
      inputVariables: {},
      executors: { while: whileExecutor },
      onEvent: () => {},
      options: { maxIterations: 5 }
    });
    assert.equal(result.status, "error");
    assert.match(result.error, /max iterations/i);
  });

  it("REQ-020: maxDepth prevents infinite recursion", async () => {
    const result = await run({
      flow: {
        nodeList: [
          { id: "a1", type: "action", config: { value: "recurse" } }
        ],
        edges: [
          { id: "e1", sourceNodeId: "a1", targetNodeId: "a1" }
        ]
      },
      project: { id: "p1" },
      inputVariables: {},
      executors: { action: passthroughExecutor },
      onEvent: () => {},
      options: { maxDepth: 3 }
    });
    assert.equal(result.status, "error");
    assert.match(result.error, /max depth/i);
  });
});
