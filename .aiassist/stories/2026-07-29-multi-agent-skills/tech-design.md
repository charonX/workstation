# 技术方案 — 多 Agent Skill 管理与分发

> 故事 ID：`2026-07-29-multi-agent-skills`
> 版本：`v0.2`
> 最后更新：2026-07-29
> v0.2：按 review-tech.md 就地修订——F1（阻塞，F3 收敛扫描域改变更前∪变更后）；W1（E4 删除、E3 改 GIT_UNAVAILABLE、新增 E12）；W2（skill 身份={slug, skillName}）；W3（local slug 冲突 409/force）；W4（registry 模板提取机制）；S1–S7 全部吸收。
> 输入：`prd.md` v0.3、`research/vercel-skills-cli-capabilities.md`、本文件附录 A 的 spike 记录、`review-tech.md`

## 术语（全文统一，CONTEXT.md 已同步）

- **技能库**（Skill Library）：workstation 私有的集中式 skill 存放目录（`<repoRoot>`，settings 可配）。
- **来源目录**（Source Directory）：技能库内一个 slug 目录，承载一次添加的内容；磁盘上的 repo 实体（ADR-003 修订后的一级实体形态）。全文不再用裸 "repo" 指代它。
- **Agent 类型声明**（agentTypes）：项目声明使用的 agent key 数组。
- **收敛**（Convergence）：使项目 agent 目录中的软链与"已关联集合 × 当前声明"一致的动作。
- **外部条目**（External Entry）：项目 agent 目录中非 workstation 创建的 skill 条目（实体目录或外部软链）。

---

## 设计目标

把 workstation 的 skill 管理/分发从"DB 安装态 + `.opc/skills` 私有投影"换轨为：**磁盘即真相**——技能库是 workstation 私有目录中的实体 skill 集合；项目声明 agent 类型（多选），关联即在项目各 agent 原生目录建立直链技能库的软链；agent 目录约定数据来自 vercel-labs/skills 的 registry（75 项），以 JSON 快照跟随上游。

## 关键决策

| # | 决策 | 要点 | 依据 |
|---|---|---|---|
| D1 | **库角色 = registry 数据源；运行链路全由 workstation 自持** | 获取（simple-git clone / 本地拷贝）、建链（自建 symlink）、更新（git pull --ff-only / 重添加覆盖）、移除（级联删链+删目录）全部自实现；不调用库 CLI | spike（附录 A）三场景证实库的项目级分发无法表达"软链解析到中央技能库"；全局 canonical 泄露 → ADR-011 |
| D2 | **ADR-003/004 修订**：repo 分组保留在磁盘层；`dependencies` 级联砍除 | 一个来源目录 = 一个 repo（可含多 skill），列表按来源分组、移除按来源级联；SKILL.md `dependencies` 字段不再解析/级联 | ADR-003 初衷（一组 skill 同生命周期）由目录天然承载；级联关联是自造复杂度，生态无此概念 |
| D3 | **registry = JSON 快照 + 同步脚本** | `scripts/sync-agent-registry.mjs` 从库提取 agents 表生成 `agentRegistry.json`（进版本库）；`globalSkillsDir` 存**模板**，运行时惰性展开（ADR-009）；置顶：claude-code、codex、opencode、cursor、kimi-code-cli | 库 dist 零导出、agents.ts 顶层展开 env 违反 ADR-009；快照 diff 可审查 |
| D4 | **项目扫描视图区分[技能库]/[外部]；冲突跳过不删实体** | 非 workstation 创建的条目如实显示+标注；软链可移除链接、实体目录不动；占用冲突跳过 + 冲突标记表面化 | 磁盘即真相=如实反映；删错=删用户数据 |
| D5 | **技能库目录布局：`<repoRoot>/<source-slug>/`** | git 来源 = clone（来源 URL 读 `.git` remote，零元数据文件）；local 来源 = 拷贝（无元数据，不可自动更新）；git slug 冲突加后缀；local slug 冲突默认 409 拒绝、显式 force 才覆盖（F2） | 磁盘即真相，不引入元数据 DB/文件；local 无同源凭据需防呆（review W3） |
| D6 | **更新语义** | git：`git pull --ff-only`，失败（本地改动/分叉）→ 报错表面化，不强行 reset；local：HTTP 400 提示重新添加；软链模型下项目侧零操作生效 | 保护用户可能的本地改动；与库 update 的"整体重装"语义对齐但更简单 |
| D7 | **收敛 = 同步执行** | agentTypes 保存时在请求内执行收敛（扫描域 = 变更前 ∪ 变更后声明目录；新增补建、移除删链），返回每 agent 结果；重同步端点幂等重建全部**已关联**技能库条目（不自动关联新 skill）；只动技能库条目，不动外部条目 | 规模小（skill 数个 × agent 数个），无需 job 化；"已关联"口径见 F3（review F1/S3） |
| D8 | **DB 迁移** | `projects.agentTypes TEXT`（JSON 数组，默认 `[]`）；删除 `skills`/`skill_repos`/`project_skills` 三表及全部相关代码（含 BUG-011 reconcile、npm update、dependencies 级联） | 开发阶段无迁移义务 |
| D9 | **建链安全边界** | 我们建的链 target 必须在技能库内（realpath 校验）；移除外链只删链本身；Windows junction 兜底复用现有代码 | 防误删、防越界 |

