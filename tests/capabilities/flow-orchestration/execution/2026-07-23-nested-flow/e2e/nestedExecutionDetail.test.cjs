// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-044
// REQ-VERSION: v2.2-hash:b496ef72731fba3105a49d3185d3ca6f430dae96b9cf22e358cf2a2fd589f104
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

const { test, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject, createFlow } = require("../../../../../e2e/helpers/seed.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

// data-testid 约定（实现阶段加在 UI 元素上）：
//   palette-node-flowInput / palette-node-callFlow           — 节点面板按钮
//   execution-row                                            — 现有，历史列表行
//   execution-detail-panel                                   — 现有，详情面板容器
//   execution-detail-node-<nodeId>                           — 详情内每个节点行
//   execution-node-status-<nodeId>                           — 节点状态徽标/标签（data-status="success|error"）
//   execution-callflow-expand-<nodeId>                       — callFlow 节点行上的展开按钮
//   execution-callflow-children-<nodeId>                     — 展开后子节点容器（缩进样式）

async function seedNestedFlow(apiBaseUrl, projectId, name = "parent", childName = "child") {
  const child = await createFlow(apiBaseUrl, { name: childName, projectId, nodeList: [
    { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
    { id: "agt", type: "agent", config: { outputVariable: "echo", prompt: "{{cin.msg}}" } },
    { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
  ], edges: [
    { sourceNodeId: "cin", targetNodeId: "agt" },
    { sourceNodeId: "agt", targetNodeId: "out" }
  ]});
  const parent = await createFlow(apiBaseUrl, { name, projectId, nodeList: [
    { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "hello-e2e" }] } },
    { id: "call", type: "callFlow", config: {
      targetFlowId: child.id, targetInputNodeId: "cin",
      inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
      outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
    }}
  ], edges: [
    { sourceNodeId: "t", targetNodeId: "call" }
  ]});
  return { parent, child };
}

