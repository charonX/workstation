// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-007
// REQ-VERSION: v1-hash:48deb3ad82e7d8647777c3836ee1a5eb7b81bbb743e89b6380a264857ddc6dd6
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.3 块 5, §10.5 决策 2, ADR-043
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadSkillService() {
  const mod = await import("../../../../../../src/services/skillService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/skillService.js");
  return mod;
}

describe("REQ-CLI-SERVICE-007 内置 Skill 自动收敛与项目链接（真 SKILL.md 缝）", () => {
  let workdir;
  let projectDir;
  let skillSvc;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-skill-"));
    projectDir = path.join(workdir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    skillSvc = await loadSkillService();
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("应用内置技能目录包含 3 个只读 SKILL.md 文件且内容包含命令说明", async () => {
    assert.equal(typeof skillSvc.getBuiltinSkillPath, "function", "导出 getBuiltinSkillPath");

    // EXPECTED-TRACE: prd.md §6.3 块 5, ADR-043
    const slugs = ["cli-claude", "cli-codex", "cli-crawl4ai"];
    for (const slug of slugs) {
      const skillPath = skillSvc.getBuiltinSkillPath(slug);
      assert.ok(skillPath, `内置技能 ${slug} 路径存在`);
      const skillMd = path.join(skillPath, "SKILL.md");
      assert.ok(fs.existsSync(skillMd), `文件 ${skillMd} 必须存在`);

      const content = fs.readFileSync(skillMd, "utf-8");
      assert.ok(content.includes("name:"), "含 frontmatter name");
      assert.ok(content.includes("一次性"), "说明文档包含一次性调用规范");
    }
  });

  it("项目启用 CLI 服务时自动创建软链，被 listLinkedSkillPaths 收编", async () => {
    assert.equal(typeof skillSvc.syncProjectCliSkills, "function", "导出 syncProjectCliSkills 收敛函数");

    // 启用 claude
    await skillSvc.syncProjectCliSkills(projectDir, { enabledCliSlugs: ["cli-claude"] });

    // EXPECTED-TRACE: prd.md §6.3 块 5
    const linkedPaths = await skillSvc.listLinkedSkillPaths(projectDir);
    const hasClaude = linkedPaths.some((p) => p.includes("cli-claude"));
    assert.ok(hasClaude, "linkedPaths 必须包含 cli-claude");

    // 禁用 claude：传入空 enabled 集合
    await skillSvc.syncProjectCliSkills(projectDir, { enabledCliSlugs: [] });
    const afterUnlink = await skillSvc.listLinkedSkillPaths(projectDir);
    const stillHasClaude = afterUnlink.some((p) => p.includes("cli-claude"));
    assert.equal(stillHasClaude, false, "禁用后软链已被自动移除");
  });

  it("用户自建同名 Skill 享有更高优先级，内置版本不覆盖自建版本", async () => {
    // 用户在项目内自建同名目录 test-project/.skills/cli-claude/SKILL.md
    const userSkillDir = path.join(projectDir, ".skills", "cli-claude");
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(path.join(userSkillDir, "SKILL.md"), "# User Custom Claude Skill");

    // 触发收敛
    await skillSvc.syncProjectCliSkills(projectDir, { enabledCliSlugs: ["cli-claude"] });

    const content = fs.readFileSync(path.join(userSkillDir, "SKILL.md"), "utf-8");
    assert.equal(content, "# User Custom Claude Skill", "用户版本不得被覆盖");
  });
});
