# 多 Agent Skill 管理与分发

> Story: `2026-07-29-multi-agent-skills`
> 版本: v0.4（2026-07-29，review-tech 就地修订）
> v0.4 修订：按 review-tech.md 补全——W1（E4 删除、E3 改系统 git 不可用 `GIT_UNAVAILABLE`、新增 E12 `SKILL_SLUG_CONFLICT`）；W2（skill 身份 = `{slug, skillName}`）；W3（local slug 冲突默认 409、force 才覆盖）；S1（E11 改双向前缀包含 + 归一）；S2（链接名 = skill 目录名，非法目录名入库拒绝）；S4（默认技能库路径更名 `~/.opc-workstation/skills`，不迁移）；S7（已删项目残留链不级联清理，记已知取舍）。阻塞项 F1 修订在 tech-design.md（收敛扫描域 = 变更前∪变更后）。
> v0.3 修订：tech-design spike 证实库的项目级分发无法实现"软链解析到技能库"——库的角色定为 **agent registry 数据源**；运行链路全自持。ADR-003/004 修订。
> 输入: `interview-notes.md` + `research/vercel-skills-cli-capabilities.md`

## 1. 问题陈述

workstation 把 skill 同步进项目时，落盘位置耦合私有目录约定（`<project>/.opc/skills/`）。不同 AI agent 对 skill 安装目录的要求不同（Claude Code 读 `.claude/skills/`、Codex 读 `.agents/skills/` 等，各约 75 种约定）。项目要支持多种 agent 时，skill 分发只能靠手工补链维护，workstation 无法按项目声明的 agent 类型自动适配。

同时，现有 skill 获取链路（npm / Claude Plugin 两种来源）是自造的、实际用处不大；安装态存 DB、磁盘是投影的双写模型已经出过分裂（BUG-009/011 的 reconcile 补丁至今在代码里）。

## 2. 解决方案

