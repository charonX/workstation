// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-004, 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-005
// REQ-VERSION: v1-hash:1f616dc91b7e8d80569503c5ce12f190ddf066f699394496ea8a815e61593119
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.3 块 3, §7, §7.1, §8 E1/E4, §10.4 接口 2/3/4
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadCliService() {
  const mod = await import("../../../../../../src/services/cliService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/cliService.js 尚未实现（REQ-CLI-SERVICE-004/005）");
  assert.equal(typeof mod.createCliService, "function", "导出 createCliService 工厂函数");
  return mod;
}

describe("REQ-CLI-SERVICE-004/005 CLI 服务配置持久化、两层启用与安全加密", () => {
  let workdir;
  let svc;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-cfg-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const { createCliService } = await loadCliService();
    svc = await createCliService({ configDir: workdir });
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("未安装的 CLI 禁止打开全局启用开关，抛出 E-CLI-NOT-INSTALLED", async () => {
    // 模拟 codex 为未安装状态
    svc._stubExecFile = async () => {
      const err = new Error("Command not found");
      err.code = "ENOENT";
      throw err;
    };

    // EXPECTED-TRACE: prd.md §7.1 规则 2, §8 E1
    await assert.rejects(
      async () => {
        await svc.setGlobalEnabled("codex", true);
      },
      (err) => {
        assert.ok(err.message.includes("E-CLI-NOT-INSTALLED") || err.code === "E-CLI-NOT-INSTALLED");
        return true;
      }
    );
  });

  it("全局未启用的 CLI 禁止在项目内启用，抛出 E-CLI-GLOBALLY-DISABLED", async () => {
    // claude 默认全局未启用
    // EXPECTED-TRACE: prd.md §7.1 规则 3
    await assert.rejects(
      async () => {
        await svc.setProjectEnabled("proj-1", "claude", true);
      },
      (err) => {
        assert.ok(err.message.includes("E-CLI-GLOBALLY-DISABLED") || err.code === "E-CLI-GLOBALLY-DISABLED");
        return true;
      }
    );
  });

  it("调用超时设置：有效范围 10-600 秒，非法值抛出 E-CLI-INVALID-TIMEOUT", async () => {
    // 模拟 claude 已安装
    svc._stubExecFile = async () => ({ stdout: "1.0.80\n", stderr: "", exitCode: 0 });

    // 合法超时 120 秒
    const res = await svc.updateConfig("claude", { timeoutSec: 120 });
    assert.equal(res.timeoutSec, 120);

    // 非法超时 5 秒（< 10）
    // EXPECTED-TRACE: prd.md §7 规则 4
    await assert.rejects(
      async () => {
        await svc.updateConfig("claude", { timeoutSec: 5 });
      },
      (err) => {
        assert.ok(err.message.includes("E-CLI-INVALID-TIMEOUT") || err.code === "E-CLI-INVALID-TIMEOUT");
        return true;
      }
    );

    // 非法超时 999 秒（> 600）
    await assert.rejects(
      async () => {
        await svc.updateConfig("claude", { timeoutSec: 999 });
      },
      (err) => {
        assert.ok(err.message.includes("E-CLI-INVALID-TIMEOUT") || err.code === "E-CLI-INVALID-TIMEOUT");
        return true;
      }
    );
  });

  it("两层启用与 effectiveConfig：仅返回「全局开 ∧ 项目开 ∧ 已安装」的有效条目", async () => {
    // 模拟 claude 已安装，codex 未安装
    svc._stubExecFile = async (cmd) => {
      if (cmd === "claude") return { stdout: "1.0.80\n", stderr: "", exitCode: 0 };
      const err = new Error("Command not found");
      err.code = "ENOENT";
      throw err;
    };

    // 全局启用 claude
    await svc.setGlobalEnabled("claude", true);

    // 项目 proj-1 尚未启用 claude
    let effective = await svc.effectiveConfig("proj-1");
    // EXPECTED-TRACE: prd.md §6.3 块 3 row 2
    assert.equal(effective.length, 0, "项目未启用时 effectiveConfig 为空");

    // 项目 proj-1 启用 claude
    await svc.setProjectEnabled("proj-1", "claude", true);
    effective = await svc.effectiveConfig("proj-1");
    assert.equal(effective.length, 1, "全局开 ∧ 项目开 ∧ 已安装 时有效");
    assert.equal(effective[0].id, "claude");

    // 项目 proj-2 未启用
    const effectiveProj2 = await svc.effectiveConfig("proj-2");
    assert.equal(effectiveProj2.length, 0);
  });

  it("环境变量输入校验：KEY 正则不匹配或 VALUE 为空时拒绝并抛出 E-CLI-INVALID-ENV-KEY", async () => {
    // EXPECTED-TRACE: prd.md §7 规则 1/2, §8 E4
    await assert.rejects(
      async () => {
        await svc.updateConfig("claude", { env: { "invalid-key": "val" } });
      },
      (err) => {
        assert.ok(err.message.includes("E-CLI-INVALID-ENV-KEY") || err.code === "E-CLI-INVALID-ENV-KEY");
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await svc.updateConfig("claude", { env: { ANTHROPIC_API_KEY: "" } });
      },
      (err) => {
        assert.ok(err.message.includes("E-CLI-INVALID-ENV-KEY") || err.code === "E-CLI-INVALID-ENV-KEY");
        return true;
      }
    );
  });

  it("环境变量加密存储：数据库中敏感值加密，API 不回显明文只返回 envKeys", async () => {
    // 注入合法的环境变量
    await svc.updateConfig("claude", {
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-secret-value-12345",
      },
    });

    // 查询配置输出安全守卫：不出现明文
    // EXPECTED-TRACE: prd.md §6.3 块 3 row 1, §10.4 接口 1/2
    const cfg = await svc.getConfig("claude");
    assert.ok(!cfg.env, "不得包含明文 env 字典");
    assert.deepEqual(cfg.envKeys, ["ANTHROPIC_API_KEY"], "只返回 envKeys 列表");

    // 检查数据库落盘内容：必须加密，不得含明文字符串
    const dbRows = await svc._getRawDbRow("claude");
    assert.ok(dbRows && dbRows.env, "DB 中必须落盘 env 字段");
    assert.ok(!dbRows.env.includes("sk-ant-test-secret-value-12345"), "数据库中严禁出现明文 API Key");
  });

  it("环境变量全量替换语义：新配置覆盖旧配置，旧键移除", async () => {
    await svc.updateConfig("claude", {
      env: {
        KEY_ONE: "val1",
        KEY_TWO: "val2",
      },
    });
    let cfg = await svc.getConfig("claude");
    assert.deepEqual(cfg.envKeys.sort(), ["KEY_ONE", "KEY_TWO"]);

    // 全量替换为只有 KEY_THREE
    await svc.updateConfig("claude", {
      env: {
        KEY_THREE: "val3",
      },
    });
    cfg = await svc.getConfig("claude");
    assert.deepEqual(cfg.envKeys, ["KEY_THREE"]);
  });

  it("边界值校验：KEY(128/129)、VALUE(4096/4097)、条目数(50/51)与 timeoutSec(9/10/600/601)", async () => {
    // 1. timeoutSec 边界：9 失败，10 成功，600 成功，601 失败
    await assert.rejects(
      async () => svc.updateConfig("claude", { timeoutSec: 9 }),
      (err) => err.code === "E-CLI-INVALID-TIMEOUT"
    );
    const valid10 = await svc.updateConfig("claude", { timeoutSec: 10 });
    assert.equal(valid10.timeoutSec, 10);

    const valid600 = await svc.updateConfig("claude", { timeoutSec: 600 });
    assert.equal(valid600.timeoutSec, 600);

    await assert.rejects(
      async () => svc.updateConfig("claude", { timeoutSec: 601 }),
      (err) => err.code === "E-CLI-INVALID-TIMEOUT"
    );

    // 2. KEY 长度边界：恰好 128 成功，129 失败
    const key128 = "K" + "A".repeat(127);
    const validKeyRes = await svc.updateConfig("claude", { env: { [key128]: "valid_val" } });
    assert.deepEqual(validKeyRes.envKeys, [key128]);

    const key129 = "K" + "A".repeat(128);
    await assert.rejects(
      async () => svc.updateConfig("claude", { env: { [key129]: "val" } }),
      (err) => err.code === "E-CLI-INVALID-ENV-KEY"
    );

    // 3. VALUE 长度边界：恰好 4096 成功，4097 失败
    const val4096 = "V".repeat(4096);
    await svc.updateConfig("claude", { env: { VALID_KEY: val4096 } });

    const val4097 = "V".repeat(4097);
    await assert.rejects(
      async () => svc.updateConfig("claude", { env: { VALID_KEY: val4097 } }),
      (err) => err.code === "E-CLI-INVALID-ENV-KEY"
    );

    // 4. 条目数边界：恰好 50 条成功，51 条失败
    const entries50 = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`ENV_${i}`, `val_${i}`])
    );
    const res50 = await svc.updateConfig("claude", { env: entries50 });
    assert.equal(res50.envKeys.length, 50);

    const entries51 = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`ENV_${i}`, `val_${i}`])
    );
    await assert.rejects(
      async () => svc.updateConfig("claude", { env: entries51 }),
      (err) => err.code === "E-CLI-INVALID-ENV-KEY"
    );
  });
});
