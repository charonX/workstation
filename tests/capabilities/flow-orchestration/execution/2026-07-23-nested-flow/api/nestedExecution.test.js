// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-040, 2026-07-23-nested-flow/REQ-FLOW-039
// REQ-VERSION: v2.2-hash:b496ef72731fba3105a49d3185d3ca6f430dae96b9cf22e358cf2a2fd589f104
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { setAgentExecutorForTests } from "../../../../../../src/services/executionRunner.js";
import { purgeExpiredExecutions } from "../../../../../../src/services/taskService.js";
import { getDb } from "../../../../../../src/db.js";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Simple echo agent: returns {{...}} substituted prompt as output so tests can map values deterministically.
// Returns agent detail (prompt/output/model/provider) so copyAgentDetail persists it to record.
function echoAgentExecutor({ node }) {
  const prompt = node.config?.prompt ?? "";
  return {
    status: "success",
    output: prompt,
    logs: [],
    agent: { prompt, output: prompt, model: node.config?.model ?? "echo", provider: node.config?.provider ?? "echo", durationMs: 0 }
  };
}

async function createPair(serverBase, projectId, childName = "child", parentName = "parent") {
  // child: flowInput(cin: msg) → agent(writes "echo") → flowOutput(out: echo)
  // agent prompt is "{{cin.msg}}" so echo agent returns that value → writes to outputVariable "echo"
  const childRes = await fetch(`${serverBase}/api/flows`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: childName, projectId, status: "published",
      nodeList: [
        { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "{{cin.msg}}" } },
        { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
      ],
      edges: [
        { sourceNodeId: "cin", targetNodeId: "agt" },
        { sourceNodeId: "agt", targetNodeId: "out" }
      ]
    })
  });
  const child = await childRes.json();
  const parentRes = await fetch(`${serverBase}/api/flows`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: parentName, projectId, status: "published",
      nodeList: [
        { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "hello-e2e" }] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.id, targetInputNodeId: "cin",
          inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
          outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
        }}
      ],
      edges: [{ sourceNodeId: "t", targetNodeId: "call" }]
    })
  });
  const parent = await parentRes.json();
  return { parent, child };
}

