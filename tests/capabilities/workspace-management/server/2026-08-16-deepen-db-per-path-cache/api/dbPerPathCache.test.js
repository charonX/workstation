// REQ-TRACE: 2026-08-16-deepen-db-per-path-cache/REQ-WORKSPACE-014, 2026-08-16-deepen-db-per-path-cache/REQ-WORKSPACE-015, 2026-08-16-deepen-db-per-path-cache/REQ-WORKSPACE-016
// REQ-VERSION: v1-hash:db8799ff708bf6ed601f372d8fd76f1cf09dcaadabb993fe9c5e5affe5587357
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: server
// EXPECTED-TRACE: prd.md §6.3 锚点（getDb(A)===getDb(A) / getDb(B) 后 A 仍可用 / 异路径异句柄 / 句柄可跨路径持有 / closeDb 关全部重取重开 / 定向关 no-op / :memory: 共享+closeDb 清）+ §10.4 契约（getDb/closeDb(path?)/resetDb）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-WORKSPACE-014（per-path 连接缓存）/ REQ-WORKSPACE-015（closeDb 语义升级）/
// REQ-WORKSPACE-016（最少调用点清理回归门）直测。
// db.js 从全局单槽改为 per-path Map 缓存：同路径同句柄（可缓存）、多路径并存互不驱逐、
// closeDb() 关全部（+可选 closeDb(path) 定向关）、:memory: 缓存但 closeDb 清。
//
// seam：src/db.js 的 getDb/closeDb/resetDb/defaultDbPath（直接调用，临时文件库 + :memory:）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, closeDb, resetDb, defaultDbPath } from "../../../../../../src/db.js";

function makeDbPath(prefix) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), "test.db");
}

function queryOk(db) {
  return db.prepare("SELECT 1 AS ok").get();
}

