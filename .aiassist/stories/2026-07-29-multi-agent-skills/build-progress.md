# Build Progress — 2026-07-29-multi-agent-skills

> BUILD 阶段进度账本。每个 slice：子代理实现 → 父代理独立验证 → PRD 对齐子代理 → refactor 子代理 → 父代理复验 → 标记完成。

## 切片计划（依赖序）

| Slice | 名称 | REQ-ID | 测试文件 | 测试数 | 状态 |
|---|---|---|---|---|---|
| 1 | agent-registry | REQ-SKILL-018, REQ-SKILL-019 | agentRegistry.test.js, agentRegistrySnapshot.test.js | 12 | done |
| 2 | skill-library（含旧机制清除） | REQ-SKILL-005/006/007/008/009/015/016/017 | skillLibrary.test.js, skillInstall.test.js | 31 | pending |
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
