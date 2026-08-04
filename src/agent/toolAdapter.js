// src/agent/toolAdapter.js
// CLI 工具面适配器（REQ-AGENT-012/013；tech-design C2「进程内 import 命令模块」）。
//
// 工具面 = `src/cli/commands/` 全量命令（release 除外，REQ-AGENT-013）；
// CLI 即控制面（保险层）：每命令声明 riskLevel（PRD §7.2 命令→风险等级映射，
// 签核决策 12），一处实现两端生效（agent 工具路径 + Slice 8 确认流程）。
//
// C2 链路（REQ-AGENT-012 标准 3）：进程内 import 命令模块 → 命令函数 →
// HTTP API（ADR-001）→ services；命令函数内部经 ensureServer 发现主进程 server
// （agent 子进程按 ppid 归属命中注册表）；显式注入 baseUrl 时经
// setServerBaseUrlOverride seam 直连指定 server（测试 seam「本测试服务器」）。
// 返回结构化结果 { output, errorCode?, errorMessage? }。
//
// 事件契约（REQ-AGENT-006 标准 4 / REQ-AGENT-012 标准 4）：
// - tool_execution_start：{ type, name, status: "running" }
// - tool_execution_end：{ type, name, status: "completed" | "rejected" }
// - tool_execution_error：{ type, name, status: "error", errorCode, errorMessage }
// 工具失败 → 错误事件回传对话，agent 可继续（不崩）。
//
// 纪律：
// - 命令模块静态 import（vite bundle 可打包；无顶层副作用——命令模块仅定义函数）。
// - 惰性（ADR-009）：createToolSurface 无副作用（注册表组装 + 可选覆盖校验）；
//   命令函数仅在 execute 时调用。
// - release 永不注入（REQ-AGENT-013）；尝试执行 → 明确拒绝「不支持该操作」。
// - confirm 级工具：本 slice 声明 riskLevel + 预留拦截点（onConfirmRequest），
//   触发确认交互 = Slice 8 确认服务（本 slice 未接线 → 直接执行）。

import fs from "node:fs";
// PI 工具参数 schema 使用与 pi 相同的 typebox 实例（pi-ai 声明的依赖并再导出），
// 保证 ToolDefinition.parameters 与 pi 会话工具注册的 schema 兼容。
import { Type } from "@earendil-works/pi-ai";
import { setServerBaseUrlOverride, getServerBaseUrlOverride } from "../cli/server.js";
import * as channel from "../cli/commands/channel.js";
import * as dashboard from "../cli/commands/dashboard.js";
import * as flow from "../cli/commands/flow.js";
import * as notify from "../cli/commands/notify.js";
import * as project from "../cli/commands/project.js";
import * as schedule from "../cli/commands/schedule.js";
import * as settings from "../cli/commands/settings.js";
import * as skill from "../cli/commands/skill.js";
import * as source from "../cli/commands/source.js";
import * as task from "../cli/commands/task.js";

// 命令模块表（release 按 REQ-AGENT-013 排除，不 import）。
const COMMAND_MODULES = {
  task,
  flow,
  project,
  schedule,
  settings,
  skill,
  dashboard,
  notify,
  source,
  channel,
};

// —— argsSchema 工具 ——
const str = (description) => ({ type: "string", description });
const boolean = (description) => ({ type: "boolean", description });
const enumOf = (values, description) => ({ type: "string", enum: values, description });
const obj = (properties, required = []) => ({ type: "object", properties, required });

