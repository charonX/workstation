// src/services/permissionConfigService.js
// PI 权限配置可视化管理——主进程服务层（2026-08-10-pi-permission-config-ui，Slice 1；
// REQ-AGENT-060/061/068）。
//
// 职责边界（tech-design §2）：
// - 权限配置服务（读写/校验/merge/元数据）只活主进程；worker/gotgenes 零改动；
// - renderer 只经 HTTP API 交互（S2 路由接线），本模块不碰 HTTP；
// - 服务端只有一个语义：校验并写入这份 JSON（Q5 单端点）。
//
// 数据源：
// - 全局基底 = 部署 JSON `agent-policy/pi-permission-config.json`（GLOBAL_POLICY_PATH
//   同源，运行时真相，Q1 拍板）——代码规则表（policyRules.js BASH_RULES）仅作
//   family/可读文案的元数据注入源（T8）；
// - 项目配置 = `<projectDir>/.pi/extensions/pi-permission-system/config.json`
//   （PROJECT_POLICY_REL_PATH 同源；gotgenes 发现路径，T7）；
// - merge 语义 = gotgenes `mergeUnifiedConfigs`（config-loader.ts 实证，T1）——
//   不重复造语义，对照测试（permissionMerge.test.js）锁死一致性；
// - 校验 = gotgenes `validateUnifiedConfig`（zod，config-schema.ts 实证，T5）——
//   保存拦截的 = 运行时 fail-closed 的，同一把尺。
//
// 保存语义（ADR-022 + 裁决 A，2026-08-10 PRD 对齐缺口 1）：
// - 覆盖式保存：请求体 = 项目 JSON 全量（最小覆盖集），落盘原样写入；
// - 顶层未知键（unifiedConfigSchema strictObject）→ 拒绝保存（400）：gotgenes 运行时
//   对含未知键的配置整集 fail-closed（{config:{}} → 全规则集回落 ask），保存即全禁；
//   permission 面内自定义 surface/pattern（z.record 合法）保留放行——自定义字段保留
//   由前端视图转换承担（tech-design §4.3/§6.6：面板保存生成 payload 时读原 project
//   JSON、保留 rules 之外的键；JSON 模式原样传）——服务端不猜模式；
// - 首次保存生成文件（目录递归创建）；取消覆盖 = 字段不在请求 JSON → 落盘消失；
// - 原子写：同目录 tmp + rename，失败不污染现有文件。

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createJiti } from "jiti";
import * as projectService from "./projectService.js";
import { expandTilde, realpathBestEffort, comparisonKey, isInsideOrEqual } from "./pathUtils.js";
import { GLOBAL_POLICY_PATH, PROJECT_POLICY_REL_PATH } from "./permissionPolicy.js";
import { BASH_RULES } from "./policyRules.js";

// —— 项目路径解析（与 agentService 项目装配同源：expandTilde + realpath）——
// 项目不存在/无 localPath → E-PROJECT-NOT-FOUND（S2 路由映射 404）。
function resolveProject(projectId) {
  const project = projectService.getProjectDetail(projectId);
  if (!project || typeof project.localPath !== "string" || project.localPath === "") {
    const err = new Error("project not found");
    err.code = "E-PROJECT-NOT-FOUND";
    throw err;
  }
  const projectDir = realpathBestEffort(path.resolve(expandTilde(project.localPath)));
  const projectConfigPath = path.join(projectDir, PROJECT_POLICY_REL_PATH);
  return { projectDir, projectConfigPath };
}

// —— 配置读取 ——

// 全局基底 = 部署 JSON 原文（只读，ADR-020 不动）。读取失败（缺失/坏文件）→
// 空对象 + 警告（防御；正常分发路径下文件随应用资源存在）。
function readGlobalConfig() {
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_POLICY_PATH, "utf8"));
  } catch (err) {
    console.warn(`[permissionConfig] permission.read-global-invalid: ${GLOBAL_POLICY_PATH}: ${err?.message ?? String(err)}`);
    return {};
  }
}

