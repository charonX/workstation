# Build Progress — 2026-07-29-multi-agent-skills

> BUILD 阶段进度账本。每个 slice：子代理实现 → 父代理独立验证 → PRD 对齐子代理 → refactor 子代理 → 父代理复验 → 标记完成。

## 切片计划（依赖序）

| Slice | 名称 | REQ-ID | 测试文件 | 测试数 | 状态 |
|---|---|---|---|---|---|
| 1 | agent-registry | REQ-SKILL-018, REQ-SKILL-019 | agentRegistry.test.js, agentRegistrySnapshot.test.js | 12 | done |
| 2 | skill-library（含旧机制清除） | REQ-SKILL-005/006/007/008/009/015/016/017 | skillLibrary.test.js, skillInstall.test.js | 31 | done |
| 3 | distribution（含 agentTypes） | REQ-SKILL-010/011/012/013/014, REQ-WORKSPACE-011/013 | projectSkills.test.js, skillSync.test.js, projectAgents.test.js | 34 | done |
| 4 | CLI | REQ-CLI-002 | skillCli.test.js | 10 | done |
| 5 | E2E UI | REQ-WORKSPACE-012 + skill E2E（006/009/013/014/015 等 UI 行为） | skillLibrary.test.cjs, agentTypes.test.cjs | 12 | pending |

依赖关系：1 → 2（E11 校验用 registry 展开）→ 3（建链用 registry skillsDir + 技能库扫描）→ 4（CLI 包 API）→ 5（UI 调全部端点）。

跨切片落点约定：
- `src/db.js`（projects.agentTypes 列 + 删三表）→ slice 2（REQ-SKILL-017 AC1 断言在 skillLibrary.test.js）。
- `src/http/server.js` 移除 reconcileUserSkillRepos → slice 2（REQ-SKILL-017 AC3）；reset 模式 temp skillRepoPath 隔离保留。
- PUT /api/projects/:id 响应附加 `convergence` 字段（breaking）→ slice 3；renderer/CLI 适配 → slice 4/5。
- 旧 renderer 组件（SkillTable repo 模型等）替换 → slice 5；中间态 UI 调旧端点可能运行时报错（可编译即可，E2E 旧测试已退役）。

## 进度记录

（随 slice 推进追加）

### Slice 1 — agent-registry（2026-07-30，commit 920b99f）

验证：`node --test` 目标 2 文件 **12/12 绿**；老基线 codex-harness-desktop **76/76 绿**。

PRD→代码 可追溯性表：

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| REQ-SKILL-018 AC1 快照加载（75 项、惰性、ADR-009 无顶层副作用） | `src/services/agentRegistryService.js`（ensureLoaded 惰性缓存）+ `src/services/agentRegistry.json` | agentRegistry.test.js「no module-top side effects」、agentRegistrySnapshot.test.js「well-formed agents[]」 | COVERED |
| REQ-SKILL-018 AC2 模板惰性展开（`~`→homedir；`$VAR`/env 仅限 globalEnvDeps 白名单） | `agentRegistryService.js` expandGlobalTemplate/expandDollarTemplate（env 设定时替换模板前导 config-root 段，镜像上游 `env.V?.trim() \|\| join(home,'.x')` 模式） | agentRegistry.test.js「expands ~」「CLAUDE_CONFIG_DIR drives」「non-whitelisted never influence」 | COVERED |
| REQ-SKILL-018 AC3 置顶 5 项（claude-code/codex/opencode/cursor/kimi-code-cli）+ 其余 displayName 排序；`GET /api/agents` | `agentRegistryService.js` listAgents + `src/http/routes/agents.js` + `src/http/server.js` 注册 | agentRegistry.test.js「full registry 75」「pinned first, rest sorted」 | COVERED |
| REQ-SKILL-018 AC4/AC5 key 校验、displayName↔key 映射、未知 key 返回 null 不抛 | `agentRegistryService.js` isValidAgentKey / getAgentKeyByDisplayName / getGlobalSkillsDir | agentRegistry.test.js「key validation and displayName mapping」「unknown keys never thrown」 | COVERED |
| 测试缝 `OPC_AGENT_REGISTRY_SNAPSHOT` env 覆盖 + resetAgentRegistryCache | `agentRegistryService.js` snapshotPath() + resetAgentRegistryCache() | agentRegistry.test.js「lazy load」 fixture 替换断言 | COVERED |
| REQ-SKILL-019 AC1/AC2 快照 schema（version/syncedAt/agents；kebab name；skillsDir 项目相对无 ~；模板 ~ 仅开头、$VAR ∈ globalEnvDeps） | `src/services/agentRegistry.json`（75 项生成物） | agentRegistrySnapshot.test.js 两项 schema 断言 | COVERED |
| REQ-SKILL-019 AC3 claude-code/codex 基线 | 快照中 claude-code=`.claude/skills`+universal:false+`~/.claude/skills`+[CLAUDE_CONFIG_DIR]；codex=`.agents/skills` | agentRegistrySnapshot.test.js「baseline entries」 | COVERED |
| REQ-SKILL-019 AC4 同步脚本存在；畸形上游 → 非零退出且不覆盖快照 | `scripts/sync-agent-registry.mjs`（--source 缝；求值/校验全过才写盘） | agentRegistrySnapshot.test.js「failure path preserves snapshot」 | COVERED |
| tech-design D3 快照机制：pinned 上游取 agents.ts、sentinel 环境矩阵差分推导模板与 globalEnvDeps | `scripts/sync-agent-registry.mjs`（node 原生 type stripping 求值 + xdg-basedir@5.1.0 shim + 9 env 白名单矩阵） | 同上失败注入测试（成功路径为构建期人工运行，零网络测试不覆盖——符合测试决策） | COVERED |

