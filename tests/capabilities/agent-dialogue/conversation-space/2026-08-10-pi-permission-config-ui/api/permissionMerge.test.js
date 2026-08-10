// REQ-TRACE: 2026-08-10-pi-permission-config-ui/REQ-AGENT-061
// REQ-VERSION: v1-hash:4b944146fd166a4f60e5ba65080efefeb75690ff7be837718c867c2d2c01b77d
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// 继承视图 merge 对照测试（REQ-AGENT-061 标准 1）：我们的 merge 纯函数必须与
// gotgenes `mergeFlatPermissions` 语义一致——同一输入喂两边，输出逐字段一致。
//
// 为什么：继承视图显示"生效值"，若与 gotgenes 运行时合并语义不一致，UI 显示
// ≠ 实际执行（最危险错位，tech-design §6 决策 1）。对照测试锁死一致性。
//
// seam 1：我们的 merge（permissionConfigService 导出纯函数 mergePermissionView
//   或同类——BUILD 产物，动态 import，RED 失败而非 import 崩溃）。
// seam 2：gotgenes mergeFlatPermissions（node_modules 包源码，经 jiti 加载——
//   对齐 worker.js loadGotgenesFactory 先例；包为 TS 源码，测试经 jiti 编译）。

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const ROOT = path.resolve(fileURLToPath(new URL("../../../../../../", import.meta.url)));
const require = createRequire(import.meta.url);

async function loadGotgenesMerge() {
  // gotgenes 包入口 src/service.ts（包 exports "."），mergeFlatPermissions 在
  // src/permission-merge.ts——经 jiti 加载（moduleCache:false 防缓存旧版本）。
  const { createJiti } = await import("jiti").catch(() => ({ createJiti: null }));
  assert.ok(createJiti, "jiti 不可用（pi-coding-agent 传递依赖）");
  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
  const mod = await jiti.import(
    path.join(ROOT, "node_modules", "@gotgenes", "pi-permission-system", "src", "permission-merge.ts"),
    { default: true }
  );
  assert.ok(mod?.mergeFlatPermissions, "gotgenes mergeFlatPermissions 加载失败");
  return mod.mergeFlatPermissions;
}

async function loadOurMerge() {
  const mod = await import("../../../../../../src/services/permissionConfigService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：permissionConfigService 尚未实现（REQ-AGENT-061）");
  const fn = mod.mergePermissionView ?? mod.mergeFlatPermissions ?? mod.mergeScopes;
  assert.ok(typeof fn === "function", "permissionConfigService 应导出 merge 纯函数（mergePermissionView/mergeFlatPermissions/mergeScopes）");
  return fn;
}

describe("REQ-AGENT-061 标准 1：merge 语义与 gotgenes mergeFlatPermissions 对照", () => {
  let gotgenesMerge;
  let ourMerge;

  before(async () => {
    gotgenesMerge = await loadGotgenesMerge();
    ourMerge = await loadOurMerge();
  });

  const cases = [
    {
      name: "标量覆盖：项目写 value 替换全局",
      global: { permission: { write: "ask", read: "allow" } },
      project: { permission: { write: "allow" } },
    },
    {
      name: "对象浅合并：bash map 只覆盖写了的 pattern",
      global: { permission: { bash: { "*": "allow", "rm *": "ask", "sudo *": "ask" } } },
      project: { permission: { bash: { "rm *": "allow" } } },
    },
    {
      name: "未定义继承：项目没有的字段回落全局",
      global: { permission: { bash: { "rm *": "ask" }, write: "ask" } },
      project: { permission: { write: "allow" } },
    },
    {
      name: "数组整体替换：authorizerChain",
      global: { authorizerChain: ["opc-bridge"] },
      project: { authorizerChain: ["opc-bridge", "custom-gate"] },
    },
    {
      name: "顶层布尔覆盖",
      global: { yoloMode: false, debugLog: false },
      project: { yoloMode: true },
    },
    {
      name: "空项目 = 全局",
      global: { permission: { "*": "ask", write: "ask" } },
      project: {},
    },
    {
      name: "深层 path 对象浅合并",
      global: { permission: { path: { "*": "allow", "src/**": "allow" } } },
      project: { permission: { path: { "src/**": "ask" } } },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      // TODO: HUMAN ASSERTION — 确认两边输出一致（合并语义锁定）
      const got = gotgenesMerge(c.global, c.project);
      const ours = ourMerge(c.global, c.project);
      assert.deepEqual(ours, got);
    });
  }
});
