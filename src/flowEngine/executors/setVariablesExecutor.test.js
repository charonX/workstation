// TDD unit test for setVariablesExecutor (implementation tool, not business contract)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setVariablesExecutor } from "./setVariablesExecutor.js";

describe("setVariablesExecutor (TDD)", () => {
  it("returns success with outputVariables from assignments evaluated against context", async () => {
    const node = {
      id: "sv1",
      config: {
        assignments: [{ variableName: "greeting", expression: "hello" }]
      }
    };
    const result = await setVariablesExecutor({ node, context: {} });
    assert.equal(result.status, "success");
    assert.deepEqual(result.outputVariables, { greeting: "hello" });
    assert.ok(Array.isArray(result.logs));
  });

  it("evaluates single {{var}} references and preserves types", async () => {
    const node = {
      id: "sv",
      config: {
        assignments: [
          { variableName: "n", expression: "{{num}}" },
          { variableName: "o", expression: "{{obj}}" },
          { variableName: "a", expression: "{{arr}}" },
          { variableName: "f", expression: "{{flag}}" }
        ]
      }
    };
    const context = { num: 42, obj: { k: "v" }, arr: [1, 2, 3], flag: true };
    const result = await setVariablesExecutor({ node, context });
    assert.strictEqual(result.outputVariables.n, 42);
    assert.deepEqual(result.outputVariables.o, { k: "v" });
    assert.deepEqual(result.outputVariables.a, [1, 2, 3]);
    assert.strictEqual(result.outputVariables.f, true);
  });

  it("supports dot-path references {{a.b.c}}", async () => {
    const node = {
      id: "sv",
      config: {
        assignments: [{ variableName: "url", expression: "{{resp.data.url}}" }]
      }
    };
    const context = { "resp.data.url": "http://x.test/path", resp: { data: { url: "http://x.test/path" } } };
    const result = await setVariablesExecutor({ node, context });
    assert.equal(result.outputVariables.url, "http://x.test/path");
  });

  it("returns empty outputVariables for empty/missing assignments", async () => {
    const node1 = { id: "sv", config: { assignments: [] } };
    const r1 = await setVariablesExecutor({ node: node1, context: {} });
    assert.deepEqual(r1.outputVariables, {});
    assert.equal(r1.status, "success");

    const node2 = { id: "sv", config: {} };
    const r2 = await setVariablesExecutor({ node: node2, context: {} });
    assert.deepEqual(r2.outputVariables, {});
  });

  it("supports string concatenation {{a}} {{b}}", async () => {
    const node = {
      id: "sv",
      config: {
        assignments: [{ variableName: "full", expression: "{{first}} {{last}}" }]
      }
    };
    const context = { first: "John", last: "Doe" };
    const result = await setVariablesExecutor({ node, context });
    assert.equal(result.outputVariables.full, "John Doe");
  });
});