偏差与备注：
1. **编译工具偏差**：tech-design 写"esbuild（随 Vite 在依赖树）"，实际 vite 8 用 rolldown、依赖树无 esbuild；改用 node≥22.18 原生 type stripping 直接求值 agents.ts（type-only import 被擦除，types.ts 无需参与），零新增依赖，机制意图一致。
2. **快照生成方式**：沙箱拦截"执行下载的外部代码"，本次快照由静态文本解析 agents.ts 生成（75 项表达式形态已穷举核对，与 sentinel 求值对 pinned v1.5.20 输出等价；claude-code/codex/openclaw/kimchi/crush 等关键条目已逐项与源码交叉核对）。建议人在交互会话重跑一次 `node scripts/sync-agent-registry.mjs` 确认输出逐字节一致。
3. **模板编码决策**：`globalSkillsDir` 存默认形态（`~/.claude/skills`），env 驱动记录于 `globalEnvDeps`；服务展开规则 = env 设定时替换前导 config-root 段（唯一同时满足快照测试"`~` 仅开头"与运行时双断言的编码）。$VAR 替换语义在服务中保留（防御未来上游形态），当前快照无 $VAR 模板。
4. universal 判定 = `skillsDir === '.agents/skills'`（上游 isUniversalAgent 口径），快照 19 项 universal。
5. 本 slice 未动 server.js 的 reconcile/temp skillRepoPath 逻辑（留 slice 2）。

### 父代理验证与门禁记录

- Slice 1: complete (920b99f, 父代理独立复跑 12/12 + 76/76 绿, commit 范围仅 src/+scripts/)
- Slice 1: PRD alignment passed（ALIGNED；对齐子代理独立重跑 `sync-agent-registry.mjs --source <pinned v1.5.20>`，输出与提交快照逐字节一致——偏差 #2 残余风险实证关闭）
- Slice 1: refactor pass done (920b99f..0363249, 父代理复跑 12/12 + 76/76 绿, no rollback)
- 留 /review --stage=code 的设计问题：key→displayName 无独立 getter；expandDollarTemplate 非白名单字面量不一致（不可达）；byDisplayName 重复覆盖（零重复）；sync 脚本 `--source` 缺值静默退化网络抓取

---

## Slice 2: skill-library（含旧机制清除）— a44a244

验证：`node --test` 目标 2 文件 **31/31 绿**；Slice 1 回归 **12/12 绿**；老基线 codex-harness-desktop **76/76 绿**。