// 项目配置读取：返回 {config, invalid} 区分信号（2026-08-11 人裁决，PRD 对齐
// 缺口 6/E6 落地）——
// - 缺失 → {config: null, invalid: false}（未配置，全部跟随全局）；
// - 坏文件（JSON.parse 失败）→ {config: null, invalid: true} + 警告（E6 防御面：
//   运行侧 gotgenes 对坏文件 {invalid:true} fail-closed；UI 侧靠 invalid 信号显示
//   坏文件提示而非「未配置」空态——project=null 无法区分「未配置」与「已损坏」）。
function readProjectConfig(projectConfigPath) {
  if (!fs.existsSync(projectConfigPath)) return { config: null, invalid: false };
  try {
    return { config: JSON.parse(fs.readFileSync(projectConfigPath, "utf8")), invalid: false };
  } catch (err) {
    console.warn(`[permissionConfig] permission.read-project-invalid: ${projectConfigPath}: ${err?.message ?? String(err)}`);
    return { config: null, invalid: true };
  }
}

// —— merge 纯函数（对齐 gotgenes mergeUnifiedConfigs，config-loader.ts 实证 T1）——
// 顶层标量/数组：`override[key] ?? base[key]`（项目写了就覆盖，未定义继承全局）；
// shellTools：按工具名浅合并（项目条目覆盖同名工具，但绝不丢全局条目）；
// permission 面：mergeFlatPermissions 语义——顶层 {...base}，对象键浅合并
// （bash/path 等 pattern map 只覆盖写了的 pattern），标量键替换。
// 未知顶层键（含 $schema）不进入 merged——与 gotgenes 行为逐字一致（对照测试）。

// 顶层字段覆盖合并：override 定义了就替换，否则继承 base（与 gotgenes
// mergeUnifiedConfigs 的 `override[key] ?? base[key]` 逐字一致）。
function mergeOverrideOrInherit(merged, base, override, keys) {
  for (const key of keys) {
    const value = override[key] ?? base[key];
    if (value !== undefined) merged[key] = value;
  }
}

// 对象面字段合并（shellTools/permission）：两源都在 → 用 mergeFn 合并；只有一源 →
// 原样继承（绝不丢全局条目——丢条目 = 静默放行回归）。
function mergeObjectField(merged, key, base, override, mergeFn) {
  if (base && override) {
    merged[key] = mergeFn(base, override);
  } else if (base) {
    merged[key] = base;
  } else if (override) {
    merged[key] = override;
  }
}

export function mergeUnified(base = {}, override = {}) {
  const merged = {};

  // 顶层布尔（override 替换 base，defined 即生效）
  mergeOverrideOrInherit(merged, base, override, [
    "debugLog",
    "permissionReviewLog",
    "yoloMode",
    "doublePressToConfirm",
  ]);

  // 顶层数值
  mergeOverrideOrInherit(merged, base, override, [
    "toolInputPreviewMaxLength",
    "toolTextSummaryMaxLength",
  ]);

  // 数组字段：整体替换（override wins，与标量同语义——authorizerChain/
  // piInfrastructureReadPaths，ADR-022）
  mergeOverrideOrInherit(merged, base, override, ["piInfrastructureReadPaths", "authorizerChain"]);

  // shellTools：按工具名浅合并——项目条目覆盖同名工具的映射，但绝不丢全局条目
  //（丢别名 = 静默放行回归）
  mergeObjectField(merged, "shellTools", base.shellTools, override.shellTools, (a, b) => ({
    ...a,
    ...b,
  }));

  // permission 面：深浅合并（mergeFlatPermissions 语义）
  mergeObjectField(merged, "permission", base.permission, override.permission, mergeFlatPermissions);

  return merged;
}

