# 契约式需求 — 多 Agent Skill 管理与分发

> 故事 ID：`2026-07-29-multi-agent-skills`
> 版本：v1.2
> 最后更新：2026-08-01
> 输入：`prd.md` v0.4、`tech-design.md` v0.2、`review-tech.md`
> 编号：REQ-SKILL 接续现有 001~004 从 005 起；REQ-WORKSPACE 接续 001~010 从 011 起；REQ-CLI 接续 001 从 002 起。
>
> 变更：
> - v1.2（2026-08-01，BUG-003 req-gap 就地补全）：REQ-SKILL-010/011 link/unlink 接口改为支持批量（单对象入参向后兼容）；REQ-SKILL-012 新增项目技能弹层按来源分组（组头支持展开/收起）、搜索/状态筛选、整组选择与批量关联/取消关联的 UI 契约。

---

## REQ 概览

| ID | 标题 | 优先级 | 必须性 | scope | 测试类型 | capability | entity |
|---|---|---|---|---|---|---|---|
| REQ-SKILL-005 | 技能库路径设置与扫描路径冲突校验 | P0 | 必须 | cross-module | 单元+API | skill-management | skill |
| REQ-SKILL-006 | 技能列表 = 技能库分组扫描视图 | P0 | 必须 | intra-module | API | skill-management | skill |
| REQ-SKILL-007 | git 来源安装 | P0 | 必须 | cross-module | API+集成 | skill-management | skill |
| REQ-SKILL-008 | local 来源安装与 slug 冲突防呆 | P0 | 必须 | intra-module | API | skill-management | skill |
| REQ-SKILL-009 | npm / Claude Plugin 来源移除 | P1 | 必须 | cross-module | API+E2E | skill-management | skill |
| REQ-SKILL-010 | 项目关联 skill（复合身份建链） | P0 | 必须 | cross-module | API+FS | skill-management | skill |
| REQ-SKILL-011 | 取消关联（只删自有链） | P0 | 必须 | cross-module | API+FS | skill-management | skill |
| REQ-SKILL-012 | 项目技能视图与外部条目保护 | P0 | 必须 | cross-module | API+FS | skill-management | skill |
| REQ-SKILL-013 | agentTypes 变更自动收敛 | P0 | 必须 | cross-module | API+FS | skill-management | skill |
| REQ-SKILL-014 | 手动重同步 | P1 | 应该 | cross-module | API+FS | skill-management | skill |
| REQ-SKILL-015 | 来源级联移除 | P0 | 必须 | cross-module | API+FS | skill-management | skill |
| REQ-SKILL-016 | 来源更新（git ff-only / local 拒绝） | P1 | 应该 | cross-module | API+集成 | skill-management | skill |
| REQ-SKILL-017 | 旧机制清除（三表 / .opc/skills / 级联关联） | P0 | 必须 | cross-module | API | skill-management | skill |
| REQ-SKILL-018 | Agent Registry 服务（快照/置顶/排序） | P0 | 必须 | intra-module | 单元+API | skill-management | agent-registry |
| REQ-SKILL-019 | Registry 快照同步脚本与快照合法性 | P1 | 应该 | intra-module | 单元 | skill-management | agent-registry |
| REQ-WORKSPACE-011 | 项目 agentTypes 字段 | P0 | 必须 | cross-module | 单元+API | workspace-management | project |
| REQ-WORKSPACE-012 | Agent 类型选择器组件 | P1 | 应该 | cross-module | E2E | workspace-management | project |
| REQ-WORKSPACE-013 | registry 漂移处理（E9） | P2 | 应该 | cross-module | API+E2E | workspace-management | project |
| REQ-CLI-002 | skill / project skill CLI 命令组 | P1 | 应该 | cross-module | CLI | command-interface | cli |

## 稳定块 → REQ 映射

| 稳定块 | REQ |
|---|---|
| S1 项目 agent 类型声明 | REQ-WORKSPACE-011 / 012 / 013 |
| S2 技能库 = 私有指定目录 | REQ-SKILL-005 / 006 / 018 |
| S3 添加 skill（git/local） | REQ-SKILL-007 / 008 / 009 |
| S4 项目关联 + 外部条目语义 | REQ-SKILL-010 / 011 / 012 |
| S5 声明即收敛 + 手动重同步 | REQ-SKILL-013 / 014 |
| S6 移除 skill | REQ-SKILL-015 |
| S7 更新 skill | REQ-SKILL-016 |
| S8 旧机制清除 | REQ-SKILL-017 |
| S9 agent registry 单一数据源 | REQ-SKILL-018 / 019 |
| CLI 对齐（ADR-001） | REQ-CLI-002 |