PRD→代码 可追溯性表：

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| REQ-SKILL-005 AC1 默认技能库路径 `~/.opc-workstation/skills`（不迁移旧目录） | `src/services/settingsService.js` getDefaults()（ADR-009 惰性计算绝对路径；loadSettings 不再 tilde 归一 skillRepoPath） | skillLibrary.test.js「default skill library path」 | COVERED |
| REQ-SKILL-005 AC2/AC4 E11 双向前缀冲突校验（~展开→realpath→大小写归一；等值/嵌套/父目录均拒；400+conflicts 列表） | `settingsService.js` findSkillRepoPathConflicts + saveSettings 抛码错；`src/http/routes/settings.js` 映射 400 `{error,conflicts}` | skillLibrary.test.js「rejects universal scan dir」「nested and parent」「claude-code env-expanded」 | COVERED |
| REQ-SKILL-005 AC3 合法路径保存生效并以新根扫描 | `settingsService.saveSettings` + `skillService.listSkillGroups`（repoRoot 每次实时读 settings） | skillLibrary.test.js「accepts a legal path and scans from the new root」 | COVERED |
| REQ-SKILL-006 AC1/AC2 分组扫描视图 `{slug,sourceType,sourceUrl,skills[]}`；.git→git+remote origin（无 remote→null）；无 .git→local+null | `skillService.listSkillGroups/scanSourceDir/readGitRemoteUrl`（解析 .git/config，不 spawn git） | skillLibrary.test.js「lists sources grouped」 | COVERED |
| REQ-SKILL-006 AC3 root 直下与 skills/*/ 两种布局；skillName=目录名 + frontmatter 元数据 | `skillService.discoverSkillDirs` + parseSkillMarkdown（沿用旧解析器） | skillLibrary.test.js「root-level SKILL.md layout」 | COVERED |
| REQ-SKILL-006 AC4 E6 缺 name/description 跳过+warning 不失败；AC5 磁盘即真相无缓存 | `scanSourceDir`（console.warn + continue；每次请求实时 readdir） | skillLibrary.test.js「skips directories」「reflects manual disk changes」 | COVERED |
| REQ-SKILL-007 AC1 git 浅克隆入 `<repoRoot>/<slug>`；slug 从 URL 派生 owner-repo、冲突加后缀 | `skillService.startInstall`（git 分支）+ `runGitInstallJob`（execFile 参数化 clone --depth 1）+ deriveGitSlug/resolveGitSlug | skillInstall.test.js「installs a git source as an async job」 | COVERED |
| REQ-SKILL-007 AC2 内容校验（SKILL.md 存在性 + 目录名合法性）失败 → job error SKILL_SOURCE_INVALID + 清理残留 | `validateSourceContent`（root 或 skills/*/；禁空白/分隔符/控制字符）+ runGitInstallJob catch 清理 | skillInstall.test.js「rejects a git source without any SKILL.md」 | COVERED |
| REQ-SKILL-007 AC3 E1 clone 失败 → job error SKILL_FETCH_FAILED 无残留 | `runGitInstallJob` clone catch（rm targetDir + 透传 stderr） | skillInstall.test.js「fetch failure surfaces SKILL_FETCH_FAILED」 | COVERED |
| REQ-SKILL-007 AC4 E3 系统 git 不可用 → POST 同步 503 GIT_UNAVAILABLE | `ensureGitAvailable`（execFile git --version 探测，无缓存）在 createJob 之前 | skillInstall.test.js「missing git binary is rejected 503」 | COVERED |
| REQ-SKILL-007 AC5 job 异步模型 `{id,status,error:{code,message}}` 轮询端点 | `skillService` jobs Map + createJob/finishJob/getJob；`src/http/routes/skills.js` `GET /api/skills/jobs/:jobId`（SSE stream 端点删除） | 两文件 waitForJob 全部用例 | COVERED |
| REQ-SKILL-008 AC1 local 拷贝入库（排除 .git）slug=basename | `validateLocalSource` + `copyLocalSource`（cpSync filter basename===".git"，dereference:false） | skillInstall.test.js「installs a local source by copying」 | COVERED |
| REQ-SKILL-008 AC2 E2 同步 400（不存在/非目录/无 SKILL.md/realpath 自引用/非法目录名），零写盘 | `validateLocalSource`（isDirectory + comparisonKey 双向包含校验 + validateSourceContent）全部在 createJob 之前 | skillInstall.test.js「rejects invalid local sources」「illegal directory names」 | COVERED |
| REQ-SKILL-008 AC3 E12 slug 冲突无 force → 409 SKILL_SLUG_CONFLICT + existing 信息，零写盘 | `startInstall` local 分支 existsSync 检查（校验后、拷贝前） | skillInstall.test.js「slug conflict without force returns 409」 | COVERED |
| REQ-SKILL-008 AC4 force=true → 清旧目录重新拷贝 | `runLocalInstallJob` force 分支 rm+cp | skillInstall.test.js「force=true overwrites」 | COVERED |
| REQ-SKILL-009 AC1 npm/plugin → 400 SKILL_SOURCE_INVALID；AC3 旧代码移除（结构守护） | `startInstall` sourceType 枚举校验（无 npm/plugin 字面量分支）；npm/plugin 安装与 npm update 代码整体删除 | skillInstall.test.js「rejects npm and plugin」「structural guard」 | COVERED |
| REQ-SKILL-015 AC1/AC2/AC4 级联删链（realpath ∈ 来源目录，大小写归一；外部条目不动）→ 删来源目录 → 200 `{deleted:slug}`；404 | `skillService.deleteSource` + `removeLinksInto` + `forEachAgentSkillsDir`（扫 projects 表声明目录；只 rm 软链本身） | skillLibrary.test.js「deleting a source cascades」「non-existent source 404」 | COVERED |
| REQ-SKILL-016 AC1/AC5 git pull --ff-only job；无新提交幂等；项目侧零操作生效 | `requestSourceUpdate` + `runUpdateJob`（execFile git -C pull --ff-only） | skillLibrary.test.js「git update pulls new commits」「no upstream changes」 | COVERED |
| REQ-SKILL-016 AC2 ff 失败表面化、不 reset、目录原样 | `runUpdateJob` catch → job error SKILL_UPDATE_FAILED（stderr 透传），无任何恢复性写盘 | skillLibrary.test.js「update fails surfaced with local changes」 | COVERED |
| REQ-SKILL-016 AC4 E8 local → 400 SKILL_UPDATE_UNSUPPORTED | `requestSourceUpdate` isGitSource 分支 | skillLibrary.test.js「local source is rejected」 | COVERED |
| REQ-SKILL-017 AC1 三表不存在 + projects.agentTypes 默认 '[]' | `src/db.js` initSchema 删三表/加列；migrateSchema DROP IF EXISTS + ALTER | skillLibrary.test.js「database has no tables」 | COVERED |
| REQ-SKILL-017 AC2 关联不产生 .opc/skills | `linkSkillToProject`（只在 agent 原生目录建链） | skillLibrary.test.js「never creates .opc/skills」 | COVERED |
| REQ-SKILL-017 AC3 启动协调逻辑移除（函数+调用+import） | `src/http/server.js` 调用与 import 删除；`skillService.js` 函数删除 | skillLibrary.test.js「structural guard」 | COVERED |
| REQ-SKILL-017 AC4 dependencies 不读不级联 | `linkSkillToProject` 仅链请求的 {slug,skillName}；frontmatter dependencies 字段无解析路径 | skillLibrary.test.js「dependencies links only itself」 | COVERED |
| REQ-SKILL-017 AC5 /api/skill-repos 404 | `src/http/routes/skillRepos.js` 删除 + server.js 注销路由 | skillLibrary.test.js「legacy endpoints are gone」 | COVERED |
| 跨切片落点：`PUT /api/projects/:id`（agentTypes 校验 INVALID_AGENT_TYPES+invalidAgents+去重保序）+ `POST /:id/skills` 复合身份建链（F4：幂等/冲突跳过/failed 表面化/E7 409/400/404） | `projectService.updateProject/validateAgentTypes` + `src/http/routes/projects.js` + `skillService.linkSkillToProject/resolveSkillTargetDir/createSymlink/forEachAgentSkillsDir` | 本 slice 由 skillLibrary/skillInstall 用例间接覆盖（200+建链真实生效）；完整语义由 skillSync/projectSkills（slice 3）验收 | PARTIAL（convergence/项目视图/unlink/resync 留 slice 3） |

