# Engineering Lessons

本文件记录跨 story 的工程经验与复用知识。

- 在项目演进过程中补充踩坑记录、最佳实践、性能调优等。
- 保持简洁，优先记录可复用的结论，而非一次性细节。

---

## Electron 主进程代码变更必须重启

- **现象**：renderer 热更新后 UI 已显示 skill 关联成功，但项目目录下没有生成 `.opc/skills` 软连接。
- **根因**：`skillService.js` 运行在 Electron main 进程，Vite 的 renderer HMR 不会重载 main 进程。
- **结论**：修改 main 进程 / Node 服务层后，必须重启应用或重新运行 `npm run dev`；E2E 与手动验收前确认主进程已加载最新代码。

## Skill Repo 作为一级实体：迁移要清理遗留数据

- **现象**：Project Detail 可用技能列表出现多个仓库名（如 `mattpocock/skills`、`mattpocock-skills`）。
- **根因**：从“单个 skill”模型迁移到“skill repo → 嵌套 skills”时，只给 `skills` 表加了 `repoId`，未清理旧数据，导致 orphan skill（`repoId IS NULL`）仍被返回。
- **结论**：数据模型变更时必须写 migration 清理遗留记录，并新增过滤器（如 `listLinkableSkills`）避免无效数据进入业务逻辑。

## Frontmatter 解析不要假设单行 key:value

- **现象**：Skill Detail 中 `tags` 丢失，`version`/`author`/`category` 等元数据在存在时显示为“—”。
- **根因**：`parseSkillMarkdown` 只按首行解析，无法处理 YAML 列表和多行 frontmatter。
- **结论**：解析 SKILL.md / Markdown frontmatter 时，使用能处理多行字段、YAML dashed list、`[a,b]` 数组的解析器；空值在 UI 层应隐藏而不是用占位符兜底。

## 文件系统副作用必须纳入契约和测试

- **现象**：用户以为 project↔skill 关联只是数据库记录，期望有实际文件系统效果。
- **结论**：当功能产生文件系统副作用（如 symlink、目录创建）时，应在 REQ 中明确验收标准，并在 API 测试中断言路径/符号链接存在性；删除时必须同步清理，避免 dangling symlink。

## 依赖级联要显式处理，避免循环

- **结论**：skill `dependencies` 解析后，关联时应递归级联并记录 `visited` 防止循环依赖；取消关联时不应级联取消，避免误删用户显式选择的 skill。

## 关闭按钮等歧义控件应使用稳定定位

- **现象**：E2E 中“关闭弹层”因 header ✕ 和 footer Close 文本冲突导致 locator 不稳定。
- **结论**：优先使用语义角色或唯一 `data-testid`；避免按文案定位可能重复的控件。

## npm 安装测试应使用本地 fixture

- **结论**：测试真实 `npm install` 时，使用本地 package 目录 fixture 代替远程 registry，避免网络依赖和 CI 不稳定。

## REQ 变更后必须同步 hash 与所有测试头部

- **结论**：`requirements.md` 一旦修改，`requirements-v1.hash` 会变，所有 `REQ-VERSION` 头部必须批量更新；否则 pre-commit/校验会认为测试契约过期。

---

来源：codex-harness-desktop /reflect（2026-07-16）
