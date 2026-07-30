# ADR-011: Agent skill 分发由 workstation 自持，第三方库仅作 registry 数据源

- **状态**: 已接受
- **日期**: 2026-07-29
- **相关 story**: 2026-07-29-multi-agent-skills
- **相关 REQ**: 待结晶（2026-07-29-multi-agent-skills）
- **修订**: ADR-003（repo 实体从 DB 迁至磁盘、恢复 local 来源）、ADR-004（软链位置与目标变更、`dependencies` 级联废止）

## 背景

workstation 要把 skill 同步进使用多种 AI agent 的项目（75 种目录约定），最初设想基于 vercel-labs/skills 库做薄封装，由库承担获取/注册/分发。调研（research/vercel-skills-cli-capabilities.md）与 spike（tech-design.md 附录 A，skills@1.5.20 实测）推翻了这一设想：

1. **库的全局 canonical 固定为 `~/.agents/skills/`，不可配置**——而该目录同时是 15 个 universal agent 的全局扫描目录，skill 放那里等于对所有 agent 全局泄露，违背"显式受控分发"。
2. **库的项目级 symlink 模型指向项目内部的实体拷贝**（`.agents/skills/`），不是外部中央仓库——"技能库一处更新、所有项目软链自动生效"无法实现；且单 agent 目标时强制 copy 模式（无 canonical、无软链），关联语义不统一；overlap 场景跳过建链。
3. **库零编程导出**（dist `export {}`），运行时只能 spawn CLI；exit code 弱语义（逐 agent 失败仍 exit 0）；约每周发版。

## 决策

1. **库的角色限定为 agent registry 数据源**：以 `scripts/sync-agent-registry.mjs` 从其包中提取 75 项目录约定，生成 JSON 快照入版本库跟随上游（diff 可审查）；`globalSkillsDir` 存模板，运行时惰性展开（遵守 ADR-009）。
2. **运行链路全由 workstation 自持**：获取（simple-git clone / 本地拷贝入库）、分发（按 registry 的 `skillsDir` 自建软链**直链技能库**）、收敛（agentTypes diff）、更新（git pull --ff-only / local 重添加覆盖）、移除（级联删链 + 删目录）。不调用库 CLI。
3. **磁盘即真相**：技能库目录与项目 agent 目录是唯一事实；技能/项目关联视图实时扫描重建，skills/skill_repos/project_skills 三表删除。
4. **修订 ADR-003**：repo 一级实体概念保留但载体从 DB 表改为技能库中的来源目录（一个来源目录 = 一个 repo，分组/级联删除语义不变）；恢复 local 安装源（ADR-003 曾移除）。
5. **修订 ADR-004**：软链位置从 `<project>/.opc/skills/<repo>/<skill>` 改为项目各 agent 原生目录，target 从安装目录改为技能库内 skill 目录；`dependencies` 级联关联废止；新增外部实体保护——非 workstation 创建的条目不删实体、占用冲突跳过并表面化。

## 后果

- 运行时对库零依赖：无 spawn/env/telemetry 面，不怕上游高频发版的行为漂移；registry 升级 = 重跑同步脚本 + diff 审查。
- 单/多 agent 关联语义统一（全是软链）；更新传播零成本（软链指向技能库实体）。
- 代价：获取/建链/更新的边界 case（junction、断链清理、ff-only 失败）由 workstation 自己负责；与库的生态（skills-lock.json、`npx skills` 互操作）不互通——项目里由 `npx skills` 安装的条目被视为[外部]（如实显示、不动实体）。
- `~/.agents/skills/` 及任何 agent 扫描路径被硬约束禁止作为技能库位置（E11 校验）。

## 替代方案

1. **库全包（spawn CLI，项目级 add per project）**：项目内实体拷贝 + per-project update + 单 agent copy 退化，与需求语义冲突。spike 否决。
2. **库全局安装 + workstation 建链**：全局 canonical 泄露给全部 universal agent。否决。
3. **vendor 库源码（agents.ts + installer.ts）**：获得数据与建链实现，但引入 TS 编译与顶层 env 展开（违反 ADR-009），且 installer 的 canonical 模型本就不符合需求。否决（仅取数据，不取实现）。

## 相关文件

- `.aiassist/stories/2026-07-29-multi-agent-skills/research/vercel-skills-cli-capabilities.md`
- `.aiassist/stories/2026-07-29-multi-agent-skills/tech-design.md`（附录 A spike 记录）
- ADR-003、ADR-004（本决策修订）、ADR-009（惰性初始化约束）
