// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-097
// REQ-VERSION: v1-hash:ff3ce6c28851eddb44986c153881ae32c5547116942bab700427cfca94e46514
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 图片附件注入协议（REQ-AGENT-097，B6 服务侧）。
//
// seam 1：POST /api/agent/sessions/:spaceKey/messages 扩展
//   {text, attachments:[{name, size, mimeType, kind:"image", path}]}（≤10）。
// seam 2：worker 侧按 path 读文件 → base64 → image content block（pi-ai 原生）。
// seam 3：JSONL 快照（pi-ai 上下文序列化——图片 base64 随消息持久化，重放可见）。
// seam 4：attachment-error 会话事件（E8：读取失败回 UI）。
//
// 环境：FAUX + 测试图片 fixture（tests/capabilities/.../fixtures/ 下真实小图）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const FIXTURE_PNG = path.join(FIXTURE_DIR, "tiny.png"); // 1x1 红色 PNG（生成 fixture）
const FIXTURE_SVG = path.join(FIXTURE_DIR, "bad.svg");

async function seedSettings(workdir) {
  fs.writeFileSync(
    path.join(workdir, "settings.json"),
    JSON.stringify({
      agent: {
        identity: "",
        providers: [{ provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] }],
        defaultModel: { provider: "moonshotai", model: "kimi-k3" },
      },
    }),
    "utf8"
  );
}