describe("REQ-WORKSPACE-014 per-path 连接缓存", () => {
  let pathA;
  let pathB;

  beforeEach(() => {
    pathA = makeDbPath("dbpc-a-");
    pathB = makeDbPath("dbpc-b-");
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(path.dirname(pathA), { recursive: true, force: true });
    fs.rmSync(path.dirname(pathB), { recursive: true, force: true });
  });

  it("AC1: 同路径两次 getDb 返回同一句柄", () => {
    // EXPECTED-TRACE: prd.md §6.3（getDb(A) === getDb(A)）
    const a1 = getDb(pathA);
    const a2 = getDb(pathA);
    assert.equal(a1, a2, "同路径必须返回同一连接句柄");
  });

  it("AC2: 异路径并存——getDb(B) 后 A 仍可用", () => {
    // EXPECTED-TRACE: prd.md §6.3（getDb(B) 后 A 仍可执行查询）
    const a = getDb(pathA);
    const b = getDb(pathB);
    assert.notEqual(a, b, "异路径必须不同句柄");
    assert.deepEqual(queryOk(a), { ok: 1 }, "A 连接不得被 getDb(B) 关闭");
    assert.deepEqual(queryOk(b), { ok: 1 }, "B 连接可查");
  });

  it("AC3: 不同路径不同句柄", () => {
    // EXPECTED-TRACE: prd.md §6.3（getDb(A) !== getDb(B)）
    assert.notEqual(getDb(pathA), getDb(pathB));
  });

  it("AC4: 句柄可跨路径安全持有", () => {
    // EXPECTED-TRACE: prd.md §6.3（句柄可缓存；database-not-open 风险消除）
    const a = getDb(pathA);
    for (let i = 0; i < 5; i++) {
      getDb(pathB); // 反复切到 B
      assert.deepEqual(queryOk(a), { ok: 1 }, `第 ${i + 1} 次切 B 后 A 句柄仍可用`);
    }
  });

  it("AC5: 无参 getDb 走默认路径", () => {
    // EXPECTED-TRACE: prd.md §6.3（DB_PATH 未设 → defaultDbPath）
    const saved = process.env.DB_PATH;
    process.env.DB_PATH = pathA;
    try {
      assert.equal(getDb(), getDb(pathA), "无参 getDb 应使用 defaultDbPath（=DB_PATH）");
    } finally {
      if (saved === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = saved;
    }
  });
});

describe("REQ-WORKSPACE-015 closeDb 语义升级", () => {
  let pathA;
  let pathB;

  beforeEach(() => {
    pathA = makeDbPath("dbpc-ca-");
    pathB = makeDbPath("dbpc-cb-");
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(path.dirname(pathA), { recursive: true, force: true });
    fs.rmSync(path.dirname(pathB), { recursive: true, force: true });
  });

  it("AC1: closeDb() 关全部——重取重开", () => {
    // EXPECTED-TRACE: prd.md §6.3（closeDb 后重取重开新句柄可查）
    const a = getDb(pathA);
    const b = getDb(pathB);
    closeDb();
    assert.notEqual(getDb(pathA), a, "closeDb 后重取必须是新句柄");
    assert.notEqual(getDb(pathB), b, "closeDb 后 B 也重开");
    assert.deepEqual(queryOk(getDb(pathA)), { ok: 1 }, "重开后可查");
  });

  it("AC2: closeDb(pathA) 定向关——B 不受影响", () => {
    // EXPECTED-TRACE: prd.md §6.3（定向关只关 A）
    const a = getDb(pathA);
    const b = getDb(pathB);
    closeDb(pathA);
    assert.deepEqual(queryOk(b), { ok: 1 }, "B 连接不得被 closeDb(A) 关闭");
    assert.notEqual(getDb(pathA), a, "A 重开为独立新连接");
  });

  it("AC3: closeDb(不存在路径) no-op 不抛", () => {
    // EXPECTED-TRACE: prd.md §8（no-op 不抛）
    const b = getDb(pathB);
    assert.doesNotThrow(() => closeDb("/nonexistent/nope.db"));
    assert.deepEqual(queryOk(b), { ok: 1 }, "no-op 后既有连接不受影响");
  });

  it("AC4: :memory: 共享 + closeDb 清", () => {
    // EXPECTED-TRACE: prd.md §6.3（:memory: 两服务同路径共享；closeDb 后新库）
    const m1 = getDb(":memory:");
    const m2 = getDb(":memory:");
    assert.equal(m1, m2, ":memory: 同路径必须共享同一句柄");
    closeDb();
    assert.notEqual(getDb(":memory:"), m1, "closeDb 后 :memory: 重新取为新库");
  });

  it("AC5: resetDb(pathA) 只 drop A，B 不受影响", () => {
    // EXPECTED-TRACE: prd.md §10.4（resetDb 不变，操作指定路径库）
    const a = getDb(pathA);
    const b = getDb(pathB);
    a.prepare("CREATE TABLE IF NOT EXISTS t (id INTEGER)").run();
    a.prepare("INSERT INTO t (id) VALUES (1)").run();

    resetDb(pathA);

    // A 表已 drop
    assert.throws(() => a.prepare("SELECT * FROM t").get(), /no such table/i);
    // B 不受影响
    assert.deepEqual(queryOk(b), { ok: 1 });
  });
});

describe("REQ-WORKSPACE-016 最少必要调用点清理（回归门）", () => {
  it("AC1: 清理后既有调用点零破坏（全量回归门——本文件各用例 + 全量 test:unit 共同承载）", () => {
    // EXPECTED-TRACE: prd.md §11.1（55 调用点零改动全绿为硬约束）
    // 本文件的核心断言（getDb 同句柄/并存/closeDb 语义）即调用点清理后行为不变的代表；
    // 全量回归由 QA 门跑。此处用一次真实双库操作代表"句柄持有 + 切换路径"的调用点形态。
    const pathA = makeDbPath("dbpc-r1-");
    const pathB = makeDbPath("dbpc-r2-");
    try {
      const a = getDb(pathA);
      a.prepare("CREATE TABLE IF NOT EXISTS t (id INTEGER)").run();
      a.prepare("INSERT INTO t (id) VALUES (1)").run();
      getDb(pathB); // 切路径后 A 句柄仍可查（调用点无需重取）
      assert.deepEqual(a.prepare("SELECT COUNT(*) AS c FROM t").get(), { c: 1 });
    } finally {
      closeDb();
      fs.rmSync(path.dirname(pathA), { recursive: true, force: true });
      fs.rmSync(path.dirname(pathB), { recursive: true, force: true });
    }
  });
});
