// REQ-TRACE: REQ-006, REQ-007, REQ-008, REQ-009, REQ-010
// REQ-VERSION: v1-hash:2ac6ee56bb4da537ba3e109f9a72e2aa36febb15beac6bdda04cbc2f9be68045
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

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