// permission 面扁平合并（gotgenes permission-merge.ts mergeFlatPermissions 语义）：
// 顶层 {...base}；对象键（pattern map）浅合并；标量键替换。
function mergeFlatPermissions(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseVal = merged[key];
    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      typeof value === "object" &&
      value !== null
    ) {
      merged[key] = { ...baseVal, ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

// —— 校验（gotgenes validateUnifiedConfig，T5）——
// 经 jiti 同步加载 gotgenes TS 源码（对齐 worker.js loadGotgenesFactory 先例：
// createRequire resolve 包目录 + createJiti + moduleCache:false；包 exports "." 指向
// service.ts，config-loader.ts 是相对路径可直达的 TS 源码）。模块级缓存，仅首次
// 编译（~120ms）。加载失败（E4，PRD §6.2）→ 降级 JSON.parse 语法级校验 + 警告，
// 不抛 500——schema 校验器不可用 ≠ 服务不可用。
const workerRequire = createRequire(import.meta.url);
let gotgenesValidationHandle = null;
function loadGotgenesValidation() {
  if (!gotgenesValidationHandle) {
    try {
      const serviceEntry = workerRequire.resolve("@gotgenes/pi-permission-system");
      const entryDir = path.dirname(serviceEntry);
      const pkgDir = path.basename(entryDir) === "src" ? path.dirname(entryDir) : entryDir;
      const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
      const loader = jiti(path.join(pkgDir, "src", "config-loader.ts"));
      const schema = jiti(path.join(pkgDir, "src", "config-schema.ts"));
      gotgenesValidationHandle = {
        validateUnifiedConfig: loader.validateUnifiedConfig,
        unifiedConfigSchema: schema.unifiedConfigSchema,
      };
    } catch (err) {
      // E4 降级：返回 null，上层降级 JSON.parse 语法级校验。不缓存失败（下次调用
      // 重试，瞬时故障自愈）；每次降级均记录警告。
      console.warn(
        `[permissionConfig] permission.validation-downgrade: gotgenes schema 校验器不可用，` +
          `降级 JSON.parse 语法校验: ${err?.message ?? String(err)}`
      );
      return null;
    }
  }
  return gotgenesValidationHandle;
}

// 降级路径的语法级判定：JSON 对象（非数组/非 null）视为语法合法；其他形态
// （数组/字符串/数字/null）不是合法配置对象——schema 校验器可用时同样拒绝。
function isJsonObjectConfig(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// gotgenes 校验判定：有 issues = 非法。同步返回（permissionConfig.test.js 对照用例
// 直接取值，不 await）。校验器不可用（E4 降级）→ 仅语法级判定（语法对 → 放行）。
export function validateWithGotgenes(config) {
  const handle = loadGotgenesValidation();
  if (!handle) return !isJsonObjectConfig(config);
  const result = handle.validateUnifiedConfig(config);
  return result.issues.length > 0;
}

// 路径化校验错误（E-PERMISSION-INVALID 载荷，接口契约 3.2：issues:[{path,message}]）。
// 裁决 A（PRD 对齐缺口 1）：顶层未知键（unifiedConfigSchema strictObject）会让
// gotgenes 运行时整集 fail-closed（{config:{}} → 全规则集回落 ask）——顶层未知键
// 必须进入 issues → 保存拒绝；permission 面内自定义 surface/pattern 是 z.record
// 合法（schema 实证），永不产生 unrecognized_keys issue → 自定义字段保留不受影响。
function validationIssues(config) {
  const handle = loadGotgenesValidation();
  if (!handle) {
    // E4 降级：仅语法级校验。非 JSON 对象 → 一条 root issue；对象 → 无 issues
    //（放行；降级警告已由 loadGotgenesValidation 记录）。
    if (!isJsonObjectConfig(config)) {
      return [
        {
          path: "(root)",
          message: "config must be a JSON object (schema validator degraded, syntax-only validation)",
        },
      ];
    }
    return [];
  }
  const result = handle.unifiedConfigSchema.safeParse(config);
  if (result.success) return [];
  const issues = [];
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      // strictObject 的 unknown-key issue：zod path 为空数组（未知键不在对象内），
      // 未知键名列在 issue.keys——逐键合成路径（顶层键 → path 即键名本身；
      // 嵌套 strictObject（如 denyWithReason）→ 父路径.键名）。
      const basePath = issue.path.length > 0 ? issue.path.map(String).join(".") : "";
      for (const key of issue.keys) {
        issues.push({
          path: basePath ? `${basePath}.${key}` : String(key),
          message: `Unrecognized config key '${key}'.`,
        });
      }
      continue;
    }
    issues.push({
      path: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
      message: issue.message,
    });
  }
  return issues;
}

// —— 原子写（同目录 tmp + rename，失败不污染现有文件；目录递归创建）——
// 写入前 realpath containment 校验（防 localPath 目录内 .pi 被替换为 symlink 逃逸——
// BUG-005 图片白名单教训；复用 pathUtils isInsideOrEqual/comparisonKey 模式）。
function assertProjectConfigContained(projectDir, targetDir) {
  const targetReal = realpathBestEffort(targetDir);
  if (!isInsideOrEqual(comparisonKey(targetReal), comparisonKey(projectDir))) {
    const err = new Error(`permission config path escapes project directory: ${targetDir}`);
    err.code = "E-PERMISSION-WRITE";
    throw err;
  }
}

// —— 元数据注入（T8：部署 JSON 无 family/可读文案，展示元数据从真源注入）——
// bash pattern → 人可读文案（对齐 UX 原型 rule-desc；原型未覆盖的 pattern 补合理文案）。
const BASH_PATTERN_LABELS = {
  "rm *": "删除任意文件/目录",
  "rm": "无参数 rm",
  "rmdir *": "删除空目录",
  "sudo *": "提权执行",
  "kill *": "终止进程",
  "pkill *": "终止进程",
  "chmod *": "修改权限/属主",
  "chown *": "修改权限/属主",
  "dd *": "磁盘低级操作",
  "mkfs *": "磁盘低级操作",
  "mv *": "移动文件/目录",
  "mv": "无参数 mv",
  "git push --force*": "强制推送（覆盖远程历史）",
  "git push -f*": "强制推送（覆盖远程历史）",
  "npm i -g *": "全局安装 npm 包",
  "npm i --global *": "全局安装 npm 包",
  "npm install -g *": "全局安装 npm 包",
  "npm install --global *": "全局安装 npm 包",
  "npm add -g *": "全局安装 npm 包",
  "npm add --global *": "全局安装 npm 包",
  "pnpm i -g *": "全局安装 pnpm 包",
  "pnpm i --global *": "全局安装 pnpm 包",
  "pnpm install -g *": "全局安装 pnpm 包",
  "pnpm install --global *": "全局安装 pnpm 包",
  "pnpm add -g *": "全局安装 pnpm 包",
  "pnpm add --global *": "全局安装 pnpm 包",
  "yarn global *": "全局安装 yarn 包",
  "*": "bash 兜底（未匹配模式的命令）",
};

// BASH_RULES 按 glob 对齐 → {family, label}（family 来自真源；label 优先静态文案）。
// 对齐失败（规则表有但部署 JSON 无的 pattern）→ 该 pattern 不产生 rule 项
// （REQ-AGENT-060 标准 3：仅返回部署 JSON 中实际存在的规则）。
const BASH_META = new Map();
for (const rule of BASH_RULES) {
  for (const glob of rule.globs ?? []) {
    BASH_META.set(glob, { family: rule.family, label: BASH_PATTERN_LABELS[glob] ?? glob });
  }
}

// 工具级（permission 标量键）可读文案（对齐 UX 原型组 4 工具级裁决）。
const TOOL_LABELS = {
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  create: "创建文件",
  delete: "删除文件/目录",
  ls: "列出目录",
  grep: "搜索文本",
  find: "查找文件",
  "*": "全局兜底（未匹配规则的调用）",
};

// pattern map 面（permission 下对象键）的 family/label（对齐 UX 分组名）。
const MAP_SURFACE_LABELS = {
  bash: "bash 命令",
  path: "path 白名单",
  external_directory: "外部目录",
  mcp: "MCP 工具",
};

// 顶层字段（授权链与开关组）可读文案。
const TOP_LEVEL_LABELS = {
  authorizerChain: "权限评估链顺序",
  yoloMode: "跳过全部询问（危险，慎用）",
  doublePressToConfirm: "确认需二次按键",
  debugLog: "权限评估调试日志",
  permissionReviewLog: "权限审查日志",
  toolInputPreviewMaxLength: "工具输入预览最大长度",
  toolTextSummaryMaxLength: "工具文本摘要最大长度",
  piInfrastructureReadPaths: "基础设施读取路径",
};

// —— rules 组装（面板渲染数据源，接口契约 3.1）——
// 遍历 merged：permission 面（bash 等 pattern map 每 pattern 一条 + 工具标量键）+
// shellTools 面（每工具一条，嵌套对象形态）+ 顶层字段（跳过 permission/shellTools/
// $schema）。每条 rule：
// { key, family, label, readable, type, global, value, source, projectOverridden }。
// source/origin：项目文件里有该 key → project（projectOverridden=true）；否则 global。

// 取 obj 中 segments 路径的值（中途非对象 → undefined）；用于 global（部署 JSON）
// 读取——JSON 解析对象的键全为 own，直接下标即等价 own 读。
function valueAt(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

// 项目来源探测：一次遍历取 segments 路径的值 + 是否逐段 own（Object.hasOwn 防
// 原型链污染键如 "__proto__" 被误判为项目覆盖）。{owned:false} → 跟随全局。
function projectOwnedValueAt(project, segments) {
  let cur = project;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== "object" || !Object.hasOwn(cur, seg)) {
      return { owned: false, value: undefined };
    }
    cur = cur[seg];
  }
  return { owned: true, value: cur };
}