async function runFlow(apiBaseUrl, projectId, flowId) {
  const res = await fetch(`${apiBaseUrl}/api/executions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flowId, projectId })
  });
  return res.json();
}

async function openExecutionDetail(firstWindow, executionId) {
  // T-8 适配（2026-08-06）：默认落地 = 会话区——管理区左导不可直达；直接 goto
  // 执行页路由（管理区壳，AC5）；断言语义不变。
  await goToAdminRoute(firstWindow, "#/executions");
  await firstWindow.locator(locators.EXECUTION_ROW).filter({ hasText: executionId }).first().click();
  await expect(firstWindow.locator(locators.EXECUTION_DETAIL_PANEL)).toBeVisible();
  // 成功执行默认落在产物 tab（ExecutionDetail 行为）；节点行在节点 tab 下
  await firstWindow.getByTestId("nodes-tab").click();
}

async function waitForStatus(apiBaseUrl, executionId, targetStatus, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`${apiBaseUrl}/api/executions/${executionId}`);
    const d = await r.json();
    if (d.status === targetStatus) return d;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`execution ${executionId} did not reach ${targetStatus}`);
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
    const exec = await runFlow(apiBaseUrl, project.id, parent.id);
    await waitForStatus(apiBaseUrl, exec.id, "success");
    await openExecutionDetail(firstWindow, exec.id);
    await expect(firstWindow.getByTestId("execution-detail-node-call")).toBeVisible();
    await expect(firstWindow.getByTestId("execution-callflow-expand-call")).toBeVisible();
  });

  test("REQ-FLOW-044 AC2: expand reveals child nodes indented under callFlow", async () => {
    const project = await createProject(apiBaseUrl, { name: "Detail2", localPath: `${userDataDir}/ws/detail2` });
    const { parent } = await seedNestedFlow(apiBaseUrl, project.id);
    const exec = await runFlow(apiBaseUrl, project.id, parent.id);
    await waitForStatus(apiBaseUrl, exec.id, "success");
    await openExecutionDetail(firstWindow, exec.id);
    await expect(firstWindow.getByTestId("execution-callflow-children-call")).not.toBeVisible();
    await firstWindow.getByTestId("execution-callflow-expand-call").click();
    const children = firstWindow.getByTestId("execution-callflow-children-call");
    await expect(children).toBeVisible();
    await expect(children.getByTestId("execution-detail-node-cin")).toBeVisible();
    await expect(children.getByTestId("execution-detail-node-out")).toBeVisible();
    assert.equal(await children.getAttribute("data-indent"), "1");
  });

  test("REQ-FLOW-044 AC3: three levels of nesting all expandable (depth 0/1/2)", async () => {
    const project = await createProject(apiBaseUrl, { name: "Detail3", localPath: `${userDataDir}/ws/detail3` });
    const gc = await createFlow(apiBaseUrl, { name: "gc", projectId: project.id, nodeList: [
      { id: "gin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
      { id: "gagt", type: "agent", config: { outputVariable: "x", prompt: "{{gin.x}}" } },
      { id: "gout", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } }
    ], edges: [
      { sourceNodeId: "gin", targetNodeId: "gagt" }, { sourceNodeId: "gagt", targetNodeId: "gout" }
    ]});
    const p = await createFlow(apiBaseUrl, { name: "p", projectId: project.id, nodeList: [
      { id: "pin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
      { id: "pcall", type: "callFlow", config: {
        targetFlowId: gc.id, targetInputNodeId: "gin",
        inputMappings: [{ childVar: "x", parentExpr: "{{pin.msg}}" }],
        outputMappings: [{ childVar: "x", parentKey: "pcall.x" }]
      }},
      { id: "pagt", type: "agent", config: { outputVariable: "echo", prompt: "{{pcall.x}}" } },
      { id: "pout", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
    ], edges: [
      { sourceNodeId: "pin", targetNodeId: "pcall" },
      { sourceNodeId: "pcall", targetNodeId: "pagt" },
      { sourceNodeId: "pagt", targetNodeId: "pout" }
    ]});
    const gp = await createFlow(apiBaseUrl, { name: "gp", projectId: project.id, nodeList: [
      { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "deep" }] } },
      { id: "call", type: "callFlow", config: {
        targetFlowId: p.id, targetInputNodeId: "pin",
        inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
        outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
      }}
    ], edges: [{ sourceNodeId: "t", targetNodeId: "call" }]});

    const exec = await runFlow(apiBaseUrl, project.id, gp.id);
    await waitForStatus(apiBaseUrl, exec.id, "success");
    await openExecutionDetail(firstWindow, exec.id);

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

    assert.equal(await pChildren.getAttribute("data-indent"), "1");
    assert.equal(await gcChildren.getAttribute("data-indent"), "2");
  });

  test("REQ-FLOW-044 AC4: failed child surfaces error state on parent callFlow", async () => {
    const project = await createProject(apiBaseUrl, { name: "Detail4", localPath: `${userDataDir}/ws/detail4` });
    const child = await createFlow(apiBaseUrl, { name: "badchild", projectId: project.id, nodeList: [
      { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
      // provider=anthropic 走 claudeAgentAdapter；项目 localPath 在磁盘上不存在（seed 不落盘），
      // validateProjectPath 在调用 SDK 前返回确定性 error（离线可复现）。未知 provider 会被
      // 服务端 validateAgentConfig 400 拒绝，无法经 API 落库，故用 anthropic 路径制造失败。
      { id: "bad", type: "agent", config: { provider: "anthropic", outputVariable: "echo", prompt: "{{cin.msg}}", retries: 0 } }
    ], edges: [{ sourceNodeId: "cin", targetNodeId: "bad" }]});
    const parent = await createFlow(apiBaseUrl, { name: "errparent", projectId: project.id, nodeList: [
      { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "x" }] } },
      { id: "call", type: "callFlow", config: {
        targetFlowId: child.id, targetInputNodeId: "cin",
        inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
        outputMappings: [], retries: 0
      }}
    ], edges: [{ sourceNodeId: "t", targetNodeId: "call" }]});

    const exec = await runFlow(apiBaseUrl, project.id, parent.id);
    await waitForStatus(apiBaseUrl, exec.id, "error");
    await openExecutionDetail(firstWindow, exec.id);
    const callStatus = firstWindow.getByTestId("execution-node-status-call");
    await expect(callStatus).toHaveAttribute("data-status", "error");
    await firstWindow.getByTestId("execution-callflow-expand-call").click();
    const children = firstWindow.getByTestId("execution-callflow-children-call");
    await expect(children).toBeVisible();
    const badStatus = children.getByTestId("execution-node-status-bad");
    await expect(badStatus).toHaveAttribute("data-status", "error");
  });

  test("REQ-FLOW-044 AC5: multiple callFlow nodes expand independently", async () => {
    const project = await createProject(apiBaseUrl, { name: "Detail5", localPath: `${userDataDir}/ws/detail5` });
    const c1 = await createFlow(apiBaseUrl, { name: "c1", projectId: project.id, nodeList: [
      { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
      { id: "cagt", type: "agent", config: { outputVariable: "x", prompt: "{{cin.x}}" } },
      { id: "cout", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } }
    ], edges: [{ sourceNodeId: "cin", targetNodeId: "cagt" }, { sourceNodeId: "cagt", targetNodeId: "cout" }]});
    const c2 = await createFlow(apiBaseUrl, { name: "c2", projectId: project.id, nodeList: [
      { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
      { id: "cagt", type: "agent", config: { outputVariable: "x", prompt: "{{cin.x}}" } },
      { id: "cout", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } }
    ], edges: [{ sourceNodeId: "cin", targetNodeId: "cagt" }, { sourceNodeId: "cagt", targetNodeId: "cout" }]});
    const parent = await createFlow(apiBaseUrl, { name: "parent2", projectId: project.id, nodeList: [
      { id: "t", type: "trigger", config: { outputVariables: [{ name: "branch", defaultValue: "a" }] } },
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
    ], edges: [
      { sourceNodeId: "t", targetNodeId: "call1" },
      { sourceNodeId: "call1", targetNodeId: "call2" }
    ]});

    const exec = await runFlow(apiBaseUrl, project.id, parent.id);
    await waitForStatus(apiBaseUrl, exec.id, "success");
    await openExecutionDetail(firstWindow, exec.id);

    await firstWindow.getByTestId("execution-callflow-expand-call1").click();
    await expect(firstWindow.getByTestId("execution-callflow-children-call1")).toBeVisible();
    await expect(firstWindow.getByTestId("execution-callflow-children-call2")).not.toBeVisible();

    await firstWindow.getByTestId("execution-callflow-expand-call2").click();
    await expect(firstWindow.getByTestId("execution-callflow-children-call2")).toBeVisible();
    await expect(firstWindow.getByTestId("execution-callflow-children-call1")).toBeVisible();

    await firstWindow.getByTestId("execution-callflow-expand-call1").click();
    await expect(firstWindow.getByTestId("execution-callflow-children-call1")).not.toBeVisible();
    await expect(firstWindow.getByTestId("execution-callflow-children-call2")).toBeVisible();
  });
});