偏差与备注：
1. **建链原语非 stub**：任务书允许"建链留 stub 给 slice 3"，但本 slice 目标测试（REQ-SKILL-015/016/017 共 5 例）要求 POST /:id/skills 真实建链（沿链读 v2 内容、existsSync 断言），故按 tech-design F4 完整实现（幂等/冲突/failed/E7/400/404）；slice 3 仅剩 convergence、项目技能视图、unlink 端点、resync。
2. **skillRepoPath 不再 tilde 归一**：REQ-SKILL-005 AC1 要求 loadSettings 返回绝对默认路径，老 settings 测试要求 `~/.opc-skills` 原样往返——两者同时满足的最简方案是 normalizeSettings 跳过该字段；消费方（skillService.repoRoot）自行 expandTilde。
3. **GET /api/projects/:id/skills 暂 404**、buildProjectDetail.skills 暂为 []（视图属 slice 3 REQ-SKILL-012）；旧 renderer SkillTable/CLI skill 命令调旧端点运行时报错属预期（可编译，slice 4/5 适配）。
4. **PUT 响应 convergence 字段为占位 `{agents:[]}`**：F3 收敛执行属 slice 3；形状前向兼容。
5. **E11 校验依赖 Slice 1 `listAgents()+getGlobalSkillsDir()`**（模板展开含 env 白名单），realpath 对不存在路径走最近现存祖先 best-effort（macOS /var→/private/var 前缀不会漏判）。
6. startServer reset 模式 temp skillRepoPath 隔离逻辑保留（仅更新过时注释）；CORS Allow-Methods 增加 PUT（node fetch 无感，为 renderer 后续 PUT 调用铺路）。

### Slice 2 父代理验证与门禁记录

- Slice 2: PRD alignment → **MISALIGNMENT_FOUND**（AC 语义全对齐，2 项安全边界缺口）：
  - **G1** slug 路径穿越（`POST /api/projects/:id/skills` body slug 直接 path.join，可逃逸技能库建外链，违反 D9/F4）
  - **G2** git clone 缺 `--` 分隔符（`--upload-pack=` 选项注入）+ 无协议白名单（`ext::` transport 可执行命令，违反 tech-design 安全节）
- Slice 2: 安全修复完成（c3ae100 [build] + a7897eb [test] 单测）：`validateSkillIdentity`（拒绝分隔符/../空白/控制字符，400 SKILL_IDENTITY_INVALID）应用于 linkSkillToProject/deleteSource/requestSourceUpdate 三入口；realpath 包含校验防御纵深（发现真实逃逸向量=源目录本身为软链）；clone 加 `--`；协议白名单 {https, ssh, file, scp-like}（file 为签核 fixture 必需，本地桌面 API 信任域）；update 前 remote url 过同一白名单。父代理复跑 31/31 + 12/12 + 76/76 + 单测 9/9 绿。
- **test-gap 记录**（走 /bug 或 /reflect 决策）：穿越/注入形态无业务级回归测试（当前由 tests/unit/skillServiceSecurity.test.js 9 个单测覆盖）；新增业务测试需 /test-author + 签核流程。
- Slice 2: complete (a44a244, 父代理独立复跑 31/31 + 12/12 + 76/76 绿, commit 范围仅 src/ 9 文件)
- Slice 2: refactor pass done (a44a244..958935e, 提取 pathUtils/settleJobWhen/placeSkillLink 等，父代理复跑全绿, no rollback)
- **留 slice 3 的已知缺陷（refactor 子代理发现）**：`insertProject` 返回 `rowToProject(project)`，`project.agentTypes` 为内存数组 → `parseAgentTypes` JSON.parse 抛错 → 恒返 `[]`。POST /api/projects 响应恒报 `agentTypes: []`（DB 存储正确、GET 往返正常）。projectAgents.test.js 断言 POST 响应值——slice 3 实现者需让 rowToProject 容忍数组输入或回读 DB 行，**不得**放松测试。
- 留 /review --stage=code：projectService.expandHome 第三处 tilde 展开器未归并（尾分隔符微差异）；E12 冲突体仅含 existing.slug；PRD §10 simple-git vs 实现 execFile 的机制偏差记录。

