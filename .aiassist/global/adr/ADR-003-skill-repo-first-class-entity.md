# ADR-003: Skill Repo 作为一级实体

- **状态**: 已接受
- **日期**: 2026-07-16
- **相关 story**: codex-harness-desktop
- **相关 REQ**: REQ-SKILL-001 ~ REQ-SKILL-004

## 背景

最初把每个 skill 作为独立安装单位，用户安装一次只能得到一个 skill；实际一个 npm package 或 plugin 往往包含多个相关 skill（如 `skills/utils/helper`）。按单个 skill 管理会导致列表重复、删除粒度错误。

## 决策

1. 引入 `skill_repos` 表作为一级实体，`skills` 表通过 `repoId` 外键归属到 repo。
2. 安装时递归扫描 repo 根目录下 `skills/` 目录，每个包含 `SKILL.md` 的目录生成一个 skill。
3. 列表按 repo 分组；删除以 repo 为单位，级联删除其 skills 与 `project_skills`。
4. 移除 `local` 安装源，仅保留 `npm` / `plugin`。

## 替代方案

1. **保持单个 skill 独立安装**：无法表达"一组 skill 一起安装/升级/删除"的语义，且 UI 会出现大量重复仓库名。拒绝。
2. **在 skill 级别增加 `packageName` 字段**：仍无法表达嵌套路径与 repo 生命周期。拒绝。

## 影响

- `skills` 表增加 `repoId`，移除 `installSource`。
- 前端 Skills 页面按 repo 分组展示；Project Detail 可用技能列表只返回属于有效 repo 的 skill（`listLinkableSkills`）。
- 迁移时必须清理 repo 模型迁移前遗留的 orphan skill（`db.js` migrateSchema 中的 DELETE 语句）。

> 注：本文件为补录。决策内容原记录于 `.aiassist/global/architecture.md` §ADR-003，adr/README 索引已声明，实体文件缺失（2026-07-19 review 发现后补建）。
