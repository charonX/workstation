// scripts/session-lifecycle-seam.mjs
// 测试 seam 预载（node --import）：把 sessionLifecycle 模块的 public 接口暴露为
// node:test 全局（tests/.../sessionLifecycleModule|sessionIdleEviction|sessionLruCap|
// sessionGroupCooling.test.js 按签核契约以裸全局引用 createSessionLifecycle/groupOf，
// 测试文件只读不 import）。
//
// 注入方式：package.json test:unit 经 `node --import ./scripts/session-lifecycle-seam.mjs
// --test ...` 预载；node --test 的测试子进程继承 execArgv，全局注入随每个测试文件生效。
// 生产代码不加载本文件（src/ 零影响）。
import { createSessionLifecycle, groupOf } from "../src/agent/sessionLifecycle.js";

globalThis.createSessionLifecycle = createSessionLifecycle;
globalThis.groupOf = groupOf;

// 测试隔离（ADR-0040，BUG-001）：注册表锚点为机器级固定路径 ~/.opc-workstation/server.json，
// 不设覆盖时测试内 startServer/registerServerRecord 会写真实机器注册表（污染外部发现）。
// 预载时默认指向 per-process tmp 文件（node --test 每测试文件一个子进程，天然按文件隔离）；
// 个别测试自设 OPC_SERVER_REGISTRY_FILE 时不覆盖（如 serverDiscovery.test.js 的用例级罩）。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

if (process.env.NODE_ENV === "test" && !process.env.OPC_SERVER_REGISTRY_FILE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-test-registry-"));
  process.env.OPC_SERVER_REGISTRY_FILE = path.join(dir, "server.json");
}