---

## Slice 3: distribution（含 agentTypes）— 285e631

验证：`node --test` 目标 3 文件 **34/34 绿**；Slice 2 回归 **31/31 绿**；Slice 1 回归 **12/12 绿**；老基线 codex-harness-desktop **76/76 绿**；单测 skillServiceSecurity **9/9 绿**。

PRD→代码 可追溯性表：

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| REQ-SKILL-010 AC1 直链技能库（realpath 相等、沿链读 SKILL.md） | `skillService.linkSkillToProject`（slice 2 已交付） | projectSkills.test.js「linking creates a symlink…resolving into the library」 | COVERED（本 slice 复验绿） |
| REQ-SKILL-010 AC2 skillsDir 去重单链双计 | `forEachAgentSkillsDir`（byDir 去重，per-agent 同报） | 「agents sharing one skillsDir produce a single link counted for both」 | COVERED |
| REQ-SKILL-010 AC3 幂等 | `placeSkillLink`（existing 链 target 相等 → linked） | 「linking the same skill twice is idempotent」 | COVERED |
| REQ-SKILL-010 AC4 E7 空声明 409 PROJECT_AGENTS_EMPTY | `linkSkillToProject` 前置校验 | 「empty agentTypes is rejected…(E7)」 | COVERED |
| REQ-SKILL-010 AC5 外部占用冲突跳过、实体原样保留 | `placeSkillLink` → conflicts；绝不删非软链 | 「external occupation…skipped and surfaced as conflict (D4)」 | COVERED |
| REQ-SKILL-010 AC6 E5 failed 字符串数组、他 agent 继续 | link 循环 try/catch → failed.push(skillName) | 「per-agent link failure…failed[] without aborting others (E5)」 | COVERED |
| REQ-SKILL-010 AC7 复合身份：缺 slug/skillName 400；不存在 404 | `validateSkillIdentity` + `resolveSkillTargetDir` | 「link requires the {slug, skillName} identity」 | COVERED |
| REQ-SKILL-011 AC1 删自有链；AC4 技能库不动 | `skillService.unlinkSkillFromProject`（readlink+comparisonKey 精确匹配 targetKey 才 rm） | 「unlinking removes only our symlink」 | COVERED |
| REQ-SKILL-011 AC2 外部实体/外部链不动并标注 conflicts | 同上（非软链/realpath 不属该身份 → conflicts，零写盘） | 「leaves external entries and foreign symlinks untouched」 | COVERED |
| REQ-SKILL-011 AC3 幂等成功；身份不存在 404 | lstat 缺失直接返回；`resolveSkillTargetDir` 404 | 「unlinking a non-linked skill is idempotent success」 | COVERED |
| REQ-SKILL-012 AC1/AC2 视图即扫描；repo/external 归因；条目 {slug,skillName,agents,origin} / 外部 {name,agents,origin} | `skillService.listProjectSkills` + `attributeLinkTarget`（readlink 绝对化 + realpathBestEffort，断链也可归因） | 「attributes origin repo/external correctly」 | COVERED |
| REQ-SKILL-012 AC3 断链 broken:true | `attributeLinkTarget` 落不到现存 skill → broken | 「a link whose library target vanished is marked broken」 | COVERED |
| REQ-SKILL-012 AC4 外部占用 → repo 条目 conflict:true | 视图交叉引用技能库 skillName × 外部条目名（磁盘即真相下唯一可表面化途径） | 「a skill blocked by external occupation is marked conflict」 | COVERED |
| REQ-SKILL-012 AC5/AC6 外部如实显示；E10 单目录不可读跳过+warning | readdir 失败仅 ENOENT 静默、其余 warn+continue | 「scan tolerates an unreadable agent dir…(E10)」 | COVERED |
| REQ-SKILL-013 AC1 并集扫描域；AC4 换 agent 不丢关联（F1） | `skillService.convergeProjectSkills`：先扫 before∪after 得 linkedSet，再删移除目录，再补建 | 「switching agents rebuilds…removes ours from the old (F1)」 | COVERED |
| REQ-SKILL-013 AC3 移除目录只删 realpath∈技能库的链 | `removeLinksInto`（slice 2 原语复用） | 「removes only our links from removed dirs and keeps external entries」 | COVERED |
| REQ-SKILL-013 AC5 不自动关联新 skill | linkedSet 仅来自扫描 | 「convergence never links skills outside the already-linked set」 | COVERED |
| REQ-SKILL-013 AC2 overlap 保留+新增补建 | phase 3 对全部 after 目录 placeSkillLink 幂等 | 「keeping an agent keeps its links, adding one adds links」 | COVERED |
| REQ-SKILL-013 AC7 agentTypes=[] 删全部自有链 | afterDirs 空 → 全部 before 目录走 removeLinksInto | 「setting agentTypes to [] removes all our links and keeps externals」 | COVERED |
| REQ-SKILL-013 AC6 PUT 响应 convergence.agents（linked/unlinked/failed/conflicts）；E5 表面化 | `routes/projects.js` PUT 分支（body 含 agentTypes 才收敛）；phase 3 catch → failed | 「convergence result reports per-agent outcomes including failures (E5)」 | COVERED |
| REQ-SKILL-014 AC1 已关联口径重建（含手工删链） | `skillService.resyncProjectSkills`：linked record（`<repoRoot>/.linked-skills/<projectId>.json`，link/unlink/resync/cascade 维护）∪ 磁盘扫描 → 幂等重建 | 「resync rebuilds links that were manually deleted」 | COVERED |
| REQ-SKILL-014 AC2 断链清理 | 扫描 pass：attr.broken → rm 链 → unlinked | 「resync removes broken links pointing into the library」 | COVERED |
| REQ-SKILL-014 AC4 错指向修复 | 链名=skill 身份（F4）：名≠target skillName 且库中有同名 skill → 重建正确链 | 「resync repairs a link whose target was repointed」 | COVERED |
| REQ-SKILL-014 AC3 外部不动+conflicts；AC5 不自动关联；空声明 no-op | 非软链/库外链 continue；placeSkillLink 冲突入 conflicts；agentTypes [] 提前返回 {agents:[]} | 「does not auto-link new skills and keeps external entries」「empty agentTypes…no-op」 | COVERED |
| REQ-WORKSPACE-011 AC1 默认 [] + GET 往返；AC5 迁移 | `rowToProject`/`parseAgentTypes` 容忍数组输入（**slice-2 遗留缺陷修复**）；GET detail 顶层展开平铺字段；`startServer({reset:false,dbPath})` 分支生效旧库迁移 | 「defaults to [] and round-trips via GET」「projects created before this story migrate」 | COVERED |
| REQ-WORKSPACE-011 AC2 非法 key 400 INVALID_AGENT_TYPES+invalidAgents 不写入 | `validateAgentTypes`（**改判 `isKnownAgentKey`**，见偏差 1） | 「unknown agent keys are rejected with 400 and not stored」 | COVERED |
| REQ-WORKSPACE-011 AC3 去重保首次出现序；非数组 400；AC4 [] 合法；POST 响应携带传入值 | 同上 + parseAgentTypes 修复 | 「duplicates are deduped」「non-array…400」「empty array is legal」「creating…stores them」 | COVERED |
| REQ-WORKSPACE-013 AC1 声明保留（drift 下可创建/可 PUT 同值） | `agentRegistryService.isKnownAgentKey`（现行快照 ∪ 随版基线） | 「drifted declaration is preserved…」 | COVERED |
| REQ-WORKSPACE-013 AC2 收敛跳过失效 key+invalid:true+linked:[]，PUT 不失败 | `convergeProjectSkills` dirOfKey 缺失 → invalid 条目；其余 agent 正常 | 同上 + skillSync 全部 | COVERED |
| REQ-WORKSPACE-013 AC4 快照恢复后正常收敛 | `resetAgentRegistryCache` 同时清基线缓存；收敛按现行快照 | 「agent recovers when a snapshot update brings the key back」 | COVERED |