function sourceFor(project, segments) {
  const probe =
    project !== null ? projectOwnedValueAt(project, segments) : { owned: false, value: undefined };
  return {
    projectOwned: probe.owned,
    value: probe.owned ? probe.value : null,
    source: probe.owned ? "project" : "global",
  };
}

// bash/path/external_directory 等 pattern map：每 pattern 一条 rule。
// family 注入（T8）：bash pattern 与 BASH_RULES glob 对齐；对齐失败（部署 JSON 含
// 规则表没有的 bash pattern——ADR-020 配平心智下的漂移信号，tech-design §6.3）→
// 「未分组」+ permission.meta-mismatch 警告（不再回落到 surface 名）。
function buildMapEntryRule(surface, pattern, global, project) {
  const segments = ["permission", surface, pattern];
  const meta = surface === "bash" ? BASH_META.get(pattern) : undefined;
  let family;
  if (surface === "bash") {
    family = meta?.family ?? "未分组";
    if (!meta) {
      console.warn(
        `[permissionConfig] permission.meta-mismatch {pattern: ${JSON.stringify(segments.join("."))}, family: null}`
      );
    }
  } else {
    family = surface;
  }
  const { projectOwned, value, source } = sourceFor(project, segments);
  return {
    key: segments.join("."),
    family,
    label: meta?.label ?? MAP_SURFACE_LABELS[surface] ?? pattern,
    readable: pattern,
    type: "map-entry",
    global: valueAt(global, segments),
    value,
    source,
    projectOverridden: projectOwned,
  };
}

