// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-012
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: BUG-007

// BUG-007 回归：agent worker 的 CLI 工具必须直连主进程 server，永不自起 server。
//
// 生产事故实锤（2026-08-09）：应用启动窗口期（主 server 尚未注册）用户发出对话，
// worker 执行 project_list → ensureServer 注册表发现失败 → headless 兜底超时 →
// **worker 进程内 startInProcessServer**——purge/飞书/lark SDK 日志全部写 worker
// stdout（主进程逐行报「子进程非法消息行」，IPC 协议流被污染），且 worker 内常驻
// 第二个完整 server（重复飞书 WebSocket 连接、重复 purge cron、事件循环争用）。
//
// 修复契约（REQ-AGENT-012 标准 3「发现主进程 server」的确定性化）：
// ① 主进程 spawn worker 时经 env 注入自己的 baseUrl（OPC_AGENT_SERVER_BASE_URL）
//    + worker 身份标记（OPC_AGENT_WORKER=1）；worker 工具面以该 baseUrl 直连
//    （既有「本测试服务器」seam 的生产化），注册表发现/兜底整体旁路；
// ② ensureServer 在 worker 上下文（OPC_AGENT_WORKER=1）发现失败 → 明确报错
//   （工具错误可转述），禁止 headless/in-process 兜底（防任何未来路径再灾变）。
//
// seam：① fake worker（捕获自身 env——agentService spawn env 透传）；
//       ② ensureServer 行为层（临时空注册表目录，断言快速拒绝且零 server 落地）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// fake worker：启动即把自身 env 中 BUG-007 两个变量写进捕获文件（缺省 null →
// 修复前清晰失败），随后响应 ping/shutdown 维持看门狗语义。
const FAKE_WORKER_SRC = `import fs from "node:fs";
import readline from "node:readline";
const captureFile = process.env.OPC_FAKE_CAPTURE;
if (captureFile) {
  fs.appendFileSync(captureFile, JSON.stringify({
    type: "worker-env",
    serverBaseUrl: process.env.OPC_AGENT_SERVER_BASE_URL ?? null,
    workerMarker: process.env.OPC_AGENT_WORKER ?? null,
  }) + "\\n");
}
process.stdout.write(JSON.stringify({ type: "ready", pid: process.pid }) + "\\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === "ping") {
    process.stdout.write(JSON.stringify({ type: "pong" }) + "\\n");
  } else if (msg.type === "shutdown") {
    process.exit(0);
  }
});
`;

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`等待超时：${label}`);
}

describe("BUG-007 ①：主进程 spawn worker 注入 baseUrl 与 worker 身份标记", () => {
  let workdir;
  let sessionDir;
  let captureFile;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bug007-spawn-env-"));
    sessionDir = path.join(workdir, "sessions");
    captureFile = path.join(workdir, "capture.jsonl");
    fs.writeFileSync(path.join(workdir, "fake-worker.mjs"), FAKE_WORKER_SRC);
    process.env.OPC_FAKE_CAPTURE = captureFile;
  });

  afterEach(async () => {
    delete process.env.OPC_FAKE_CAPTURE;
    await agentService?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("worker env 携带 OPC_AGENT_SERVER_BASE_URL（= 注入值）与 OPC_AGENT_WORKER=1", async () => {
    // Arrange
    const { createAgentService } = await import("../../../../../../src/services/agentService.js");
    agentService = createAgentService({
      cwd: workdir,
      sessionDir,
      entry: path.join(workdir, "fake-worker.mjs"),
      agentServerBaseUrl: "http://127.0.0.1:59999",
    });
    // Act
    const ready = [];
    agentService.on("ready", () => ready.push(1));
    await agentService.start();
    await waitUntil(() => ready.length === 1, { label: "worker ready" });
    await waitUntil(() => fs.existsSync(captureFile) && fs.readFileSync(captureFile, "utf8").includes("worker-env"), {
      label: "worker env 捕获",
    });
    // Assert
    const envRec = fs
      .readFileSync(captureFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((m) => m.type === "worker-env");
    assert.equal(
      envRec.serverBaseUrl,
      "http://127.0.0.1:59999",
      `worker env 应携带注入的 OPC_AGENT_SERVER_BASE_URL（工具面直连主进程 server，旁路注册表发现/兜底）。实际: ${JSON.stringify(envRec)}`
    );
    assert.equal(
      envRec.workerMarker,
      "1",
      `worker env 应携带 OPC_AGENT_WORKER=1（ensureServer 灾难性兜底守卫的身份标记）。实际: ${JSON.stringify(envRec)}`
    );
  });
});

describe("BUG-007 ②：ensureServer 在 worker 上下文禁止自起 server", () => {
  let workdir;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bug007-ensure-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir; // 空注册表 → 发现必失败
    process.env.OPC_AGENT_WORKER = "1";
  });

  afterEach(async () => {
    delete process.env.OPC_AGENT_WORKER;
    // 修复前 RED 路径可能真实 boot 了 headless server——按注册表记录逐一关闭清理；
    // 修复后注册表恒为空（零 server 落地），本循环为 no-op。
    try {
      const { readServerInfoRaw } = await import("../../../../../../src/serverRegistry.js");
      for (const info of readServerInfoRaw()) {
        if (info?.port) {
          await fetch(`http://127.0.0.1:${info.port}/api/server/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) }).catch(() => {});
        }
      }
    } catch {
      // 清理尽力而为。
    }
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("发现失败 → 明确拒绝（不 boot headless/in-process server，零注册表落地）", async () => {
    // Arrange
    const { ensureServer } = await import("../../../../../../src/cli/server.js");
    const startedAt = Date.now();
    // Act + Assert：worker 上下文发现失败必须快速明确报错（工具错误可转述），
    // 而非 boot 第二个 server（修复前：headless 兜底 → 真实 server 注册落地）。
    await assert.rejects(() => ensureServer(), /不可达|unreachable/i, "worker 上下文 ensureServer 发现失败应明确拒绝");
    assert.ok(Date.now() - startedAt < 8000, "拒绝应快速（不得进入 headless 8s 超时兜底）");
    const { readServerInfoRaw } = await import("../../../../../../src/serverRegistry.js");
    assert.deepEqual(readServerInfoRaw(), [], "禁止任何 server 自起——注册表必须保持为空");
  });

  it("显式 override 优先于守卫（既有注入 seam 语义不变）", async () => {
    // Arrange
    const { ensureServer, setServerBaseUrlOverride } = await import("../../../../../../src/cli/server.js");
    setServerBaseUrlOverride("http://127.0.0.1:59998");
    try {
      // Act
      const found = await ensureServer();
      // Assert：override 短路（worker 注入 baseUrl 后的真实生产路径——守卫不拦截）。
      assert.equal(found.baseUrl, "http://127.0.0.1:59998");
    } finally {
      setServerBaseUrlOverride(null);
    }
  });
});
