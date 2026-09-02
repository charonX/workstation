// REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-008
// REQ-VERSION: v1-hash:d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9
// CAPABILITY-TRACE: file-preview
// ENTITY-TRACE: file-preview-panel
// EXPECTED-TRACE: prd.md §10.4 接口3 全部样例 / 接口5 全部样例, §10.3 流A 步骤4, §10.5 决策5（rename 归并）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// seam：watch 生命周期 HTTP 端点 + 既有会话 SSE 推送（ADR-042 决策1）——
//   POST   /api/agent/files/watch  {projectId, path} → {watchId}（同键幂等）
//   DELETE /api/agent/files/watch/:watchId → 204（重复幂等）
//   推送   GET /api/agent/sessions/:spaceKey/events 流上 file-preview-changed 帧
//          （帧格式沿袭 sessionSseRegistry：`data: <json>\n\n`，type 字段为传输判别，
//           载荷 {projectId, path, change} 见 §10.4 接口5）
// 真实依赖：真实 fs fixture + fs.watch（不 mock 文件系统事件，防抖/归并语义必须真实时序验证）。
// SSE 捕获：项目空间会话（POST /api/agent/sessions {spaceKind:"project", projectId}）
// 的 events 流；peekAgentService 语义保证开流不启动 agent 子进程（无需配置 provider）。

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

let serverCtx, baseUrl, rootDir, projectId, spaceKey;