// —— 工具注册表（单一真源）——
// name = "<module> <subcommand>"（CLI 实体/动作形态）；fn = 命令模块导出函数；
// riskLevel 与 PRD §7.2 映射一致；positionalFrom = 从参数中取位置参数（如
// `skill update <slug>` 的 slug）。PRD 表未列出的删除类命令（project/flow/
// schedule delete）按 §7.2 注「删除/配置变更类归高危」取向归入 confirm。
const TOOL_DEFS = [
  // task
  { name: "task run", module: "task", fn: "run", riskLevel: "dispatch",
    // PRD §6.1 对话下发 / REQ-AGENT-017 接替声明：工具路径（对话场景）缺省
    // trigger=dialogue（defaultArgs 注入，见 execute）；manual 保留给手动/定时路径，
    // 且不覆盖调用方显式传值。命令模块自身默认 manual 面向 CLI 手动路径。
    description: "下发执行任务（对话下发，直跑；trigger 缺省 dialogue）",
    argsSchema: obj({ "project-id": str("项目 ID（必填）"), "flow-id": str("流程 ID（必填）"), trigger: enumOf(["manual", "dialogue"], "触发来源（缺省 dialogue：对话下发；manual 保留手动路径）") }, ["project-id", "flow-id"]),
    defaultArgs: { trigger: "dialogue" } },
  { name: "task list", module: "task", fn: "listExecutions", riskLevel: "query",
    description: "列出执行记录（不含日志详情）",
    argsSchema: obj({}) },
  { name: "task get", module: "task", fn: "getExecution", riskLevel: "query",
    description: "查询单次执行详情（含节点记录）",
    argsSchema: obj({ id: str("执行 ID（UUID，必填）") }, ["id"]) },

  // flow
  { name: "flow create", module: "flow", fn: "create", riskLevel: "confirm",
    description: "创建流程（高危-确认）",
    argsSchema: obj({ name: str("流程名称（必填）"), "project-id": str("项目 ID（必填）"), description: str("流程描述") }, ["name", "project-id"]) },
  { name: "flow list", module: "flow", fn: "list", riskLevel: "query",
    description: "列出全部流程",
    argsSchema: obj({}) },
  { name: "flow get", module: "flow", fn: "get", riskLevel: "query",
    description: "查询单个流程详情",
    argsSchema: obj({ id: str("流程 ID（必填）") }, ["id"]) },
  { name: "flow import", module: "flow", fn: "importFlow", riskLevel: "confirm",
    description: "从文件导入流程（高危-确认）",
    argsSchema: obj({ file: str("流程 JSON 文件路径（必填）"), "project-id": str("目标项目 ID（必填）") }, ["file", "project-id"]) },
  { name: "flow export", module: "flow", fn: "exportFlow", riskLevel: "confirm",
    description: "导出流程为 JSON（可写文件，高危-确认）",
    argsSchema: obj({ id: str("流程 ID（必填）"), file: str("可选导出文件路径") }, ["id"]) },
  { name: "flow delete", module: "flow", fn: "delete", riskLevel: "confirm",
    description: "删除流程（删除类高危-确认）",
    argsSchema: obj({ id: str("流程 ID（必填）") }, ["id"]) },

  // project
  { name: "project create", module: "project", fn: "create", riskLevel: "confirm",
    description: "创建项目（高危-确认）",
    argsSchema: obj({ name: str("项目名称（必填）"), "local-path": str("本地路径"), "repo-url": str("仓库地址"), branch: str("分支") }, ["name"]) },
  { name: "project list", module: "project", fn: "list", riskLevel: "query",
    description: "搜索项目（需 q 关键字；无参数时命令校验报错）",
    argsSchema: obj({ q: str("搜索关键字") }) },
  { name: "project get", module: "project", fn: "get", riskLevel: "query",
    description: "查询单个项目详情",
    argsSchema: obj({ id: str("项目 ID（必填）") }, ["id"]) },
  { name: "project delete", module: "project", fn: "delete", riskLevel: "confirm",
    description: "删除项目（删除类高危-确认）",
    argsSchema: obj({ id: str("项目 ID（必填）") }, ["id"]) },
  { name: "project update", module: "project", fn: "update", riskLevel: "confirm",
    description: "更新项目（如 agent 类型，高危-确认）；id 为位置参数",
    argsSchema: obj({ id: str("项目 ID（必填）"), agents: str("agent 类型列表，逗号分隔") }, ["id"]),
    positionalFrom: ["id"] },
  { name: "project skill", module: "project", fn: "skill", riskLevel: "confirm",
    description: "项目技能管理（list/link/unlink/resync，高危-确认）；action/id 等为位置参数",
    argsSchema: obj({
      action: enumOf(["list", "link", "unlink", "resync"], "操作（必填）"),
      id: str("项目 ID"),
      slug: str("技能 slug（link/unlink 必填）"),
      skillName: str("技能名称（link/unlink 必填）"),
    }, ["action"]),
    positionalFrom: ["action", "id", "slug", "skillName"] },

  // schedule
  { name: "schedule create", module: "schedule", fn: "create", riskLevel: "confirm",
    description: "创建定时调度（高危-确认）",
    argsSchema: obj({ "project-id": str("项目 ID（必填）"), "flow-id": str("流程 ID（必填）"), cron: str("cron 表达式（必填）"), variables: str("变量 JSON 字符串"), vars: str("变量 JSON 字符串（别名）") }, ["project-id", "flow-id", "cron"]) },
  { name: "schedule toggle", module: "schedule", fn: "toggle", riskLevel: "confirm",
    description: "启用/停用定时调度（高危-确认）",
    argsSchema: obj({ id: str("调度 ID（必填）") }, ["id"]) },
  { name: "schedule list", module: "schedule", fn: "list", riskLevel: "query",
    description: "列出全部定时调度",
    argsSchema: obj({}) },
  { name: "schedule delete", module: "schedule", fn: "delete", riskLevel: "confirm",
    description: "删除定时调度（删除类高危-确认）",
    argsSchema: obj({ id: str("调度 ID（必填）") }, ["id"]) },

  // settings
  { name: "settings get", module: "settings", fn: "get", riskLevel: "query",
    description: "读取平台设置",
    argsSchema: obj({}) },
  { name: "settings set", module: "settings", fn: "set", riskLevel: "confirm",
    description: "更新平台设置（配置变更高危-确认）",
    argsSchema: obj({
      "workspace-root": str("工作区根目录"),
      "skill-repo-path": str("技能库路径"),
      density: str("密度"),
      language: str("语言"),
      theme: str("主题"),
    }) },

  // skill
  { name: "skill list", module: "skill", fn: "list", riskLevel: "query",
    description: "列出已安装技能库",
    argsSchema: obj({}) },
  { name: "skill install", module: "skill", fn: "install", riskLevel: "confirm",
    description: "安装技能库（git/local，高危-确认）",
    argsSchema: obj({ source: enumOf(["git", "local"], "来源类型（必填）"), identifier: str("git 地址或本地目录（必填）"), force: boolean("强制重装") }, ["source", "identifier"]) },
  { name: "skill update", module: "skill", fn: "update", riskLevel: "confirm",
    description: "更新技能库（高危-确认）；slug 为位置参数",
    argsSchema: obj({ slug: str("技能库 slug（必填）") }, ["slug"]),
    positionalFrom: ["slug"] },
  { name: "skill remove", module: "skill", fn: "remove", riskLevel: "confirm",
    description: "移除技能库（高危-确认）；slug 为位置参数",
    argsSchema: obj({ slug: str("技能库 slug（必填）") }, ["slug"]),
    positionalFrom: ["slug"] },
  { name: "skill agents", module: "skill", fn: "agents", riskLevel: "query",
    description: "列出可用 agent",
    argsSchema: obj({}) },

  // dashboard
  { name: "dashboard stats", module: "dashboard", fn: "stats", riskLevel: "query",
    description: "查看平台统计概览",
    argsSchema: obj({}) },

  // notify
  { name: "notify list", module: "notify", fn: "list", riskLevel: "query",
    description: "列出通知",
    argsSchema: obj({ unread: boolean("仅未读") }) },
  { name: "notify read", module: "notify", fn: "read", riskLevel: "query",
    description: "标记通知已读（all 或指定 id）",
    argsSchema: obj({ all: boolean("全部已读"), id: str("通知 ID") }) },

  // source
  { name: "source create", module: "source", fn: "create", riskLevel: "confirm",
    description: "创建内容源（高危-确认）",
    argsSchema: obj({ name: str("名称（必填）"), type: str("类型（必填）"), config: str("配置 JSON"), tags: str("标签，逗号分隔") }, ["name", "type"]) },
  { name: "source list", module: "source", fn: "list", riskLevel: "query",
    description: "列出内容源（可按标签/启用态过滤）",
    argsSchema: obj({ tag: str("标签过滤"), enabled: boolean("仅启用") }) },
  { name: "source update", module: "source", fn: "update", riskLevel: "confirm",
    description: "更新内容源（配置变更高危-确认）",
    argsSchema: obj({ id: str("内容源 ID（必填）"), name: str("名称"), type: str("类型"), config: str("配置 JSON"), tags: str("标签，逗号分隔"), enabled: boolean("启用态") }, ["id"]) },
  { name: "source toggle", module: "source", fn: "toggle", riskLevel: "confirm",
    description: "启用/停用内容源（高危-确认）",
    argsSchema: obj({ id: str("内容源 ID（必填）") }, ["id"]) },
  { name: "source delete", module: "source", fn: "delete", riskLevel: "confirm",
    description: "删除内容源（高危-确认）",
    argsSchema: obj({ id: str("内容源 ID（必填）") }, ["id"]) },

  // channel
  { name: "channel binding", module: "channel", fn: "binding", riskLevel: "query",
    description: "查看消息通道绑定",
    argsSchema: obj({}) },
  { name: "channel bind", module: "channel", fn: "bind", riskLevel: "confirm",
    description: "绑定通道到流程/项目（高危-确认）",
    argsSchema: obj({ "flow-id": str("流程 ID"), "project-id": str("项目 ID"), force: boolean("强制覆盖") }) },
  { name: "channel credentials", module: "channel", fn: "credentials", riskLevel: "confirm",
    description: "配置通道凭据（appId/appSecret，高危-确认）",
    argsSchema: obj({ "app-id": str("应用 ID（必填）"), "app-secret": str("应用密钥（必填）") }, ["app-id", "app-secret"]) },
  { name: "channel status", module: "channel", fn: "status", riskLevel: "query",
    description: "查看通道运行状态",
    argsSchema: obj({}) },
  { name: "channel reconnect", module: "channel", fn: "reconnect", riskLevel: "confirm",
    description: "重连消息通道（高危-确认）",
    argsSchema: obj({}) },
];

