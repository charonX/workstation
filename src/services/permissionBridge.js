// src/services/permissionBridge.js
// 授权桥（2026-08-02-ui-copilot REQ-AGENT-033，S8 M2；ADR-032 深化）。
//
// 职责：
// - 桥接 Worker 侧 tool_call / user_bash / pre-gate 拦截至主进程 PermissionAdjudicator；
// - 支持 adjudicator / confirmationService 双入参兼容；
// - 优先使用 adjudicator.waitForDecision(id) 即时决议（零 20ms 轮询开销）。

import { randomUUID } from "node:crypto";
import { createPolicyEvaluator, classifyBashToolCall } from "./permissionPolicy.js";

const POLL_INTERVAL_MS = 20;

export function createPermissionBridge({ adjudicator, confirmationService } = {}) {
  const svc = adjudicator ?? confirmationService;
  if (!svc || typeof svc.submit !== "function" || typeof svc.get !== "function") {
    throw Object.assign(new Error("E-BRIDGE-CONFIG: adjudicator / confirmationService 必填（submit/get）"), {
      code: "E-BRIDGE-CONFIG",
    });
  }

  function waitForDecision(confirmId) {
    if (typeof svc.waitForDecision === "function") {
      return svc.waitForDecision(confirmId);
    }
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const row = svc.get(confirmId);
        if (!row) return;
        if (row.status === "approved") {
          clearInterval(timer);
          resolve({ kind: "allow" });
        } else if (row.status === "rejected") {
          clearInterval(timer);
          resolve({ kind: "deny", reason: "操作已取消（用户拒绝）" });
        }
      }, POLL_INTERVAL_MS);
      timer.unref?.();
    });
  }

  async function authorize({ spaceKey, tool, input, description: _description, confirmId } = {}) {
    const id = confirmId ?? randomUUID();
    svc.submit({
      confirmId: id,
      sessionKey: spaceKey ?? "",
      command: tool ?? "permission",
      args: input ?? {},
      riskLevel: "permission",
      notifyOnSettle: false,
    });
    return { confirmId: id, decision: waitForDecision(id) };
  }

  async function evaluateUserBash({ spaceKey, command, cwd, confirmId } = {}) {
    const evaluator = createPolicyEvaluator({ cwd });
    const verdict = evaluator.evaluate({ tool: "bash", input: { command } });
    if (verdict === "allow") return { verdict: "allow" };
    return {
      verdict: "ask",
      ...(await authorize({
        spaceKey,
        tool: "bash",
        input: { command },
        description: `bash: ${command}`,
        confirmId,
      })),
    };
  }

  async function evaluateBashToolCall({ spaceKey, command, cwd, projectDir, confirmId } = {}) {
    const verdict = classifyBashToolCall(command, { cwd, projectDir });
    if (verdict === "allow") return { verdict: "allow" };
    return {
      verdict: "ask",
      ...(await authorize({
        spaceKey,
        tool: "bash",
        input: { command },
        description: `bash: ${command}`,
        confirmId,
      })),
    };
  }

  return { authorize, evaluateUserBash, evaluateBashToolCall };
}