async function postJson(urlPath, payload) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function del(urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`, { method: "DELETE" });
  return { status: res.status };
}

// —— SSE 捕获助手：收集 file-preview-changed 帧 ——
// 返回 { frames(), connected, close() }；connected 在响应头到达（流建立）时即 resolve，
// 读帧循环后台常驻（长连接不 resolve 整体 promise）。
function openPreviewEventStream() {
  const frames = [];
  let buffer = "";
  const decoder = new TextDecoder();
  const ctrl = new AbortController();
  let resolveConnected;
  const connected = new Promise((resolve) => { resolveConnected = resolve; });
  (async () => {
    try {
      const res = await fetch(`${baseUrl}/api/agent/sessions/${encodeURIComponent(spaceKey)}/events`, {
        signal: ctrl.signal,
      });
      resolveConnected(res);
      if (res.status !== 200) return;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const ev = JSON.parse(dataLine.slice(6));
          if (ev.type === "file-preview-changed") frames.push(ev);
        }
      }
    } catch {
      /* abort/断开为正常收尾 */
    }
  })();
  const stream = {
    frames: () => frames,
    connected: connected.then((res) => {
      assert.equal(res.status, 200, `setup：SSE events 流应 200，实际 ${res.status}`);
    }),
    close: () => ctrl.abort(),
  };
  sseStreams.push(stream);
  return stream;
}
const sseStreams = [];

function previewFrames(stream, p) {
  return stream.frames().filter((f) => f.projectId === projectId && f.path === p);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-watch-"));
  fs.mkdirSync(path.join(rootDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), "v1");

  serverCtx = await startServer({ port: 0 });
  baseUrl = serverCtx.baseUrl;

  // agent 配置注入（生产等价：设置页保存 provider+key；NODE_ENV=test 自动 FAUX，不触网。
  // 先例：sessionEvents.test.js configureAgent——项目空间会话创建需要 provider 已配置）
  const settingsMod = await import("../../../../../../src/services/settingsService.js");
  settingsMod.saveAgentConfig({ provider: "deepseek", apiKey: "sk-test-faux" });
  const proj = await postJson("/api/projects", { name: "fp-watch-fixture", localPath: rootDir });
  assert.ok(proj.status === 200 || proj.status === 201, `setup：创建项目应 2xx：${JSON.stringify(proj.body)}`);
  projectId = proj.body.id ?? proj.body.project?.id;
  const sess = await postJson("/api/agent/sessions", { spaceKind: "project", projectId });
  assert.equal(sess.status, 200, `setup：项目空间会话应 200：${JSON.stringify(sess.body)}`);
  spaceKey = sess.body.spaceKey;
});

after(async () => {
  // 先收 SSE 连接再停 server：打开的流式响应会阻塞 server.close()（先例 sessionEvents.test.js）。
  for (const s of sseStreams) s.close();
  await sleep(150);
  // teardown 卫生：清掉 keep-alive 空闲连接，避免 server.close 挂等（非断言面）。
  try { serverCtx?.server?.closeAllConnections?.(); } catch {}
  if (serverCtx) await stopServer(serverCtx);
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("REQ-PREVIEW-008 AC1/AC3：注册/注销幂等", () => {
  it("POST 同 (projectId, path) 两次 → 同一 watchId；DELETE → 204；重复 DELETE → 204", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口3 样例行「正常」（同键幂等返回同一 watchId）
    const a = await postJson("/api/agent/files/watch", { projectId, path: "docs/guide.md" });
    assert.equal(a.status, 200);
    assert.ok(a.body.watchId, "应返回 watchId");
    const b = await postJson("/api/agent/files/watch", { projectId, path: "docs/guide.md" });
    assert.equal(b.status, 200);
    assert.equal(b.body.watchId, a.body.watchId, "同键重复 POST 幂等返回同一 watchId");

    // EXPECTED-TRACE: prd.md §10.4 接口3 样例行「异常」（DELETE 不存在 watchId → 204 幂等吞掉）
    assert.equal((await del(`/api/agent/files/watch/${a.body.watchId}`)).status, 204);
    assert.equal((await del(`/api/agent/files/watch/${a.body.watchId}`)).status, 204);
    assert.equal((await del(`/api/agent/files/watch/w-never-existed`)).status, 204);
  });
});

describe("REQ-PREVIEW-008 AC2：注册边界", () => {
  it("目标文件不存在 → E-PREVIEW-NOT-FOUND 且不注册（随后落盘不产生事件）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口3 样例行「边界」（文件被删后 POST → E2 不注册）
    const stream = openPreviewEventStream();
    await stream.connected;
    const r = await postJson("/api/agent/files/watch", { projectId, path: "docs/ghost.md" });
    assert.ok(r.status >= 400);
    assert.equal(r.body.error, "E-PREVIEW-NOT-FOUND");

    fs.writeFileSync(path.join(rootDir, "docs", "ghost.md"), "born");
    await sleep(600); // > 200ms 防抖窗口 ×3，足够任何误注册触发推送
    assert.deepEqual(previewFrames(stream, "docs/ghost.md"), [], "E2 不注册：落盘不应产生事件");
    stream.close();
  });

  it("越界路径 → E-PREVIEW-OUTSIDE-ROOT", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口3 业务错误行（边界校验同接口2）
    const r = await postJson("/api/agent/files/watch", { projectId, path: "../outside.txt" });
    assert.ok(r.status >= 400);
    assert.equal(r.body.error, "E-PREVIEW-OUTSIDE-ROOT");
  });
});

describe("REQ-PREVIEW-008 AC4：200ms 防抖合并", () => {
  it("200ms 窗口内连续 3 次落盘 → 仅 1 次 modified 事件", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口5 样例行「连写合并」（3 次落盘 → 仅 1 次事件）
    const stream = openPreviewEventStream();
    await stream.connected;
    const w = await postJson("/api/agent/files/watch", { projectId, path: "docs/guide.md" });
    assert.equal(w.status, 200);

    for (const v of ["v2", "v3", "v4"]) {
      fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), v);
      await sleep(50); // 3 次写入落在 200ms 防抖窗口内
    }
    await sleep(800); // 等防抖窗口关闭 + 推送到达

    const frames = previewFrames(stream, "docs/guide.md");
    assert.equal(frames.length, 1, `3 次连写应合并为 1 次事件，实际 ${frames.length}`);
    assert.equal(frames[0].change, "modified");
    await del(`/api/agent/files/watch/${w.body.watchId}`);
    stream.close();
  });
});

describe("REQ-PREVIEW-008 AC5：删除 → deleted 事件 + 自动注销", () => {
  it("删除被监听文件 → 推送 deleted；随后重建文件不再产生事件（句柄不泄漏）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口5 样例行「删除」（deleted 事件；监听注销）
    const target = path.join(rootDir, "docs", "doomed.md");
    fs.writeFileSync(target, "x");
    const stream = openPreviewEventStream();
    await stream.connected;
    const w = await postJson("/api/agent/files/watch", { projectId, path: "docs/doomed.md" });
    assert.equal(w.status, 200);

    fs.rmSync(target);
    await sleep(800);
    const frames = previewFrames(stream, "docs/doomed.md");
    assert.ok(frames.some((f) => f.change === "deleted"), `应有 deleted 事件，实际 ${JSON.stringify(frames)}`);

    fs.writeFileSync(target, "reborn");
    await sleep(600);
    const after_ = previewFrames(stream, "docs/doomed.md").filter((f) => f.change === "modified");
    assert.deepEqual(after_, [], "deleted 后服务端自动注销：重建不应再推送");
    // 自动注销后 DELETE 仍 204（幂等吞掉）
    assert.equal((await del(`/api/agent/files/watch/${w.body.watchId}`)).status, 204);
    stream.close();
  });
});

describe("REQ-PREVIEW-008 AC6：原子写（rename 覆盖）归并", () => {
  it("临时文件 + rename 覆盖 → 归并为一次 modified 事件（无 deleted）", async () => {
    // EXPECTED-TRACE: prd.md §10.5 决策5（编辑器原子写在 macOS 表现为 rename 序列，归并后等价修改）
    const target = path.join(rootDir, "docs", "atomic.md");
    fs.writeFileSync(target, "a1");
    const stream = openPreviewEventStream();
    await stream.connected;
    const w = await postJson("/api/agent/files/watch", { projectId, path: "docs/atomic.md" });
    assert.equal(w.status, 200);
    await sleep(100);

    const tmp = path.join(rootDir, "docs", ".atomic.md.tmp");
    fs.writeFileSync(tmp, "a2");
    fs.renameSync(tmp, target);
    await sleep(800);

    const frames = previewFrames(stream, "docs/atomic.md");
    const modified = frames.filter((f) => f.change === "modified");
    const deleted = frames.filter((f) => f.change === "deleted");
    assert.equal(modified.length, 1, `rename 覆盖应归并为 1 次 modified，实际 ${JSON.stringify(frames)}`);
    assert.equal(deleted.length, 0, "原子写不应产生 deleted");
    await del(`/api/agent/files/watch/${w.body.watchId}`);
    stream.close();
  });
});