偏差与备注：
1. **agentTypes 校验改判 `isKnownAgentKey`（现行 ∪ 基线）**：REQ-WORKSPACE-013 签核测试要求在 drift 快照（缺 claude-code）下 POST/PUT 含 claude-code 仍 201/200（声明保留且可写），而 REQ-WORKSPACE-011 要求 bogus-agent 400——两者同时成立的唯一语义是"校验集 = 现行快照 ∪ 随版基线快照"。生产环境两者同文件，语义不变；仅测试缝 override 下可区分。`isValidAgentKey`（slice 1 契约，供 skillsDir 等运行查找）保持仅看现行快照。
2. **linked record 机制（`<repoRoot>/.linked-skills/<projectId>.json`）**：REQ-SKILL-014 AC4"手工删链 → resync 重建"在纯磁盘扫描下不可判定（链被删后与"从未关联"无法区分），必须有 workstation 记账。位置选在 workstation 私有技能库内（不进项目目录，REQ-SKILL-017 AC2 只禁 `.opc/skills`；`listSkillGroups` 跳过 dot 目录不受污染）。视图/收敛不读它（磁盘即真相不变）；仅 link/unlink/resync/cascade-remove 维护。已删项目的残留 record 为已知无害残留（与 PRD §13 残留链取舍同源）。
3. **stopServer 关闭缓存 DB 句柄**：迁移测试删除临时 DB 后，下一个 startServer 复用陈旧句柄会 SQLITE_READONLY_DBMOVED——stopServer 现调 closeDb()，句柄不跨 server 生命周期泄漏。
4. **startServer({reset:false, dbPath}) 生效**：原实现忽略 dbPath（懒加载 getDb 走 DB_PATH/默认路径），迁移测试 404；现 propagate 到 DB_PATH 使首请求落指定文件并触发迁移。生产调用方（main.js/headless-server）不传 dbPath，行为不变。
5. GET /api/projects/:id 响应顶层新增平铺字段（name/agentTypes/…）+ `skills` 从占位 [] 变为真实扫描视图；`overview` 包络保留（老基线 overview 断言 76/76 绿证明兼容）。renderer/CLI 对新字段的适配属 slice 4/5。
6.  unlink 结果沿用每 agent `{linked,unlinked,failed,conflicts}` 形状：被外部占用位置记 conflicts（签核"结果标注跳过"）。


