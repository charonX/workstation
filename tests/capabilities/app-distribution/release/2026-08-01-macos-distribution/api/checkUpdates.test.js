// REQ-TRACE: 2026-08-01-macos-distribution/REQ-DIST-002
// REQ-VERSION: v1-hash:3167cf207baf471a951b02c4bd09915f1cd79b25cab37ebdb4632c3bb2d63b10
// CAPABILITY-TRACE: app-distribution
// ENTITY-TRACE: release
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-02 assertion signoff)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// REQ-DIST-002：应用内检查更新（启动静默 + 手动）。
//
// 实现约定（待 implementer 落地）：
//   主进程更新服务导出：
//     checkForUpdates({ fetchImpl, getVersion, repo }) -> Promise<{
//       currentVersion, latestVersion|null, hasUpdate, error:{code,message}|null
//     }>
//     compareVersions(a, b) -> -1 | 0 | 1   （a<b 为 -1；仅数值比较 X.Y.Z）
//   fetchImpl 与 getVersion 可注入；repo 从 package.json repository 字段解析。

describe("checkForUpdates", () => {
  const repo = { owner: "charonX", repo: "workstation" };

  function jsonResponse(body, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  }

  it("REQ-DIST-002 AC1: 返回契约结构，hasUpdate 由版本比较得出", async () => {
    const { checkForUpdates } = await import("../../../../../../src/main/updates.js");
    const result = await checkForUpdates({
      fetchImpl: async () => jsonResponse({ tag_name: "v1.1.0" }),
      getVersion: () => "1.0.0",
      repo
    });
    assert.deepEqual(result, {
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      hasUpdate: true,
      error: null
    });
  });

  it("REQ-DIST-002 AC2/AC3: 已是最新（latest ≤ current）→ hasUpdate false", async () => {
    const { checkForUpdates } = await import("../../../../../../src/main/updates.js");
    const older = await checkForUpdates({
      fetchImpl: async () => jsonResponse({ tag_name: "v1.1.0" }),
      getVersion: () => "1.2.0",
      repo
    });
    assert.equal(older.hasUpdate, false);
    const same = await checkForUpdates({
      fetchImpl: async () => jsonResponse({ tag_name: "v1.2.0" }),
      getVersion: () => "1.2.0",
      repo
    });
    assert.equal(same.hasUpdate, false);
  });

  it("REQ-DIST-002 AC5: 仓库无 release → latestVersion null 且 hasUpdate false", async () => {
    const { checkForUpdates } = await import("../../../../../../src/main/updates.js");
    const result = await checkForUpdates({
      fetchImpl: async () => jsonResponse({ message: "Not Found" }, 404),
      getVersion: () => "1.0.0",
      repo
    });
    assert.equal(result.latestVersion, null);
    assert.equal(result.hasUpdate, false);
  });

  it("REQ-DIST-002 AC4: 网络失败 → error E_UPDATE_CHECK_NETWORK，不抛未捕获异常", async () => {
    const { checkForUpdates } = await import("../../../../../../src/main/updates.js");
    const result = await checkForUpdates({
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      getVersion: () => "1.0.0",
      repo
    });
    assert.equal(result.error?.code, "E_UPDATE_CHECK_NETWORK");
    assert.equal(result.hasUpdate, false);
  });

  it("REQ-DIST-002 AC6: tag 解析失败 → error E_UPDATE_PARSE", async () => {
    const { checkForUpdates } = await import("../../../../../../src/main/updates.js");
    const result = await checkForUpdates({
      fetchImpl: async () => jsonResponse({ tag_name: "nightly-build" }),
      getVersion: () => "1.0.0",
      repo
    });
    assert.equal(result.error?.code, "E_UPDATE_PARSE");
    assert.equal(result.hasUpdate, false);
  });

  it("REQ-DIST-002 AC7: 启动静默路径——失败仅返回 error，服务不抛", async () => {
    const { checkForUpdates } = await import("../../../../../../src/main/updates.js");
    let result;
    await assert.doesNotReject(
      (async () => {
        result = await checkForUpdates({
          fetchImpl: async () => {
            throw new TypeError("network down");
          },
          getVersion: () => "1.0.0",
          repo
        });
      })(),
      "silent check must never reject"
    );
    assert.ok(result.error, "failure must be surfaced as error field");
  });
});

describe("compareVersions (semver 最小实现)", () => {
  it("相等/高于/低于/0.x 边界/数值比较", async () => {
    const { compareVersions } = await import("../../../../../../src/main/updates.js");
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
    assert.equal(compareVersions("1.1.0", "1.0.0"), 1);
    assert.equal(compareVersions("1.0.0", "1.1.0"), -1);
    assert.equal(compareVersions("1.10.0", "1.9.9"), 1, "numeric comparison, not string order");
    assert.equal(compareVersions("0.9.0", "1.0.0"), -1);
  });
});