// permission 标量键（read/write/*/CLI 工具等）：一条 rule。
function buildPermissionScalarRule(surface, global, project) {
  const segments = ["permission", surface];
  const { projectOwned, value, source } = sourceFor(project, segments);
  return {
    key: segments.join("."),
    // bash 字符串简写（gotgenes schema 允许 surface 级字符串 = {"*": state} 简写）
    family: surface === "bash" ? "bash" : "tool",
    label: surface === "bash" ? "bash 命令（字符串简写）" : (TOOL_LABELS[surface] ?? "工具级裁决"),
    readable: surface,
    type: "scalar",
    global: valueAt(global, segments),
    value,
    source,
    projectOverridden: projectOwned,
  };
}

// 顶层字段（authorizerChain/开关/预览长度等）：一条 rule（授权链与开关组）。
function buildTopLevelRule(key, global, project) {
  const segments = [key];
  const globalValue = valueAt(global, segments);
  const { projectOwned, value, source } = sourceFor(project, segments);
  const type =
    typeof globalValue === "boolean" ? "switch" : Array.isArray(globalValue) ? "array" : "scalar";
  return {
    key,
    family: "chain",
    label: TOP_LEVEL_LABELS[key] ?? key,
    readable: key,
    type,
    global: globalValue,
    value,
    source,
    projectOverridden: projectOwned,
  };
}