describe("REQ-FLOW-040: 嵌套执行记录", () => {
  let serverCtx;
  let project;

  beforeEach(async () => {
    setAgentExecutorForTests(echoAgentExecutor);
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nested", localPath: "~/opc-workspace/nested" })
    });
    project = await res.json();
  });

  afterEach(async () => {
    setAgentExecutorForTests(null);
    await stopServer(serverCtx);
  });

  async function runFlow(flowId, variables = {}) {
    const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId, projectId: project.id, variables })
    });
    return res.json();
  }

  async function waitFor(executionId, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${serverCtx.baseUrl}/api/executions/${executionId}`);
      if (res.status === 200) {
        const data = await res.json();
        if (data.status === "success" || data.status === "error") return data;
      }
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${executionId}`);
  }

  it("AC1: migration 在已有数据上不报错；顶层 execution depth=0、parentExecutionId=NULL", async () => {
    const flowRes = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "simple", projectId: project.id, status: "published",
        nodeList: [{ id: "t", type: "trigger", config: { outputVariables: [] } }], edges: [] })
    });
    const flow = await flowRes.json();
    const exec = await runFlow(flow.id);
    const result = await waitFor(exec.id);
    assert.equal(result.status, "success");
    assert.equal(result.depth, 0);
    assert.equal(result.parentExecutionId, null);
  });

  it("AC2/AC3: 子流程 execution 记录 trigger=subflow、parentExecutionId/parentNodeId/depth 正确", async () => {
    const { parent, child } = await createPair(serverCtx.baseUrl, project.id);
    const exec = await runFlow(parent.id, {});
    await waitFor(exec.id);

    const listRes = await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`);
    assert.equal(listRes.status, 200);
    const children = await listRes.json();
    assert.equal(children.length, 1);
    const childExec = children[0];
    assert.equal(childExec.trigger, "subflow");
    assert.equal(childExec.parentExecutionId, exec.id);
    assert.equal(childExec.parentNodeId, "call");
    assert.equal(childExec.depth, 1);
    assert.equal(childExec.flowId, child.id);
  });

  it("AC4: 父 callFlow 节点含 __childExecutionId；子 execution 有其 nodes", async () => {
    const { parent } = await createPair(serverCtx.baseUrl, project.id);
    const exec = await runFlow(parent.id, {});
    await waitFor(exec.id);

    const parentDetail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${exec.id}`)).json();
    const callNode = parentDetail.nodes.find(n => n.nodeId === "call");
    assert.ok(callNode);
    const children = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`)).json();
    assert.equal(callNode.outputVariables["call.__childExecutionId"], children[0].id);

    const childDetail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${children[0].id}`)).json();
    assert.ok(Array.isArray(childDetail.nodes));
    assert.ok(childDetail.nodes.some(n => n.nodeId === "cin"));
    assert.ok(childDetail.nodes.some(n => n.nodeId === "out"));
  });

  it("AC5: GET 列表支持 parentExecutionId 过滤；3 层嵌套 depth=0/1/2", async () => {
    // grandchild
    const gcRes = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "gc", projectId: project.id, status: "published",
        nodeList: [
          { id: "gin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
          { id: "gagt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "x", prompt: "{{gin.x}}" } },
          { id: "gout", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } }
        ],
        edges: [{ sourceNodeId: "gin", targetNodeId: "gagt" }, { sourceNodeId: "gagt", targetNodeId: "gout" }]
      })
    });
    const gc = await gcRes.json();
    // parent (mid)
    const pRes = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "mid", projectId: project.id, status: "published",
        nodeList: [
          { id: "pin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
          { id: "pcall", type: "callFlow", config: {
            targetFlowId: gc.id, targetInputNodeId: "gin",
            inputMappings: [{ childVar: "x", parentExpr: "{{pin.msg}}" }],
            outputMappings: [{ childVar: "x", parentKey: "pcall.x" }]
          }},
          { id: "pagt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "{{pcall.x}}" } },
          { id: "pout", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
        ],
        edges: [
          { sourceNodeId: "pin", targetNodeId: "pcall" },
          { sourceNodeId: "pcall", targetNodeId: "pagt" },
          { sourceNodeId: "pagt", targetNodeId: "pout" }
        ]
      })
    });
    const mid = await pRes.json();
    // grandparent
    const gpRes = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "gp", projectId: project.id, status: "published",
        nodeList: [
          { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "deep" }] } },
          { id: "call", type: "callFlow", config: {
            targetFlowId: mid.id, targetInputNodeId: "pin",
            inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
            outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
          }}
        ],
        edges: [{ sourceNodeId: "t", targetNodeId: "call" }]
      })
    });
    const gp = await gpRes.json();

    const exec = await runFlow(gp.id);
    await waitFor(exec.id);

    const midList = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`)).json();
    assert.equal(midList.length, 1);
    assert.equal(midList[0].depth, 1);
    assert.equal(midList[0].parentNodeId, "call");

    const gcList = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${midList[0].id}`)).json();
    assert.equal(gcList.length, 1);
    assert.equal(gcList[0].depth, 2);
    assert.equal(gcList[0].parentNodeId, "pcall");
    assert.equal(gcList[0].flowId, gc.id);
  });

  it("AC6: purgeExpiredExecutions 删除父时级联删除子/孙", async () => {
    // 通过将 retentionDays 设为 0 触发清理——调用现有 service 方法或 API
    // 简单验证：直接 import purgeExpiredExecutions 并调用。
    // 这里使用 fetch 调管理接口的方式可能不存在；退而求其次，先验证子 execution 与父通过 parentExecutionId 关联，
    // 级联删除逻辑在 taskService.purgeExpiredExecutions 实现（递归 CTE），由单元覆盖。
    const { parent } = await createPair(serverCtx.baseUrl, project.id, "child-purge", "parent-purge");
    const exec = await runFlow(parent.id);
    await waitFor(exec.id);
    const children = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`)).json();
    assert.equal(children.length, 1);
    // 级联删除通过 service 层递归 CTE 验证。purgeExpiredExecutions(db, {retentionDays:0})
    purgeExpiredExecutions(getDb(), { retentionDays: 0 });
    const parentAfter = await fetch(`${serverCtx.baseUrl}/api/executions/${exec.id}`);
    assert.equal(parentAfter.status, 404);
    const childAfter = await fetch(`${serverCtx.baseUrl}/api/executions/${children[0].id}`);
    assert.equal(childAfter.status, 404);
  });
});

describe("REQ-FLOW-039: 运行时加载子流程最新版本", () => {
  let serverCtx;
  let project;

  beforeEach(async () => {
    setAgentExecutorForTests(echoAgentExecutor);
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Latest", localPath: "~/opc-workspace/latest" })
    });
    project = await res.json();
  });

  afterEach(async () => {
    setAgentExecutorForTests(null);
    await stopServer(serverCtx);
  });

  it("AC1/AC2: 子流程修改后父执行看到新版本（不重新发布父）", async () => {
    const childRes = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "child-v", projectId: project.id, status: "published",
        nodeList: [
          { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
          { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "v1" } },
          { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
        ],
        edges: [{ sourceNodeId: "cin", targetNodeId: "agt" }, { sourceNodeId: "agt", targetNodeId: "out" }]
      })
    });
    const child = await childRes.json();
    const parentRes = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "parent-v", projectId: project.id, status: "published",
        nodeList: [
          { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "hi" }] } },
          { id: "call", type: "callFlow", config: {
            targetFlowId: child.id, targetInputNodeId: "cin",
            inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
            outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
          }}
        ],
        edges: [{ sourceNodeId: "t", targetNodeId: "call" }]
      })
    });
    const parent = await parentRes.json();

    async function runAndGetChildAgentPrompt(parentId) {
      const exec = await (await fetch(`${serverCtx.baseUrl}/api/executions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId: parentId, projectId: project.id })
      })).json();
      const r = await (async function waitFor(id, ms = 10000) {
        const start = Date.now();
        while (Date.now() - start < ms) {
          const res = await fetch(`${serverCtx.baseUrl}/api/executions/${id}`);
          const d = await res.json();
          if (d.status === "success" || d.status === "error") return d;
          await sleep(100);
        }
      })(exec.id);
      const children = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`)).json();
      const childDetail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${children[0].id}`)).json();
      const agt = childDetail.nodes.find(n => n.nodeId === "agt");
      assert.ok(agt, "child agent node present");
      // prompt is at agt.prompt (flat, not nested under agent.*)
      return agt.prompt;
    }

    const prompt1 = await runAndGetChildAgentPrompt(parent.id);
    assert.equal(prompt1, "v1");

    // patch 子 flow — agent prompt 改为 "v2"（当前版本，不发布）
    await fetch(`${serverCtx.baseUrl}/api/flows/${child.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeList: [
          { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
          { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "v2" } },
          { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
        ],
        edges: [{ sourceNodeId: "cin", targetNodeId: "agt" }, { sourceNodeId: "agt", targetNodeId: "out" }]
      })
    });

    const prompt2 = await runAndGetChildAgentPrompt(parent.id);
    assert.equal(prompt2, "v2", "子 flow 修改后父再次执行应看到新版本 prompt");
  });
});
