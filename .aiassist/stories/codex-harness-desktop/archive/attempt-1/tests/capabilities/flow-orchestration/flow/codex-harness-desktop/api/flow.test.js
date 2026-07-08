// REQ-TRACE: codex-harness-desktop/REQ-006, codex-harness-desktop/REQ-007, codex-harness-desktop/REQ-008, codex-harness-desktop/REQ-009, codex-harness-desktop/REQ-010
// REQ-VERSION: v1-hash:2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetFlows,
  createFlow,
  listFlows,
  getFlow,
  getNodeCategories,
  getEditableFields,
  toggleRun,
  zoomIn,
  zoomOut,
  resetZoom
} from "../../../../../../src/flowService.js";

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
    assert.deepEqual(getNodeCategories(), ["Trigger", "Agent", "Data", "Logic", "Output"]);
  });

  it("REQ-009: selected node exposes editable properties", () => {
    assert.equal(getEditableFields({ type: "trigger" }).length, 2);
    assert.deepEqual(getEditableFields({ type: "trigger" }), ["name", "outputVariable"]);
    assert.deepEqual(getEditableFields({ type: "agent" }), ["name", "outputVariable", "model", "systemPrompt"]);
  });

  it("REQ-010: run control toggles running state", () => {
    assert.deepEqual(toggleRun(false), { running: true, label: "Running..." });
    assert.deepEqual(toggleRun(true), { running: false, label: "Run" });
  });

  it("REQ-010: zoom control computes new zoom level", () => {
    assert.equal(zoomIn(1.0), 1.1);
    assert.equal(zoomIn(1.5), 1.5);
    assert.equal(zoomOut(1.0), 0.9);
    assert.equal(zoomOut(0.5), 0.5);
    assert.equal(resetZoom(), 1.0);
  });
});
