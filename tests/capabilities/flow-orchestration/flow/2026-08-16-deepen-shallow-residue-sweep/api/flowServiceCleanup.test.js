// REQ-TRACE: REQ-FLOW-059
// REQ-VERSION: v1-hash:f255c1918d40e06767b8129157cdcde68091d02015b0b577fa7c03b449fa5d8f
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// EXPECTED-TRACE: prd.md §6.1 row 5 + §10.1 设计目标 6
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as flowService from "../../../../../../src/services/flowService.js";

describe("REQ-FLOW-059 清理 flowService 废弃 UI 计算助手", () => {
  it("AC1: flowService 不再导出前端 UI 缩放与画布计算助手", () => {
    // EXPECTED-TRACE: prd.md §10.1
    const deprecatedFunctions = [
      "toggleRun",
      "zoomIn",
      "zoomOut",
      "resetZoom",
      "getNodeCategories",
      "getEditableFields"
    ];

    for (const fn of deprecatedFunctions) {
      assert.equal(
        flowService[fn],
        undefined,
        `flowService 必须删除废弃 UI 助手: ${fn}`
      );
    }
  });

  it("AC2: flowService 保留核心服务端 Flow CRUD 与校验能力", () => {
    // EXPECTED-TRACE: prd.md §6.1 row 5
    assert.equal(typeof flowService.createFlow, "function", "必须保留 createFlow");
    assert.equal(typeof flowService.getFlow, "function", "必须保留 getFlow");
    assert.equal(typeof flowService.updateFlow, "function", "必须保留 updateFlow");
    assert.equal(typeof flowService.deleteFlow, "function", "必须保留 deleteFlow");
    assert.equal(typeof flowService.listFlows, "function", "必须保留 listFlows");
    assert.equal(typeof flowService.publishFlow, "function", "必须保留 publishFlow");
    assert.equal(typeof flowService.validateNodeList, "function", "必须保留 validateNodeList");
  });
});
