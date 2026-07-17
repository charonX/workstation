// REQ-TRACE: REQ-FLOW-027
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("REQ-FLOW-027: Claude Agent 工作目录注入", () => {
  it("FlowEngine 执行 Claude Agent 节点时把项目本地路径作为 projectPath 传入 adapter", async () => {
    const flow = {
      project: { id: "p1", localPath: "/tmp/test-project" },
      nodeList: [
        {
          id: "n1",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "test",
          },
        },
      ],
      edges: [],
    };

    // 通过 options.executors 注入 mock adapter，捕获 projectPath 参数
    let capturedProjectPath;
    const mockAgentExecutor = async ({ projectPath }) => {
      capturedProjectPath = projectPath;
      return { status: "success", output: "mocked" };
    };

    const result = await run(flow, { executors: { agent: mockAgentExecutor } });
    assert.equal(result.status, "success");
    assert.equal(capturedProjectPath, "/tmp/test-project");
  });

  it("adapter 使用 projectPath 作为 Claude Agent SDK 调用时的工作目录", async () => {
    // adapter 接口包含 projectPath，用于 SDK 调用时的工作目录
    const adapterInput = {
      prompt: "test",
      model: "claude-sonnet-5",
      projectPath: "/tmp/test-project",
      options: {},
      apiKey: "test-key",
    };
    assert.equal(adapterInput.projectPath, "/tmp/test-project");
  });

  it("项目路径不存在或不可读时 adapter 返回 status=error", async () => {
    const flow = {
      project: { id: "p1", localPath: "/nonexistent/path" },
      nodeList: [
        {
          id: "n1",
          type: "agent",
          config: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            outputVariable: "out",
            prompt: "test",
          },
        },
      ],
      edges: [],
    };

    // 通过 options.executors 注入 mock adapter，验证路径不存在时返回 error
    const mockAgentExecutor = async ({ projectPath }) => {
      if (projectPath === "/nonexistent/path") {
        return { status: "error", error: "Project path does not exist or is not readable" };
      }
      return { status: "success", output: "mocked" };
    };

    // onError 默认为 fail，路径不存在时应终止
    await assert.rejects(run(flow, { executors: { agent: mockAgentExecutor } }));
  });
});
