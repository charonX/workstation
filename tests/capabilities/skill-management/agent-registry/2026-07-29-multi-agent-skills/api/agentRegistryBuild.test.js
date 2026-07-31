// REQ-TRACE: 2026-07-29-multi-agent-skills/REQ-SKILL-018
// REQ-VERSION: v1-hash:2a55ba61c735de5ace6ceaf30e9b4aede312c1419bb3505b5795b38eba7bdc49
// CAPABILITY-TRACE: skill-management
// ENTITY-TRACE: agent-registry
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 构件级契约测试（BUG-002 回归）：agentRegistryService 在运行时按 bundle 所在
// 目录读取 agentRegistry.json（DEFAULT_SNAPSHOT_PATH），因此 vite main 构建产物
// 必须与快照资产一同产出。API/E2E 测试均从 src/ 源码启动（import.meta.url 指向
// src/services/），永远读得到源文件，只有真实构建产物会缺资产——本测试跑一次
// 真实 vite main build（--outDir 临时目录，不污染 .vite/build/），断言产物目录
// 中存在 agentRegistry.json 且与 src/services/agentRegistry.json 完全一致。

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../.."
);
const VITE_CLI = path.join(PROJECT_ROOT, "node_modules", "vite", "bin", "vite.js");
const VITE_MAIN_CONFIG = path.join(PROJECT_ROOT, "vite.main.config.js");
const SNAPSHOT_SRC = path.join(PROJECT_ROOT, "src", "services", "agentRegistry.json");

describe("Agent Registry (build artifact ships the snapshot)", () => {
  let buildOutDir;

  before(() => {
    buildOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-registry-build-"));
    try {
      execFileSync(
        process.execPath,
        [VITE_CLI, "build", "--config", VITE_MAIN_CONFIG, "--outDir", buildOutDir],
        {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
        }
      );
    } catch (err) {
      throw new Error(`vite main build failed: ${err.message}`);
    }
  });

  after(() => {
    fs.rmSync(buildOutDir, { recursive: true, force: true });
  });

  it("REQ-SKILL-018: built bundle directory contains agentRegistry.json identical to the source snapshot", () => {
    const built = path.join(buildOutDir, "agentRegistry.json");
    assert.ok(
      fs.existsSync(built),
      `agentRegistry.json must be copied next to the built bundle (${buildOutDir}) — ` +
        "agentRegistryService reads it relative to import.meta.url (BUG-002)"
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(built, "utf-8")),
      JSON.parse(fs.readFileSync(SNAPSHOT_SRC, "utf-8")),
      "built snapshot must match src/services/agentRegistry.json"
    );
  });
});