---

## REQ-SKILL-005：技能库路径设置与扫描路径冲突校验

**稳定块**：S2

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module
- **capability/entity**：skill-management / skill
- **modules**：settingsService、agentRegistryService、settings 路由

### 验收标准

1. **AC1（默认值）**：新安装/未配置时，技能库路径默认为 `~/.opc-workstation/skills`（不再是 `~/.codex-harness/skills`）；不迁移旧目录内容。
2. **AC2（E11 冲突拒绝）**：保存技能库路径时，若该路径与 registry 中任一 agent 的全局扫描路径**互为前缀包含**（库在扫描路径之内，或扫描路径在库之内），保存失败返回 HTTP 400 + `SKILL_REPO_PATH_CONFLICT`，错误体含冲突 agent 列表。判定前对两侧路径统一做 `~` 展开 → realpath（解析 symlink）→ 大小写归一。
3. **AC3（合法保存生效）**：路径非空、展开后可创建为目录、无 E11 冲突时保存成功；后续技能库扫描以新路径为根。
4. **AC4（典型拒绝案例）**：配置 `~/.agents/skills`、`~/.claude/skills` 或其子目录（如 `~/.agents/skills/foo`）均被拒绝；配置其父目录形态（如 `~/.agents`）同样拒绝（扫描路径在库之内）。

### 测试

- Seam：`PUT /api/settings`（或现有 settings 端点）API 测试 + 路径归一单测
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillLibrary.test.js`

---

## REQ-SKILL-006：技能列表 = 技能库分组扫描视图

**稳定块**：S2

- **优先级**：P0　**必须性**：必须
- **scope**：intra-module
- **capability/entity**：skill-management / skill
- **modules**：skillService、skills 路由

### 验收标准

1. **AC1（扫描即列表）**：`GET /api/skills` 返回按来源目录分组的视图：每个来源目录 `{ slug, sourceType, sourceUrl, skills[] }`；不读 skills/skill_repos 表（表已删，见 REQ-SKILL-017）。
2. **AC2（来源类型与 URL）**：含 `.git` 的来源目录 `sourceType="git"` 且 `sourceUrl` 取自 git remote；无 `.git` 为 `"local"`，`sourceUrl` 为 null。
3. **AC3（SKILL.md 解析）**：每个 skill 条目含 `skillName`（= 目录名）与 frontmatter 解析出的 `name`、`description` 等元数据；支持来源根目录直下、`skills/*/` 与 `skills/*/*/`（分类嵌套，如 mattpocock 的 `skills/engineering/<name>/`）三种布局；嵌套布局的 `skillName` = 叶子目录名。v1.1（BUG-001 就地补全）：由两种布局扩展为三种布局。
4. **AC4（E6 非法跳过）**：frontmatter 缺 `name`/`description` 的目录不进入列表，记 warning 日志；扫描整体不失败。
5. **AC5（磁盘即真相）**：在技能库目录中手工新增/删除一个合法 skill 目录后，再次 `GET /api/skills` 如实反映（无缓存）。

### 测试

- Seam：`GET /api/skills` API 测试（临时技能库目录 fixture）
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillLibrary.test.js`

---

## REQ-SKILL-007：git 来源安装

**稳定块**：S3

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module（skillService ↔ 系统 git / simple-git；job 异步模式）
- **capability/entity**：skill-management / skill
- **modules**：skillService、skills 路由、job/event 机制
- **interface_contract**：输入 `{sourceType:"git", identifier:<url>}` → 输出 `{jobId}`；终态经 job 查询：success（技能库出现来源目录）/ error（E1/E3）；副作用 = `<repoRoot>/<slug>/` 新建目录

### 验收标准

1. **AC1（克隆入库）**：合法 git URL → 浅克隆（--depth 1）到 `<repoRoot>/<slug>/`；slug 从 URL 派生（owner-repo），冲突时加后缀区分。
2. **AC2（内容校验）**：克隆完成后校验目录内含 `SKILL.md` 或 `skills/*/SKILL.md`；每个 skill 目录名合法（不含路径分隔符/空白/控制字符）；不满足则 job 失败并清理已克隆目录。
3. **AC3（E1 获取失败）**：clone 失败（网络/认证/repo 不存在）→ job 终态 error，错误码 `SKILL_FETCH_FAILED`，HTTP 502；技能库无残留目录。
4. **AC4（E3 git 不可用）**：系统 git 缺失/不可执行 → job 终态 error，错误码 `GIT_UNAVAILABLE`，HTTP 503。
5. **AC5（job 异步）**：安装经 job 执行，进度/终态可经 `GET /api/skills/jobs/:jobId` 查询（沿用现有 job+event 模式）。

