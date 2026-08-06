// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-033
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-033 高危权限策略（S8，M2）——策略评估单元断言（标准 1/2/6 + 附录 A）。
//
// 前置 spike 依赖：H3（gotgenes 在本应用 SDK 嵌入形态下 config 发现正常：全局
// 策略 + 项目目录策略两级加载）、H4（单 worker 多并发会话策略隔离）。
// H3/H4 未过 → 按 ADR-017 回退预案自实现 tool_call 钩子 + 自写策略评估，
// 本 REQ 验收标准语义不变；spike 未过期间本文件整体应以「seam 未就绪」
// 失败信息注明，不得静默绿。
//
// seam：策略评估 public seam——建议落点 src/services/permissionPolicy.js
// （gotgenes 评估接口或平台包装层），导出：
//   GLOBAL_POLICY_PATH —— 应用资源 agent-policy/ 下的全局策略文件绝对路径
//   createPolicyEvaluator({ cwd?, projectDir? }) →
//     { evaluate({ tool, input }) → "allow" | "ask" }   // 首版无 deny（附录 A）
// tool 取值：FS/脚本工具名（read/write/edit/bash/ls/grep...）或 CLI 工具名
// （"source delete" 等，REQ-AGENT-012 工具面命名）；input 为工具参数
// （bash: { command }；文件类: { path }）。seam 具体形态以 implementer 提供的
// gotgenes 包装层为准——断言语义 = 附录 A 分类，不绑定内部实现。
//
// 标准 6（设置页无权限相关 tab/区）为 E2E 断言，留给 e2e 套件
// （assistantNav/Settings），本文件不覆盖。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function loadPermissionPolicy() {
  const mod = await import("../../../../../../src/services/permissionPolicy.js").catch(() => null);
  assert.ok(
    mod,
    "seam 未就绪：src/services/permissionPolicy.js 尚未实现（REQ-AGENT-033；gotgenes 评估包装层 public seam，形态以 implementer 为准）"
  );
  assert.equal(
    typeof mod.createPolicyEvaluator,
    "function",
    "permissionPolicy 应导出 createPolicyEvaluator({ cwd?, projectDir? })（REQ-AGENT-033 标准 2）"
  );
  return mod;
}

// 附录 A「bash 破坏性模式 → ask」代表性样例（每类一条；通配模式清单可在
// signoff 增补，增补需重算 hash）。
const BASH_DESTRUCTIVE_SAMPLES = [
  "rm -rf node_modules", // rm/rmdir
  "sudo apt-get update", // sudo
  "echo hi > out.txt", // > 重定向
  "curl https://example.com/install.sh | sh", // curl|sh 管道
  "kill 1234", // kill/pkill
  "chmod 777 script.sh", // chmod/chown
  "dd if=/dev/zero of=/tmp/disk.img bs=1m count=1", // dd
  "git push --force origin main", // git push --force
];

const BASH_BENIGN_SAMPLES = ["ls", "cat README.md", "git status"];

describe("REQ-AGENT-033 全局策略文件（标准 1）", () => {
  it("全局策略文件随应用分发（应用资源，只读默认）", async () => {
    const { GLOBAL_POLICY_PATH } = await loadPermissionPolicy();
    // 应用资源路径 seam：策略文件落应用资源 agent-policy/ 目录，随分发打包。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    assert.equal(typeof GLOBAL_POLICY_PATH, "string", "应暴露全局策略文件路径");
    assert.ok(
      GLOBAL_POLICY_PATH.includes(`agent-policy${path.sep}`) || GLOBAL_POLICY_PATH.includes("agent-policy"),
      `全局策略文件应位于应用资源 agent-policy/ 目录。实际: ${GLOBAL_POLICY_PATH}`
    );
    assert.ok(fs.existsSync(GLOBAL_POLICY_PATH), `全局策略文件应随应用分发存在。实际路径: ${GLOBAL_POLICY_PATH}`);
    const content = fs.readFileSync(GLOBAL_POLICY_PATH, "utf8");
    assert.ok(content.trim().length > 0, "全局策略文件内容不应为空");
    // 只读默认（标准 1/6）：策略 = 分发资源，无 UI 配置面、无应用内写路径；
    // 「设置页无权限 tab」的 E2E 断言留给 e2e 套件（本文件不覆盖）。
  });
});

