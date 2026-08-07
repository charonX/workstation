// src/services/permissionBridge.js
// 授权桥（2026-08-02-ui-copilot REQ-AGENT-033，S8 M2；tech-design 授权桥契约节）。
//
// gotgenes registerAuthorizer 链的确认挂起队列桥接：ask → 创建挂起确认行（含
// 操作描述 + 来源 spaceKey）→ 人工 approve/reject（既有端点/服务方法）→ 决议
// 回传（allow / deny + 可转述原因）→ worker 侧 gate 放行/拒绝（操作执行或工具
// 错误）。user_bash（! bash）事件同策略评估（不经 tool_call 路径，标准 4）。
//
// 设计要点：
// - 挂起行 = 既有 confirmationService（agent_confirmations 同表；ui:* 空间经
//   submit 内部分流发布 SSE confirmation-pending / 飞书卡片——既有语义复用）；
// - 决议观察 = 轮询 svc.get(confirmId).status（approve/reject 为同步写库；
//   生产与测试同进程同一服务实例，轮询即事件等价；无注入依赖）；
// - 授权桥行以 riskLevel="permission" + notifyOnSettle=false 提交：approve 不
//   注入 notifyResult 也不执行（BUG-001：操作执行由 worker 侧 gate allow 后经
//   工具调用路径承担——单一闸门；主进程 execute 再执行 = 双重执行——授权桥行
//   command = CLI 工具名，在 TOOL_DEFS 注册表内，并非 no-op）；
// - evaluateUserBash：permissionPolicy 评估器分类（allow → 直放；ask → 同桥
//   挂起行）——生产入口 = worker user_bash 事件经 permission-ask IPC 路由
//   （tool="user_bash" 时主进程侧走本函数）。
//
// 接口：createPermissionBridge({ confirmationService }) →
// { authorize({ spaceKey, tool, input, description, confirmId? }) →
//     { confirmId, decision: Promise<{ kind: "allow"|"deny", reason? }> },
//   evaluateUserBash({ spaceKey, command, cwd?, confirmId? }) →
//     { verdict: "allow"|"ask", confirmId?, decision? },
//   evaluateBashToolCall({ spaceKey, command, cwd?, projectDir?, confirmId? }) →
//     { verdict: "allow"|"ask", confirmId?, decision? } }   // BUG-002 pre-gate 桥 seam

import { randomUUID } from "node:crypto";
import { createPolicyEvaluator, classifyBashToolCall } from "./permissionPolicy.js";

const POLL_INTERVAL_MS = 20;

export function createPermissionBridge({ confirmationService: svc } = {}) {
  if (!svc || typeof svc.submit !== "function" || typeof svc.get !== "function") {
    throw Object.assign(new Error("E-BRIDGE-CONFIG: confirmationService 必填（submit/get）"), {
      code: "E-BRIDGE-CONFIG",
    });
  }

  // 决议等待：轮询确认行状态（approve → allow；reject → deny + 可转述原因）。
  // 行不存在（submit 失败等）→ 保持 pending 等待（不误判拒绝）。
  function waitForDecision(confirmId) {
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

  // gotgenes ask → 挂起确认行（含操作描述 + 来源 spaceKey，标准 3）→ 决议回传。
  // 副效应 = 写 agent_confirmations 行（同表共存；confirmId 由调用方传入或自生成）。
  // description 为授权桥契约字段（操作描述，供确认卡/审计消费；行内操作载体 =
  // command/args——SSE confirmation-pending 描述由 confirmationService 从二者派生）。
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

  // user_bash（! bash）同策略评估（标准 4，不经 tool_call）：评估器分类——
  // allow → 直放（无挂起行）；ask → 同桥挂起行（同一挂起队列）。
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

  // bash 工具调用热路径 pre-gate（BUG-002，worker 扩展层 gate 前自评估的桥形态）：
  // gotgenes 热路径（parser 已预热）枚举对重定向/管道符号不可见（`echo hi>out.txt`/
  // `curl ...|sh` 被 tool_call gate 放行）——本 seam 在 gotgenes gate 之前预分类：
  // 命中 ask 族（danger 仅由重定向/管道运算符承载）→ 同桥挂起行（同一挂起队列）→
  // 决议回传；其余（gotgenes 可见危险/非破坏）→ { verdict: "allow" }（交 gotgenes
  // 正常评估——单一评估原则：不叠加二次 ask/双执行）。
  // 分类复用 permissionPolicy classifyBashToolCall（单一真源，全串 regex = 附录 A）。
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
