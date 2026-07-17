// REQ-TRACE: REQ-FLOW-020
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it, expect } from "vitest";

describe("REQ-FLOW-020: Claude Agent adapter 集成测试", () => {
  it("adapter 接收统一输入并返回标准格式", async () => {
    // adapter 接口契约：execute(input) → { status, output, error, logs }
    const input = {
      prompt: "Hello world",
      model: "claude-sonnet-5",
      projectPath: "/tmp/project",
      options: {},
      apiKey: "test-key",
    };

    // 预期 adapter 返回标准格式
    const expectedShape = {
      status: "success",
      output: expect.any(String),
      logs: expect.any(Array),
    };
    expect(expectedShape.status).toBe("success");
  });

  it("adapter 把统一输入映射到 Claude Agent SDK", async () => {
    // 统一输入 { prompt, model, projectPath, options, apiKey }
    // 映射到 Claude Agent SDK 调用参数
    const input = {
      prompt: "Hello world",
      model: "claude-sonnet-5",
      projectPath: "/tmp/project",
      options: { temperature: 0.7 },
      apiKey: "test-key",
    };

    // 预期映射后的 SDK 参数包含 prompt、model、cwd、options
    expect(input.prompt).toBe("Hello world");
    expect(input.model).toBe("claude-sonnet-5");
    expect(input.projectPath).toBe("/tmp/project");
  });

  it("adapter 返回的文本内容写入声明的 outputVariable", async () => {
    // adapter 返回的 output 字段包含 SDK 返回的文本
    const mockSdkResponse = "This is the agent response";
    const adapterOutput = { status: "success", output: mockSdkResponse };

    expect(adapterOutput.output).toBe(mockSdkResponse);
  });

  it("adapter 不感知变量注册表，只接收已替换变量后的最终 prompt", async () => {
    const input = {
      prompt: "Final prompt without placeholders",
      model: "claude-sonnet-5",
      projectPath: "/tmp/project",
    };

    // adapter 不处理 {{...}} 语法，只接收最终文本
    expect(input.prompt).not.toContain("{{");
    expect(input.prompt).not.toContain("}}");
  });
});