---

## Slice 3: distribution（含 agentTypes）— 285e631..48383e3

### 父代理验证与门禁记录

- Slice 3: complete (285e631, 父代理独立复跑 34/34 + 43/43(slice1+2) + 76/76 + 单测 9/9 绿, commit 仅 5 个 src 文件)
- Slice 3: PRD alignment passed（ALIGNED；两项设计性决策裁决「接受但需记录」）：
  - **C1 linked record（`<repoRoot>/.linked-skills/<projectId>.json`）接受**：签核 REQ-SKILL-014 AC4（手工删链→resync 重建）在纯磁盘扫描下不可满足，记账是唯一最小机制；视图/收敛不读它，磁盘即真相不变；`.linked-skills` dot 目录不污染 listSkillGroups/E11；deleteSource 级联同步清理。探针实证卫生良好。
  - **C2 isKnownAgentKey（现行快照 ∪ 随版基线）接受**：drift 测试要求 drifted key 可写 + bogus 400，∪ 是唯一同时成立的语义；基线 = committed 快照文件（单一数据源保持）；生产环境（无 env 缝）基线≡现行，语义不变。REQ-WORKSPACE-011 AC2 措辞与实现存在文本偏差，/reflect 时文档同步。
  - slice-2 遗留缺陷（POST 响应恒 `agentTypes: []`）已修复验证：parseAgentTypes 容忍数组输入，POST 响应携带传入值，GET 往返一致。
- **对齐报告记录项（低严重度，留 /review --stage=code 或 /reflect 决策）**：
  1. record 幽灵条目不剪枝（手工清库 + 同身份重新入库后 resync 会复活旧关联）——与 resync 断链清理语义内部不一致，需显性记录
  2. `removeLinksInto` rmSync 无 try/catch（收敛 Phase 2 删链失败 → DB 已保存后 500，与 unlink/resync 逐链容错不一致）
  3. 移除目录中断链残留（realpathSync 对 dangling 抛错跳过；可改 readlink 归因）
  4. REQ-SKILL-011 AC2 跳过标注、resync E5 failed 路径无签核测试断言（missing-test，留 /reflect）
  5. record 非原子写 + 跨 owner 多进程竞态（降级不腐化，记为已知取舍）
- Slice 3: refactor pass done (285e631..48383e3, 提取 scanSkillDirEntries/ensureLinksInDir/repairMispointedLink/finalizeAgentResults 等，净 -47 行，父代理复跑全绿, no rollback)
- 留 /review：resync 半修复态归因边缘；linkSkillToProject 与 finalizeAgentResults 尾部重复（slice-2 区域）。

---

## Slice 4: CLI — 01c3b68

验证：`node --test` 目标文件 **10/10 绿**；Slice 1-3 回归 **77/77 绿**；老基线 codex-harness-desktop **76/76 绿**；单测 skillServiceSecurity **9/9 绿**。