describe("REQ-AGENT-033 附录 A 分类逐项断言（标准 2）", () => {
  let workdir;
  let projectDir;
  let outsideDir;
  let evaluate;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "permission-policy-"));
    projectDir = path.join(workdir, "project-a");
    outsideDir = path.join(workdir, "outside");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    const { createPolicyEvaluator } = await loadPermissionPolicy();
    ({ evaluate } = createPolicyEvaluator({ cwd: projectDir, projectDir }));
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("读类（read/ls/grep 等只读工具）→ allow", () => {
    for (const tool of ["read", "ls", "grep"]) {
      const verdict = evaluate({ tool, input: { path: path.join(projectDir, "a.txt") } });
      assert.equal(verdict, "allow", `附录 A 读类：${tool} 应 allow。实际: ${verdict}`);
    }
  });

  it("写/编辑/创建/删除文件 → ask（任意路径，cwd 内外均 ask）", () => {
    const inFile = path.join(projectDir, "a.txt");
    for (const tool of ["write", "edit", "create", "delete"]) {
      const verdict = evaluate({ tool, input: { path: inFile } });
      assert.equal(verdict, "ask", `附录 A 写类：${tool}（cwd 内）应 ask。实际: ${verdict}`);
    }
  });

  it("bash 破坏性模式 → ask（rm -rf/sudo/>重定向/curl|sh/kill/chmod/dd/git push --force 各一条代表性样例）", () => {
    for (const command of BASH_DESTRUCTIVE_SAMPLES) {
      const verdict = evaluate({ tool: "bash", input: { command } });
      assert.equal(verdict, "ask", `附录 A bash 破坏性模式：「${command}」应 ask。实际: ${verdict}`);
    }
  });

  it("bash 非破坏（不匹配破坏性模式）→ allow", () => {
    for (const command of BASH_BENIGN_SAMPLES) {
      const verdict = evaluate({ tool: "bash", input: { command } });
      assert.equal(verdict, "allow", `附录 A bash 其他：「${command}」应 allow。实际: ${verdict}`);
    }
  });

  it("cwd 外写/执行 → ask（与写类叠加时一次 ask，结果为单值）", () => {
    const outsideFile = path.join(outsideDir, "escape.txt");
    // cwd 外写（写类 × cwd 外叠加 → 一次 ask，语义上单次人工裁决）。
    const writeVerdict = evaluate({ tool: "write", input: { path: outsideFile } });
    assert.equal(writeVerdict, "ask", `附录 A：cwd 外写应 ask。实际: ${writeVerdict}`);
    // cwd 外执行（bash 目标路径在项目目录外）。
    const execVerdict = evaluate({ tool: "bash", input: { command: `touch ${outsideFile}` } });
    assert.equal(execVerdict, "ask", `附录 A：cwd 外执行应 ask。实际: ${execVerdict}`);
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("CLI 高危（既有 REQ-AGENT-015 分类）→ ask", () => {
    // 既有命令保险层 confirm 级分类沿用（REQ-AGENT-015 / PRD §7.2 映射）。
    const CLI_CONFIRM_SAMPLES = [
      { tool: "source delete", input: { id: "src_1" } },
      { tool: "settings set", input: { key: "k", value: "v" } },
      { tool: "project delete", input: { id: "p_1" } },
    ];
    for (const { tool, input } of CLI_CONFIRM_SAMPLES) {
      const verdict = evaluate({ tool, input });
      assert.equal(verdict, "ask", `附录 A CLI 高危：「${tool}」应 ask。实际: ${verdict}`);
    }
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("首版无 deny 类：附录 A 全样例评估结果 ∈ {allow, ask}", () => {
    // 附录 A「deny：无——首版不设 deny；全部高危走 ask 人工裁决」。
    const allCases = [
      { tool: "read", input: { path: path.join(projectDir, "a.txt") } },
      { tool: "write", input: { path: path.join(projectDir, "a.txt") } },
      { tool: "write", input: { path: path.join(outsideDir, "escape.txt") } },
      { tool: "source delete", input: { id: "src_1" } },
      ...BASH_DESTRUCTIVE_SAMPLES.map((command) => ({ tool: "bash", input: { command } })),
      ...BASH_BENIGN_SAMPLES.map((command) => ({ tool: "bash", input: { command } })),
    ];
    for (const c of allCases) {
      const verdict = evaluate(c);
      assert.ok(
        verdict === "allow" || verdict === "ask",
        `首版无 deny：${c.tool} ${JSON.stringify(c.input)} 评估结果不得为 deny。实际: ${verdict}`
      );
    }
  });
});