async function sendMessage(baseUrl, spaceKey, body) {
  return fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// SSE 流消费者（对齐 sessionEvents.test.js 先例）：取帧带超时 + waitForType 扫描。
function createSseStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  const waiters = [];
  let buffer = "";
  let failure = null;
  const deliver = (frame) => {
    const w = waiters.shift();
    if (w) w.resolve(frame);
    else frames.push(frame);
  };
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const rawFrame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const data = rawFrame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n");
          if (data === "") continue;
          let event;
          try { event = JSON.parse(data); } catch { event = { type: "__unparsed__", raw: data }; }
          deliver({ event });
        }
      }
    } catch (err) {
      failure = err;
    } finally {
      while (waiters.length > 0) waiters.shift().reject(failure ?? new Error("SSE 流已结束"));
    }
  })();
  return {
    next(timeoutMs, label) {
      if (frames.length > 0) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve: (f) => { clearTimeout(timer); resolve(f); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        };
        const timer = setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error(`等待 SSE 事件超时（${timeoutMs}ms）：${label}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    async waitForType(type, timeoutMs = 30000, label = type) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const frame = await this.next(Math.max(1, deadline - Date.now()), label);
        if (frame.event?.type === type) return frame;
      }
    },
    async close() {
      try { await reader.cancel(); } catch { /* 忽略断开异常 */ }
      try { await pump; } catch { /* 忽略断开异常 */ }
    },
  };
}

describe("REQ-AGENT-097 图片附件注入协议（B6 服务侧）", () => {
  let workdir;
  let server;
  let baseUrl;
  let spaceKey;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "attach-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    process.env.DB_PATH = path.join(workdir, "data.db");
    process.env.OPC_AGENT_FAUX = "1";
    // fixture：真实小图（1x1 PNG）——测试不依赖外部文件
    if (!fs.existsSync(FIXTURE_DIR)) fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    if (!fs.existsSync(FIXTURE_PNG)) {
      fs.writeFileSync(FIXTURE_PNG, Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
        "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082",
        "hex"
      ));
    }
    seedSettings(workdir);
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const res = await fetch(`${baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    spaceKey = (await res.json()).spaceKey;
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    delete process.env.DB_PATH;
    delete process.env.OPC_AGENT_FAUX;
  });

  it("带附件消息：worker 收到 image content block（base64 = 文件内容）", async () => {
    const res = await sendMessage(baseUrl, spaceKey, {
      text: "看看这张图",
      attachments: [{ name: "tiny.png", size: fs.statSync(FIXTURE_PNG).size, mimeType: "image/png", kind: "image", path: FIXTURE_PNG }],
    });
    assert.equal(res.status, 202);
    // JSONL 快照（pi-ai 原生序列化）：消息行 content 含 image block（base64 = 文件内容）
    const list = await (await fetch(`${baseUrl}/api/agent/sessions`)).json();
    const row = [...(list.general ?? [])].find((r) => r.spaceKey === spaceKey);
    assert.ok(row?.sessionRef, "会话行存在");
    const raw = fs.readFileSync(row.sessionRef, "utf8");
    assert.ok(raw.includes('"type":"image"') || raw.includes('"type": "image"'), "JSONL 含 image content block");
    assert.ok(raw.includes(Buffer.from(fs.readFileSync(FIXTURE_PNG)).toString("base64").slice(0, 32)), "image block 含文件 base64 内容");
  });

  it("JSONL 快照：消息行含附件内容，重放后仍可见", async () => {
    await sendMessage(baseUrl, spaceKey, {
      text: "看图",
      attachments: [{ name: "tiny.png", size: fs.statSync(FIXTURE_PNG).size, mimeType: "image/png", kind: "image", path: FIXTURE_PNG }],
    });
    // 重放：GET messages 含附件块（name 可见）；JSONL 行含 base64（懒恢复后仍在）
    const msgs = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`)).json();
    const rawJson = JSON.stringify(msgs);
    assert.ok(rawJson.includes("tiny.png"), "消息投影含附件名");
    const list = await (await fetch(`${baseUrl}/api/agent/sessions`)).json();
    const row = [...(list.general ?? [])].find((r) => r.spaceKey === spaceKey);
    assert.ok(fs.readFileSync(row.sessionRef, "utf8").includes('"image"'), "JSONL 含附件内容（重放可见）");
  });

  it("白名单外类型（SVG）→ 400 E-ATTACH-TYPE", async () => {
    const res = await sendMessage(baseUrl, spaceKey, {
      text: "",
      attachments: [{ name: "bad.svg", size: 10, mimeType: "image/svg+xml", kind: "image", path: FIXTURE_SVG }],
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "E-ATTACH-TYPE");
  });

  it("超数量（>10）/ 超大小（>10MB）→ 400 E-ATTACH-COUNT / E-ATTACH-SIZE", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      name: `img${i}.png`, size: 100, mimeType: "image/png", kind: "image", path: FIXTURE_PNG,
    }));
    const r1 = await sendMessage(baseUrl, spaceKey, { text: "", attachments: eleven });
    const b1 = await r1.json();
    assert.equal(r1.status, 400);
    assert.equal(b1.error, "E-ATTACH-COUNT");

    const big = [{ name: "big.png", size: 11 * 1024 * 1024, mimeType: "image/png", kind: "image", path: FIXTURE_PNG }];
    const r2 = await sendMessage(baseUrl, spaceKey, { text: "", attachments: big });
    const b2 = await r2.json();
    assert.equal(r2.status, 400);
    assert.equal(b2.error, "E-ATTACH-SIZE");
  });

  it("路径不存在 → 400 E-ATTACH-PATH（路由层校验；worker 读失败事件见 chmod-000 用例）", async () => {
    // 路由层校验（§10.4 接口 4：path 存在性）→ 不存在的路径 400 E-ATTACH-PATH
    const res = await sendMessage(baseUrl, spaceKey, {
      text: "",
      attachments: [{ name: "gone.png", size: 100, mimeType: "image/png", kind: "image", path: "/nonexistent/gone.png" }],
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "E-ATTACH-PATH");
  });

  it("worker 侧读取失败（存在但不可读）→ attachment-error 事件，消息不发送（E8）", async () => {
    // fixture：存在但 chmod 000 的图片（路由层 existsSync 通过 → worker 读失败路径）
    const lockedPath = path.join(FIXTURE_DIR, "locked.png");
    fs.copyFileSync(FIXTURE_PNG, lockedPath);
    fs.chmodSync(lockedPath, 0o000);
    try {
      // SSE 打开（对齐 sessionEvents.test.js 先例）
      const evRes = await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/events`);
      assert.equal(evRes.status, 200);
      const sse = createSseStream(evRes);
      try {
        const sendRes = await sendMessage(baseUrl, spaceKey, {
          text: "",
          attachments: [{ name: "locked.png", size: fs.statSync(lockedPath).size, mimeType: "image/png", kind: "image", path: lockedPath }],
        });
        assert.equal(sendRes.status, 202, "路由层校验通过（文件存在）");
        // attachment-error 事件到达 + 消息未发送（JSONL 无 image 行）
        const frame = await sse.waitForType("attachment-error", 15000, "attachment-error");
        assert.equal(frame.event.message, "文件读取失败");
        const list = await (await fetch(`${baseUrl}/api/agent/sessions`)).json();
        const row = [...(list.general ?? [])].find((r) => r.spaceKey === spaceKey);
        const raw = fs.readFileSync(row.sessionRef, "utf8");
        assert.ok(!raw.includes('"image"'), "读取失败时消息不发送（JSONL 无 image block）");
      } finally {
        await sse.close();
      }
    } finally {
      fs.chmodSync(lockedPath, 0o644); // 恢复权限便于清理
    }
  });

  it("无附件文本消息行为不变（回归）", async () => {
    const res = await sendMessage(baseUrl, spaceKey, { text: "纯文本消息" });
    assert.equal(res.status, 202);
    const msgs = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`)).json();
    assert.ok(msgs.messages.some((m) => m.role === "user"), "既有 messages 契约不破坏");
  });
});
