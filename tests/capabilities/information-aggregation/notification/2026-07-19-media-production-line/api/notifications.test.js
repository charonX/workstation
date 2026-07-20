// REQ-TRACE: 2026-07-19-media-production-line/REQ-NOTIFY-001
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: information-aggregation
// ENTITY-TRACE: notification
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";

// 签核 API 面：
//   GET  /api/notifications[?unreadOnly=1]  → { items, unreadCount }（按 createdAt 倒序）
//   POST /api/notifications/:id/read        → 单条已读
//   POST /api/notifications/read-all        → 全部已读
//   CLI：`notify list [--unread]` / `notify read --id <id> | --all`

// seam：notificationService（tech-design 契约：notify({type,title,body,executionId?}) /
// list({unreadOnly?}) / markRead({ids|all})）。
async function loadNotificationService() {
  const mod = await import("../../../../../../src/services/notificationService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/notificationService.js 尚未实现（REQ-NOTIFY-001）");
  assert.equal(typeof mod.notify, "function", "notificationService 应导出 notify()");
  assert.equal(typeof mod.list, "function", "notificationService 应导出 list()");
  assert.equal(typeof mod.markRead, "function", "notificationService 应导出 markRead()");
  return mod;
}

async function apiNotifications(baseUrl) {
  const res = await fetch(`${baseUrl}/api/notifications`);
  assert.equal(res.status, 200, "GET /api/notifications 应可用");
  const data = await res.json();
  // 签核响应形状：{ items, unreadCount }。
  assert.ok(Array.isArray(data.items), `响应应含 items 数组，实际: ${JSON.stringify(data).slice(0, 200)}`);
  assert.equal(typeof data.unreadCount, "number", "响应应含数值 unreadCount");
  return data;
}

describe("REQ-NOTIFY-001: 通知服务", () => {
  let serverCtx;
  let service;

  beforeEach(async () => {
    serverCtx = await startServer();
    service = await loadNotificationService();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("AC1/AC2: 三类事件源写入，字段完整（id/type/title/body/executionId?/createdAt/readAt）", async () => {
    service.notify({ type: "artifact", title: "日报已生成", body: "outputs/daily/x.md", executionId: "exec-1" });
    service.notify({ type: "execution-failed", title: "执行失败", body: "E-AGENT-FAILED", executionId: "exec-2" });
    service.notify({ type: "channel-status", title: "飞书通道掉线", body: "E-CHANNEL-DOWN" });

    const list = service.list();
    assert.equal(list.length, 3);
    for (const item of list) {
      for (const field of ["id", "type", "title", "body", "createdAt"]) {
        assert.ok(field in item, `通知应含字段 ${field}`);
      }
      assert.ok("readAt" in item, "通知应含 readAt 字段（未读为 null）");
    }
    assert.deepEqual(new Set(list.map((n) => n.type)), new Set(["artifact", "execution-failed", "channel-status"]));
  });

  it("AC3: /api/notifications 按时间倒序 + 未读数", async () => {
    service.notify({ type: "artifact", title: "第一条", body: "b1" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    service.notify({ type: "channel-status", title: "第二条", body: "b2" });

    const { items, unreadCount } = await apiNotifications(serverCtx.baseUrl);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, "第二条", "列表应按时间倒序（最新在前）");
    assert.equal(unreadCount, 2, "未读数应为 2");
  });

  it("AC3: 标记已读（单条/全部）后未读数清零", async () => {
    service.notify({ type: "artifact", title: "n1", body: "b" });
    service.notify({ type: "artifact", title: "n2", body: "b" });
    const { items } = await apiNotifications(serverCtx.baseUrl);

    const single = await fetch(`${serverCtx.baseUrl}/api/notifications/${items[0].id}/read`, { method: "POST" });
    assert.ok(single.ok, "单条已读端点应可用");
    let state = await apiNotifications(serverCtx.baseUrl);
    assert.equal(state.unreadCount, 1);
    const readItem = state.items.find((n) => n.id === items[0].id);
    assert.ok(readItem.readAt, "已读通知应有 readAt");

    const all = await fetch(`${serverCtx.baseUrl}/api/notifications/read-all`, { method: "POST" });
    assert.ok(all.ok, "全部已读端点应可用");
    state = await apiNotifications(serverCtx.baseUrl);
    assert.equal(state.unreadCount, 0, "全部已读后未读数清零");
    assert.ok(state.items.every((n) => n.readAt), "全部已读后所有通知应有 readAt");
  });

  it("AC3: unreadOnly 过滤", async () => {
    service.notify({ type: "artifact", title: "keep-unread", body: "b" });
    const read = service.notify({ type: "artifact", title: "make-read", body: "b" });
    service.markRead({ ids: [read.id] });

    const res = await fetch(`${serverCtx.baseUrl}/api/notifications?unreadOnly=1`);
    assert.equal(res.status, 200);
    const { items } = await res.json();
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "keep-unread");
  });

  it("AC3: CLI notify list / read 等价", async () => {
    service.notify({ type: "artifact", title: "cli-notify", body: "b" });

    const list = JSON.parse(execSync(`${CLI} notify list`, { encoding: "utf-8" }));
    const items = Array.isArray(list) ? list : list.items;
    assert.ok(items.some((n) => n.title === "cli-notify"));

    execSync(`${CLI} notify read --all`, { encoding: "utf-8" });
    const after = JSON.parse(execSync(`${CLI} notify list --unread`, { encoding: "utf-8" }));
    const unread = Array.isArray(after) ? after : after.items;
    assert.equal(unread.length, 0, "CLI 全部已读后未读列表为空");
  });

  it("AC4: 写入失败仅记日志（E-NOTIFY-FAILED），不阻断主流程", async () => {
    // 破坏 DB 连接模拟写入失败；notify 不得抛出，且应记 E-NOTIFY-FAILED 日志。
    const dbMod = await import("../../../../../../src/db.js");
    dbMod.closeDb();

    const logged = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => logged.push(args.map(String).join(" "));
    console.error = (...args) => logged.push(args.map(String).join(" "));
    try {
      assert.doesNotThrow(() => service.notify({ type: "artifact", title: "x", body: "y" }),
        "通知写入失败不应向调用方抛出（不阻断主流程）");
    } finally {
      console.log = origLog;
      console.error = origError;
    }
    assert.match(logged.join("\n"), /E-NOTIFY-FAILED/, "写入失败应记 E-NOTIFY-FAILED 日志");
  });
});