## 模块与边界

| 模块 | 职责 | 变更 |
|---|---|---|
| `scripts/sync-agent-registry.mjs` | **新增**：从 skills 包（npm 或 GitHub raw）提取 agents 表 → 生成 `agentRegistry.json`；打印 diff 供审查 | 新增（构建期工具，不进运行时） |
| `src/services/agentRegistry.json` | **新增**：registry 快照（name/displayName/skillsDir/globalSkillsDir 模板/universal 标记） | 新增（生成物，入版本库） |
| `src/services/agentRegistryService.js` | **新增**：读快照（惰性，ADR-009）；`globalSkillsDir` 模板运行时展开（homedir + 环境变量白名单）；displayName↔key 映射；置顶/排序展示配置；E11 路径冲突校验 | 新增 |
| `src/services/skillService.js` | **重构**：技能库视图（扫描+SKILL.md 解析，按来源分组）；获取入库（git clone via simple-git / 本地拷贝）；更新（pull --ff-only）；移除（级联删链+删目录）；项目视图（扫描 agent 目录，区分[技能库]/[外部]）；分发/收敛/重同步（自建软链） | 重构（删除 installSource/job 旧链、三表访问、`.opc/skills`、dependencies 级联、BUG-011 reconcile） |
| `src/services/projectService.js` | `agentTypes` CRUD + 保存后调用收敛 | 改造 |
| `src/services/settingsService.js` | 技能库路径设置保留；保存时触发 E11 校验 | 小改 |
| `src/db.js` | `projects` 加 `agentTypes TEXT DEFAULT '[]'`；删三表 | 迁移 |
| `src/http/routes/skills.js` | 重构：列表（分组扫描视图）/安装（沿用 job 异步）/更新/移除 | 重构 |
| `src/http/routes/skillRepos.js` | **删除**（并入 skills 分组视图） | 删除 |
| `src/http/routes/agents.js` | **新增**：registry 列表（含置顶分组、排序、displayName） | 新增 |
| `src/http/routes/projects.js` | 加 `agentTypes` 读写；项目技能：关联/取消/列表/重同步 | 改造 |
| `src/cli/commands/skill.js` | 对齐 API：`list/install/update/remove/agents`；`project` 命令加 `--agents` 与 `skill link/unlink/list/resync` | 重构 |
| `src/renderer/components/skill/InstallSkillModal.jsx` | 两来源（git URL / 本地路径） | 改造 |
| `src/renderer/components/skill/SkillTable.jsx` | 扫描视图数据源；按来源分组；外部条目标注 | 改造 |
| `src/renderer/components/skill/SkillDetailModal.jsx` | 元数据来自 SKILL.md 解析 | 小改 |
| `src/renderer/components/common/AgentTypeMultiSelect.jsx` | **新增**：搜索 + 置顶分组 + 全量 75 项多选，无默认预选 | 新增 |
| 项目创建/详情页 | 集成 AgentTypeMultiSelect；技能区（关联/取消/重同步入口 M1）；agent 失效标记（E9） | 改造 |
| Settings 页 | 技能库路径设置保留；E11 错误反馈 | 小改 |