### 测试

- Seam：`POST /api/skills/install` API 测试；git 来源用本地裸仓库 fixture（无网络）
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillInstall.test.js`

---

## REQ-SKILL-008：local 来源安装与 slug 冲突防呆

**稳定块**：S3

- **优先级**：P0　**必须性**：必须
- **scope**：intra-module
- **capability/entity**：skill-management / skill
- **modules**：skillService、skills 路由

### 验收标准

1. **AC1（拷贝入库）**：合法本地路径 → 拷贝（排除 `.git`）到 `<repoRoot>/<slug>/`；`sourceType="local"`。
2. **AC2（E2 校验）**：路径不存在 / 非目录 / 不含 SKILL.md / realpath 等于或包含技能库自身 → HTTP 400 + `SKILL_SOURCE_INVALID`，技能库无残留；skill 目录名合法性校验同 REQ-SKILL-007 AC2。
3. **AC3（E12 slug 冲突默认拒绝）**：目标 slug 已存在且无 `force` → HTTP 409 + `SKILL_SLUG_CONFLICT`，错误体提示已存在的来源；不发生任何写盘。
4. **AC4（force 覆盖）**：显式 `force=true` → 清理旧目录后重新拷贝（这是 local"更新"的唯一途径）；覆盖后项目软链指向新内容。

### 测试

- Seam：`POST /api/skills/install` API 测试 + FS 断言
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillInstall.test.js`

---

## REQ-SKILL-009：npm / Claude Plugin 来源移除

**稳定块**：S3

- **优先级**：P1　**必须性**：必须
- **scope**：cross-module
- **capability/entity**：skill-management / skill
- **modules**：skills 路由、skillService、InstallSkillModal

### 验收标准

1. **AC1（端点拒绝旧来源）**：`POST /api/skills/install` 携带 `sourceType:"npm"` 或 `"plugin"` → HTTP 400 + `SKILL_SOURCE_INVALID`。
2. **AC2（UI 无旧来源）**：安装弹窗来源类型选项只有 `git` / `local` 两项；不出现 npm / Claude Plugin 选项。
3. **AC3（旧代码移除）**：skillService 中 npm 安装、plugin 安装、npm update 逻辑不复存在（静态检查：路由/服务无对应分支）。

### 测试

- Seam：`POST /api/skills/install` API 测试（npm/plugin 拒绝）
- Seam：E2E 打开安装弹窗断言来源选项集合
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillInstall.test.js`、`.../e2e/skillLibrary.test.cjs`

---

## REQ-SKILL-010：项目关联 skill（复合身份建链）

**稳定块**：S4

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module（skillService ↔ projectService / agentRegistryService / FS）
- **capability/entity**：skill-management / skill
- **modules**：skillService、projectService、agentRegistryService、projects 路由
- **interface_contract**：输入单对象 `{slug, skillName}` 或批量 `{skills:[{slug,skillName},...]}` + 项目 agentTypes → 单对象返回每 agent 结果 `{agent, skillsDir, linked[], failed[], conflicts[]}`（向后兼容）；批量返回 `{results:[{slug,skillName,status,code?,agents?}], count:{linked,skipped,failed}}`；错误 E5/E7；副作用 = 项目各声明 agent skillsDir 下新建软链（Windows junction）

### 验收标准

1. **AC1（直链技能库）**：关联后，项目每个声明 agent 的 `<localPath>/<skillsDir>/<skillName>` 为软链，realpath 解析后等于技能库内 `<repoRoot>/<slug>/<skillPath>`；沿链可读 SKILL.md 内容。
2. **AC2（skillsDir 去重）**：声明的多个 agent 共享同一 `skillsDir`（如多个 universal agent 的 `.agents/skills`）时只建一处链，结果中各 agent 均计为 linked。
3. **AC3（幂等）**：重复关联同一 `{slug, skillName}` → 成功且目录结构不变（不报错、不重复建链）。
4. **AC4（E7 空声明拒绝）**：项目 agentTypes 为空数组时关联 → HTTP 409 + `PROJECT_AGENTS_EMPTY`。
5. **AC5（冲突跳过，D4）**：目标位置已存在外部实体目录或外部软链 → 该 agent 记入 `conflicts`，跳过建链，**外部实体原样保留**；其余 agent 照常。
6. **AC6（E5 失败表面化）**：某 agent 建链失败（权限/磁盘）→ 该 agent 记入 `failed`，其余 agent 继续；不静默降级为拷贝。
7. **AC7（身份校验）**：`{slug, skillName}` 不存在于技能库 → HTTP 400/404；裸 `skillName` 无 slug 的请求被拒绝（复合身份必填）。
8. **AC8（批量关联，v1.2）**：`POST /api/projects/:id/skills` body 为 `{skills:[...]}` 时按序关联每个 `{slug,skillName}`；单项的身份错误、冲突、E5 失败不中断其余项，逐项在 `results[]` 中报告（`status:"linked"|"skipped"|"failed"`，失败/跳过时带 `code` 与每 agent `agents[]`），响应含 `count` 汇总；空数组、非数组 `skills` → HTTP 400；单对象 body 仍返回 AC1~AC7 的旧 `{agents}` 形态（向后兼容）。项目级 E7（agentTypes 为空）对批量同样返回 409。

### 测试

- Seam：`POST /api/projects/:id/skills` API 测试 + FS 断言（lstat 为 symbolicLink/junction、realpath 指向、SKILL.md 可经链读取）
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/projectSkills.test.js`

