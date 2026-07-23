// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-044
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { test, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow } = require("../../../../../e2e/helpers/seed.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

// data-testid 约定（实现阶段加在 UI 元素上）：
//   palette-node-flowInput / palette-node-callFlow           — 节点面板按钮
//   execution-row                                            — 现有，历史列表行
//   execution-detail-panel                                   — 现有，详情面板容器
//   execution-detail-node-<nodeId>                           — 详情内每个节点行
//   execution-node-status-<nodeId>                           — 节点状态徽标/标签（data-status="success|error"）
//   execution-callflow-expand-<nodeId>                       — callFlow 节点行上的展开按钮
//   execution-callflow-children-<nodeId>                     — 展开后子节点容器（缩进样式）

// 构造父子 fixture（子通过 test agent executor 或确定性节点返回，不触达真实 LLM）
// 注意：E2E 不 mock executor，使用最简单的 pass-through 子流程：
//   child: flowInput(cin, msg) → flowOutput(out, echo=msg)
//   parent: trigger(t, msg="hi") → callFlow(call, child, msg→cin.msg, echo→call.echo)
// 需要一个 agent 节点把 cin.msg 写到 echo 供 flowOutput 收集——为了不触达 LLM，
// implementer 可以在 test build 中给 agent 注入一个 echo executor（参考 taskService.testAgentExecutor 机制），
// 或者使用条件节点/直接让 flowOutput 从 cin.msg 读（flowOutput executor 从 context 读同名 key）。
async function seedNestedFlow(apiBaseUrl, projectId, name = "parent", childName = "child") {
  const child = await createFlow(apiBaseUrl, projectId, childName, [
    { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
    // 子流程简单直传：cin.msg 直接作为 out.echo 返回
    // 实现上 flowOutput executor 会从 context 读 bare `msg` key（由 cin 通过 TRIGGER_LIKE 播种），
    // 所以 out 的 outputVariables 声明 `echo` 但实际值在 context["msg"]——
    // 为了让 flowOutput 正确返回，编排者用 agent 节点把 msg 写到 echo；E2E 中 test agent 直传。
    { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "{{cin.msg}}" } },
    { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
  ], [
    { sourceNodeId: "cin", targetNodeId: "agt" },
    { sourceNodeId: "agt", targetNodeId: "out" }
  ]);
  const parent = await createFlow(apiBaseUrl, projectId, name, [
    { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "hello-e2e" }] } },
    { id: "call", type: "callFlow", config: {
      targetFlowId: child.id, targetInputNodeId: "cin",
      inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
      outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
    }}
  ], [
    { sourceNodeId: "t", targetNodeId: "call" }
  ]);
  return { parent, child };
}

async function openExecutionDetail(firstWindow, executionId) {
  await firstWindow.click(locators.EXECUTIONS_LINK);
  await firstWindow.locator(locators.EXECUTION_ROW).filter({ hasText: executionId }).first().click();
  await expect(firstWindow.locator(locators.EXECUTION_DETAIL_PANEL)).toBeVisible();
}

