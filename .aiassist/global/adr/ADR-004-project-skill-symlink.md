# ADR-004: Project 与 Skill 通过文件系统软连接关联

- **状态**: 已接受
- **日期**: 2026-07-16
- **相关 story**: codex-harness-desktop
- **相关 REQ**: REQ-WORKSPACE-006、REQ-SKILL-004

## 背景

Project 关联 Skill 仅保存数据库记录时，对实际工作目录没有影响；agent/codex 节点难以直接发现和使用 skill。需要在项目本地路径中建立可解析的 skill 入口。

## 决策

1. 关联 skill 时，在项目目录 `<project.localPath>/.opc/skills/<repoName>/<skillName>` 创建指向 skill 安装目录的符号链接。
2. 取消关联时仅删除当前 skill 的软连接。
3. 关联时按 `SKILL.md` 中的 `dependencies` 自动级联关联依赖 skill；取消关联时不级联取消。
4. 删除 skill repo 前，遍历 `project_skills` 清理所有已关联项目中的 skill 软连接，避免 dangling symlink。

## 替代方案

1. **仅 DB 记录，运行时再按记录动态解析 skill 路径**：增加了运行时代码复杂度，且外部工具无法直接读取 skill。拒绝。
2. **把 skill 文件物理复制到项目目录**：重复占用空间，且 repo 更新后项目中的副本会过期。拒绝。

## 影响

- `skillService.linkSkill` / `unlinkSkill` 需要 `projectService` 与文件系统操作协同。
- 测试必须断言符号链接存在性与清理行为。
- 删除 skill repo 的级联逻辑需先清理 symlink 再删 DB 记录。

> 注：本文件为补录。决策内容原记录于 `.aiassist/global/architecture.md` §ADR-004，adr/README 索引已声明，实体文件缺失（2026-07-19 review 发现后补建）。
