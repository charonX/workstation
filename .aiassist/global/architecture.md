# Architecture Decision Records (ADR)

本文件记录项目关键架构决策。

## 模板

### 决策标题

- **状态**: 提议 / 已接受 / 已废弃
- **背景**: 为什么需要做这个决策
- **方案**: 选择了什么
- **替代方案**: 考虑过哪些，为什么没选
- **影响**: 对项目结构和后续开发的影响

## ADR-001: 桌面应用壳选择 Electron

- **状态**: 已接受
- **背景**: PRD 最初指定 Tauri + React + TypeScript。在 `/tac-tech-design` 阶段回顾时发现，核心服务层已用 Node.js 实现，且 Agent 节点需要进程内调用 Agent SDK / Codex app-server，Tauri 的 Rust 后端会引入不必要的桥接复杂度。
- **方案**: 采用 Electron 作为桌面应用壳。主进程即 Node.js 引擎进程，可直接复用现有服务层；渲染进程使用 React + TypeScript + TailwindCSS + React Flow。
- **替代方案**:
  - Tauri：更轻量，但需要把核心逻辑用 Rust 重写或在 Rust 与 Node.js 之间做 IPC 桥接，增加 Agent 调用的摩擦。
  - 纯 Node.js CLI + 浏览器：缺少桌面壳的窗口管理、系统托盘、自动启动等能力。
- **影响**:
  - 现有 `src/` 服务层可继续演进，最终运行在 Electron main process 中。
  - 文件系统、SQLite、子进程管理都在 Node.js 主进程内完成，无需跨语言桥接。
  - 包体积和内存占用高于 Tauri，但作为内部工具可接受。
  - 需要为 Electron 主进程写集成测试（使用 spectron 替代方案或 playwright-electron）。

## ADR-002: 前端验收采用 Playwright Electron E2E + feel-signoff

- **状态**: 已接受
- **背景**: 第一次 attempt 只依赖 feel-signoff 人工验收前端，导致前端界面未实现就进入 QA，无法通过 feel-signoff。
- **方案**: 引入 Playwright Electron E2E 作为前端结构与关键用户路径的自动化验收 seam；视觉细节仍由 feel-signoff 依据 HTML UX 参照验收。
- **替代方案**:
  - 纯组件测试：无法覆盖 Electron 主进程/渲染进程边界和真实窗口行为。
  - 手工 feel-signoff only：无法在 BUILD/QA 阶段自动回归。
- **影响**:
  - 关键用户路径必须有 E2E 覆盖才能进入 feel-signoff。
  - E2E 数量遵循测试金字塔，只覆盖关键路径，不替代单元测试。
  - CI 需要安装 Playwright 浏览器/ Electron 依赖。

## ADR-003: Skill Repo 作为一级实体

- **状态**: 已接受
- **背景**: 最初把每个 skill 作为独立安装单位，用户安装一次只能得到一个 skill；实际一个 npm package 或 plugin 往往包含多个相关 skill（如 `skills/utils/helper`）。按单个 skill 管理会导致列表重复、删除粒度错误。
- **方案**:
  - 引入 `skill_repos` 表作为一级实体，`skills` 表通过 `repoId` 外键归属到 repo。
  - 安装时递归扫描 repo 根目录下 `skills/` 目录，每个包含 `SKILL.md` 的目录生成一个 skill。
  - 列表按 repo 分组；删除以 repo 为单位，级联删除其 skills 与 `project_skills`。
  - 移除 `local` 安装源，仅保留 `npm`/`plugin`。
- **替代方案**:
  - 保持单个 skill 独立安装：无法表达“一组 skill 一起安装/升级/删除”的语义，且 UI 会出现大量重复仓库名。
  - 在 skill 级别增加 `packageName` 字段：仍无法表达嵌套路径与 repo 生命周期。
- **影响**:
  - `skills` 表增加 `repoId`，移除 `installSource`。
  - 前端 Skills 页面按 repo 分组展示；Project Detail 可用技能列表只返回属于有效 repo 的 skill（`listLinkableSkills`）。
  - 迁移时必须清理 repo 模型迁移前遗留的 orphan skill。

## ADR-004: Project 与 Skill 通过文件系统软连接关联

- **状态**: 已接受
- **背景**: Project 关联 Skill 仅保存数据库记录时，对实际工作目录没有影响；agent/codex 节点难以直接发现和使用 skill。需要在项目本地路径中建立可解析的 skill 入口。
- **方案**:
  - 关联 skill 时，在项目目录 `<project.localPath>/.opc/skills/<repoName>/<skillName>` 创建指向 skill 安装目录的符号链接。
  - 取消关联时仅删除当前 skill 的软连接。
  - 关联时按 `SKILL.md` 中的 `dependencies` 自动级联关联依赖 skill；取消关联时不级联取消。
  - 删除 skill repo 前，遍历 `project_skills` 清理所有已关联项目中的 skill 软连接，避免 dangling symlink。
- **替代方案**:
  - 仅 DB 记录，运行时再按记录动态解析 skill 路径：增加了运行时代码复杂度，且外部工具无法直接读取 skill。
  - 把 skill 文件物理复制到项目目录：重复占用空间，且 repo 更新后项目中的副本会过期。
- **影响**:
  - `skillService.linkSkill`/`unlinkSkill` 需要 `projectService` 与文件系统操作协同。
  - 测试必须断言符号链接存在性与清理行为。
  - 删除 skill repo 的级联逻辑需先清理 symlink 再删 DB 记录。
