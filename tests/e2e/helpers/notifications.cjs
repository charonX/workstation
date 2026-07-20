// REQ-TRACE: 2026-07-19-media-production-line/REQ-NOTIFY-001, 2026-07-19-media-production-line/REQ-NOTIFY-002
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: information-aggregation
// ENTITY-TRACE: notification
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

/**
 * 通知表直写播种 helper（REQ-NOTIFY-002 E2E 签核决策：不开放 POST 写入面）。
 *
 * 经 electronApp.evaluate 在 Electron 主进程内用 better-sqlite3 直写
 * <userDataDir>/data.db 的 notifications 表——主进程与应用同 ABI（plain node
 * 侧 require better-sqlite3 会与 electron ABI 冲突，故必须在主进程内执行）。
 * 表不存在时按 REQ-NOTIFY-001 契约建表（属测试基础设施）。
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {string} userDataDir
 * @param {Array<{id: string, type: "artifact"|"execution-failed"|"channel-status", title: string, body?: string, executionId?: string, createdAt: string, readAt?: string|null}>} notifications
 * @returns {Promise<number>} 写入条数
 */
async function seedNotifications(electronApp, userDataDir, notifications) {
  return electronApp.evaluate(async ({ userDataDir, notifications }) => {
    const path = await import("node:path");
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(path.join(userDataDir, "data.db"));
    try {
      db.pragma("busy_timeout = 5000");
      db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          executionId TEXT,
          createdAt TEXT NOT NULL,
          readAt TEXT
        );
      `);
      const insert = db.prepare(`
        INSERT OR REPLACE INTO notifications (id, type, title, body, executionId, createdAt, readAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const n of notifications) {
        insert.run(n.id, n.type, n.title, n.body ?? null, n.executionId ?? null, n.createdAt, n.readAt ?? null);
      }
      return notifications.length;
    } finally {
      db.close();
    }
  }, { userDataDir, notifications });
}

module.exports = { seedNotifications };