把 skill 的"获取 → 注册 → 分发 → 更新 → 移除"整条链建立在 [vercel-labs/skills](https://github.com/vercel-labs/skills) 库的 **agent registry 数据**（75 项目录约定）之上，运行链路全部由 workstation 自持：

- **技能库 = workstation 私有、可指定的目录**（settings 中配置，默认在应用数据目录下）。**硬约束：该目录不得是任何 agent 的全局/项目扫描路径**（库的全局 canonical `~/.agents/skills/` 同时是 15 个 universal agent 的全局 skills 目录，收进去的 skill 会被这些 agent 在所有项目中自动读到——这违背显式受控分发，故不可用）。添加 skill 进入该目录（git URL clone / 本地路径拷贝，实体入库），技能列表 = 扫描该目录。**磁盘即真相**，不再维护安装态 DB。
- **项目声明 agent 类型**（多选，来自 registry 快照全量 75 项；无默认预选；搜索 + 常用置顶）。关联 skill = workstation 在项目的各 agent 原生目录**自建软链，直接指向技能库中的对应 skill**（无间接层；registry 中 `skillsDir` 相同的 agent 去重）。项目已关联列表 = 扫描项目 agent 目录；**非 workstation 创建的外部条目如实显示并标注，不动其实体，占用冲突时跳过并表面化**。
- **声明即收敛**：agent 类型变更后自动补建/删除软链；另提供手动"重新同步"兜底。
- **更新/移除**：更新 = 技能库内刷新（git 来源 `git pull --ff-only`，失败表面化不强行覆盖；local 来源手动重新添加覆盖；软链模型下项目侧自动生效）；移除 = 所有项目删链 + 从技能库删除。
- npm / Claude Plugin 来源及其 UI/代码**删除**；`dependencies` 级联关联**删除**；`.opc/skills` 约定废弃；skills / skill_repos / project_skills 三表删除。

tech-design spike 结论（skills@1.5.20 实测，详见 tech-design.md）：库的项目级 add 在单 agent 时强制 copy、多 agent 时软链指向**项目内**实体拷贝、overlap 场景跳过建链——三条路都无法实现"项目软链解析到中央技能库"；全局 canonical 位置固定且是 universal agent 公共扫描目录。因此库的运行时能力（add/update/remove/list）一律不调用，仅取其 registry 数据（JSON 快照跟随上游）。

## 3. 用户故事

- 作为用户，我在创建/编辑项目时声明该项目使用的 agent 类型（多选、可搜索、常用置顶），以便 skill 能同步到这些 agent 真正读取的目录。
- 作为用户，我从 git URL 或本地路径把 skill 添加进技能库，以便跨项目复用。
- 作为用户，我把技能库里的 skill 关联到项目，项目的每个已声明 agent 目录立刻出现指向技能库的软链，agent 实际能读到。
- 作为用户，我修改项目的 agent 类型后，已关联 skill 自动补建/删除软链，无需手工维护。
- 作为用户，我在外部用 `npx skills` 或手动改动过目录后，workstation 扫描能如实反映现状，且能用"重新同步"一键收敛漂移。
- 作为用户，我能更新技能库里的 skill（远程来源拉取最新），所有项目的软链自动指向新内容。
- 作为用户，我能从技能库移除 skill，所有项目中的对应软链一并清除。

## 4. 稳定块

| # | 块 | 要点 |
|---|---|---|
| S1 | 项目 agent 类型声明 | `projects.agentTypes`（JSON 数组）；候选 = 库 registry 全量 75 项；无默认预选；搜索 + 常用置顶（claude-code、codex 等）；允许空数组（语义 = 暂不分发） |
| S2 | 技能库 = 私有指定目录 | settings 保留路径配置（默认应用数据目录下，如 `~/.opc-workstation/skills/`）；**硬约束：不得与 75 项 agent 约定的任何全局/项目扫描路径重合**（配置时校验并拒绝）；技能列表 = 扫描该目录 + 解析 SKILL.md 元数据（复用现有解析代码） |
| S3 | 添加 skill | 来源仅 git URL / 本地路径；实体进入技能库目录（本地来源拷贝入库、与源脱钩）；npm / Claude Plugin 来源、UI、代码删除 |
| S4 | 项目关联/取消关联 + 外部条目语义 | 关联 = workstation 在项目各 agent 目录**自建软链直链技能库**中的对应 skill（registry 中 `skillsDir` 相同的 agent 去重）；项目详情技能列表 = 扫描项目 agent 目录；非 workstation 创建的条目如实显示并标注 **[外部]**（软链可移除链接、实体目录不动；不参与收敛/移除/更新）；目标位置被外部实体占用时**跳过 + 冲突标记表面化，绝不删外部实体** |
| S5 | 声明即收敛 + 手动重同步 | agentTypes 变更后自动补建/删链（同步执行）；项目详情提供"重新同步"入口，一键修复断链/漂移/外部改动（只重建技能库条目，不动外部条目） |
| S6 | 移除 skill | 所有项目中的软链删除 + 从技能库删除；UI 需确认 |
| S7 | 更新 skill | 技能库内刷新：git 来源 `git pull --ff-only`（失败表面化、不强行覆盖）；local 来源提示手动重新添加（重添加遇 slug 冲突默认 409，显式确认才覆盖，E12）；软链模型下项目侧自动生效 |
| S8 | 旧机制清除 | `.opc/skills` 不再产生；skills / skill_repos / project_skills 三表删除；BUG-011 reconcile 逻辑随表删除 |
| S9 | agent registry 单一数据源 | 75 项目录约定来自库（跟随上游）；workstation 只持有展示配置（置顶清单、排序）；registry 漂移（声明的 agent 在新版库中消失）时跳过 + warning，不丢项目数据 |

## 5. 移动块

| # | 块 | 为什么在动 |
|---|---|---|
| M1 | "重新同步"入口的具体 UI 位置（项目详情技能区 vs 技能库页） | 倾向项目详情技能区（同步是 per-project 语义），UX 阶段定稿 |

> M2（集成形态）、M3（registry 获取方式）、M4（两条链路实现）已在 tech-design 定稿：库仅作 registry 数据源（JSON 快照 + 同步脚本），运行链路全由 workstation 自持——见 tech-design.md D1/D3 与 ADR-011。

## 6. 用户操作流

**S1（声明 agent 类型）**：项目创建/编辑页 → agent 类型选择器 → 输入 "claude" 过滤 → 勾选 `claude-code`、`codex`（常用区置顶）→ 保存 → 项目详情显示两个 agent 标识。

**S2/S3（添加 skill）**：技能库页 → "添加 Skill" → 选来源类型（git URL / 本地路径）→ 输入 `https://github.com/owner/repo` 或 `/abs/path` → 确认 → 安装任务执行 → 技能库目录出现该 skill 实体 → 技能列表展示（名称、描述来自 SKILL.md）。

**S4（关联 skill）**：项目详情 → 技能区 → "关联 Skill" → 从技能库列表（按来源分组，身份 = 来源 + 名称）选择 → 确认 → 项目 `.claude/skills/<name>` 与 `.agents/skills/<name>` 出现软链 → 沿软链解析最终读到技能库目录中的 SKILL.md → Claude Code 在该项目能调用此 skill。

**S5（变更收敛）**：项目详情 → 编辑 agent 类型 → 增加 `cursor`、移除 `codex` → 保存 → cursor 对应目录（registry 查得）出现全部已关联 skill 的软链、codex 独有链被删除 → 若有建链失败，UI 表面化失败 agent 清单。点击"重新同步"→ 全部已关联 skill 按当前声明重建一次。

**S6（移除 skill）**：技能库页 → skill 行 → "移除" → 确认对话框（提示将删除所有项目中的引用）→ 确认 → 各项目 agent 目录软链删除 → 技能库目录中对应 skill 删除 → 技能列表不再出现。

**S7（更新 skill）**：技能库页 → skill 行 → "更新" → 重新拉取远程内容并覆盖技能库中的 skill → 列表显示更新后信息 → 项目侧软链无需操作即指向新内容。local 来源点"更新"→ 提示不支持自动更新、请重新添加。

**S8**：N/A（结构清除，无用户操作流；验收靠"操作后 `.opc/skills` 不再出现、DB 中无三表"）。

**S9**：N/A（内部数据源；随库升级后新 agent 出现在选择器、消失的旧 agent 在已声明项目中显示失效标记，属 S1/S5 的表现）。

## 7. 表单与输入验证

| 字段 | 规则 |
|---|---|
| 添加来源类型 | 必填；枚举 `git` \| `local` |
| git URL | 必填；非空；合法 https/ssh/SCP-like git 地址；长度 ≤ 2048 |
| 本地路径 | 必填；非空；展开 `~` 后为已存在的目录；目录内存在 `SKILL.md`、`skills/*/SKILL.md` 或 `skills/*/*/SKILL.md`；realpath 不得等于或包含技能库自身 |
| local slug 冲突 | slug 已存在时默认拒绝（E12），显式确认（force）才覆盖（review W3） |
| skill 目录名 | 链接名 = 来源内 skill 目录名；目录名含路径分隔符/空白/控制字符的 skill 在入库校验时拒绝（review S2） |
| skill 身份（关联/取消） | 复合身份 `{slug, skillName}`（来源目录 + skill 目录名）；裸名称跨来源可重名，不足以定位（review W2）；必须存在于技能库扫描结果；项目 agentTypes 非空（空则拒绝并提示先设置 agent 类型，E7） |
| agentTypes | 数组；元素必须 ∈ registry（75 项 key）；自动去重；允许空数组 |
| 技能库路径（settings） | 非空；展开 `~` 后可创建为目录；**不得与 registry 中任何 agent 的全局或项目扫描路径互为前缀包含**（如 `~/.agents/skills`、`~/.claude/skills`），重合则拒绝保存（E11，review S1） |
| 项目 localPath | 沿用现有校验（存在且为目录）——建链以它为根 |

## 8. 错误状态与失败响应

| # | 场景 | 响应 |
|---|---|---|
| E1 | git 获取失败（网络/认证/repo 不存在） | 安装任务失败；透传底层错误信息；HTTP 502 + `SKILL_FETCH_FAILED` |
| E2 | 本地路径无效 / 不含 SKILL.md | HTTP 400 + `SKILL_SOURCE_INVALID`，字段级错误 |
| E3 | 系统 git 不可用（simple-git spawn 失败） | HTTP 503 + `GIT_UNAVAILABLE`；技能库页显示不可用横幅（review W1 改造：原为库 CLI 不可用，D1 后该场景不复存在） |
| ~~E4~~ | ~~库 exit 0 但 list --json 核验不一致~~ | **已删除**（review W1：spawn 库 CLI 时代的场景，D1 运行时零库调用后不复存在；编号保留不重用） |
| E5 | 某 agent 目录建链失败（权限/磁盘） | 该 agent 标记 `syncFailed`，其余 agent 继续；结果中含失败清单，UI 表面化；不静默降级为拷贝 |
| E6 | SKILL.md frontmatter 缺 `name`/`description` | 扫描跳过该目录 + 记 warning；不进入技能列表 |
| E7 | agentTypes 为空时发起关联 | HTTP 409 + `PROJECT_AGENTS_EMPTY`，提示先设置 agent 类型 |
| E8 | 更新 local 来源 skill | HTTP 400 + `SKILL_UPDATE_UNSUPPORTED`，提示重新添加 |
| E9 | registry 漂移（项目声明的 agent 在新版库中不存在） | 扫描/收敛跳过该 agent + 记 warning；项目数据保留，UI 标失效 |
| E10 | 扫描期间目录并发变动 | 单目录失败跳过 + warning；扫描整体不崩 |
| E11 | 技能库路径配置与 agent 扫描路径重合（如填 `~/.agents/skills`） | HTTP 400 + `SKILL_REPO_PATH_CONFLICT`，指出冲突的 agent 列表，拒绝保存。**判定 = 双向前缀包含**（库在扫描路径之内，或扫描路径在库之内）；比较前 `~` 展开 + realpath + 大小写归一（review S1） |
| E12 | local 来源添加时 slug 已存在 | 默认拒绝：HTTP 409 + `SKILL_SLUG_CONFLICT`，提示已存在的来源；仅显式确认（force 参数/UI 确认）才覆盖（review W3） |

## 9. 复杂度分级

**complex**。理由：触及模块多（skillService 重构、agentRegistryService 新增、projectService、DB schema 迁移、HTTP 路由、CLI、4+ UI 组件、registry 同步脚本）；外部依赖（系统 git + 网络，仅 git 来源）；文件系统副作用（symlink，跨 macOS/Windows）；外部一致性语义（磁盘即真相 + 外部改动收敛）。

## 10. 实现决策

模块/接口层决策（不写实现细节；M2/M3 由 tech-design spike 定稿）：

- **agentRegistryService**（新，main 进程）：运行时读取 registry **JSON 快照**（由 `scripts/sync-agent-registry.mjs` 从库提取生成，进版本库跟随上游）；`globalSkillsDir` 存模板、**惰性展开**（ADR-009）；displayName ↔ key 映射；展示配置（置顶清单：claude-code、codex、opencode、cursor、kimi-code-cli；其余按 displayName 排序）；技能库路径合法性校验（E11）。**registry 数据的唯一入口。**
- **skillService**（重构）：技能库视图（扫描技能库目录 + SKILL.md 解析，复用现有解析，按来源目录分组）；获取入库（git clone 用 simple-git——已是项目依赖；本地拷贝）；更新（git pull --ff-only）；移除（级联删链 + 删目录）；分发（自建软链直链技能库，junction 兜底复用现有代码）；收敛（agentTypes diff → 补建/删链）；重同步。技能列表/详情的数据源从 DB 改为扫描视图。**不调用库 CLI。**
- **projectService**：`agentTypes` 字段 CRUD；变更后调用 skillService 收敛。
- **DB 迁移**：`projects` 加 `agentTypes TEXT`（JSON 数组，默认 `[]`）；删除 `skills` / `skill_repos` / `project_skills` 三表及相关代码（含 BUG-011 reconcile、update npm repo、dependencies 级联逻辑）。
- **HTTP/CLI**：skills 路由重构（列表/安装/更新/移除，安装沿用现有 job 异步模式）；skillRepos 路由并入 skills（按来源分组）；agents 路由（registry 列表）；projects 路由加 agentTypes + 项目技能关联/取消/重同步端点；CLI 命令对齐（`skill install --source git|local`）。
- **UI**：InstallSkillModal 改两来源；SkillTable/SkillDetailModal 数据源切到扫描视图（按来源分组、外部条目标注）；项目创建/详情加 agent 多选组件（搜索 + 置顶分组）；"重新同步"入口（M1）；settings 保留技能库路径设置（E11 校验反馈）。

### 10.1 解耦决策

1. **库的唯一接触面 = registry 快照同步脚本**：运行时对库零调用（不怕每周发版的上游漂移、无 telemetry 面、无 spawn/env 坑）；跟随上游 = 重跑脚本 + diff 审查快照（挂入现有 `/sync-refs` 流程）。
2. **技能库位置由 workstation 拥有**：库的全局 canonical 是 universal agent 的公共扫描目录，不符合受控分发语义；库"必须把 canonical 放在固定位置"的能力（add/update）一律不使用。
3. **分发是 workstation 的显式语义**：spike 证实库的项目级 add 做不到"软链解析到技能库"（单 agent 强制 copy、多 agent 链向项目内拷贝、overlap 跳过），故项目侧软链由 workstation 自建直链，仅复用 registry 的目录约定数据。
4. **registry 数据与展示配置分离**：置顶/排序是 workstation 产品决策，不进快照。
5. **扫描视图不缓存进 DB**：每次请求实时扫描（规模小：单仓库目录 + 项目声明的少数 agent 目录），避免重新引入双写。性能问题出现时再说（记录为已知取舍）。

## 11. 测试决策

- **主 seam：HTTP API + FS 断言**（node --test，沿用 `tests/capabilities/skill-management/skill/<story-id>/` 与 `workspace-management/project/<story-id>/` 结构）。FS 断言覆盖：软链存在性、target 指向技能库、解析后 SKILL.md 可读、外部实体未被动、冲突跳过。
- **git fixture**：git 来源测试用本地裸仓库 fixture（无网络依赖）；技能库目录用临时目录隔离（沿用现有 `opc-workstation-test-skills-*` 模式）。
- **registry 快照**：测试用固定 fixture 快照（不跑同步脚本）；同步脚本本身一个 smoke 测试（快照 schema 合法）。
- **CLI seam**：`opc-workstation skill ...` 与 project agentTypes 命令，对齐 API 行为。
- **E2E（Playwright Electron）**：agent 多选组件（搜索/置顶/无默认）；添加 skill（local 来源，避免网络依赖）；关联后 agent 目录出现软链；agentTypes 变更自动收敛；重新同步；外部条目标注。
- **manual**：无。本 story 全部结构/行为可自动化。

## 12. 范围外

- loop-workflow 自身的 skill 安装流程（CLAUDE.md 的 `cp -R` 机制）——不动。
- npm / Claude Plugin 来源——**删除**，不是延期。
- SKILL.md `dependencies` 字段的级联关联——**删除**（ADR-004 第 3 条废止；vercel 生态无此概念）。
- 库的全部运行时能力：`add` / `update` / `remove` / `list` / `use` / `find` / `init` / `experimental_sync` / `--copy` / 全局安装 `-g`——一律不调用；仅使用其 registry 数据（快照）。
- 历史数据迁移（开发阶段；现有 DB 里的 skill 记录随三表删除而清空）。
- 团队协作 / 多机同步（workstation 是本地单机 app）。
- 技能库路径的远程/共享位置（网络盘、同步盘）——本地目录为唯一支持形态。

## 13. 补充说明

- 本 PRD 的技术事实依据：`research/vercel-skills-cli-capabilities.md`（primary sources，2026-07-29）+ tech-design spike 记录（skills@1.5.20 三场景实测，见 tech-design.md 附录）。
- **telemetry 面**：运行时对库零调用，无遥测问题（同步脚本离线提取数据，不触发库运行时）。
- **已知取舍**：技能列表实时扫描而非缓存；local 来源 skill 不自动更新；registry 跟随上游靠快照 diff 审查（E9 漂移兜底）；**已从 workstation 删除但磁盘保留的项目，其残留软链不被级联清理（磁盘即真相下的可接受残留，review S7）**；**默认技能库路径由 `~/.codex-harness/skills` 更名为 `~/.opc-workstation/skills`，旧目录内容不迁移、用户重新添加（review S4）**。
- v0.2 的关键认知：`~/.agents/skills/` 是 15 个 universal agent 的全局扫描目录（research 第 3 节），任何放入其中的 skill 对这些 agent 全局可见——技能库必须私有。同理，配置技能库路径时要防用户误填任何 agent 的扫描路径（E11）。
- README 在 BUILD 阶段同步更新（来源说明、settings 变化）。

## 14. PRD 完整性自检查

- [x] 每个稳定块至少有一条 happy path（第 6 节；S8/S9 为结构性块，已显式 N/A 并给出验收方式）。
- [x] 涉及用户输入的稳定块有字段级验证规则（第 7 节，覆盖 S1/S2/S3/S4）。
- [x] 每个稳定块有失败场景或显式 N/A（第 8 节 E1–E3、E5–E12 覆盖 S1–S7、S9；E4 已随 D1 删除；S8 的失败面为迁移本身，开发阶段 N/A）。
- [x] 跨模块/外部依赖调用有错误状态定义（E1/E3 git 链路；E5 文件系统；E9 registry 漂移；E11/E12 配置与冲突）。
- [x] 复杂度已分级并给出理由（第 9 节，complex）。
