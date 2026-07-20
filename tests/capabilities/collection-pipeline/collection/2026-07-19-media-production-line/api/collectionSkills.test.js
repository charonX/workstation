// REQ-TRACE: 2026-07-19-media-production-line/REQ-COLL-003
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: collection
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { makeTmpProjectDir } from "../../../../../fixtures/media-production-line/tmpProjectDir.js";

// 签核资产落点：src/assets/skill-repos/opc-collection-skills/（单 repo 含 skills/fetch-to-markdown、
// skills/topic-daily-digest、skills/feishu-doc-sync，各含 SKILL.md）。
const BUILTIN_REPO = path.resolve("src/assets/skill-repos/opc-collection-skills");
const SKILL_NAMES = ["fetch-to-markdown", "topic-daily-digest", "feishu-doc-sync"];

function requireBuiltinRepo() {
  assert.ok(fs.existsSync(BUILTIN_REPO),
    `内置收集 skill 包尚未交付（期望落点 ${BUILTIN_REPO}；REQ-COLL-003）`);
  for (const name of SKILL_NAMES) {
    assert.ok(
      fs.existsSync(path.join(BUILTIN_REPO, "skills", name, "SKILL.md")),
      `skill ${name} 应以 skill repo 形式交付（skills/${name}/SKILL.md）`
    );
  }
}

describe("REQ-COLL-003: 收集 skill 包与安全约束", () => {
  let tmp;
  let serverCtx;

  beforeEach(async () => {
    tmp = makeTmpProjectDir();
    serverCtx = await startServer();
  });

  afterEach(async () => {
    tmp.cleanup();
    await stopServer(serverCtx);
  });

  it("AC1: 三个收集 skill 以 skill repo 形式交付", () => {
    requireBuiltinRepo();
  });

  it("AC1: 经现有 skillService 安装并注入项目（.opc/skills/... symlink 真实存在）", async () => {
    requireBuiltinRepo();
    const skillService = await import("../../../../../../src/services/skillService.js");

    const project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Skill Project", localPath: tmp.dir })
    })).json();

    const repo = skillService.createSkillRepo({
      name: "opc-collection-skills",
      repoPath: BUILTIN_REPO,
      installSource: "builtin"
    });
    for (const name of SKILL_NAMES) {
      const skill = skillService.createSkill({ name, description: `builtin ${name}`, repoPath: path.join("skills", name) }, repo.id);
      skillService.linkSkill(skill.id, project.id);
    }

    // 真实 I/O 断言：symlink 存在且指向内置 skill 目录。
    for (const name of SKILL_NAMES) {
      const linkPath = path.join(tmp.dir, ".opc", "skills", "opc-collection-skills", name);
      const stat = fs.lstatSync(linkPath, { throwIfNoEntry: false });
      assert.ok(stat, `.opc/skills 下应存在 ${name} 链接`);
      assert.ok(stat.isSymbolicLink() || stat.isDirectory(), `${name} 应为 symlink（或 junction 目录）`);
      const real = fs.realpathSync(linkPath);
      assert.equal(real, fs.realpathSync(path.join(BUILTIN_REPO, "skills", name)), `${name} 链接应指向内置 skill 目录`);
    }
  });

  it("AC2: fetch-to-markdown URL 解析拒绝私网 IP（SSRF 阻断）", async () => {
    requireBuiltinRepo();
    // seam：skill 附带 URL 校验脚本（建议 skills/fetch-to-markdown/scripts/validateUrl.js，
    // 导出 assertPublicUrl(url) 或 isPrivateIp(host)）。
    const helperPath = path.join(BUILTIN_REPO, "skills", "fetch-to-markdown", "scripts", "validateUrl.js");
    assert.ok(fs.existsSync(helperPath), `SSRF 校验脚本尚未交付: ${helperPath}`);
    const helper = await import(helperPath);
    const assertPublicUrl = helper.assertPublicUrl || helper.validateUrl;
    assert.equal(typeof assertPublicUrl, "function", "validateUrl.js 应导出 assertPublicUrl(url)");

    const blocked = [
      "http://127.0.0.1/admin",
      "http://127.10.20.30/",
      "http://10.0.0.1/internal",
      "http://10.255.255.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.1/router",
      "http://172.16.0.1/",
      "http://0.0.0.0/",
      "http://localhost:8080/debug"
    ];
    for (const url of blocked) {
      assert.throws(() => assertPublicUrl(url), /private|SSRF|blocked|E-SSRF|私网/i,
        `应拒绝私网地址: ${url}`);
    }

    assert.doesNotThrow(() => assertPublicUrl("https://example.com/article"), "公网 http(s) 地址应放行");
  });

  it("AC2: 抓取内容以「不可信数据」标记包裹的约定写入 skill 说明", () => {
    requireBuiltinRepo();
    const skillMd = fs.readFileSync(path.join(BUILTIN_REPO, "skills", "fetch-to-markdown", "SKILL.md"), "utf8");
    // 签核：标记同时含中英文锚点（UNTRUSTED / 不可信），便于 agent prompt 引用。
    assert.match(skillMd, /UNTRUSTED/, "fetch-to-markdown 应含 UNTRUSTED 锚点");
    assert.match(skillMd, /不可信/, "fetch-to-markdown 应含「不可信」锚点");
  });

  it("AC3: skill 不依赖系统内核内部 API（仅经公开 CLI/文件交互）", () => {
    requireBuiltinRepo();
    // 结构断言：skill 包内文件不得 import/require 内核源码。
    const stack = [BUILTIN_REPO];
    const files = [];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/\.(js|mjs|cjs|ts|md)$/.test(entry.name)) files.push(full);
      }
    }
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      assert.ok(
        !/(from|require\()\s*["'][^"']*src\/(services|http|flowEngine|main|preload)/.test(content),
        `${path.relative(BUILTIN_REPO, file)} 不应依赖系统内核内部 API（仅经公开 CLI/文件交互）`
      );
    }
  });
});