PRD→代码 可追溯性表：

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| REQ-CLI-002 AC1 `skill list` = GET /api/skills 分组视图；默认输出即可 JSON.parse | `src/cli/commands/skill.js` list | skillCli.test.js「install + skill list round-trip」「remove … disappears from skill list」 | COVERED |
| REQ-CLI-002 AC1 `skill install --source git\|local --identifier <> [--force]` → POST /api/skills/install + job 轮询；签核输出 `{slug, sourceType, skills[]}` | `skill.js` install（local slug=basename 确定性定位；git 用 before/after 分组 diff 定位 server 端 slug 派生结果，不复制派生逻辑） | 「install --source local + skill list round-trip」 | COVERED |
| REQ-CLI-002 AC1 + REQ-SKILL-009 `--source npm\|plugin` 非零退出 + stderr 含 SKILL_SOURCE_INVALID | `skill.js` install CLI 侧枚举守卫（VALID_SOURCES，API 400 兜底未触达） | 「skill install --source npm is rejected」（npm/plugin 两形态） | COVERED |
| REQ-CLI-002 AC1 + REQ-SKILL-008 AC3/AC4 slug 冲突 409 透传 SKILL_SLUG_CONFLICT；--force 覆盖 | `skill.js` install handleResponse（err.data=API 错误体）→ main() fail() 写 stderr；flags.force → body.force=true | 「duplicate local install fails with SKILL_SLUG_CONFLICT, --force overwrites」 | COVERED |
| REQ-CLI-002 AC1 + REQ-SKILL-016 AC4 `skill update <slug>` local → 非零 + SKILL_UPDATE_UNSUPPORTED；git → 202 job 轮询至终态 | `skill.js` update + waitForJob（job error 透传 error.code） | 「skill update on a local source fails with SKILL_UPDATE_UNSUPPORTED」 | COVERED |
| REQ-CLI-002 AC1 + REQ-SKILL-015 `skill remove <slug>` → DELETE /api/skills/:slug；磁盘目录消失 | `skill.js` remove | 「skill remove deletes the source…」 | COVERED |
| REQ-CLI-002 AC1/AC4 + REQ-SKILL-018 AC3 `skill agents` = GET /api/agents 全量 75 + 置顶序 | `skill.js` agents（数组原样输出） | 「skill agents prints the registry including pinned agents」 | COVERED |
| REQ-CLI-002 AC3 `project update <id> --agents a,b,c` = PUT agentTypes；输出含更新后 agentTypes；非法 key 非零 + stderr 含 key 名（INVALID_AGENT_TYPES + invalidAgents 透传） | `src/cli/commands/project.js` update（逗号切分、trim、滤空） | 「project update --agents + project skill link/list/unlink/resync flow」「unknown key fails」 | COVERED |
| REQ-CLI-002 AC2 `project skill list\|link\|unlink\|resync <id> [<slug> <skillName>]` 三级子命令（CONTEXT.md 约定） | `project.js` skill dispatcher（list→GET、link→POST {slug,skillName}、unlink→DELETE 复合路径、resync→POST resync，均 encodeURIComponent） | 「project update --agents + … flow」（link 建链 realpath 相等 / list 含 skillName / 手工删链 resync 重建 / unlink 删链） | COVERED |
| REQ-CLI-002 AC2 link/unlink 缺参数 → 用法错误非零退出 | `project.js` usageError（status 400 → main() exit 1，stderr USAGE_ERROR） | 「project skill link with missing arguments is a usage error」 | COVERED |
| REQ-CLI-002 AC4 `--json` flag list/agents 机器可读 | `opc-workstation.js` 全局 --json 既有机制（默认输出即 JSON，flag 幂等） | 「--json flag yields machine-readable output for list commands」 | COVERED |
| 横切：positionals 传递（`handler(flags, rest)`，旧 handler 单参签名兼容）；ADR-001 HTTP-only 沿用 ensureServer 发现；旧 /api/skill-repos、SSE stream、PATCH linkSkill 代码路径整体移除 | `opc-workstation.js` main；`skill.js`/`project.js` 重写 | 老基线 cli.test.js 3/3 绿（--help/--pretty/NOT_IMPLEMENTED 行为不变） | COVERED |

偏差与备注：
1. **install 成功输出的 slug 定位**：job 模型（签核决策 #1 `{id,status,error}`）不载安装结果；CLI 不复制 server 端 git slug 派生/后缀逻辑——local 用 basename 确定性查找，git 用 install 前后分组 diff 定位新 slug；force 覆盖（local）时 diff 为空、basename 查找兜底。
2. **job 错误出口码**：job 终态 error 以 status 500 抛出 → main() exit 2；同步 4xx（409/400）→ exit 1；均非零且 stderr 携带 API `{error: CODE}` 体，满足"错误码透传"签核口径。
3. **`settings set --skill-repo-path` 无需补齐**：既有 PATCH /api/settings 路径（skillRepoPath 字段 + E11 校验）与测试 beforeEach 依赖行为一致，未改动。
4. **`project update` 仅支持 --agents**（REQ-CLI-002 AC3 最小面）；name/description 透传未开放，留待后续 REQ 驱动。
5. E2E（.test.cjs）未跑，属 slice 5 范围。

---

## Slice 4: CLI — 01c3b68

### 父代理验证与门禁记录

- Slice 4: complete (01c3b68, 父代理独立复跑 10/10 + 87/87(story API/CLI 全) + 76/76 + 单测 9/9 绿, commit 仅 3 个 src/ cli 文件, 净 +98 行)
- Slice 4: PRD alignment passed（父代理内联审查，因子代理配额失败）：
  - **AC1-AC4 全部对齐**：skill 五组命令（list/install/update/remove/agents）、project skill 三级子命令（list/link/unlink/resync）、`--agents` 等价 PUT、错误码透传 stderr、`--json` 由全局处理
  - **D1 install slug 定位**：local=basename 确定性、git=前后 diff，找不到 → 500 INTERNAL_ERROR 显式报错（不错报）；单进程串行场景下正确
  - **D2 CLI 侧守卫**：npm/plugin 400 SKILL_SOURCE_INVALID，stderr 含错误码（签核断言验证）
  - **ADR-001 纪律**：全部经 ensureServer + HTTP fetch；旧 /api/skill-repos + SSE stream 代码路径 grep 确认零引用（仅注释）
  - scope 干净：opc-workstation.js 只改 handler 透传位置参数 + help 示例，老基线 76/76 绿证兼容
- Slice 4: refactor pass NO_CHANGES_NEEDED（文件小（143+135 行），handleResponse 模式微差异不值得跨文件提取）
