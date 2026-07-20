// REQ-TRACE: 2026-07-19-media-production-line/REQ-CHANNEL-001
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: channel-integration
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { startFakeFeishuServer } from "../../../../../fixtures/media-production-line/fakeFeishuServer.js";

/**
 * 将飞书开放平台域名请求 mock 为快速成功/失败，避免测试依赖真实网络。
 * 返回恢复函数，必须在 finally 中调用。
 */
function mockFeishuOpenPlatform({ tokenValid = true } = {}) {
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")) {
      if (tokenValid) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: "fake-tenant-token", expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 99991663, msg: "app access token invalid" }), { status: 200 });
    }
    if (urlStr.includes("open.feishu.cn/open-apis/im/v1/messages")) {
      return new Response(JSON.stringify({ code: 0, msg: "success", data: { message_id: "om_fake_1" } }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  return () => {
    global.fetch = originalFetch;
  };
}

function clearServerRegistry() {
  try {
    fs.unlinkSync(path.join(os.homedir(), ".opc-workstation", "server.json"));
  } catch {
    // ignore
  }
}

describe("REQ-CHANNEL-001 CLI 集成：channel credentials / status / reconnect", () => {
  let fake;
  let restoreFetch;

  beforeEach(async () => {
    clearServerRegistry();
    fake = await startFakeFeishuServer();
    restoreFetch = mockFeishuOpenPlatform();
  });

  afterEach(async () => {
    restoreFetch();
    await fake.stop();
    clearServerRegistry();
  });

  it("opc-workstation channel credentials 返回 {appId, status, error?}", () => {
    const out = execSync(
      `node src/cli/opc-workstation.js channel credentials --app-id cli_fake_cli --app-secret fake-secret-cli`,
      { encoding: "utf-8" }
    );
    const data = JSON.parse(out);
    assert.equal(data.appId, "cli_fake_cli", "CLI 应回显 appId");
    assert.ok(["connecting", "online", "offline"].includes(data.status), `status 应为三态之一，实际: ${data.status}`);
    assert.ok(data.error === undefined || data.error === null || typeof data.error === "string", "error 字段应为字符串、null 或不存在");
  });

  it("opc-workstation channel status 返回 {channelType, status, error?}", () => {
    execSync(
      `node src/cli/opc-workstation.js channel credentials --app-id cli_fake_cli --app-secret fake-secret-cli`,
      { encoding: "utf-8" }
    );
    const out = execSync(`node src/cli/opc-workstation.js channel status`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.channelType, "feishu", "CLI 应返回 channelType=feishu");
    assert.ok(["connecting", "online", "offline"].includes(data.status), `status 应为三态之一，实际: ${data.status}`);
    assert.ok(data.error === undefined || data.error === null || typeof data.error === "string", "error 字段应为字符串、null 或不存在");
  });

  it("opc-workstation channel reconnect 返回 {channelType, status, error?}", () => {
    execSync(
      `node src/cli/opc-workstation.js channel credentials --app-id cli_fake_cli --app-secret fake-secret-cli`,
      { encoding: "utf-8" }
    );
    const out = execSync(`node src/cli/opc-workstation.js channel reconnect`, { encoding: "utf-8" });
    const data = JSON.parse(out);
    assert.equal(data.channelType, "feishu", "CLI 应返回 channelType=feishu");
    assert.ok(["connecting", "online", "offline"].includes(data.status), `status 应为三态之一，实际: ${data.status}`);
    assert.ok(data.error === undefined || data.error === null || typeof data.error === "string", "error 字段应为字符串、null 或不存在");
  });
});
