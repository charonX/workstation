import fs from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

// 默认单节点最大轮数，防止失控计费（tech-design §6.4）；可经 config.options.maxTurns 覆盖。
const DEFAULT_MAX_TURNS = 20;

// 鉴权失败指引（tech-design §6.3）：应用不存储凭证，复用本机 claude code 登录态。
const AUTH_GUIDANCE =
  "本机 claude code 未登录或不可用，请先在本机完成 claude 登录（或自行配置 ANTHROPIC_API_KEY）";

// 可注入的 SDK query 引用（tech-design §5.5 可测试性缝）：
// 映射/汇聚/错误转换逻辑通过注入假 queryFn 离线覆盖，默认值为真实 SDK query。
let queryFn = query;

export function setQueryFn(fn) {
  queryFn = fn;
}

export function resetQueryFn() {
  queryFn = query;
}

export async function execute({ prompt, model, projectPath, options, apiKey } = {}) {
  const startedAt = Date.now();
  const logs = [];
  const log = (message) => logs.push({ at: new Date().toISOString(), message });

  // REQ-FLOW-027 AC4：先校验 projectPath 存在且可读，失败不调 SDK。
  const pathError = validateProjectPath(projectPath);
  if (pathError) {
    log(pathError);
    return { status: "error", error: pathError, logs, durationMs: Date.now() - startedAt };
  }

  const sdkOptions = {
    cwd: projectPath,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: options?.maxTurns ?? DEFAULT_MAX_TURNS,
  };
  if (model) {
    sdkOptions.model = model;
  }
  if (options?.systemPrompt !== undefined) {
    sdkOptions.systemPrompt = options.systemPrompt;
  }
  if (apiKey) {
    sdkOptions.env = { ...process.env, ANTHROPIC_API_KEY: apiKey };
  }

  log(`claude agent execute start (model=${model ?? "default"}, cwd=${projectPath})`);

  let resultMessage;
  let assistantText = "";
  const assistantErrors = [];
  let authFailure = false;

  try {
    for await (const message of queryFn({ prompt, options: sdkOptions })) {
      if (message.type === "assistant") {
        for (const block of message.message?.content ?? []) {
          if (block.type === "text") {
            assistantText += block.text;
          }
        }
        if (message.error) {
          assistantErrors.push(message.error);
          if (message.error === "authentication_failed" || message.error === "oauth_org_not_allowed") {
            authFailure = true;
          }
        }
      } else if (message.type === "auth_status") {
        if (message.error) {
          authFailure = true;
          assistantErrors.push(message.error);
        }
      } else if (message.type === "result") {
        resultMessage = message;
      }
    }
  } catch (err) {
    const raw = err?.message || String(err);
    log(`claude agent execute failed: ${raw}`);
    return {
      status: "error",
      error: withAuthGuidance(raw, authFailure),
      logs,
      durationMs: Date.now() - startedAt,
    };
  }

  if (resultMessage && resultMessage.subtype !== "success") {
    const raw =
      (resultMessage.errors ?? []).filter(Boolean).join("; ") ||
      `agent execution failed (${resultMessage.subtype})`;
    log(`claude agent execute failed: ${raw}`);
    return {
      status: "error",
      error: withAuthGuidance(raw, authFailure),
      logs,
      durationMs: Date.now() - startedAt,
    };
  }

  if (!resultMessage && assistantErrors.length > 0) {
    const raw = assistantErrors.join("; ");
    log(`claude agent execute failed: ${raw}`);
    return {
      status: "error",
      error: withAuthGuidance(raw, authFailure),
      logs,
      durationMs: Date.now() - startedAt,
    };
  }

  const output = resultMessage?.result ?? assistantText;
  log("claude agent execute success");
  return { status: "success", output, logs, durationMs: Date.now() - startedAt };
}

function validateProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== "string") {
    return "projectPath is required and must be a non-empty string";
  }
  let stat;
  try {
    stat = fs.statSync(projectPath);
  } catch {
    return `projectPath does not exist: ${projectPath}`;
  }
  if (!stat.isDirectory()) {
    return `projectPath is not a directory: ${projectPath}`;
  }
  try {
    fs.accessSync(projectPath, fs.constants.R_OK);
  } catch {
    return `projectPath is not readable: ${projectPath}`;
  }
  return null;
}

function withAuthGuidance(message, authFailure) {
  if (authFailure || isAuthLike(message)) {
    return `${message}。${AUTH_GUIDANCE}`;
  }
  return message;
}

function isAuthLike(text) {
  return /auth|unauthorized|401|not logged in|api.?key|oauth|credential/i.test(text);
}
