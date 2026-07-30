# Build Progress — 2026-07-29-multi-agent-skills

> BUILD 阶段进度账本。每个 slice：子代理实现 → 父代理独立验证 → PRD 对齐子代理 → refactor 子代理 → 父代理复验 → 标记完成。

## 切片计划（依赖序）

| Slice | 名称 | REQ-ID | 测试文件 | 测试数 | 状态 |
|---|---|---|---|---|---|
| 1 | agent-registry | REQ-SKILL-018, REQ-SKILL-019 | agentRegistry.test.js, agentRegistrySnapshot.test.js | 12 | done |
| 2 | skill-library（含旧机制清除） | REQ-SKILL-005/006/007/008/009/015/016/017 | skillLibrary.test.js, skillInstall.test.js | 31 | done |
| 3 | distribution（含 agentTypes） | REQ-SKILL-010/011/012/013/014, REQ-WORKSPACE-011/013 | projectSkills.test.js, skillSync.test.js, projectAgents.test.js | 34 | pending |
| 4 | CLI | REQ-CLI-002 | skillCli.test.js | 10 | pending |
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
