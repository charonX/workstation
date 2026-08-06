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
// - tool_execution_end：{ type, name, status: "completed" | "pending" | "rejected" }
// - tool_execution_error：{ type, name, status: "error", errorCode, errorMessage }
// 工具失败 → 错误事件回传对话，agent 可继续（不崩）。
//
// 纪律：
// - 命令模块静态 import（vite bundle 可打包；无顶层副作用——命令模块仅定义函数）。
// - 惰性（ADR-009）：createToolSurface 无副作用（注册表组装 + 可选覆盖校验）；
//   命令函数仅在 execute 时调用。
// - release 永不注入（REQ-AGENT-013）；尝试执行 → 明确拒绝「不支持该操作」。
// - confirm 级工具：本 slice 声明 riskLevel + 拦截点（onConfirmRequest）——Slice 8
//   确认服务接线：拦截 → IPC confirm-request → 主进程确认服务入队（agent_confirmations
//   pending + 确认卡片）→ 返回待确认（E-CONFIRM-PENDING，工具不执行——执行由确认
//   回调驱动，REQ-AGENT-016 b 解耦）；未接线 → 与 CLI 路径一致直接执行。
// - G1 接线（REQ-AGENT-017 标准 2 生产消费）：task run 缺省项目/流程时注入绑定
//   默认目标候选（getDefaultTarget，buildToolContext 经 session-config toolContext
//   下发）；GAP 1（Slice 7 登记）：task run 记录 originating spaceKey 到执行
//   variables（任务卡片路由激活——execution:started → variables.spaceKey）。
// - 主进程侧确认执行（REQ-AGENT-016 AC2）：executeToolCommand 导出——确认服务驱动
//   **同一命令模块**执行（C2 路径，与工具路径同一 TOOL_DEFS 注册表，一处实现两端
//   生效，签核决策 12/13）。

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// PI 工具参数 schema 使用与 pi 相同的 typebox 实例（pi-ai 声明的依赖并再导出），
// 保证 ToolDefinition.parameters 与 pi 会话工具注册的 schema 兼容。
import { Type } from "@earendil-works/pi-ai";
import { setServerBaseUrlOverride, getServerBaseUrlOverride } from "../cli/server.js";
import { comparisonKey, isInsideOrEqual, realpathBestEffort } from "../services/pathUtils.js";
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
    // G1 接线：project-id/flow-id 非必填——缺省时注入绑定默认目标候选
    // （buildToolContext → getDefaultTarget；无绑定时命令校验报错回投）。
    description: "下发执行任务（对话下发，直跑；trigger 缺省 dialogue；project-id/flow-id 缺省用绑定流程）",
    argsSchema: obj({ "project-id": str("项目 ID（缺省用绑定流程）"), "flow-id": str("流程 ID（缺省用绑定流程）"), trigger: enumOf(["manual", "dialogue"], "触发来源（缺省 dialogue：对话下发；manual 保留手动路径）") }),
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