// —— 命令层错误（统一 code：E-AGENT-CLI-ERROR，REQ-AGENT-012 错误契约）——
function commandError(message) {
  return Object.assign(new Error(message), { code: "E-AGENT-CLI-ERROR" });
}

// —— C2 命令调用 ——
// COMMAND_MODULES 为静态注册表（静态 import 已就绪），按 module/fn 直接取导出函数；
// 命令函数内部 ensureServer 发现 server（agent 子进程按 ppid 归属命中注册表主进程
// server）；显式注入 baseUrl 时临时覆盖为直连指定 server（执行完恢复，不污染后续调用）。
async function invokeCommandHandler(tool, flags, positional, baseUrl) {
  const handler = COMMAND_MODULES[tool.module]?.[tool.fn];
  if (typeof handler !== "function") {
    throw commandError(`命令模块 ${tool.module} 缺少导出 ${tool.fn}`);
  }
  const prevOverride = getServerBaseUrlOverride();
  setServerBaseUrlOverride(baseUrl ?? null);
  try {
    return await handler(flags, positional);
  } finally {
    setServerBaseUrlOverride(prevOverride);
  }
}

// LLM 参数归一化：camelCase → kebab-case（与 CLI flags 命名一致，
// 如 projectId → project-id）；已有 kebab 键保持不变。
function normalizeArgs(args = {}) {
  const flags = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const flagKey = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    flags[flagKey] = value;
  }
  return flags;
}

