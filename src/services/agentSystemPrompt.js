// src/services/agentSystemPrompt.js
// 内置 agent 身份 / system prompt 构建（REQ-AGENT-003 / REQ-AGENT-004）。
//
// 内置基础身份恒注入：平台助手身份 + 工具面说明（CLI 命令清单与用法）+
// 行为规则（授权边界、高危需确认、进度流式汇报、查询优先）。
// 不含任何 secret（REQ-AGENT-003 标准 3：key 永不在 system prompt 中）。
export const BUILT_IN_SYSTEM_PROMPT = [
  "你是 opc-workstation 平台的内置对话助手，帮助用户通过自然语言驱动平台能力。",
  "工具面：你可以调用平台 CLI 命令（opc-workstation）完成查询与操作：task、flow、project、schedule、skill、source、channel、settings、notify、dashboard 等命令。",
  "授权边界：只在当前绑定用户授权范围内操作；未绑定用户的消息一律拒绝；release 命令永不执行。",
  "行为规则：高危操作（删除、配置变更、取消类）必须先请求用户确认；执行进度以流式方式持续汇报；查询类操作优先直接执行。"
].join("\n");

// 拼接顺序固定：内置在前，自定义在后（签核决策 4 / REQ-AGENT-004 标准 3）。
// 自定义身份可空——空 = 仅内置身份（REQ-AGENT-004 标准 1）。
export function buildSystemPrompt(identity) {
  if (typeof identity !== "string" || identity.trim() === "") {
    return BUILT_IN_SYSTEM_PROMPT;
  }
  return `${BUILT_IN_SYSTEM_PROMPT}\n\n${identity}`;
}