test.describe("Nested Execution Detail", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp();
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("REQ-FLOW-044 AC1: callFlow node shows expand affordance when __childExecutionId present", async () => {
    const project = await createProject(apiBaseUrl, { name: "Detail1", localPath: `${userDataDir}/ws/detail1` });
    const { parent } = await seedNestedFlow(apiBaseUrl, project.id);

    // 手动触发父流程执行
    const runRes = await fetch(`${apiBaseUrl}/api/executions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: parent.id })
    });
    const exec = await runRes.json();

    // 等待执行完成（E2E 等待策略：轮询 execution status）
    await expect(async () => {
      const r = await fetch(`${apiBaseUrl}/api/executions/${exec.id}`);
      const d = await r.json();
      if (d.status !== "success") throw new Error(`still ${d.status}`);
    }).toPass({ timeout: 15000 });

    await openExecutionDetail(firstWindow, exec.id);

    // 父 call 节点行可见，展开按钮可见
    await expect(firstWindow.getByTestId("execution-detail-node-call")).toBeVisible();
    await expect(firstWindow.getByTestId("execution-callflow-expand-call")).toBeVisible();
  });

  test("REQ-FLOW-044 AC2: expand reveals child nodes indented under callFlow", async () => {
    const project = await createProject(apiBaseUrl, { name: "Detail2", localPath: `${userDataDir}/ws/detail2` });
    const { parent } = await seedNestedFlow(apiBaseUrl, project.id);

    const runRes = await fetch(`${apiBaseUrl}/api/executions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: parent.id })
    });
    const exec = await runRes.json();
    await expect(async () => {
      const r = await fetch(`${apiBaseUrl}/api/executions/${exec.id}`);
      const d = await r.json();
      if (d.status !== "success") throw new Error(`still ${d.status}`);
    }).toPass({ timeout: 15000 });

    await openExecutionDetail(firstWindow, exec.id);

    // 初始子容器不可见
    await expect(firstWindow.getByTestId("execution-callflow-children-call")).not.toBeVisible();

    // 点展开
    await firstWindow.getByTestId("execution-callflow-expand-call").click();

    // 子容器出现，内含子流程节点
    const children = firstWindow.getByTestId("execution-callflow-children-call");
    await expect(children).toBeVisible();
    await expect(children.getByTestId("execution-detail-node-cin")).toBeVisible();
    await expect(children.getByTestId("execution-detail-node-out")).toBeVisible();

    // 子容器有缩进（通过 data-indent 属性或 padding-left 样式验证，不测具体像素）
    const indent = await children.getAttribute("data-indent");
    assert.equal(indent, "1");
  });

  test("REQ-FLOW-044 AC3: three levels of nesting all expandable (depth 0/1/2)", async () => {
    // 构造 3 层：gp → p → gc
    const project = await createProject(apiBaseUrl, { name: "Detail3", localPath: `${userDataDir}/ws/detail3` });
    const gc = await createFlow(apiBaseUrl, project.id, "gc", [
      { id: "gin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
      { id: "gagt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "x", prompt: "{{gin.x}}" } },
      { id: "gout", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } }
    ], [
      { sourceNodeId: "gin", targetNodeId: "gagt" }, { sourceNodeId: "gagt", targetNodeId: "gout" }
    ]);
    const p = await createFlow(apiBaseUrl, project.id, "p", [
      { id: "pin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
      { id: "pcall", type: "callFlow", config: {
        targetFlowId: gc.id, targetInputNodeId: "gin",
        inputMappings: [{ childVar: "x", parentExpr: "{{pin.msg}}" }],
        outputMappings: [{ childVar: "x", parentKey: "pcall.x" }]
      }},
      { id: "pagt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "{{pcall.x}}" } },
      { id: "pout", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
    ], [
      { sourceNodeId: "pin", targetNodeId: "pcall" },
      { sourceNodeId: "pcall", targetNodeId: "pagt" },
      { sourceNodeId: "pagt", targetNodeId: "pout" }
    ]);
    const gp = await createFlow(apiBaseUrl, project.id, "gp", [
      { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "deep" }] } },
      { id: "call", type: "callFlow", config: {
        targetFlowId: p.id, targetInputNodeId: "pin",
        inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
        outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
      }}
    ], [{ sourceNodeId: "t", targetNodeId: "call" }]);

    const runRes = await fetch(`${apiBaseUrl}/api/executions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: gp.id })
    });
    const exec = await runRes.json();
    await expect(async () => {
      const r = await fetch(`${apiBaseUrl}/api/executions/${exec.id}`);
      const d = await r.json();
      if (d.status !== "success") throw new Error(`still ${d.status}`);
    }).toPass({ timeout: 15000 });

    await openExecutionDetail(firstWindow, exec.id);

    // 展开 gp.call → p.pcall → gc
    await firstWindow.getByTestId("execution-callflow-expand-call").click();
    const pChildren = firstWindow.getByTestId("execution-callflow-children-call");
    await expect(pChildren).toBeVisible();
    await expect(pChildren.getByTestId("execution-detail-node-pcall")).toBeVisible();
    await expect(pChildren.getByTestId("execution-callflow-expand-pcall")).toBeVisible();

    await pChildren.getByTestId("execution-callflow-expand-pcall").click();
    const gcChildren = firstWindow.getByTestId("execution-callflow-children-pcall");
    await expect(gcChildren).toBeVisible();
    await expect(gcChildren.getByTestId("execution-detail-node-gin")).toBeVisible();
    await expect(gcChildren.getByTestId("execution-detail-node-gout")).toBeVisible();

    // 缩进级别
    assert.equal(await pChildren.getAttribute("data-indent"), "1");
    assert.equal(await gcChildren.getAttribute("data-indent"), "2");
  });

  test("REQ-FLOW-044 AC4: failed child surfaces error state on parent callFlow; expand shows failed node", async () => {
    const project = await createProject(apiBaseUrl, { name: "Detail4", localPath: `${userDataDir}/ws/detail4` });
    // 子流程故意让 agent 失败（bad provider 或 expression 触发 error）
    const child = await createFlow(apiBaseUrl, project.id, "badchild", [
      { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
      { id: "bad", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "{{cin.msg}}", retries: 0 } }
    ], [{ sourceNodeId: "cin", targetNodeId: "bad" }]);
    const parent = await createFlow(apiBaseUrl, project.id, "errparent", [
      { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "x" }] } },
      { id: "call", type: "callFlow", config: {
        targetFlowId: child.id, targetInputNodeId: "cin",
        inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
        outputMappings: [],
        retries: 0
      }}
    ], [{ sourceNodeId: "t", targetNodeId: "call" }]);

    const runRes = await fetch(`${apiBaseUrl}/api/executions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: parent.id })
    });
    const exec = await runRes.json();
    await expect(async () => {
      const r = await fetch(`${apiBaseUrl}/api/executions/${exec.id}`);
      const d = await r.json();
      if (d.status !== "error") throw new Error(`still ${d.status}`);
    }).toPass({ timeout: 15000 });

    await openExecutionDetail(firstWindow, exec.id);

    // 父 call 节点状态为 error
    const callStatus = firstWindow.getByTestId("execution-node-status-call");
    await expect(callStatus).toHaveAttribute("data-status", "error");
    await expect(callStatus).toContainText(/error|失败/i);

    // 展开可见子失败节点
    await firstWindow.getByTestId("execution-callflow-expand-call").click();
    const children = firstWindow.getByTestId("execution-callflow-children-call");
    await expect(children).toBeVisible();
    const badStatus = children.getByTestId("execution-node-status-bad");
    await expect(badStatus).toHaveAttribute("data-status", "error");
    await expect(badStatus).toContainText(/error|失败/i);
  });

  test("REQ-FLOW-044 AC5: multiple callFlow nodes expand independently", async () => {
    const project = await createProject(apiBaseUrl, { name: "Detail5", localPath: `${userDataDir}/ws/detail5` });
    // 两个独立子流程
    const c1 = await createFlow(apiBaseUrl, project.id, "c1", [
      { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
      { id: "cout", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } },
      { id: "cagt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "x", prompt: "{{cin.x}}" } }
    ], [{ sourceNodeId: "cin", targetNodeId: "cagt" }, { sourceNodeId: "cagt", targetNodeId: "cout" }]);
    const c2 = await createFlow(apiBaseUrl, project.id, "c2", [
      { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
      { id: "cout", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } },
      { id: "cagt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "x", prompt: "{{cin.x}}" } }
    ], [{ sourceNodeId: "cin", targetNodeId: "cagt" }, { sourceNodeId: "cagt", targetNodeId: "cout" }]);

    // 父：trigger → condition 分支到 call1 / call2
    const parent = await createFlow(apiBaseUrl, project.id, "parent2", [
      { id: "t", type: "trigger", config: { outputVariables: [{ name: "branch", defaultValue: "a" }] } },
      { id: "cond", type: "condition", config: { expression: "t.branch === 'a'" } },
      { id: "call1", type: "callFlow", config: {
        targetFlowId: c1.id, targetInputNodeId: "cin",
        inputMappings: [{ childVar: "x", parentExpr: "{{t.branch}}" }],
        outputMappings: []
      }},
      { id: "call2", type: "callFlow", config: {
        targetFlowId: c2.id, targetInputNodeId: "cin",
        inputMappings: [{ childVar: "x", parentExpr: "{{t.branch}}" }],
        outputMappings: []
      }}
    ], [
      { sourceNodeId: "t", targetNodeId: "cond" },
      // 两个 callFlow 都连在 condition 后——通过两条 unconditional 边，简化
      { sourceNodeId: "cond", targetNodeId: "call1" },
      { sourceNodeId: "call1", targetNodeId: "call2" }
    ]);

    const runRes = await fetch(`${apiBaseUrl}/api/executions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: parent.id })
    });
    const exec = await runRes.json();
    await expect(async () => {
      const r = await fetch(`${apiBaseUrl}/api/executions/${exec.id}`);
      const d = await r.json();
      if (d.status !== "success") throw new Error(`still ${d.status}`);
    }).toPass({ timeout: 15000 });

    await openExecutionDetail(firstWindow, exec.id);

    // 展开 call1 → call1 子女可见
    await firstWindow.getByTestId("execution-callflow-expand-call1").click();
    await expect(firstWindow.getByTestId("execution-callflow-children-call1")).toBeVisible();

    // call2 子女尚未展开
    await expect(firstWindow.getByTestId("execution-callflow-children-call2")).not.toBeVisible();

    // 展开 call2 → 两者都可见
    await firstWindow.getByTestId("execution-callflow-expand-call2").click();
    await expect(firstWindow.getByTestId("execution-callflow-children-call2")).toBeVisible();
    await expect(firstWindow.getByTestId("execution-callflow-children-call1")).toBeVisible();

    // 收起 call1 → call1 子女隐藏，call2 仍显示
    await firstWindow.getByTestId("execution-callflow-expand-call1").click();
    await expect(firstWindow.getByTestId("execution-callflow-children-call1")).not.toBeVisible();
    await expect(firstWindow.getByTestId("execution-callflow-children-call2")).toBeVisible();
  });
});
