// src/services/permissionPolicy.js
// 权限策略评估（2026-08-02-ui-copilot REQ-AGENT-033，S8 M2；tech-design gotgenes 策略节）。
//
// 职责：
// - GLOBAL_POLICY_PATH：全局策略文件（应用资源 agent-policy/，只读默认，随分发；
//   REQ-AGENT-033 标准 1）。同一文件由 worker 启动时幂等部署到 gotgenes 全局发现
//   路径 <agentHome>/extensions/pi-permission-system/config.json（spike H3：
//   getAgentDir() 读 PI_CODING_AGENT_DIR）。
// - createPolicyEvaluator({ cwd, projectDir }) → { evaluate({ tool, input }) }：
//   附录 A 分类逐项评估（标准 2）+ 项目策略文件覆盖（H4 隔离契约，标准 5）。
//
// 评估语义（附录 A + signoff 裁决 13/14/15）：
// - 读类（read/ls/grep/find/cat 等只读工具）→ allow（cwd 外路径 → ask，裁决 14）；
// - 写类（write/edit/create/delete）→ ask（任意路径，cwd 内外均 ask）；
// - bash 破坏性模式（rm/sudo/>重定向/curl|sh/kill/chmod/dd/git push --force 等）→ ask；
// - bash 其他 → allow；命令中任一绝对路径在项目目录外（external_directory）→ ask；
// - CLI 高危（既有 REQ-AGENT-015 分类，toolAdapter TOOL_DEFS 单一真源）→ ask；
// - CLI 查询/直跑（query/dispatch）→ allow（裁决 15：task list/run 默认 allow）；
// - 无 deny 类（裁决 13）：本层分类只产出 allow/ask；策略文件显式 deny 直通
//   （用户项目文件可收紧，gotgenes 运行时同语义）。
// - 策略文件覆盖：项目（<projectDir>/.pi/extensions/pi-permission-system/config.json）
//   优先于全局；显式规则命中（非 "*" 通配）时以文件裁决为准（H4：A 空间项目策略
//   不影响 B 空间评估——每 evaluator 独立加载）；分类为内建默认。
//
// 术语遵循 CONTEXT.md；与 gotgenes 运行时共享同一策略文件（文件 = 契约）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getToolDefinition } from "../agent/toolAdapter.js";
import { comparisonKey, isInsideOrEqual, realpathBestEffort } from "./pathUtils.js";

// 全局策略文件（应用资源 agent-policy/ 随分发；src/services/ → ../../agent-policy）。
// 打包形态的可靠资源定位（asar extraResource）未配置——见 build-progress「已知偏差」。
export const GLOBAL_POLICY_PATH = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agent-policy"),
  "pi-permission-config.json"
);

// 项目策略约定路径（gotgenes 发现路径 <cwd>/.pi/extensions/pi-permission-system/config.json，
// 用户手写可选；项目覆盖全局）。
export const PROJECT_POLICY_REL_PATH = path.join(".pi", "extensions", "pi-permission-system", "config.json");

// 附录 A 读/写类工具面（FS/脚本工具命名小写，签核裁决 6）。
const READ_TOOLS = new Set(["read", "ls", "grep", "find", "cat"]);
const WRITE_TOOLS = new Set(["write", "edit", "create", "delete"]);

// bash 破坏性模式（附录 A 清单；与 agent-policy/pi-permission-config.json 的
// bash 面规则逐条对应——runtime 与评估层同契约，改此清单需同步改策略文件）。
const BASH_DESTRUCTIVE_PATTERNS = [
  /(^|\s)(rm|rmdir)(\s|$)/, // rm/rmdir
  /(^|\s)sudo(\s|$)/, // sudo
  />+/, // > 重定向（含 >>）
  /\|\s*(ba)?sh(\s|$)/, // curl|sh / wget|sh 管道
  /(^|\s)(kill|pkill)(\s|$)/, // kill/pkill
  /(^|\s)(chmod|chown)(\s|$)/, // chmod/chown
  /(^|\s)dd(\s|$)/, // dd
  /(^|\s)mkfs(\s|$)/, // mkfs
  /(^|\s)mv(\s|$)/, // mv（可覆盖目标，保守 ask）
  /(^|\s)git\s+push\s+(--force|-f)/, // git push --force / -f
  /(^|\s)(npm|pnpm)\s+(i|install|add)\s+(-g|--global)/, // 全局包安装
  /(^|\s)yarn\s+global(\s|$)/, // yarn global
];

// 命令中绝对路径抽取（与 toolAdapter commandViolatesCwd 同型启发式；边界判定
// 统一 realpath 归一化比较——signoff 裁决 18）。
const ABS_PATH_IN_COMMAND = /(?:"|')?(\/[^\s"']+)(?:"|')?/g;

function commandViolatesCwd(root, command) {
  if (!root) return false;
  for (const m of String(command ?? "").matchAll(ABS_PATH_IN_COMMAND)) {
    const targetAbs = path.resolve(m[1]);
    const targetReal = realpathBestEffort(targetAbs);
    if (!isInsideOrEqual(comparisonKey(targetReal), comparisonKey(root))) return true;
  }
  return false;
}

