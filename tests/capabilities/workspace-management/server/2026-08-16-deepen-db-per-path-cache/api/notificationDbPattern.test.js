// REQ-TRACE: 2026-08-16-deepen-db-per-path-cache/REQ-WORKSPACE-016
// REQ-VERSION: v1-hash:db8799ff708bf6ed601f372d8fd76f1cf09dcaadabb993fe9c5e5affe5587357
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: server
// EXPECTED-TRACE: prd.md §10.5 D5（透明替换，行为不变）+ §11.1（55 调用点零改动全绿）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// BUG-001 回归（REQ-WORKSPACE-016 调用点清理漏网）：
// notificationService.js 是 per-path 缓存后全库唯一仍模块级持句柄 + 自愈
// （getDbRef `!db || !db.open`）+ closed-error 检测（isDbClosedError）的站点——
// 单槽时代的防御机制。per-op getDb() 始终返回有效缓存连接，自愈与检测成为死复杂度，
// 应迁移为 per-op 取用（与其余 54 处调用点一致）。
//
// seam 1（静态）：notificationService.js 源码不应再含模块级持句柄/自愈/closed-error 检测。
// seam 2（行为）：notify/list/markRead 在 closeDb() 关全部后仍可用（per-op getDb 自动重开）。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("BUG-001: notificationService 迁移 per-op getDb（无模块级持句柄/自愈）", () => {
  it("1. 静态断言：notificationService.js 不再含模块级持句柄 / getDbRef 自愈 / isDbClosedError", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../../../../src/services/notificationService.js"),
      "utf-8"
    );
    assert.doesNotMatch(src, /^let\s+db\s*=\s*null;/, "不应再模块级持有 db 句柄（let db = null）");
    assert.doesNotMatch(src, /function\s+getDbRef\s*\(/, "不应再有 getDbRef 自愈函数");
    assert.doesNotMatch(src, /function\s+isDbClosedError\s*\(/, "不应再有 isDbClosedError 检测");
  });

  it("2. 行为断言：notify/list/markRead 在 closeDb() 后仍可用（per-op getDb 保持 closeDb 弹性）", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bug001-notify-"));
    const prevDbPath = process.env.DB_PATH;
    process.env.DB_PATH = path.join(tmpDir, "data.db");
    try {
      const { notify, list, markRead } = await import("../../../../../../src/services/notificationService.js");
      const { closeDb } = await import("../../../../../../src/db.js");

      notify({ type: "artifact", title: "t1", body: "b1", executionId: "e1" });
      assert.equal(list().length, 1, "notify 后应能 list 到 1 条");

      // closeDb() 关全部缓存连接；下一次操作经 per-op getDb() 自动重开（无需自愈）。
      closeDb();

      notify({ type: "artifact", title: "t2", body: "b2" });
      const rows = list();
      assert.equal(rows.length, 2, "closeDb 后 notify/list 应仍可用（重开新连接）");
      assert.equal(rows[0].title, "t2");

      markRead({ ids: [rows[0].id] });
      assert.equal(list({ unreadOnly: true }).length, 1, "markRead 后未读应剩 1 条");
    } finally {
      process.env.DB_PATH = prevDbPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
