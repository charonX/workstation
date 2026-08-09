// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-005
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// BUG-001（code-defect）回归：worker 模型解析必须是纯本地解析——
// `setRuntimeApiKey` 不得触发 pi.dev 远程模型目录刷新。
//
// 根因（2026-08-09 实证）：worker `ModelRuntime.create({ allowModelNetwork: false })`
// 只约束 create 时首次 refresh；`resolveModel` 调 `setRuntimeApiKey(provider, apiKey)`
// 未传第三参 refreshOptions → SDK 内部 `refresh({})` 的 allowNetwork 回退到
// modelNetworkEnabled（= PI_OFFLINE 未设 → true）→ 对持凭证 provider 发起
// fetch("https://pi.dev/api/models/providers/<id>")（无 signal/无超时）。
// 本机 pi.dev 黑洞（TCP 通零字节）时靠 undici headersTimeout 300s 兜底——
// session-config 阻塞 5 分钟（生产日志 + 独立 spawn 重放双侧实证 +301,109ms）。
// 修复：setRuntimeApiKey 第三参显式 { allowNetwork: false }，与 create 语义一致。
//
// seam：真实 spawn worker（非 FAUX——FAUX 直取 faux 模型、不经 resolveModel）+
//   node --import fixtures/fetchBlackhole.mjs 拦截子进程全局 fetch：
//   pi.dev 请求 → 记录到日志文件并永久悬挂（确定性复现黑洞，不依赖真实网络）。
//   dummy key 即可走通全路径——session-config 装配不发起模型调用（实证：
//   createAgentSession/bindExtensions 均不校验 key 有效性）。
//
// 预期值签核（来源：BUG-001 根因诊断人确认——模型解析零网络意图）：
//   ① session-config 在 20s 内回 config-ack（无修复时该请求永久悬挂 → 红；
//      修复后实测全路径 ~2s，20s 为抖动余量）；
//   ② fetch 记录文件零 pi.dev 条目（远程目录对产品运行零贡献——实证：
//      刷新超时失败后 getModel 照常返回内建 catalog 模型、会话照常工作）。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../../../");
const workerEntry = path.join(repoRoot, "src/agent/worker.js");
const fetchBlackhole = path.join(__dirname, "fixtures/fetchBlackhole.mjs");
const CONFIG_ACK_BUDGET_MS = 20000; // 签核值①：无修复时永久悬挂 → 红

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`超时等待 ${label}`);
}

describe("BUG-001 回归：worker 模型解析零网络（REQ-AGENT-005 恢复路径不被远程目录阻塞）", () => {
  let workdir;
  let fetchLog;
  let child;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-modelresolve-"));
    fs.mkdirSync(path.join(workdir, "sessions"), { recursive: true });
    fs.mkdirSync(path.join(workdir, "agent-home"), { recursive: true });
    fetchLog = path.join(workdir, "fetch.log");
    child = null;
  });

  afterEach(() => {
    if (child && !child.killed) child.kill("SIGKILL");
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("session-config 在预算内回 config-ack，且全程零 pi.dev 远程目录请求", async () => {
    child = spawn(process.execPath, ["--import", fetchBlackhole, workerEntry], {
      env: {
        ...process.env,
        // 非 FAUX：直走 resolveModel 真实路径（provider=deepseek + dummy key）。
        OPC_AGENT_FAUX: "0",
        OPC_AGENT_SESSION_DIR: path.join(workdir, "sessions"),
        OPC_AGENT_HOME: path.join(workdir, "agent-home"),
        OPC_AGENT_CWD: workdir,
        OPC_AGENT_STATS_INTERVAL_MS: "60000", // 降噪：stats 帧不影响断言
        OPC_TEST_FETCH_LOG: fetchLog,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const messages = [];
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      try {
        messages.push(JSON.parse(line));
      } catch { /* 非协议行忽略 */ }
    });
    let stderrTail = "";
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + String(chunk)).slice(-4000);
    });

    await waitUntil(() => messages.some((m) => m.type === "ready"), { label: "worker ready" });
    child.stdin.write(JSON.stringify({
      type: "session-config",
      sessionKey: "ui:project:p-test:s-test",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      keyRef: "key:deepseek",
      systemPrompt: "",
      apiKey: "sk-dummy-bug001", // dummy：装配路径不校验 key（实证，见头注释）
      cwd: workdir,
      skillPaths: [],
      permissionProfile: "default", // 轻装：跳过 gotgenes，resolveModel 路径同型
    }) + "\n");

    const t0 = Date.now();
    await waitUntil(
      () => messages.some((m) => m.type === "config-ack"),
      { timeout: CONFIG_ACK_BUDGET_MS, interval: 200, label: `config-ack（预算 ${CONFIG_ACK_BUDGET_MS / 1000}s；超时即 pi.dev 悬挂复发）` }
    );
    const elapsed = Date.now() - t0;

    // 签核值②：零 pi.dev 请求（装配期远程目录刷新 = 缺陷复发）。
    const fetchHits = fs.existsSync(fetchLog) ? fs.readFileSync(fetchLog, "utf8").trim() : "";
    assert.equal(fetchHits, "", `不得发起 pi.dev 远程目录请求，实际命中：\n${fetchHits}\n[stderr 尾部]\n${stderrTail}`);
    assert.ok(elapsed < CONFIG_ACK_BUDGET_MS, `config-ack 耗时 ${elapsed}ms 应低于预算（防御性，waitUntil 已保）`);
  });
});