function pathOutsideCwd(root, targetPath) {
  if (!root) return false;
  const targetAbs = path.resolve(String(targetPath ?? ""));
  const targetReal = realpathBestEffort(targetAbs);
  return !isInsideOrEqual(comparisonKey(targetReal), comparisonKey(root));
}

// 通配匹配（gotgenes wildcard-matcher 同语义的简化子集：* → .*，锚定首尾；
// 末段 " *" 可省略——"cat *" 亦匹配裸 "cat"，与 gotgenes 一致）。
function wildcardMatch(pattern, value) {
  const pat = String(pattern ?? "");
  const text = String(value ?? "");
  const parts = pat.split("*");
  if (parts.length === 1) return text === pat;
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "") continue;
    const idx = text.indexOf(part, pos);
    if (idx === -1) return false;
    if (i === 0 && idx !== 0) return false;
    pos = idx + part.length;
  }
  const last = parts[parts.length - 1];
  if (last !== "" && !text.endsWith(last)) return false;
  return true;
}

// 策略文件解析：permission 对象 → surface → [[pattern, state], ...]（保持写入顺序；
// 字符串值 = {"*": state} 简写，gotgenes schema 同义）。兼容两种形态：
// ① gotgenes 统一配置 { permission: { surface: ... } }（全局策略文件用此）；
// ② 顶层直接为 surface 映射 { surface: ... }（authorizerBridge H4 签核测试的
// 项目策略 fixture 形态）。解析失败 → 空规则（fail-closed 由分类兜底，不因坏
// 文件崩溃）。
function loadPermissionRules(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const permission =
      config && typeof config === "object" && config.permission
        ? config.permission
        : config;
    if (!permission || typeof permission !== "object") return null;
    const surfaces = new Map();
    for (const [surface, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        surfaces.set(surface, [["*", value]]);
      } else if (value && typeof value === "object") {
        surfaces.set(
          surface,
          Object.entries(value).map(([pattern, state]) => [pattern, state])
        );
      }
    }
    return surfaces;
  } catch {
    return null;
  }
}

// 显式规则命中（项目 > 全局；同层 last-match-wins——gotgenes 语义）：
// 返回 { matched, state }；"*" 通配命中视为「未显式命中」（分类提供默认）。
function matchFileRules(surfaces, surface, value) {
  const rules = surfaces?.get(surface);
  if (!rules || rules.length === 0) return { matched: false, state: null };
  let last = null;
  for (const [pattern, state] of rules) {
    if (pattern === "*") continue; // 通配默认交给分类（避免文件默认压过附录 A）
    if (wildcardMatch(pattern, value)) last = state;
  }
  return last !== null ? { matched: true, state: last } : { matched: false, state: null };
}

// 附录 A 分类（内建默认；产出 ∈ {allow, ask}——无 deny 类，裁决 13）。
function classify({ tool, input }, { cwd, projectDir }) {
  const surface = String(tool ?? "");
  const root = projectDir ?? cwd;
  if (surface === "bash") {
    const command = String(input?.command ?? "");
    if (commandViolatesCwd(root, command)) return "ask"; // cwd 外执行（external_directory）
    for (const re of BASH_DESTRUCTIVE_PATTERNS) {
      if (re.test(command)) return "ask";
    }
    return "allow";
  }
  if (READ_TOOLS.has(surface)) {
    // 只读工具 cwd 外路径 → ask（signoff 裁决 14：gotgenes external_directory 默认语义）。
    if (input?.path && pathOutsideCwd(root, input.path)) return "ask";
    return "allow";
  }
  if (WRITE_TOOLS.has(surface)) return "ask"; // 写类任意路径均 ask（cwd 内外）
  // CLI 工具（既有 REQ-AGENT-015 分类单一真源 = toolAdapter TOOL_DEFS riskLevel）：
  // confirm（删除/配置变更/取消类）→ ask；query/dispatch（查询/直跑）→ allow（裁决 15）。
  const def = getToolDefinition(surface);
  if (def) return def.riskLevel === "confirm" ? "ask" : "allow";
  return "ask"; // 未知工具 fail-safe（gotgenes 通用回退同语义）
}

export function createPolicyEvaluator({ cwd, projectDir } = {}) {
  const root = projectDir ?? cwd;
  const globalRules = loadPermissionRules(GLOBAL_POLICY_PATH);
  const projectFile = root ? path.join(root, PROJECT_POLICY_REL_PATH) : null;
  const projectRules = projectFile ? loadPermissionRules(projectFile) : null;

  // 单值评估：项目文件显式命中 > 全局文件显式命中 > 附录 A 分类。
  // H4 隔离：每 evaluator 独立加载自身上下文（globalThis 单槽不参与本层评估）。
  function evaluate({ tool, input } = {}) {
    const surface = String(tool ?? "");
    const value = surface === "bash" ? String(input?.command ?? "") : surface;
    if (projectRules) {
      const hit = matchFileRules(projectRules, surface, value);
      if (hit.matched) return hit.state;
    }
    if (globalRules) {
      const hit = matchFileRules(globalRules, surface, value);
      if (hit.matched) return hit.state;
    }
    return classify({ tool, input }, { cwd, projectDir });
  }

  return { evaluate };
}
