// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-040, 2026-07-23-nested-flow/REQ-FLOW-039
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe("REQ-FLOW-040: 嵌套执行记录 (parentExecutionId/parentNodeId/depth)", () => {
  let serverCtx;
  let project;

  beforeEach(async () => {
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nested", localPath: "~/opc-workspace/nested" })
    });
    project = await res.json();
  });

  afterEach(async () => { await stopServer(serverCtx); });

  async function createFlow(name, nodeList, edges) {
    const res = await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, projectId: project.id, nodeList, edges, status: "published" })
    });
    return res.json();
  }

  async function runFlow(flowId, variables = {}) {
    const res = await fetch(`${serverCtx.baseUrl}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId, variables })
    });
    return res.json();
  }

  async function waitForExecution(executionId, timeoutMs = 3000) {
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
    const flow = await createFlow("simple", [
      { id: "t", type: "trigger", config: { outputVariables: [] } }
    ], []);
    const exec = await runFlow(flow.id);
    const result = await waitForExecution(exec.id);
    assert.equal(result.status, "success");
    assert.equal(result.depth, 0);
    assert.equal(result.parentExecutionId, null);
  });

  it("AC2/AC3: 子流程 execution 记录 trigger=subflow、parentExecutionId/parentNodeId/depth 正确", async () => {
    // 此测试依赖 callFlow 真实执行（invokeSubflow）；属于集成测试
    // 构造父子 flow：父 feishuMessage → callFlow → 子 flowInput → flowOutput
    // 然后跑父，断言子 execution 字段正确
    // 注：因为 invokeSubflow 内联执行，父 run 返回时子已完成；等待父完成后查询
    const child = await createFlow("child",
      [
        { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
        { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } },
        // 中间一个 pass-through agent 把 cin.msg 写到 echo
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "{{cin.msg}}" } }
      ],
      [
        { sourceNodeId: "cin", targetNodeId: "agt" },
        { sourceNodeId: "agt", targetNodeId: "out" }
      ]
    );
    const parent = await createFlow("parent",
      [
        { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "hello" }] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.id, targetInputNodeId: "cin",
          inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
          outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
        }}
      ],
      [{ sourceNodeId: "t", targetNodeId: "call" }]
    );
    const exec = await runFlow(parent.id, {});
    const parentResult = await waitForExecution(exec.id);
    assert.equal(parentResult.status, "success");

    // 查子 execution：按 parentExecutionId 列子
    const listRes = await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`);
    assert.equal(listRes.status, 200);
    const children = await listRes.json();
    assert.ok(Array.isArray(children));
    assert.equal(children.length, 1);
    const childExec = children[0];
    assert.equal(childExec.trigger, "subflow");
    assert.equal(childExec.parentExecutionId, exec.id);
    assert.equal(childExec.parentNodeId, "call");
    assert.equal(childExec.depth, 1);
    assert.equal(childExec.flowId, child.id);
  });

  // Helper: 构造一个父调子的最简 pair，返回 {parent, child}
  async function createParentChildPair({ childResult = "child-output" } = {}) {
    const child = await createFlow("child",
      [
        { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "{{cin.msg}}" } },
        { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
      ],
      [
        { sourceNodeId: "cin", targetNodeId: "agt" },
        { sourceNodeId: "agt", targetNodeId: "out" }
      ]
    );
    const parent = await createFlow("parent",
      [
        { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "hello" }] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.id, targetInputNodeId: "cin",
          inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
          outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
        }}
      ],
      [{ sourceNodeId: "t", targetNodeId: "call" }]
    );
    // 需要 stub agent executor 让 child.agt 确定性返回 childResult 而不触达真实 LLM
    // 注：本测试依赖真实 invokeSubflow；agent 节点实际会触达 LLM，需要在 server 启动时注入 test agent executor
    // 如 serverCtx 不支持注入，implementer 可在此改用 HTTP + test double 模式（见 taskService testAgentExecutor 机制）
    return { parent, child };
  }

  it("AC4: 子 execution_nodes 在子 execution 下，父 callFlow 行的 outputVariables 含 __childExecutionId", async () => {
    const { parent } = await createParentChildPair();
    const exec = await runFlow(parent.id, {});
    const parentResult = await waitForExecution(exec.id);
    assert.equal(parentResult.status, "success");

    // 父 execution.nodes 中 call 节点存在
    const callNode = parentResult.nodes.find(n => n.nodeId === "call");
    assert.ok(callNode, "父 execution 含 call 节点");
    assert.ok(callNode.outputVariables, "call 节点有 outputVariables");

    // 列子 execution
    const listRes = await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`);
    assert.equal(listRes.status, 200);
    const children = await listRes.json();
    assert.equal(children.length, 1);
    const childExec = children[0];

    // 父 call 节点 outputVariables 含指向子 execution 的 id
    assert.equal(callNode.outputVariables["call.__childExecutionId"], childExec.id);

    // 子 execution 查详情含其 nodes
    const childDetailRes = await fetch(`${serverCtx.baseUrl}/api/executions/${childExec.id}`);
    assert.equal(childDetailRes.status, 200);
    const childDetail = await childDetailRes.json();
    assert.ok(Array.isArray(childDetail.nodes));
    assert.ok(childDetail.nodes.length >= 3, "子 execution 含 cin/agt/out 三个节点");
    // 子 nodes 里 cin 是 flowInput、out 是 flowOutput
    assert.ok(childDetail.nodes.some(n => n.nodeId === "cin"));
    assert.ok(childDetail.nodes.some(n => n.nodeId === "out"));
  });

  it("AC5: GET /api/executions/:id 返回 parentExecutionId/parentNodeId/depth；顶层字段为 null/0", async () => {
    const { parent } = await createParentChildPair();
    const exec = await runFlow(parent.id, {});
    const parentResult = await waitForExecution(exec.id);
    // 顶层字段
    assert.equal(parentResult.parentExecutionId, null);
    assert.equal(parentResult.parentNodeId, null);
    assert.equal(parentResult.depth, 0);

    const children = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`)).json();
    const childExec = children[0];
    assert.equal(childExec.parentExecutionId, exec.id);
    assert.equal(childExec.parentNodeId, "call");
    assert.equal(childExec.depth, 1);
  });

  it("AC5: 3 层嵌套 depth=0/1/2，parentExecutionId 链正确", async () => {
    // grandchild: flowInput x → flowOutput x
    const grandchild = await createFlow("grandchild",
      [
        { id: "gin", type: "flowInput", config: { outputVariables: [{ name: "x" }] } },
        { id: "gout", type: "flowOutput", config: { outputVariables: [{ name: "x" }] } },
        // pass-through: 用 agent 把 gin.x 写到 x（实际实现可简化为 flowOutput 直接读 gin.x）
        { id: "gagt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "x", prompt: "{{gin.x}}" } }
      ],
      [
        { sourceNodeId: "gin", targetNodeId: "gagt" },
        { sourceNodeId: "gagt", targetNodeId: "gout" }
      ]
    );
    // child: flowInput msg → callFlow grandchild → flowOutput echo
    const child = await createFlow("child",
      [
        { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
        { id: "ccall", type: "callFlow", config: {
          targetFlowId: grandchild.id, targetInputNodeId: "gin",
          inputMappings: [{ childVar: "x", parentExpr: "{{cin.msg}}" }],
          outputMappings: [{ childVar: "x", parentKey: "ccall.x" }]
        }},
        { id: "cout", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } },
        { id: "cagt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "{{ccall.x}}" } }
      ],
      [
        { sourceNodeId: "cin", targetNodeId: "ccall" },
        { sourceNodeId: "ccall", targetNodeId: "cagt" },
        { sourceNodeId: "cagt", targetNodeId: "cout" }
      ]
    );
    // parent: trigger → callFlow child
    const parent = await createFlow("parent",
      [
        { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "deep" }] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.id, targetInputNodeId: "cin",
          inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
          outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
        }}
      ],
      [{ sourceNodeId: "t", targetNodeId: "call" }]
    );

    const exec = await runFlow(parent.id, {});
    const top = await waitForExecution(exec.id);
    assert.equal(top.depth, 0);

    // level 1
    const midList = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`)).json();
    assert.equal(midList.length, 1);
    assert.equal(midList[0].depth, 1);
    assert.equal(midList[0].parentNodeId, "call");

    // level 2
    const deepList = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${midList[0].id}`)).json();
    assert.equal(deepList.length, 1);
    assert.equal(deepList[0].depth, 2);
    assert.equal(deepList[0].parentNodeId, "ccall");
    assert.equal(deepList[0].flowId, grandchild.id);
  });

  it("AC6: purgeExpiredExecutions 删除父时级联删除子/孙 execution", async () => {
    const { parent } = await createParentChildPair();
    const exec = await runFlow(parent.id, {});
    await waitForExecution(exec.id);

    const midList = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec.id}`)).json();
    assert.equal(midList.length, 1);
    const childId = midList[0].id;

    // 触发 purge（retentionDays=0 或直接调用 service 方法）
    // 具体触发方式：post to /api/maintenance/purge 或直接 import purgeExpiredExecutions；
    // implementer 根据现有清理接口选择。断言父+子 execution 都被删：
    const purgeRes = await fetch(`${serverCtx.baseUrl}/api/maintenance/purge-executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ olderThanDays: 0 })
    });
    // 如果没有该 API，implementer 可改用 serverCtx 暴露的 service 引用直接调用
    assert.equal(purgeRes.status, 200);

    const parentAfter = await fetch(`${serverCtx.baseUrl}/api/executions/${exec.id}`);
    assert.equal(parentAfter.status, 404);
    const childAfter = await fetch(`${serverCtx.baseUrl}/api/executions/${childId}`);
    assert.equal(childAfter.status, 404);
  });
});

