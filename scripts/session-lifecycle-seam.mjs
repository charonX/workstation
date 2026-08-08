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