// LLM 参数 → 命令 flags（camelCase 归一化 + 缺省注入）与位置参数——surface.execute
// 与 executeToolCommand（确认流程主进程侧执行，C2 路径）共用同一调用形态，一处
// 实现两端生效。
function prepareInvocation(tool, args) {
  return {
    flags: applyDefaultArgs(tool, normalizeArgs(args)),
    positional: (tool.positionalFrom ?? []).map((key) => args[key]),
  };
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
// createToolSurface({ commandsDir, baseUrl, onConfirmRequest, sessionKey, getDefaultTarget }) →
// { listTools, execute, onEvent, toPiToolDefinitions }。
// - commandsDir：可选；提供时做注册表覆盖校验（防命令模块漂移）。
// - baseUrl：可选；注入时命令执行直连该 HTTP API（测试 seam「本测试服务器」），
//   缺省按注册表发现主进程 server（生产 agent 子进程路径，C2）。
// - onConfirmRequest：可选；confirm 级工具拦截点（Slice 8 确认服务接线——
//   worker 经 IPC confirm-request → 主进程确认服务入队；未接线 → 直接执行）。
// - sessionKey：可选；所属 agent 会话（空间 key）——task run 记录 originating
//   spaceKey 到执行 variables（GAP 1，任务卡片路由）。
// - getDefaultTarget：可选；绑定默认目标候选惰性读取（G1，REQ-AGENT-017 标准 2
//   生产消费——session-config toolContext 由 worker 注入）。
export function createToolSurface(options = {}) {
  const { commandsDir, baseUrl, onConfirmRequest, sessionKey, getDefaultTarget } = options;
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
      const { flags, positional } = prepareInvocation(tool, args);
      surface.emit({ type: "tool_execution_start", name, status: "running" });
      try {
        // 确认拦截点（Slice 8 接线）：confirm 级工具在注入 onConfirmRequest 时先请求
        // 确认（tech-design 命令保险层钩子 C2）。确认服务已入队（pending + 确认卡片）
        // → 返回 E-CONFIRM-PENDING（工具不执行——执行由确认回调驱动，REQ-AGENT-016
        // b 解耦，不经过 agent turn）；明确拒绝 → E-CONFIRM-REJECTED。
        if (tool.riskLevel === "confirm" && typeof onConfirmRequest === "function") {
          const decision = await onConfirmRequest({ tool: name, args: flags, riskLevel: tool.riskLevel });
          if (decision?.approved !== true) {
            if (decision?.pending === true) {
              surface.emit({ type: "tool_execution_end", name, status: "pending" });
              return errorResult("E-CONFIRM-PENDING", decision?.reply ?? "操作待确认，请在确认卡片中完成操作");
            }
            surface.emit({ type: "tool_execution_end", name, status: "rejected" });
            return errorResult("E-CONFIRM-REJECTED", decision?.error ?? "操作已拒绝");
          }
        }
        // G1 接线（REQ-AGENT-017 标准 2 生产消费）：task run 缺省项目/流程 →
        // 注入绑定默认目标候选（绑定 flow 优先；无绑定/调用方显式传值 → 不覆盖）。
        if (tool.name === "task run") {
          const target = typeof getDefaultTarget === "function" ? getDefaultTarget() : null;
          if (!flags["project-id"] && target?.projectId) flags["project-id"] = target.projectId;
          if (!flags["flow-id"] && target?.flowId) flags["flow-id"] = target.flowId;
        }
        // GAP 1（Slice 7 登记）：task run 记录 originating spaceKey 到执行 variables——
        // 任务卡片路由激活（server.js resolveSessionKey = executionEvent.variables?.spaceKey）。
        if (tool.name === "task run" && sessionKey) {
          const existing = flags.variables;
          flags.variables = { ...(existing && typeof existing === "object" ? existing : {}), spaceKey: sessionKey };
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

// 主进程侧确认执行（REQ-AGENT-016 AC2 / tech-design b 解耦）：确认回调驱动
// **同一命令模块**执行（C2 路径：进程内 import 命令模块 → HTTP API → services，
// 签核决策 13）——与工具路径共用 TOOL_DEFS 注册表与命令模块，一处实现两端生效
// （签核决策 12）。server.js 注入确认服务时使用（baseUrl 显式注入本 server，
// 避免注册表发现歧义）。返回命令模块原始输出（结构化 { output, ... }）。
export async function executeToolCommand(name, args = {}, { baseUrl } = {}) {
  const tool = TOOL_DEFS.find((t) => t.name === name);
  if (!tool) {
    throw commandError(`不支持该操作：${name} 不在 agent 工具面内`);
  }
  const { flags, positional } = prepareInvocation(tool, args);
  const data = await invokeCommandHandler(tool, flags, positional, baseUrl);
  return data;
}

// —— M2（REQ-AGENT-032）FS/脚本工具（read / write / bash）——
// 命名小写（signoff 裁决 6）；仅 project 空间挂载（PRD §10.2 工具面分级硬边界：
// 通用/飞书空间 = CLI-only，不可获得 FS/脚本工具）。cwd 边界判定（signoff 裁决
// 18：realpath 归一化比较）：cwd 外路径的写/执行 fail-closed 为工具错误
// （E-AGENT-BOUNDARY，agent 收到工具错误可转述，副作用不发生）。授权放行链
// （cwd 外 ask → approve）随 Slice 7 gotgenes 接入——本切片先实现工具面挂载与
// cwd 边界判定接口。

const READ_TOOL = {
  name: "read",
  description: "读取项目目录内文件内容（cwd 外路径被权限层拦截）",
  argsSchema: obj({ path: str("项目内文件绝对路径（必填）") }, ["path"]),
};
const WRITE_TOOL = {
  name: "write",
  description: "写入项目目录内文件（cwd 外路径被权限层拦截）",
  argsSchema: obj(
    { path: str("项目内文件绝对路径（必填）"), content: str("文件内容（必填）") },
    ["path", "content"]
  ),
};
const BASH_TOOL = {
  name: "bash",
  description: "在项目目录内执行 shell 命令（cwd 外路径被权限层拦截）",
  argsSchema: obj({ command: str("shell 命令（必填）") }, ["command"]),
};
const FS_TOOLS = [READ_TOOL, WRITE_TOOL, BASH_TOOL];

const BOUNDARY_ERROR_CODE = "E-AGENT-BOUNDARY";
const BOUNDARY_ERROR_MESSAGE = "拒绝：目标路径在项目目录之外";

// realpath 归一化判定：target 位于 cwd 内（含等于，signoff 裁决 18）→ 返回
// realpath 后的目标路径；否则 null。realpathBestEffort 对不存在的尾部沿父链
// 取最近存在祖先归一化（写入目标常尚未创建）。
function resolveInsideCwd(cwd, targetPath) {
  const targetAbs = path.resolve(String(targetPath ?? ""));
  const targetReal = realpathBestEffort(targetAbs);
  return isInsideOrEqual(comparisonKey(targetReal), comparisonKey(cwd)) ? targetReal : null;
}

// 命令中绝对路径抽取（引号内/外 /-根路径 token；相对路径不判定——执行以 cwd
// 为基目录。启发式边界判定，完整策略评估（external_directory 等）随 Slice 7）。
// 任一解析路径在 cwd 外 → 判定越界（fail-closed）。
const ABS_PATH_IN_COMMAND = /(?:"|')?(\/[^\s"']+)(?:"|')?/g;

function commandViolatesCwd(cwd, command) {
  for (const m of String(command ?? "").matchAll(ABS_PATH_IN_COMMAND)) {
    if (resolveInsideCwd(cwd, m[1]) === null) return true;
  }
  return false;
}

// bash 执行（execFile 无 shell 中间层；cwd 限定项目目录；超时兜底防悬挂）。
const execFileAsync = promisify(execFile);

async function runBash(command, cwd) {
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
  const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
  try {
    const { stdout, stderr } = await execFileAsync(shell, args, { cwd, timeout: 30000 });
    const out = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
    return out;
  } catch (err) {
    const detail = String(err?.stderr ?? err?.message ?? "命令执行失败").trim();
    throw Object.assign(new Error(detail || "命令执行失败"), { code: "E-AGENT-BASH" });
  }
}

async function executeFsTool(name, args, { cwd }) {
  switch (name) {
    case "read": {
      const target = resolveInsideCwd(cwd, args.path);
      if (target === null) return errorResult(BOUNDARY_ERROR_CODE, BOUNDARY_ERROR_MESSAGE);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return errorResult("E-AGENT-FS-ERROR", `文件不存在或不可读：${args.path}`);
      }
      return { output: fs.readFileSync(target, "utf8") };
    }
    case "write": {
      const target = resolveInsideCwd(cwd, args.path);
      if (target === null) return errorResult(BOUNDARY_ERROR_CODE, BOUNDARY_ERROR_MESSAGE);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(args.content ?? ""));
      return { output: `已写入 ${args.path}` };
    }
    case "bash": {
      if (commandViolatesCwd(cwd, args.command)) {
        return errorResult(BOUNDARY_ERROR_CODE, BOUNDARY_ERROR_MESSAGE);
      }
      return { output: await runBash(String(args.command ?? ""), cwd) };
    }
    default:
      throw commandError(`不支持该操作：${name} 不在 agent 工具面内`);
  }
}

// —— 会话工具面（REQ-AGENT-032 public seam）——
// createSessionToolSurface({ profile, cwd, commandsDir, baseUrl, sessionKey,
//   getDefaultTarget, onConfirmRequest }) → { listTools, execute, onEvent,
//   emit, toPiToolDefinitions }（形态与 createToolSurface 一致）。
// - profile="default"（通用/飞书空间）= CLI 基线（createToolSurface 等价，无
//   read/write/bash——分级硬边界）；
// - profile="project"（项目空间）= CLI + read/write/bash（cwd 限定项目目录；
//   cwd 外写/执行 fail-closed 为工具错误，授权放行链随 Slice 7）。
export function createSessionToolSurface(options = {}) {
  const { profile = "default", cwd, commandsDir, baseUrl, sessionKey, getDefaultTarget, onConfirmRequest } = options;
  const cli = createToolSurface({ commandsDir, baseUrl, sessionKey, getDefaultTarget, onConfirmRequest });
  if (profile !== "project") return cli;

  // 组合面事件桥：CLI 与 FS 工具事件统一进同一监听器集（worker 经 onEvent
  // 转发 tool_execution_error——CLI 侧错误同样可达）。
  const listeners = [];
  cli.onEvent((ev) => {
    for (const cb of listeners) {
      try {
        cb(ev);
      } catch {
        // 监听器异常不影响工具执行。
      }
    }
  });
  const emit = (event) => {
    for (const cb of listeners) {
      try {
        cb(event);
      } catch {
        // 同上。
      }
    }
  };

  const fsSurface = {
    listTools() {
      return [
        ...cli.listTools(),
        ...FS_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          riskLevel: "confirm",
          argsSchema: t.argsSchema,
        })),
      ];
    },
    onEvent(cb) {
      if (typeof cb === "function") listeners.push(cb);
    },
    emit,
    async execute(name, args = {}) {
      const tool = FS_TOOLS.find((t) => t.name === name);
      if (!tool) return cli.execute(name, args);
      emit({ type: "tool_execution_start", name, status: "running" });
      try {
        const result = await executeFsTool(name, args, { cwd });
        if (result?.errorCode) {
          emitToolError(emit, name, result.errorCode, result.errorMessage ?? "操作失败");
        } else {
          emit({ type: "tool_execution_end", name, status: "completed" });
        }
        return result;
      } catch (err) {
        const errorCode = err?.code || "E-AGENT-FS-ERROR";
        const errorMessage = err?.message ?? String(err);
        emitToolError(emit, name, errorCode, errorMessage);
        return errorResult(errorCode, errorMessage);
      }
    },
    toPiToolDefinitions() {
      const fsDefs = FS_TOOLS.map((tool) => ({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: schemaToTypeBox(tool.argsSchema),
        execute: async (toolCallId, params, signal) => {
          if (signal?.aborted) throw new Error("操作已取消");
          const result = await fsSurface.execute(tool.name, params ?? {});
          if (result?.errorCode) {
            throw new Error(`[${result.errorCode}] ${result.errorMessage ?? "命令执行失败"}`);
          }
          return {
            content: [{ type: "text", text: formatToolOutput(result.output) }],
            details: { tool: tool.name },
          };
        },
      }));
      return [...cli.toPiToolDefinitions(), ...fsDefs];
    },
  };
  return fsSurface;
}
