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
  const firstWindow = await electronApp.firstWindow();
  return firstWindow.evaluate((list) => {
    if (!window.opc?.__seedNotifications) {
      throw new Error("E2E seed seam not available; ensure app is running with NODE_ENV=development");
    }
    return window.opc.__seedNotifications(list);
  }, notifications);
}

module.exports = { seedNotifications };