---

## REQ-SKILL-011：取消关联（只删自有链）

**稳定块**：S4

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module
- **capability/entity**：skill-management / skill
- **modules**：skillService、projects 路由

### 验收标准

1. **AC1（删自有链）**：`DELETE /api/projects/:id/skills/:slug/:skillName` 后，项目声明 agent 目录中 realpath 指向该 `{slug, skillName}` 的软链被删除。
2. **AC2（外部不动）**：目标位置为外部实体目录或 realpath 不在技能库内的链 → 不删除，结果中标注跳过；接口整体成功。
3. **AC3（幂等）**：对已不存在的关联取消 → 成功，无错误。
4. **AC4（技能库不动）**：取消关联不修改技能库目录任何内容。
5. **AC5（批量取消，v1.2）**：`DELETE /api/projects/:id/skills`（无路径段）携带 JSON body `{skills:[{slug,skillName},...]}` 时按序取消每个，单项的冲突/未知身份不中断其余项，逐项在 `results[]` 报告（`status:"unlinked"|"skipped"`，跳过时带 `code`），响应含 `count` 汇总；空数组/非数组 → HTTP 400。URL 路径形态 `DELETE /api/projects/:id/skills/:slug/:skillName` 仍保留用于单条取消（向后兼容）。

### 测试

- Seam：`DELETE /api/projects/:id/skills/:slug/:skillName` 单条与 `DELETE /api/projects/:id/skills` 批量 body 两种 API 测试 + FS 断言
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/projectSkills.test.js`

---

## REQ-SKILL-012：项目技能视图与外部条目保护

**稳定块**：S4

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module
- **capability/entity**：skill-management / skill
- **modules**：skillService、agentRegistryService、projects 路由、renderer 项目详情弹层

### 验收标准

1. **AC1（视图即扫描）**：`GET /api/projects/:id/skills` 返回对项目声明 agentTypes（skillsDir 去重）的实时扫描结果；条目含 `{ slug, skillName, agents[], origin }`。
2. **AC2（origin 归因）**：realpath ∈ 技能库的软链 → `origin:"repo"` 且 slug/skillName 正确归属；目录实体或 realpath ∉ 技能库的链 → `origin:"external"`。
3. **AC3（broken 标注）**：指向技能库但目标 skill 已不存在的断链 → 条目含 `broken:true`。
4. **AC4（conflict 标注）**：因外部占用导致建链被跳过的 `{slug, skillName}`（REQ-SKILL-010 AC5 发生后）→ 条目含 `conflict:true`。
5. **AC5（外部条目如实显示）**：外部条目出现在列表中并标注 `origin:"external"`；视图本身不修改任何外部条目。
6. **AC6（E10 并发容错）**：扫描期间单目录变动/不可读 → 跳过该目录 + warning，视图整体正常返回。
7. **AC7（按来源分组，v1.2）**：项目详情技能弹层中，origin 为 repo 的条目按来源 `slug` 分组展示，每组有组头显示 slug 与"已关联 N/总数"；组头支持展开/收起（收起仅隐藏组内行，不影响已勾选集合与批量操作）；origin 为 external 的条目单独置底为只读区段（无勾选、无批量）。
8. **AC8（搜索与状态筛选，v1.2）**：弹层顶部提供搜索框，按技能 name/slug/description 大小写不敏感实时过滤；提供状态筛选（全部 / 已关联 / 未关联 / 异常）。筛选只改变可见行，不改变已勾选集合与磁盘关联状态。
9. **AC9（整组选择与批量关联/取消，v1.2）**：每组组头提供三态勾选框，选中态对应该组当前可见条目（全选/部分选/不选）；勾选若干条目后出现批量操作条，可一次性"关联选中"或"取消关联选中"，分别调用 REQ-SKILL-010 AC8 / REQ-SKILL-011 AC5 的批量接口；操作完成后逐项成功/失败/冲突在 UI 表面化并刷新列表与磁盘状态；external 条目不可被勾选或批量操作。

### 测试

- Seam：`GET /api/projects/:id/skills` API 测试（预置混合：自有链/外部实体/外部链/断链）+ Playwright Electron E2E（分组/搜索/状态筛选/整组选择/批量关联取消，预置多来源多 skill）
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/projectSkills.test.js`、`.../e2e/skillLibrary.test.cjs`

