// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-006
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// BUG-004（code-defect）回归：DEFAULT_MODELS 硬编码的模型 ID 必须在 pi 运行时
// 模型目录里真实存在，否则 worker resolveModel 抛 E-AGENT-MODEL → 会话建不起来 →
// 飞书对话无回复（REQ-AGENT-006 AC1：prompt → PI AgentSession 处理 → 回复回传）。
//
// 根因：deepseek-chat / kimi-latest 在 pi 目录里不存在（deepseek provider 仅
// deepseek-v4-flash/deepseek-v4-pro；moonshotai 仅 kimi-k2.x/kimi-k3）。
// 修复前：assert deepseek 默认模型可在目录解析 → 红（getModel 返回 null）。
// 修复后：全部 provider 默认模型可解析 → 绿。
//
// seam：与 worker.js resolveModel 完全同构——ModelRuntime.create + getModel(provider, model)。
// 纯目录查询、零网络（与 worker 的 authPath 重定向、faux 注册无关）。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(__dirname, "../../../../../../src/services/agentService.js");

async function loadDEFAULT_MODELS() {
  const mod = await import(src).catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 应可导入");
  assert.equal(typeof mod.DEFAULT_MODELS, "object", "agentService 应导出 DEFAULT_MODELS");
  return mod.DEFAULT_MODELS;
}

describe("BUG-004 回归：DEFAULT_MODELS 模型 ID 在 pi 运行时目录中可解析", () => {
  it("每个生产 provider 的默认模型都能在 ModelRuntime 目录解析（resolveModel seam）", async () => {
    const DEFAULT_MODELS = await loadDEFAULT_MODELS();
    // 目录查询（与 worker resolveModel 同构）：创建 runtime 后 getModel(provider, model)。
    // 只覆盖生产 provider（faux 是测试 seam，经 registerNativeProvider 注入，不经目录）。
    const providers = ["deepseek", "moonshotai", "moonshotai-cn"];
    const runtime = await ModelRuntime.create({
      allowModelNetwork: false,
      modelsPath: null,
      authPath: path.join(os.tmpdir(), "opc-agent-model-test-auth.json"),
    });
    for (const provider of providers) {
      const model = DEFAULT_MODELS[provider];
      assert.equal(
        typeof model,
        "string",
        `DEFAULT_MODELS 应给 provider=${provider} 配默认模型`
      );
      const resolved = runtime.getModel(provider, model);
      assert.ok(
        resolved,
        `默认模型 ${provider}/${model} 在 pi 运行时目录里不可解析——worker resolveModel 会抛 E-AGENT-MODEL，飞书对话无回复（REQ-AGENT-006 AC1）`
      );
    }
  });

  it("agentService 的 provider → 模型映射与目录一致（防止未来新 provider 配了不存在的模型）", async () => {
    const DEFAULT_MODELS = await loadDEFAULT_MODELS();
    const runtime = await ModelRuntime.create({
      allowModelNetwork: false,
      modelsPath: null,
      authPath: path.join(os.tmpdir(), "opc-agent-model-test-auth2.json"),
    });
    const listed = runtime.snapshot.all.map((m) => m.id);
    for (const [provider, model] of Object.entries(DEFAULT_MODELS)) {
      if (provider === "faux") continue; // 测试 seam，不进目录
      // 目录条目按 provider+model 解析（getModel 是权威 seam，与 worker 一致）。
      const resolved = runtime.getModel(provider, model);
      assert.ok(resolved, `DEFAULT_MODELS[${provider}]="${model}" 在目录不存在（listed=${listed.length}）`);
    }
  });
});
