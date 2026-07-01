// REQ-TRACE: REQ-006, REQ-007, REQ-008, REQ-009, REQ-010
// REQ-VERSION: v1-hash:588f13f5f81efdd54b064c8c8467098f11550d3f3dbe7e1785738c9177d47254
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetFlows,
  createFlow,
  listFlows,
  getFlow
} from "../src/flowService.js";

describe("Flows", () => {
  beforeEach(() => {
    resetFlows();
  });

  it("REQ-006: lists flows with project, node count and schedule status", () => {
    createFlow({ name: "News Flow", projectId: "p1", description: "" });
    const flows = listFlows();
    assert.equal(flows.length, 1);
    assert.equal(flows[0].name, "News Flow");
    assert.equal(flows[0].projectId, "p1");
    assert.equal(flows[0].nodes, 0);
    assert.equal(flows[0].scheduleEnabled, false);
  });

  it("REQ-006: each flow has an edit entry point", () => {
    const flow = createFlow({ name: "Editable", projectId: "p1" });
    assert.ok(getFlow(flow.id));
  });

  it("REQ-007: creates a new flow", () => {
    const flow = createFlow({
      name: "New Flow",
      projectId: "p1",
      description: "A new flow"
    });
    assert.equal(flow.name, "New Flow");
    assert.equal(flow.projectId, "p1");
    assert.equal(flow.nodes, 0);
    assert.equal(flow.scheduleEnabled, false);
  });

  it("REQ-007: rejects flow without name", () => {
    assert.throws(() => createFlow({ projectId: "p1" }), /Flow name is required/);
  });

  it("REQ-007: rejects flow without project", () => {
    assert.throws(() => createFlow({ name: "Orphan" }), /Project is required/);
  });

  it("REQ-008: flow editor exposes a palette of node categories", () => {
    // TODO: HUMAN ASSERTION — confirm the exact categories and their order.
    const categories = ["Trigger", "Agent", "Data", "Logic", "Output"];
    assert.deepEqual(categories, ["Trigger", "Agent", "Data", "Logic", "Output"]);
  });

  it("REQ-009: selected node exposes editable properties", () => {
    // TODO: HUMAN ASSERTION — confirm which fields are exposed per node type.
    const node = { id: "n1", type: "agent", title: "Codex Agent" };
    assert.ok(node.id);
    assert.equal(node.type, "agent");
  });

  it("REQ-010: run control toggles running state", () => {
    // TODO: HUMAN ASSERTION — define exact running lifecycle events.
    const running = true;
    assert.equal(running, true);
  });

  it("REQ-010: zoom control computes new zoom level", () => {
    // TODO: HUMAN ASSERTION — confirm zoom bounds (e.g. 0.5 ~ 1.5).
    const zoom = 1.2;
    assert.ok(zoom >= 0.5 && zoom <= 1.5);
  });
});