// 注册表漂移校验（运行时防漂移提示）：commands 目录全量（release 除外）应均有
// 工具登记；不可读（打包环境）跳过；业务测试 toolSurface.test.js 已断言覆盖，
// 此处仅告警不阻断（agent 进程不因注册表漂移而崩）。
function verifyCommandCoverage(commandsDir, toolNames) {
  if (!commandsDir) return;
  try {
    const modules = fs
      .readdirSync(commandsDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => f.replace(/\.js$/, ""))
      .filter((m) => m !== "release");
    for (const mod of modules) {
      if (!toolNames.some((n) => n.startsWith(`${mod} `))) {
        console.warn(`[toolAdapter] 命令模块 ${mod} 未登记工具（REQ-AGENT-012 覆盖漂移）`);
      }
    }
  } catch {
    // commandsDir 不可读 → 跳过校验。
  }
}

// —— TypeBox（PI ToolDefinition.parameters，typebox 1.3.7）——
// argsSchema（JSON Schema 子集）→ TypeBox TSchema；required 之外的属性可选。
function schemaToTypeBox(schema) {
  const props = {};
  const required = new Set(schema.required ?? []);
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    let t;
    switch (prop.type) {
      case "boolean":
        t = Type.Boolean();
        break;
      case "number":
        t = Type.Number();
        break;
      case "array":
        t = Type.Array(prop.items?.type === "number" ? Type.Number() : Type.String());
        break;
      case "string":
      default:
        t = prop.enum
          ? Type.Union(prop.enum.map((value) => Type.Literal(value)))
          : Type.String();
    }
    props[key] = required.has(key) ? t : Type.Optional(t);
  }
  return Type.Object(props);
}

