#!/usr/bin/env node
// scripts/gen-agent-policy.mjs
// 出厂权限策略生成器（tech-design 接口 4；REQ-AGENT-041）——配平测试与开发者
// 共用同一入口。
//
// 默认模式：`node scripts/gen-agent-policy.mjs`
//   规则表 policyRules（hotPathVisible:true 且 decision:ask 族的 globs）+ 静态
//   模板字段 → 覆写 agent-policy/pi-permission-config.json。
//   不可见族（hotPathVisible:false——重定向/管道，* > * / * >> * / *|*sh / *|*bash
//   等）不出现在产物：B7「不可见族只活在 pre-gate」。
// --check 模式：`node scripts/gen-agent-policy.mjs --check`
//   不写文件，diff 生成结果与检入文件——一致 exit 0；漂移 exit 1 + diff 摘要
//   （E3 漂移拦截：配平测试红，不进部署）。
//
// 真源职责划分：
//   - 规则字段（bash 破坏性模式 + 可见性）只来自 src/services/policyRules.js；
//   - 静态模板字段（debugLog/authorizerChain/长度上限等非规则字段 + 非 bash 的
//     permission 块——读/写工具默认 + CLI 工具面）只来自本文件 STATIC_TEMPLATE
//     （自既有 golden 平移；CLI 面与 toolAdapter TOOL_DEFS 单一真源对应）。
// 两者在产物内不重叠——改规则只动 policyRules，golden 由生成器产出。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASH_RULES } from "../src/services/policyRules.js";

const GOLDEN_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "agent-policy",
  "pi-permission-config.json"
);

// 静态模板字段（非规则字段；自既有 golden 平移，键序 = 产物 JSON 键序）。
// permission 块的静态部分按原 golden 键序分段（bash 由规则表生成、夹在工具面
// 中间——见 buildConfig 组装，保持既有结构可审）。
const STATIC_TEMPLATE = {
  $schema:
    "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-system/schemas/permissions.schema.json",
  debugLog: false,
  permissionReviewLog: false,
  yoloMode: false,
  doublePressToConfirm: false,
  toolInputPreviewMaxLength: 400,
  toolTextSummaryMaxLength: 120,
  piInfrastructureReadPaths: [],
  // 链序（Slice 3，REQ-AGENT-073）：auto-judge 在前（allow 直放/deny 短路），
  // defer 落回 opc-bridge 确认卡。非 auto 模式下 auto-judge 由 worker 侧模式门控
  // 纯 defer（净效果 = 现状 ["opc-bridge"]）——见 build-progress Slice 3。
  authorizerChain: ["auto-judge", "opc-bridge"],
};

// permission 块静态分段（自既有 golden 平移；CLI 面与 toolAdapter TOOL_DEFS 对应）。
const PERMISSION_TOP_SURFACES = {
  "*": "ask",
  path: { "*": "allow" },
  external_directory: { "*": "ask" },
};
const READ_WRITE_SURFACES = {
  read: "allow",
  ls: "allow",
  grep: "allow",
  find: "allow",
  write: "ask",
  edit: "ask",
  create: "ask",
  delete: "ask",
};
const CLI_SURFACES = {
  "task list": "allow",
  "task get": "allow",
  "task run": "allow",
  "flow list": "allow",
  "flow get": "allow",
  "flow create": "ask",
  "flow import": "ask",
  "flow export": "ask",
  "flow delete": "ask",
  "project list": "allow",
  "project get": "allow",
  "project create": "ask",
  "project update": "ask",
  "project delete": "ask",
  "project skill": "ask",
  "schedule list": "allow",
  "schedule create": "ask",
  "schedule toggle": "ask",
  "schedule delete": "ask",
  "settings get": "allow",
  "settings set": "ask",
  "skill list": "allow",
  "skill agents": "allow",
  "skill install": "ask",
  "skill update": "ask",
  "skill remove": "ask",
  "dashboard stats": "allow",
  "notify list": "allow",
  "notify read": "allow",
  "source list": "allow",
  "source create": "ask",
  "source update": "ask",
  "source toggle": "ask",
  "source delete": "ask",
  "channel binding": "allow",
  "channel status": "allow",
  "channel bind": "ask",
  "channel credentials": "ask",
  "channel reconnect": "ask",
};

// bash surface：`*` 通配默认 allow + 规则表 hotPathVisible:true 且 decision:ask
// 族的 globs（保持规则表序；不可见族不出现）。
function buildBashSurface() {
  const bash = { "*": "allow" };
  for (const rule of BASH_RULES) {
    if (rule.hotPathVisible !== true || rule.decision !== "ask") continue;
    for (const glob of rule.globs ?? []) bash[glob] = "ask";
  }
  return bash;
}

function buildConfig() {
  return {
    ...STATIC_TEMPLATE,
    permission: {
      ...PERMISSION_TOP_SURFACES,
      ...READ_WRITE_SURFACES,
      bash: buildBashSurface(),
      ...CLI_SURFACES,
    },
  };
}

// 简单 LCS 行 diff（无外部依赖；行数 ~110，DP 开销可忽略）。
function diffLines(aLines, bLines) {
  const n = aLines.length;
  const m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push(`  ${aLines[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`- ${aLines[i]}`);
      i++;
    } else {
      out.push(`+ ${bLines[j]}`);
      j++;
    }
  }
  while (i < n) out.push(`- ${aLines[i]}`);
  while (j < m) out.push(`+ ${bLines[j]}`);
  return out;
}

function main() {
  const check = process.argv.includes("--check");
  const generated = `${JSON.stringify(buildConfig(), null, 2)}\n`;
  const existing = fs.existsSync(GOLDEN_PATH) ? fs.readFileSync(GOLDEN_PATH, "utf8") : null;
  if (check) {
    if (generated === existing) {
      console.log(`[gen-agent-policy] --check: 一致（${GOLDEN_PATH}）`);
      process.exit(0);
    }
    console.error(`[gen-agent-policy] --check: 漂移——检入产物与规则表生成结果不一致（${GOLDEN_PATH}）`);
    console.error("diff 摘要（- 检入 / + 生成，最多 40 行）：");
    for (const line of diffLines((existing ?? "").split("\n"), generated.split("\n")).slice(0, 40)) {
      console.error(line);
    }
    process.exit(1);
  }
  fs.writeFileSync(GOLDEN_PATH, generated);
  console.log(`[gen-agent-policy] 已覆写 ${GOLDEN_PATH}`);
}

main();