## 数据流

### F1 添加 skill（git）

```
UI/CLI → POST /api/skills/install {sourceType:"git", identifier:<url>}
  → job 启动（沿用现有异步 job + event 模式）
  → slug 化（owner-repo 从 URL 派生，冲突加后缀）
  → simple-git clone <url> → <repoRoot>/<slug>/（浅克隆 --depth 1）
  → 校验：目录内含 SKILL.md 或 skills/*/SKILL.md（否则失败并清理）；
     每个 skill 目录名合法（不含路径分隔符/空白/控制字符——链接名即目录名，见 F4）
  → 完成事件 → 下次列表扫描即出现
错误：系统 git 不可用 → job 失败，E3（GIT_UNAVAILABLE）；clone 失败 → job 失败，E1
```

### F2 添加 skill（local）

```
→ 校验路径（存在/目录/含 SKILL.md；realpath 不得等于或包含技能库自身——防自引用；
   skill 目录名合法性同 F1）
→ slug 冲突处理（review W3）：slug 已存在 → 默认拒绝（HTTP 409 + SKILL_SLUG_CONFLICT，
  提示已存在的来源）；仅显式 force（请求参数/UI 确认对话框）才清理覆盖
  ※ local 无同源凭据（不像 git 可读 .git remote 比对），静默覆盖会让所有项目软链
    瞬间指向另一个 skill 的内容；git 冲突加后缀、local 冲突需确认，不对称是有意为之
→ 拷贝（排除 .git）→ <repoRoot>/<slug>/
→ local 的"更新" = 重添加 + force 覆盖（唯一途径，见 D6）
```

### F3 项目声明/变更 agentTypes → 自动收敛

```
UI/CLI → PUT /api/projects/:id {agentTypes:[...]}
  → 校验：元素 ∈ registry；去重；允许 []
  → 保存 projects.agentTypes
  → 收敛（请求内同步）：
     扫描域 = 变更前声明 ∪ 变更后声明 的 skillsDir（去重）
       ※ 必须取并集：只扫变更后会漏掉被移除目录中的链，
         "已关联集合"变空 → 补建无来源 → 关联静默丢失（review F1）
     已关联 = 并集目录中 realpath ∈ 技能库的软链所指向的 skill 集合
     对新增目录：为每个已关联 skill 补建链（幂等，冲突跳过）
     对移除目录：删除其中指向技能库的链（外部条目不动）
     ※ 关联是显式动作（F4）：收敛只迁移/清理已关联 skill 的链，不自动关联新 skill
  → 返回 { agents: [{agent, skillsDir, linked:[], unlinked:[], failed:[], conflicts:[]}] }
  ※ 响应结构变更（breaking）：PUT /api/projects/:id 原响应上附加收敛结果字段，
    renderer 项目编辑页与 CLI project update 需同步适配（review S5）
```

### F4 关联/取消关联

```
skill 身份 = { slug, skillName }（复合，缺一不可）：
  slug = 来源目录名；skillName = 来源目录内 skill 目录名
  ※ 裸 skillName 跨来源可重名（两个 repo 都含 skills/helper 是正常情形），
    仅用 name 无法定位（review W2）
链接名 = 来源内 skill 目录名（磁盘即真相；agent 按目录名发现 skill，
  不用 SKILL.md frontmatter 的 name——可含空格/大写/中文）（review S2）

POST /api/projects/:id/skills { slug, skillName }
  → 校验：{slug, skillName} ∈ 技能库；agentTypes 非空（E7）
  → 对声明的每个 agent（skillsDir 去重）：
     目标 = <project.localPath>/<skillsDir>/<skillName>
     目标已存在且为指向该 skill 的链 → 幂等成功
     目标已存在（外部实体/外部链）→ 记 conflict，跳过（D4）
     不存在 → mkdir -p + symlink(<repoRoot>/<slug>/<skillPath>, 目标)（junction 兜底）
  → 返回每 agent 结果（含 conflicts）
DELETE /api/projects/:id/skills/:slug/:skillName
  → 仅当目标是软链且 realpath ∈ 技能库对应 {slug, skillName} → 删链；外部实体不动
```

### F5 更新 / 移除 / 重同步