function formatToolOutput(output) {
  if (output === undefined) return "（无输出）";
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

// 工具级默认值注入（仅缺省时，不覆盖调用方显式传值）：
// task run 对话场景缺省 trigger=dialogue（PRD §6.1 / REQ-AGENT-017 接替声明），
// 不依赖命令模块 CLI 默认 manual（该默认面向手动 CLI 路径）；非对话场景
// 未来扩展可各自声明 defaultArgs，互不影响。
function applyDefaultArgs(tool, flags) {
  for (const [key, value] of Object.entries(tool.defaultArgs ?? {})) {
    if (flags[key] === undefined) flags[key] = value;
  }
  return flags;
}

// 失败的结构化结果（REQ-AGENT-012 标准 4：错误事件已回传，调用方/agent 可继续）。
function errorResult(errorCode, errorMessage) {
  return { output: undefined, errorCode, errorMessage };
}

// 工具错误事件（REQ-AGENT-012 标准 4：结构化错误事件，含工具名与状态）。
function emitToolError(emit, name, errorCode, errorMessage) {
  emit({ type: "tool_execution_error", name, status: "error", errorCode, errorMessage });
}

// —— 工具面 ——
// createToolSurface({ commandsDir, baseUrl, onConfirmRequest }) →
// { listTools, execute, onEvent, toPiToolDefinitions }。
// - commandsDir：可选；提供时做注册表覆盖校验（防命令模块漂移）。
// - baseUrl：可选；注入时命令执行直连该 HTTP API（测试 seam「本测试服务器」），
//   缺省按注册表发现主进程 server（生产 agent 子进程路径，C2）。
// - onConfirmRequest：可选；confirm 级工具拦截点（Slice 8 确认服务接线；
//   未接线 → confirm 级工具直接执行）。
export function createToolSurface(options = {}) {
  const { commandsDir, baseUrl, onConfirmRequest } = options;
  const listeners = [];

  const surface = {
    listTools() {
      // 工具定义 = 命令 + 参数 schema + 风险等级（REQ-AGENT-012 标准 1/2）。
      return TOOL_DEFS.map((t) => ({
        name: t.name,
        description: t.description,
        riskLevel: t.riskLevel,
        argsSchema: t.argsSchema,
      }));
    },
    onEvent(cb) {
      if (typeof cb === "function") listeners.push(cb);
    },
    emit(event) {
      for (const cb of listeners) {
        try {
          cb(event);
        } catch {
          // 监听器异常不影响工具执行（agent 可继续）。
        }
      }
    },
    async execute(name, args = {}) {
      const tool = TOOL_DEFS.find((t) => t.name === name);
      if (!tool) {
        // 拒绝（REQ-AGENT-013）：release 不注入；未知工具同样明确拒绝。
        const message = `不支持该操作：${name} 不在 agent 工具面内`;
        emitToolError(surface.emit, name, "E-AGENT-UNSUPPORTED", message);
        throw new Error(message);
      }
      const flags = applyDefaultArgs(tool, normalizeArgs(args));
      const positional = (tool.positionalFrom ?? []).map((key) => args[key]);
      surface.emit({ type: "tool_execution_start", name, status: "running" });
      try {
        // 确认拦截点（预留）：confirm 级工具在注入 onConfirmRequest 时先请求确认
        // （tech-design 命令保险层钩子 C2；触发确认交互 = Slice 8 确认服务，
        // 本 slice 未接线 → 与 CLI 路径一致直接执行）。
        if (tool.riskLevel === "confirm" && typeof onConfirmRequest === "function") {
          const decision = await onConfirmRequest({ tool: name, args: flags, riskLevel: tool.riskLevel });
          if (decision?.approved !== true) {
            surface.emit({ type: "tool_execution_end", name, status: "rejected" });
            return errorResult("E-CONFIRM-REJECTED", "操作已拒绝");
          }
        }
        const data = await invokeCommandHandler(tool, flags, positional, baseUrl);
        surface.emit({ type: "tool_execution_end", name, status: "completed" });
        return { output: data };
      } catch (err) {
        // 工具失败 → 结构化错误结果 + tool_execution_error 错误事件
        // （REQ-AGENT-012 标准 4：agent 可继续，不崩）。
        const errorCode = err?.code || "E-AGENT-CLI-ERROR";
        const errorMessage = err?.message ?? String(err);
        emitToolError(surface.emit, name, errorCode, errorMessage);
        return errorResult(errorCode, errorMessage);
      }
    },
    // PI 工具注入形态（REQ-AGENT-012 标准 1：CLI 命令作为 PI 工具注入 agent；
    // worker 在 createAgentSession customTools 处接线）。execute 异常/错误 →
    // PI 标记 isError 工具结果（LLM 可见错误文本，agent 继续）。
    toPiToolDefinitions() {
      return TOOL_DEFS.map((tool) => ({
        name: tool.name,
        label: tool.name,
        description: `${tool.description}（风险等级：${tool.riskLevel}）`,
        parameters: schemaToTypeBox(tool.argsSchema),
        execute: async (toolCallId, params, signal) => {
          if (signal?.aborted) throw new Error("操作已取消");
          const result = await surface.execute(tool.name, params ?? {});
          if (result?.errorCode) {
            throw new Error(`[${result.errorCode}] ${result.errorMessage ?? "命令执行失败"}`);
          }
          return {
            content: [{ type: "text", text: formatToolOutput(result.output) }],
            details: { tool: tool.name, riskLevel: tool.riskLevel },
          };
        },
      }));
    },
  };

  if (commandsDir) {
    verifyCommandCoverage(commandsDir, TOOL_DEFS.map((t) => t.name));
  }
  return surface;
}

// 供未来调用方复用（确认流程等）：按名字查工具定义。
export function getToolDefinition(name) {
  return TOOL_DEFS.find((t) => t.name === name) ?? null;
}