describe("REQ-FLOW-039: 运行时加载子流程最新版本", () => {
  let serverCtx;
  let project;
  beforeEach(async () => {
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Latest", localPath: "~/opc-workspace/latest" })
    });
    project = await res.json();
  });
  afterEach(async () => { await stopServer(serverCtx); });

  it("AC1/AC2: 子流程修改后父执行看到新版本（不重新发布父）", async () => {
    // 子 flow 只有一个 agent 返回常量字符串 v1；通过 test agent executor 注入确定性返回
    const child = await createFlow("child",
      [
        { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "echo" } },
        { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
      ],
      [
        { sourceNodeId: "cin", targetNodeId: "agt" },
        { sourceNodeId: "agt", targetNodeId: "out" }
      ]
    );
    const parent = await createFlow("parent",
      [
        { id: "t", type: "trigger", config: { outputVariables: [{ name: "msg", defaultValue: "hi" }] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: child.id, targetInputNodeId: "cin",
          inputMappings: [{ childVar: "msg", parentExpr: "{{t.msg}}" }],
          outputMappings: [{ childVar: "echo", parentKey: "call.echo" }]
        }}
      ],
      [{ sourceNodeId: "t", targetNodeId: "call" }]
    );

    // 第一次执行：断言父 call 节点拿到 v1
    // 需要 test agent executor 注入 "v1"
    const exec1 = await runFlow(parent.id, {});
    const r1 = await waitForExecution(exec1.id);
    assert.equal(r1.status, "success");
    const call1 = r1.nodes.find(n => n.nodeId === "call");
    // 具体 echo 值依赖 test executor 返回（此处 placeholder 断言：执行成功、子 execution 存在）
    const children1 = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec1.id}`)).json();
    assert.equal(children1.length, 1);

    // 修改子 flow（改 agent prompt 或 outputVariable 默认值），不重新发布父
    const patchRes = await fetch(`${serverCtx.baseUrl}/api/flows/${child.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeList: [
          { id: "cin", type: "flowInput", config: { outputVariables: [{ name: "msg" }] } },
          { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "echo", prompt: "echo-v2" } },
          { id: "out", type: "flowOutput", config: { outputVariables: [{ name: "echo" }] } }
        ],
        edges: [
          { sourceNodeId: "cin", targetNodeId: "agt" },
          { sourceNodeId: "agt", targetNodeId: "out" }
        ]
      })
    });
    assert.equal(patchRes.status, 200);

    // 第二次执行：断言看到新版本（echo 值变化）
    const exec2 = await runFlow(parent.id, {});
    const r2 = await waitForExecution(exec2.id);
    assert.equal(r2.status, "success");
    // 通过子 execution 的 agent 节点 prompt 字段断言新版本生效
    const children2 = await (await fetch(`${serverCtx.baseUrl}/api/executions?parentExecutionId=${exec2.id}`)).json();
    assert.equal(children2.length, 1);
    const childDetail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${children2[0].id}`)).json();
    const agtNode = childDetail.nodes.find(n => n.nodeId === "agt");
    assert.ok(agtNode);
    assert.ok(agtNode.agent, "agt 节点有 agent 详情");
    assert.equal(agtNode.agent.prompt, "echo-v2", "子 flow 修改后 prompt 立即生效");
  });
});