```
更新（git）：POST /api/skills/:slug/update → job → git -C <repoRoot>/<slug> pull --ff-only
  → 失败 → E 表面化（不 reset）；成功 → 事件；项目侧零操作
移除：DELETE /api/skills/:slug → 确认 → 扫描所有项目所有声明 agent 目录，
  删除 realpath ∈ <repoRoot>/<slug> 的链 → rm -rf <repoRoot>/<slug>
  ※ 已从 workstation 删除（但磁盘保留）的项目扫不到，其中的链会残留为断链
    （PRD §13 已知取舍，review S7）
重同步：POST /api/projects/:id/skills/resync → 对当前声明 agentTypes，
  把全部【已关联】技能库条目（扫描变更前后声明目录并集，口径同 F3）按当前声明幂等重建
  + 清理指向技能库但 skill 已不存在的断链；不自动关联新 skill；不动外部条目（review S3）
```

### F6 列表扫描视图

```
GET /api/skills → 扫描 <repoRoot>/*/
  → 每个来源目录：{ slug, sourceType: git(有.git)|local, sourceUrl: git remote（如有）,
     skills: [解析 SKILL.md → { skillName(=目录名), name(frontmatter), description, ... }] }
  → SKILL.md 非法 → 跳过 + warning（E6）
GET /api/projects/:id/skills → 对声明的 agentTypes（skillsDir 去重）扫描
  → 条目 { slug, skillName, agents:[...], origin: "repo"|"external", broken?:true, conflict?:true }
  → origin=external：目录实体，或 realpath ∉ 技能库的链（无 slug 归属）
```

## 接口契约

### HTTP（错误码见 PRD §8；review W1 修订：E4 已删除、E3 改为系统 git 不可用）

| 端点 | 说明 |
|---|---|
| `GET /api/skills` | 技能库分组扫描视图 |
| `POST /api/skills/install` | `{sourceType:"git"\|"local", identifier, force?}` → `{jobId}`；local slug 冲突无 force → 409 `SKILL_SLUG_CONFLICT` |
| `GET /api/skills/jobs/:jobId` | 安装/更新任务状态（沿用现有 job 模式） |
| `POST /api/skills/:slug/update` | git 来源更新 → `{jobId}`；local → 400 `SKILL_UPDATE_UNSUPPORTED` |
| `DELETE /api/skills/:slug` | 级联移除 |
| `GET /api/agents` | registry 列表（pinned 在前，其余按 displayName 排序） |
| `PUT /api/projects/:id` | body 含 `agentTypes` → 保存 + 收敛结果。**响应结构变更（breaking）**：原项目对象上附加 `convergence` 字段，renderer 项目编辑页与 CLI `project update` 同步适配（review S5） |
| `GET /api/projects/:id/skills` | 项目扫描视图（含 external/conflict/broken 标注；条目带 slug+skillName） |
| `POST /api/projects/:id/skills` | `{slug, skillName}` → 关联结果（每 agent 状态）；裸 skillName 歧义见 F4（review W2） |
| `DELETE /api/projects/:id/skills/:slug/:skillName` | 取消关联（只删我们的链） |
| `POST /api/projects/:id/skills/resync` | 已关联条目幂等重建 + 断链清理 |

### CLI（对齐 API，ADR-001；`project skill <action>` 为三级子命令，命名约定扩展已在 CONTEXT.md 登记——review S6）

```
opc-workstation skill list
opc-workstation skill install --source git|local --identifier <url|path> [--force]
opc-workstation skill update <slug>
opc-workstation skill remove <slug>
opc-workstation skill agents                      # registry 列表
opc-workstation project update <id> --agents claude-code,codex
opc-workstation project skill list <id>
opc-workstation project skill link <id> <slug> <skillName>
opc-workstation project skill unlink <id> <slug> <skillName>
opc-workstation project skill resync <id>
```

### 关键数据结构

```jsonc
// agentRegistry.json（快照，生成物）
{ "version": "1.5.20", "syncedAt": "2026-07-29",
  "agents": [ { "name": "claude-code", "displayName": "Claude Code",
                "skillsDir": ".claude/skills", "globalSkillsDir": "~/.claude/skills",
                "universal": false } ] }

// projects.agentTypes（DB TEXT）
["claude-code", "codex"]

// 收敛/关联结果（HTTP 响应）
{ "agents": [ { "agent": "claude-code", "skillsDir": ".claude/skills",
                "linked": ["foo"], "unlinked": [], "failed": [], "conflicts": [] } ] }
```

