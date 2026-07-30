# 访谈笔记 — 2026-07-29-multi-agent-skills

> 2026-07-29 需求洞察完成，用户已显式确认方向（yes）。

## 核心问题

workstation 的 skill 管理与分发耦合私有目录约定（`<project>/.opc/skills/`）。项目使用多种 AI agent 时，不同 agent 的 skill 安装目录要求不同（Claude Code → `.claude/skills/`，Codex → `.agents/skills/` 等），skill 同步只能手工维护，无法按项目声明的 agent 类型自动适配。

## 用户画像

workstation 用户（开发者本人/团队内部）。本地单机桌面 app（Electron），管理多个使用不同 AI agent 的项目。项目处于开发阶段，无线上用户、无历史数据迁移义务。

## 关键边界

1. **封装落点**：workstation 内部（skillService 改造）。不做独立工具；loop-workflow 自身的 `cp -R` skill 安装流程不动。
2. **底座库**：[vercel-labs/skills](https://github.com/vercel-labs/skills)——"open agent skills ecosystem 的 CLI"。自带 70+ agent 目录约定表；默认 symlink（"symlinks from each agent to a canonical copy, single source of truth"），`--copy` 退化；`-a` 指定多 agent；来源 git/GitHub/GitLab/本地路径；命令 add/list/update/remove/find/use/init。**只暴露 CLI，无编程 API**。
3. **来源收敛**：git URL + 本地路径两种；npm 和 Claude Plugin 来源**删除**（用户原话："开发阶段可以直接删掉，本身也没什么用"）。
4. **单轨**：获取/注册/分发/更新/移除整条链走库；不做"skillService 一套 + 库一套"双轨。
5. **磁盘即真相，扫描重建视图**：skills / skill_repos / project_skills 三表消解。技能列表 = 扫描中央仓库目录；项目关联 = 扫描项目 agent 目录里的软链；元数据（description/parameters/examples/readme）扫描时解析 SKILL.md（现有解析代码保留复用）。外部 `npx skills` 手动改动也能被如实反映——从根上消除 BUG-009 那类 split-brain。
6. **`.opc/skills` 私有约定废弃**，不再产生。
7. **同步语义：声明即收敛**。修改项目 agent 类型后，已关联 skill 自动补装到新增 agent 目录、从被移除的 agent 目录删链；另提供手动"重新同步"入口兜底（外部改动、断链、漂移场景）。
8. **agent 类型选择器**：全量 70+ 列表，**无默认预选**，用户显式挑；支持搜索 + 排序，claude-code / codex 等常用置顶。
9. symlink 为主；`--copy` 退化本期不暴露。
10. 库的全局安装（`-g`）、`skills use` 临时使用、`skills find` 远程搜索、`skills init` 模板创建，本期不纳入 workstation 功能面。

## 隐含假设

1. 库的 canonical copy 行为能与 workstation 中央仓库（settings "Skill 仓库路径"）映射——**未验证**。
2. CLI-only 库可在 Electron 打包环境中稳定调用（dependency + spawn bin，或 import 内部模块）——**未验证**。
3. 安装 git 来源时用户机器有网络。
4. "项目关联 skill" = 往项目 agent 目录装；不存在"关联了但不分发"的纯 DB 态关联语义（用户选 A 时已接受）。
5. 扫描性能可接受（项目只扫描其声明的 agent 目录，不是全量 70+）。

## 矛盾/风险

1. **集成可行性风险（最高）**：CLI-only 库进 Electron 主进程。spawn bin 需要 node 环境与 bin 可用；import 内部模块无 API 承诺、升级易碎。→ tech-design 必须先 spike。
2. **canonical copy 语义映射风险**：库的 canonical copy 位置/生命周期未确认；若库把它放在自有位置（非 workstation 仓库目录），"中央仓库目录 = 扫描源"的设计要调整。→ tech-design 必须先 spike。
3. **Windows symlink 权限**：现有代码用 junction 兜底；库自身如何处理 Windows 待确认。
4. **元数据穿透**：agent 目录里只有软链时，SKILL.md 解析要穿透到 target；扫描重建的正确性成为新的关键路径。
5. 若方向错了，最可能错的层：**可行性层**（CLI 集成）与**方案层**（canonical copy 映射）——这两点不过，需求本身不受影响，直接换实现即可。

## 候选方向

### 方向 A：库单轨 + 磁盘即真相（最终确认）
- 适用场景：多 agent 项目，开发阶段无迁移负担。
- 主要取舍：删掉 npm/Plugin 来源与三张 DB 表，换架构简洁与外部一致性；承担 CLI 集成风险。
- 推荐度：**首选（用户确认）**。

### 方向 B：双轨 / DB 为主 + 扫描对账
- 保留现有 DB 真相，库只负责落盘，扫描做自愈对账。
- 主要取舍：双写根源保留，split-brain 只是缓解不是消除。
- 推荐度：不推荐（用户否决）。

### 方向 C：保留三种来源 UI，workstation 做获取归一化
- npm/Plugin 由 workstation 物化成本地目录后以 local source 交给库。
- 主要取舍：保留已有用户路径，但保留获取层代码，复杂度高。
- 推荐度：不推荐（用户判断 npm/Plugin "本身也没什么用"，直接删）。

### 方向 D：只抄库的 agent 目录约定表，不依赖库本体
- 主要取舍：无集成风险，但失去库持续维护的红利（70+ agent 表更新）。
- 推荐度：不推荐（用户明确"使用这个第三方的包"）。

## 确认方向

最终确认的方向：**方向 A**（用户显式 yes）。

- **Outcome**：workstation 的 skill 管理/分发整体换轨到 vercel-labs/skills 库——项目声明支持的 agent 类型（多选），skill 从 git/本地来源收进中央仓库，按声明软链分发到项目各 agent 原生目录，磁盘即真相。
- **User**：workstation 用户（自己/团队内部），管理多个使用不同 AI agent 的项目。
- **Why now**：项目要支持多种 agent，现有 `.opc/skills` 私有约定只对得上一套目录假设；发现合适的库，开发阶段一次性换掉比渐进修补便宜。
- **Success**：
  1. 项目创建/详情可多选 agent 类型（全量 70+，搜索 + 常用置顶，无默认预选）；保存后已关联 skill 自动补装/删链收敛。
  2. git URL / 本地路径添加 skill → 扫描后出现在技能列表；关联到项目 → 各 agent 目录出现可用软链，agent 实际能读到。
  3. 外部 `npx skills` 手动改动后，workstation 扫描如实反映，不出现 split-brain。
  4. 手动"重新同步"入口可一键修复断链/漂移。
  5. npm / Claude Plugin 来源及其 UI/代码删除，`.opc/skills` 不再产生，三表消解。
- **Constraint**：库 CLI-only（集成机制留 tech-design）；不做历史数据迁移；symlink 为主、`--copy` 不暴露。
- **Out of scope**：loop-workflow 的 cp -R 流程；npm/Plugin 来源（删除非延期）；库的 `-g` / `use` / `find` / `init` 能力；团队协作/多机同步。

## 最窄的切入点

技术 spike 先行（tech-design 阶段）：① 库在 Electron/Node 环境的调用方式；② `skills add` 本地来源时 canonical copy 的位置与可控性。

功能最窄切片：单项目 + 单 agent 类型（claude-code）+ 本地来源，跑通"添加 → 扫描列表 → 关联 → 软链可读 → 重新同步"闭环，再扩到多 agent 类型与 git 来源。

## 待确认问题

- [ ] （tech-design）库的集成机制：dependency + spawn bin vs import 内部模块？
- [ ] （tech-design）库 canonical copy 位置是否可指向 workstation 中央仓库目录？
- [ ] （tech-design）库对 Windows symlink/junction 的处理？
- [ ] （tech-design）库的版本锁定与升级策略？
- [ ] （PRD）手动"重新同步"入口的 UI 位置（项目详情？技能列表？）