---

## REQ-SKILL-013：agentTypes 变更自动收敛

**稳定块**：S5（review F1 修订后的语义）

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module（projectService ↔ skillService / FS）
- **capability/entity**：skill-management / skill
- **modules**：projectService、skillService、projects 路由
- **interface_contract**：`PUT /api/projects/:id` body 含 `agentTypes` → 响应在原项目对象上附加 `convergence` 字段（**breaking**，renderer/CLI 同步适配）；副作用 = 新增目录补建链、移除目录删链

### 验收标准

1. **AC1（并集扫描域）**：收敛的已关联集合 = 在**变更前 ∪ 变更后**声明目录（skillsDir 去重）中扫描到的、realpath ∈ 技能库的软链所指 skill。
2. **AC2（新增补建）**：对变更后新增的目录，为已关联集合中每个 skill 补建软链（幂等、冲突跳过同 REQ-SKILL-010 AC5）。
3. **AC3（移除删链）**：对被移除的目录，删除其中 realpath ∈ 技能库的链；外部条目原样保留。
4. **AC4（换 agent 不丢关联）**：声明从 `[codex]` 改为 `[claude-code]` 后，原 codex 目录中已关联的 skill 在 `.claude/skills/` 下全部有链，`.agents/skills/` 下自有链被删除（review F1 场景）。
5. **AC5（不自动关联新 skill）**：收敛不建立"已关联集合之外"的链——技能库中存在但从未关联的 skill 不会因收敛而被链入。
6. **AC6（响应携带结果）**：PUT 响应含 `convergence.agents[]`（每 agent linked/unlinked/failed/conflicts）；E5 失败表面化。
7. **AC7（空声明）**：agentTypes 改为 `[]` → 删除全部声明目录中的自有链（已关联集合清空），外部不动。

### 测试

- Seam：`PUT /api/projects/:id` API 测试 + FS 断言（重点：AC4 换 agent 场景）
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillSync.test.js`

---

## REQ-SKILL-014：手动重同步

**稳定块**：S5

- **优先级**：P1　**必须性**：应该
- **scope**：cross-module
- **capability/entity**：skill-management / skill
- **modules**：skillService、projects 路由、项目详情 UI

### 验收标准

1. **AC1（已关联口径重建）**：`POST /api/projects/:id/skills/resync` 后，已关联集合（口径同 REQ-SKILL-013 AC1）中每个 skill 在当前声明目录下全部有链（幂等）；不自动关联新 skill。
2. **AC2（断链清理）**：指向技能库但目标 skill 已不存在的断链被删除。
3. **AC3（外部不动）**：外部实体目录与外部软链原样保留；外部占用导致的冲突记入结果 conflicts。
4. **AC4（漂移修复）**：手工删除项目内某个自有链后 resync → 链被重建；手工把自有链 target 改错后 resync → 恢复正确指向。
5. **AC5（入口存在）**：项目详情技能区提供"重新同步"入口（M1 定稿位置）；触发后展示结果摘要。

### 测试

- Seam：`POST /api/projects/:id/skills/resync` API 测试 + FS 断言；E2E 触发入口
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillSync.test.js`、`.../e2e/skillLibrary.test.cjs`

---

## REQ-SKILL-015：来源级联移除

**稳定块**：S6

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module（skillService ↔ 全部项目 / FS）
- **capability/entity**：skill-management / skill
- **modules**：skillService、projectService、skills 路由

