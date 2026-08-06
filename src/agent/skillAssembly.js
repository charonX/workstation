// src/agent/skillAssembly.js
// REQ-AGENT-031 标准 3/4 public seam（signoff 实现契约）：available_skills
// 渐进披露段的输入等价物。
//
// PI 在 worker 内按 resourceLoader.additionalSkillPaths 生成 system prompt 的
// <available_skills> 段（name/description/location，渐进披露——H5 已证多 loader
// 共存独立、互不污染）。该段在 worker 进程内组装，fake worker 观测不到；业务
// 测试经本模块断言等价输入：读取各 skillPath 下 SKILL.md frontmatter →
// [{ name, description }]（与 skillService 的 frontmatter 解析语义一致）。

import fs from "node:fs";
import path from "node:path";

// frontmatter 解析（镜像 skillService parseFrontmatter：支持多行值）。
function parseFrontmatter(text) {
  const result = {};
  const lines = text.split("\n");
  let currentKey = null;
  const currentRaw = [];

  function flush() {
    if (currentKey) {
      result[currentKey] = currentRaw.join("\n").trim();
      currentRaw.length = 0;
    }
  }

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      flush();
      currentKey = match[1];
      currentRaw.push(match[2]);
    } else if (currentKey) {
      currentRaw.push(line);
    }
  }
  flush();
  return result;
}

function parseScalar(raw) {
  if (raw == null) return "";
  const v = raw.trim();
  return v.replace(/^["']|["']$/g, "");
}

// listAvailableSkills({ skillPaths }) → [{ name, description }]
// 读取各 skillPath 下 SKILL.md frontmatter 的 name/description（等价于 PI
// 渐进披露段对该 skill 的展示输入）。缺 name/description（E6 语义）与不可读
// 目录（E10 语义）跳过——扫描不因单个 skill 失败。
export function listAvailableSkills({ skillPaths = [] } = {}) {
  const skills = [];
  for (const dir of skillPaths) {
    let content;
    try {
      content = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    } catch {
      continue; // E10：不可读 skillPath 跳过。
    }
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) continue;
    const frontmatter = parseFrontmatter(match[1]);
    const name = parseScalar(frontmatter.name);
    const description = parseScalar(frontmatter.description);
    if (!name || !description) continue; // E6：缺 name/description 跳过。
    skills.push({ name, description });
  }
  return skills;
}