// shellTools 面：每工具一条 rule（嵌套对象形态——{commandArgument, workdirArgument}
// 整体是这条工具的 shell 语义映射，type:"shell-tool" 区别于 scalar/map-entry；
// 面板编辑器负责展示/编辑两个子字段，字段级覆盖整条映射）。
function buildShellToolRule(toolName, global, project) {
  const segments = ["shellTools", toolName];
  const { projectOwned, value, source } = sourceFor(project, segments);
  return {
    key: segments.join("."),
    family: "shell-tools",
    label: "非 bash 工具的 shell 语义别名（命令参数 → 命令/工作目录）",
    readable: toolName,
    type: "shell-tool",
    global: valueAt(global, segments),
    value,
    source,
    projectOverridden: projectOwned,
  };
}

function buildRules(global, project, merged) {
  const rules = [];
  const permission = merged?.permission;
  if (permission && typeof permission === "object") {
    for (const [surface, surfaceValue] of Object.entries(permission)) {
      if (surfaceValue && typeof surfaceValue === "object" && !Array.isArray(surfaceValue)) {
        for (const pattern of Object.keys(surfaceValue)) {
          // mcp 族默认（`*: ask`，signoff D4）不是规则行：部署 JSON 含
          // `permission.mcp = { "*": "ask" }`，但权限配置页 mcp 分组出厂零规则行
          // （E2E perm-rule-row count=0）——`*` 是族默认（族头「未匹配默认 ask」），
          // 规则行只列用户规则（项目覆盖层写入的 server:tool glob，如 "local-db:*"）。
          if (surface === "mcp" && pattern === "*") continue;
          rules.push(buildMapEntryRule(surface, pattern, global, project));
        }
      } else {
        rules.push(buildPermissionScalarRule(surface, global, project));
      }
    }
  }
  // shellTools 面（gotgenes shellToolsSchema：record<工具名, {commandArgument,
  // workdirArgument?}>，config-schema.ts 实证）：每工具一条 rule（非每子字段一条）。
  const shellTools = merged?.shellTools;
  if (shellTools && typeof shellTools === "object" && !Array.isArray(shellTools)) {
    for (const toolName of Object.keys(shellTools)) {
      rules.push(buildShellToolRule(toolName, global, project));
    }
  }
  for (const key of Object.keys(merged)) {
    if (key === "permission" || key === "shellTools" || key === "$schema") continue;
    rules.push(buildTopLevelRule(key, global, project));
  }
  return rules;
}

// —— 读取：继承视图组装（接口契约 3.1 GET 的数据面）——
// 返回 { global, project, merged, rules[], projectInvalid }；project=null = 未配置
// （空态，REQ-AGENT-067）；projectInvalid=true = 项目配置文件已损坏（E6，2026-08-11
// 人裁决落地）——UI 显示坏文件提示而非「未配置」空态，保存即覆盖修复。
export function getPermissionView(projectId) {
  const { projectConfigPath } = resolveProject(projectId);
  const global = readGlobalConfig();
  const { config: project, invalid: projectInvalid } = readProjectConfig(projectConfigPath);
  // 无项目文件 → merged = 全局原文（干净继承态，REQ-AGENT-061 标准 2）；坏文件
  // 同样回落全局（运行时对坏文件 fail-closed，UI 侧按全局默认展示 + 坏文件提示）。
  const merged = project ? mergeUnified(global, project) : global;
  const rules = buildRules(global, project, merged);
  return { global, project, merged, rules, projectInvalid };
}