### 验收标准

1. **AC1（级联删链）**：`DELETE /api/skills/:slug` 后，所有项目（projects 表内）所有声明 agent 目录中 realpath ∈ `<repoRoot>/<slug>` 的软链被删除；外部条目不动。
2. **AC2（删来源目录）**：级联完成后 `<repoRoot>/<slug>` 被删除；`GET /api/skills` 不再出现该来源。
3. **AC3（确认交互）**：UI 移除前出现确认提示（将删除所有项目中的引用）。
4. **AC4（不受影响集合）**：其他来源目录与其软链保持不变。

### 测试

- Seam：`DELETE /api/skills/:slug` API 测试 + FS 断言（多项目预置）
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillLibrary.test.js`

---

## REQ-SKILL-016：来源更新（git ff-only / local 拒绝）

**稳定块**：S7

- **优先级**：P1　**必须性**：应该
- **scope**：cross-module（skillService ↔ 系统 git）
- **capability/entity**：skill-management / skill
- **modules**：skillService、skills 路由

### 验收标准

1. **AC1（ff-only 更新）**：git 来源 `POST /api/skills/:slug/update` → 在 `<repoRoot>/<slug>` 执行 `git pull --ff-only`；上游有新提交时目录内容更新，job 终态 success。
2. **AC2（失败表面化）**：ff-only 失败（本地改动/历史分叉）→ job 终态 error，错误信息表面化；**不执行 reset/强制覆盖**；目录内容保持原样。
3. **AC3（项目侧零操作）**：更新成功后，项目软链所指内容即为新版本（无需任何项目侧动作）。
4. **AC4（E8 local 拒绝）**：local 来源调更新 → HTTP 400 + `SKILL_UPDATE_UNSUPPORTED`，提示重新添加。
5. **AC5（无新提交幂等）**：上游无变化时更新成功且目录不变。

### 测试

- Seam：`POST /api/skills/:slug/update` API 测试（本地裸仓库 fixture：先克隆→上游加提交→update；制造本地改动→ff 失败）
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillLibrary.test.js`

---

## REQ-SKILL-017：旧机制清除（三表 / .opc/skills / 级联关联）

**稳定块**：S8

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module
- **capability/entity**：skill-management / skill
- **modules**：db.js、skillService、server 启动逻辑

### 验收标准

1. **AC1（三表不存在）**：应用启动后数据库中不存在 `skills`、`skill_repos`、`project_skills` 表；`projects` 表含 `agentTypes` 列（TEXT，默认 `'[]'`）。
2. **AC2（.opc/skills 不再产生）**：执行关联/收敛/重同步后，项目目录下不创建 `.opc/skills` 路径。
3. **AC3（reconcile 移除）**：server 启动流程不再执行 `reconcileUserSkillRepos`（该函数及其调用不复存在）。
4. **AC4（级联关联移除）**：关联动作不读取/不级联 SKILL.md `dependencies` 字段（含该字段的 skill 关联结果只含自身）。
5. **AC5（旧路由消亡）**：`/api/skill-repos` 端点不存在（404）；其能力并入 `/api/skills` 分组视图。

### 测试

- Seam：API 测试（启动后 sqlite_master 断言、旧端点 404、关联后无 .opc 路径）
- 文件：`tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/skillLibrary.test.js`

---

## REQ-SKILL-018：Agent Registry 服务（快照/置顶/排序）

**稳定块**：S1、S2、S9

- **优先级**：P0　**必须性**：必须
- **scope**：intra-module
- **capability/entity**：skill-management / agent-registry
- **modules**：agentRegistryService、agents 路由

### 验收标准

1. **AC1（快照加载）**：服务从 `agentRegistry.json` 快照读取 agent 列表（≥75 项，含 name/displayName/skillsDir/globalSkillsDir 模板/universal 标记）；惰性加载（首次访问时读盘，无模块顶层副作用，ADR-009）。
2. **AC2（模板惰性展开）**：`globalSkillsDir` 模板在运行时展开：`~` → 当前 homedir；`$VAR` → 仅快照 `globalEnvDeps` 白名单内的环境变量；白名单外 env 不读取。
3. **AC3（置顶与排序）**：`GET /api/agents` 返回顺序：置顶组 `claude-code、codex、opencode、cursor、kimi-code-cli`（按此序）在前，其余按 displayName 字母序在后；每项含 name/displayName/skillsDir。
4. **AC4（key 校验与映射）**：提供 agent key ∈ registry 的校验（供 agentTypes/关联校验复用）；displayName ↔ key 双向映射正确。
5. **AC5（未知 key 容错）**：查询快照中不存在的 key → 返回"未知/失效"标记而非抛错（供 E9 使用）。