## Registry 快照机制（D3 细化）

### 提取（同步脚本，构建期）

库里 `globalSkillsDir` 是模块加载时用 homedir/env 展开的**值**，而快照要存**模板**（review W4）。`scripts/sync-agent-registry.mjs` 的提取机制：

1. 从上游 pinned 版本（npm `skills@<pin>` 或 GitHub raw tag）取 `src/agents.ts` + `src/types.ts`。
2. 用 esbuild（devDependency，随 Vite 已在依赖树）在临时目录编译为 plain ESM（`--format=esm`，外部依赖仅 `xdg-basedir`，一并打包）。
3. 在 **sentinel 环境矩阵**下求值两次以上：`HOME=/sentinel/home`，并轮流置位白名单 env（`XDG_CONFIG_HOME`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`VIBE_HOME`、`HERMES_HOME`、`AUTOHAND_HOME`、`GROK_HOME`、`APPDATA`、`FLATPAK_XDG_CONFIG_HOME`，清单来自 research §5）。
4. 差分推导模板：值中 sentinel home → `~`；随某 env 变化的部分 → `$VAR` 占位；**逐项记录该模板依赖的 env 清单**。
5. 生成 `agentRegistry.json`：`{ version, syncedAt, agents: [{ name, displayName, skillsDir, globalSkillsDir(模板), globalEnvDeps: [...], universal }] }`；打印与现快照的 diff 供人工审查（重点核对模板与 envDeps 变化）。

提取失败（上游结构变化导致编译/差分异常）→ 脚本非零退出，保留旧快照，不生成半成品。

### 运行时（agentRegistryService，遵守 ADR-009）

- 惰性读快照（首次访问时读盘 + 缓存，无顶层副作用）。
- 模板惰性展开：`~` → `os.homedir()`；`$VAR` → 仅白名单内 env（清单取自快照 `globalEnvDeps`，不读其他 env）。
- 展示配置（置顶/排序）独立持有，不进快照。
- **E11 校验（review S1）**：技能库路径 vs 每个 agent 的全局扫描路径（模板展开后），**互为前缀包含即拒绝**（库在扫描路径之内，或扫描路径在库之内）；比较前统一 `~` 展开 → realpath（解析 symlink，如 `/tmp`→`/private/tmp`）→ 大小写归一（macOS/Windows 大小写不敏感卷）。

### settings 默认值决策（review S4）

- 默认技能库路径由旧的 `~/.codex-harness/skills`（旧产品命名）**更名为 `~/.opc-workstation/skills`**。
- **不迁移**：旧目录下已入库的 skill 不做搬移（开发阶段无历史包袱），用户在新位置重新添加；PRD §13 已记为已知取舍。

## 安全、性能与可观测性

**安全**（对照 checklists/security.md）：
- local 来源与技能库路径：realpath 校验防自引用/遍历（E2/E11）；git URL 协议白名单 https/ssh。
- symlink：我们建的链 target 必须在技能库内（realpath 校验）；删除操作只作用于链，绝不递归删外部实体（D4/D9）。
- SKILL.md 仅作数据解析，不执行；git clone 由系统 git 执行，无 shell 拼接（simple-git 参数化）。
- 无遥测面（运行时零库调用）。

**性能**（对照 checklists/performance.md）：
- 扫描规模：技能库目录数（个位数~几十）× 每来源 skill 数 + 项目声明 agent 数（≤数个）——实时扫描可接受，不缓存（防双写回潮，PRD 13 已知取舍）。
- git clone 浅克隆（--depth 1）。

**可观测性**（对照 checklists/observability.md）：
- 安装/更新沿用现有 job + event 机制（进度、失败原因）。
- 收敛/关联/重同步返回结构化每 agent 结果（linked/unlinked/failed/conflicts），UI 表面化。
- E6/E9/E10 记 warning 日志（跳过非法 SKILL.md、registry 漂移、扫描并发变动）。

## 测试 seams

