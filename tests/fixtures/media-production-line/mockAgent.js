// 测试夹具：mock agent 执行器（替代真实 Claude agent，避免外部进程/网络依赖）。
// 支撑 REQ-COLL-001/002、REQ-SCHEDULE-008/009 的执行链路测试。
//
// 与 flowEngine 的 executor 注入 seam 兼容（options.executors.agent），
// 签名与 src/flowEngine/executors/agentExecutor.js 一致：async ({ node, context }) => result。
// 这是测试替身，可完整使用；不是产品代码骨架。

import fs from "node:fs";
import path from "node:path";

/**
 * 通用 mock agent 执行器。
 *
 * @param {(args: {node: object, context: object}) => (object|Promise<object>)} handler
 *   返回 executor 结果（{status:"success", output, logs?} 或 {status:"error", error}）。
 * @returns {(args: {node: object, context: object}) => Promise<object>}
 */
export function createMockAgentExecutor(handler) {
  return async ({ node, context } = {}) => {
    const result = await handler({ node, context });
    return { status: "success", logs: [], ...result };
  };
}

/**
 * 产出一个"真实写文件"的 mock agent 执行器：把 files 写入 baseDir（真实 I/O），
 * 并返回成功结果。用于产物登记/端到端文件断言（STANDARDS 红线：真实 I/O 断言）。
 *
 * @param {string} baseDir 项目临时目录（产物写入位置）。
 * @param {Array<{relativePath: string, content: string}>} files
 * @returns {(args: {node: object, context: object}) => Promise<object>}
 */
export function createFileWritingAgentExecutor(baseDir, files) {
  return async () => {
    for (const file of files) {
      const target = path.join(baseDir, file.relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, "utf8");
    }
    return {
      status: "success",
      output: `mock agent wrote ${files.length} file(s)`,
      logs: [{ level: "info", message: "mock agent completed" }]
    };
  };
}

/**
 * 产出一个恒失败的 mock agent 执行器（重试耗尽 / E-AGENT-FAILED 分支用）。
 *
 * @param {string} [reason]
 * @returns {(args: {node: object, context: object}) => Promise<object>}
 */
export function createFailingAgentExecutor(reason = "E-AGENT-FAILED: mock agent exhausted retries") {
  return async () => ({
    status: "error",
    error: reason,
    logs: [{ level: "error", message: reason }]
  });
}