### 测试

- Seam：`GET /api/agents` API 测试 + 服务单测（固定 fixture 快照）
- 文件：`tests/capabilities/skill-management/agent-registry/2026-07-29-multi-agent-skills/api/agentRegistry.test.js`

---

## REQ-SKILL-019：Registry 快照同步脚本与快照合法性

**稳定块**：S9

- **优先级**：P1　**必须性**：应该
- **scope**：intra-module
- **capability/entity**：skill-management / agent-registry
- **modules**：scripts/sync-agent-registry.mjs、agentRegistry.json

### 验收标准

1. **AC1（快照 schema）**：`agentRegistry.json` 含 `version`、`syncedAt`、`agents[]`；每项含 `name`（kebab-case）、`displayName`、`skillsDir`（项目相对路径）、`globalSkillsDir`（模板或 null）、`globalEnvDeps`（env 名数组）、`universal`（boolean）；`skillsDir` 不含 `~`/绝对路径。
2. **AC2（模板可展开性）**：`globalSkillsDir` 模板中的 `$VAR` 占位全部 ∈ 该项 `globalEnvDeps`；`~` 仅出现于开头。
3. **AC3（claude-code 基线）**：快照中 `claude-code` 项 `skillsDir == ".claude/skills"`、`universal == false`；`codex` 项存在且 `skillsDir == ".agents/skills"`。
4. **AC4（脚本存在且可执行）**：`scripts/sync-agent-registry.mjs` 存在；其提取失败路径（上游结构异常）为非零退出且不覆盖现有快照（以静态检查 + 失败注入单测验证，不在测试中访问网络）。

### 测试

- Seam：快照 schema 校验单测（node --test，读取仓库内 agentRegistry.json）；脚本失败注入单测（fixture 上游内容）
- 文件：`tests/capabilities/skill-management/agent-registry/2026-07-29-multi-agent-skills/api/agentRegistrySnapshot.test.js`

---

## REQ-WORKSPACE-011：项目 agentTypes 字段

**稳定块**：S1

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module（projectService ↔ db / agentRegistryService）
- **capability/entity**：workspace-management / project
- **modules**：db.js、projectService、projects 路由
- **interface_contract**：`projects.agentTypes` TEXT（JSON 数组，默认 `'[]'`）；读写经 PUT/GET 项目端点；非法元素 → 400

### 验收标准

1. **AC1（存储与默认）**：新建项目未提供 agentTypes 时存为 `[]`；`GET /api/projects/:id` 返回 `agentTypes` 数组。
2. **AC2（元素校验）**：PUT 携带的 agentTypes 元素必须 ∈ registry（经 REQ-SKILL-018 AC4 校验）；含未知 key → HTTP 400，错误体含非法元素列表；不写入。
3. **AC3（去重与形态）**：重复元素自动去重后存储；非数组输入 → HTTP 400。
4. **AC4（空数组语义）**：`agentTypes: []` 合法保存；语义 = 暂不分发（关联被拒见 REQ-SKILL-010 AC4；收敛清空见 REQ-SKILL-013 AC7）。
5. **AC5（既有项目兼容）**：DB 迁移后，迁移前已存在的项目 agentTypes 为 `[]`，项目其他字段不变。

### 测试

- Seam：projects API 测试（创建/读取/更新 agentTypes、非法元素、迁移断言）
- 文件：`tests/capabilities/workspace-management/project/2026-07-29-multi-agent-skills/api/projectAgents.test.js`

---

## REQ-WORKSPACE-012：Agent 类型选择器组件

**稳定块**：S1

- **优先级**：P1　**必须性**：应该
- **scope**：cross-module（renderer ↔ agents API）
- **capability/entity**：workspace-management / project
- **modules**：AgentTypeMultiSelect（新组件）、项目创建/编辑页、agents 路由

### 验收标准（UX/前端检查结论：结构/行为全部可自动化，选 E2E；非纯审美）

1. **AC1（全量候选）**：选择器候选 = `GET /api/agents` 全量（≥75 项）；无默认预选（初始勾选为空或等于已保存值）。
2. **AC2（搜索过滤）**：输入关键字后候选实时过滤（匹配 name 与 displayName，大小写不敏感）。
3. **AC3（置顶分组）**：置顶五项（claude-code、codex、opencode、cursor、kimi-code-cli）出现在列表最前分组，其余在后。
4. **AC4（多选与回显）**：勾选/取消勾选即时反映；打开已有项目编辑页时回显已保存的 agentTypes。
5. **AC5（保存生效）**：保存后 `GET /api/projects/:id` 的 agentTypes 与勾选一致；伴随收敛结果展示（REQ-SKILL-013 AC6）。