// 含点 surface 防御（PRD 对齐缺口 7，2026-08-11 人裁决落地）：renderer 面板的
// 规则 key 协议 `permission.<surface>.<pattern>` 以点作结构分隔，segmentsOf 正则
// 限定 surface 不含点（`[^.]+`）——含点 surface（如 permission."custom.surface"）
// 会被面板误解析为 surface=custom + pattern=surface，面板保存生成的 payload 路径
// 损坏（一改即坏：删除/覆盖错位）。permission 面是 z.record（config-schema.ts
// 实证），gotgenes schema 接受任意字符串键（含点也过）——需在协议层补拦：
// 只拒「段内含点」的 surface 键；pattern 键（permission.bash."rm *"、
// permission.path."src/**" 等）在 map 内层，点只是 pattern 内容、非结构分隔，
// 不受影响。
function dotSurfaceIssues(config) {
  const issues = [];
  const permission = config?.permission;
  if (permission && typeof permission === "object" && !Array.isArray(permission)) {
    for (const key of Object.keys(permission)) {
      if (key.includes(".")) {
        issues.push({
          path: `permission.${key}`,
          message: "surface 名含点不支持（面板 key 协议以点作结构分隔，含点 surface 会被误解析）",
        });
      }
    }
  }
  return issues;
}

// —— 保存（接口契约 3.2 PUT 的数据面）——
// 校验 fail-closed（B10/T5）：gotgenes 同一把尺（validateWithGotgenes），非法 →
// E-PERMISSION-INVALID + 路径化 issues，不落盘。裁决 A：顶层未知键（strictObject）
// 会让运行时整集 fail-closed（全规则集回落 ask = 保存即全禁）→ 拒绝保存；
// permission 面内自定义 surface/pattern（z.record 合法）保留放行。
// 含点 surface（dotSurfaceIssues）为 schema 之外的协议层约束，一并拒绝。
// 成功 → 原子写 → { saved: true, mtime }（mtimeMs，供前端可选提示）。
// 观测（tech-design §7）：成功/校验失败/IO 失败三态日志 permission.save
// {projectId, mtime? | issues? | error}。
export function savePermission(projectId, config) {
  const { projectDir, projectConfigPath } = resolveProject(projectId);

  const dotIssues = dotSurfaceIssues(config);
  if (validateWithGotgenes(config) || dotIssues.length > 0) {
    const issues = [...validationIssues(config), ...dotIssues];
    if (issues.length > 0) {
      const err = new Error("permission config invalid");
      err.code = "E-PERMISSION-INVALID";
      err.issues = issues;
      console.warn(
        `[permissionConfig] permission.save {projectId: ${projectId}, issues: ${JSON.stringify(issues)}}`
      );
      throw err;
    }
  }

  const targetDir = path.dirname(projectConfigPath);
  // containment 校验先于 mkdirSync（防 symlink 逃逸时在项目外创建目录的副作用）。
  assertProjectConfigContained(projectDir, targetDir);

  const tmpPath = `${projectConfigPath}.tmp`;
  let mtime;
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const content = `${JSON.stringify(config, null, 2)}\n`;
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, projectConfigPath);
    mtime = fs.statSync(projectConfigPath).mtimeMs;
  } catch (err) {
    // mkdir/写/rename 统一 → E-PERMISSION-WRITE（目录不可写不再裸抛 → 500
    // VALIDATION_ERROR）；原子写失败不污染现有文件。
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // tmp 清理失败不影响主错误
    }
    const wrapped = new Error(`permission config write failed: ${err?.message ?? String(err)}`);
    wrapped.code = "E-PERMISSION-WRITE";
    console.warn(
      `[permissionConfig] permission.save {projectId: ${projectId}, error: E-PERMISSION-WRITE, message: ${err?.message ?? String(err)}}`
    );
    throw wrapped;
  }

  console.log(`[permissionConfig] permission.save {projectId: ${projectId}, mtime: ${mtime}}`);
  return { saved: true, mtime };
}