| Seam | 覆盖 |
|---|---|
| HTTP API（node --test）+ FS 断言 | F1–F6 全部；软链存在/target/realpath 解析；外部实体未动；冲突跳过；E1/E2/E5/E6/E7/E8/E9/E11 |
| CLI | 与 API 对齐的命令行为 |
| git fixture | 本地裸仓库作 git 来源（无网络）；技能库用临时目录隔离（沿用 `opc-workstation-test-skills-*` 模式） |
| registry fixture | 固定快照（不跑同步脚本）；同步脚本 1 个 smoke（快照 schema 合法） |
| E2E（Playwright Electron） | agent 多选（搜索/置顶/无默认）；两来源安装（local）；关联→软链出现；agentTypes 变更收敛；重同步；外部条目标注 |
| capability/entity 归属 | `skill-management/skill`（F1/F2/F5/F6 + 同步脚本）、`skill-management/agent-registry`（registry/置顶/E11）、`workspace-management/project`（agentTypes/F3/F4/F5 项目侧） |

## 风险与回退

| 风险 | 缓解 |
|---|---|
| registry 快照与上游漂移（agent 改名/删项） | E9：跳过+warning+UI 失效标记；快照 diff 审查挂 `/sync-refs` |
| Windows 建链权限 | junction 兜底（现有代码已处理；junction 不需开发者模式——research 第 6 节） |
| 用户在技能库目录内手动改动（git 来源） | pull --ff-only 失败表面化（D6），不强行覆盖 |
| slug 冲突（同名不同源 URL） | slug 派生规则 + 冲突后缀；可重添加覆盖 |
| 大 skill 目录拷贝慢 | local 拷贝为一次性操作，job 化反馈进度 |

回退：本方案每一步都是文件系统操作 + 单表字段，若后期要重新引入库的运行时能力，仅需在 skillService 内替换获取/建链实现，API/CLI/UI 契约不变。

## 对 PRD 的反向同步（已落 v0.3）

1. S4/S5：建链 = workstation 自建直链（无间接层）；新增外部条目语义（[外部]标注/不动实体/冲突跳过）。
2. S7：更新 = 技能库内 git pull --ff-only；local 手动重添加。
3. M2/M3/M4 解决移出移动块（本文件 D1/D3/D5/D9）；M1 保留。
4. 第 10 节：skillLibraryClient 模块取消（运行时零库调用），改为 registry 快照 + 同步脚本；10.1 解耦决策改写。
5. 第 11 节：测试 seam 更新（去掉真库集成测试，改 fixture 策略）。
6. 第 12 节：范围外新增 `dependencies` 级联删除、库全部运行时能力不调用。
7. 第 13 节：telemetry 面消失（零库运行时调用）。

## 附录 A：Spike 记录（2026-07-29，skills@1.5.20，npm dist）

| 场景 | 命令（cwd=空项目） | 结果 |
|---|---|---|
| A 单 agent | `skills add <local-path> -a claude-code -y` | `.claude/skills/<name>` = **实体拷贝**；无 `.agents/`；无软链。原因：`uniqueDirs.size ≤ 1 → installMode = "copy"`（dist/cli.mjs:3803） |
| C 多 agent | `skills add <local-path> -a claude-code -a codex -y` | `.agents/skills/<name>` = **项目内实体拷贝**（canonical）；`.claude/skills/<name>` = 软链 → `../../.agents/skills/<name>` |
| B 预置推演 | 预置 `.agents/skills/<name>` 为指向技能库的链，再 add | 不可行：`pathsOverlap(source, canonicalDir)` 命中 → `skipped:true` 直接返回，**不再创建 agent 目录的链**（dist/cli.mjs:2036-2043；installer.ts:348-356） |

结论：库的"symlink 单一真相"是**项目内部**的一份拷贝；无法表达"项目软链 → 中央技能库"（我们的 S4/S7 语义）；单 agent 强制 copy 使关联语义不统一。叠加全局 canonical 泄露问题（PRD v0.2 已否决），运行链路全部自持（D1）。

环境备注：spike 中发现 `/tmp` 在 macOS 是 symlink（→`/private/tmp`），库内部 realpath 处理正常，无影响；发布版 dist 与 main HEAD 源码逻辑一致（已逐行核对 installSkillForAgent）。