### 测试

- Seam：Playwright Electron E2E（项目创建/编辑页）
- 文件：`tests/capabilities/workspace-management/project/2026-07-29-multi-agent-skills/e2e/agentTypes.test.cjs`

---

## REQ-WORKSPACE-013：registry 漂移处理（E9）

**稳定块**：S1、S9

- **优先级**：P2　**必须性**：应该
- **scope**：cross-module
- **capability/entity**：workspace-management / project
- **modules**：projectService、skillService、agentRegistryService、项目编辑页

### 验收标准

1. **AC1（声明保留）**：项目 agentTypes 中含有的 key 在现行快照中不存在时，项目数据原样保留（不自动剔除）；`GET /api/projects/:id` 原样返回。
2. **AC2（收敛跳过）**：收敛/关联/重同步遇到失效 key → 跳过该 agent + 记 warning；其余 agent 正常执行；结果中该 agent 标注失效。
3. **AC3（UI 失效标记）**：项目编辑页的 agent 选择器中，已勾选但失效的 key 显示失效标记（不消失、可取消勾选）。
4. **AC4（恢复）**：快照更新使该 key 重新存在后，失效标记消失，收敛恢复对该 agent 的建链。

### 测试

- Seam：API 测试（fixture 快照缺 key 场景）+ E2E（失效标记展示）
- 文件：`tests/capabilities/workspace-management/project/2026-07-29-multi-agent-skills/api/projectAgents.test.js`、`.../e2e/agentTypes.test.cjs`

---

## REQ-CLI-002：skill / project skill CLI 命令组

**稳定块**：横切（ADR-001 CLI 对齐）

- **优先级**：P1　**必须性**：应该
- **scope**：cross-module（CLI ↔ 本地 HTTP API）
- **capability/entity**：command-interface / cli
- **modules**：src/cli/commands/skill.js、src/cli/commands/project.js
- **interface_contract**：每个命令 = 对应 HTTP 端点的参数/退出码映射；错误码经 API 透传（E1/E2/E7/E8/E12 等）；副作用与 API 一致

### 验收标准

1. **AC1（skill 命令组）**：`skill list / install --source git|local --identifier <> [--force] / update <slug> / remove <slug> / agents` 五组命令行为与对应 API 一致；`install --source npm|plugin` 报错退出（非零）。
2. **AC2（project skill 子命令）**：`project skill list|link|unlink|resync <id> [<slug> <skillName>]` 行为与对应 API 一致；link/unlink 缺 slug 或 skillName 参数时报用法错误。
3. **AC3（--agents）**：`project update <id> --agents a,b,c` 等价于 PUT agentTypes；非法 key 报错误（非零退出）。
4. **AC4（输出可读）**：list/agents 输出为对齐表格或 JSON（`--json` 时）；错误信息含 API 错误码。

### 测试

- Seam：CLI 测试（headless server 模式，沿用现有 cli 测试设施）
- 文件：`tests/capabilities/command-interface/cli/2026-07-29-multi-agent-skills/cli/skillCli.test.js`

---

## REFLECT 人工验收备注（不进 REQ 验收标准）

- Agent 选择器置顶分组与其余列表的视觉分组样式（分隔/标签观感）。
- 外部条目 [外部] 标注的呈现样式。

## 移动块（未结晶，留在 PRD）

- M1："重新同步"入口的具体 UI 位置——REQ-SKILL-014 AC5 仅约束"项目详情技能区提供入口"，精确视觉位置在 BUILD 中按现有页面布局落地。

## PRD 完整性复核（crystallize 清单）

- [x] 每个稳定块至少一条 happy path（PRD §6；S8/S9 结构性 N/A 有验收方式）
- [x] complex story 操作分支与异常（§6 六条流 + §8 十二错误码）
- [x] 输入稳定块有字段级验证（§7 九条规则）
- [x] 每个稳定块有失败场景或显式 N/A（§8 E1–E3、E5–E12）
- [x] 跨模块/外部依赖错误状态（E1/E3 git、E5 FS、E9 registry、E11/E12 配置冲突）
- [x] 复杂度 complex 与内容一致（19 REQ：5 个 cross-module 接口契约显式化）
