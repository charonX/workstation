# 测试计划 — 多 Agent Skill 管理与分发

> 故事 ID：`2026-07-29-multi-agent-skills`
> 版本：v1（对应 requirements.md v1，hash `48b5bb09…63ee4f`）
> 生成：2026-07-29 `/test-author`
> 测试规模：87 个 API/CLI 测试（8 文件）+ 12 个 Playwright Electron E2E（2 文件）= 99 个自动化测试
> UX 原型：本 story 无 `ux/` HTML 原型，无 HTML 映射测试；选择器/项目技能区结构行为直接由 REQ-WORKSPACE-012、REQ-SKILL-010~014 的 E2E 覆盖。

## 目录组织

| capability / entity | 目录 | 文件 |
|---|---|---|
| skill-management / skill | `tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/` | `skillLibrary.test.js` (20), `skillInstall.test.js` (11), `projectSkills.test.js` (14), `skillSync.test.js` (11) |
| skill-management / skill | `.../e2e/` | `skillLibrary.test.cjs` (7) |
| skill-management / agent-registry | `tests/capabilities/skill-management/agent-registry/2026-07-29-multi-agent-skills/api/` | `agentRegistry.test.js` (8), `agentRegistrySnapshot.test.js` (4) |
| workspace-management / project | `tests/capabilities/workspace-management/project/2026-07-29-multi-agent-skills/api/` | `projectAgents.test.js` (9) |
| workspace-management / project | `.../e2e/` | `agentTypes.test.cjs` (5) |
| command-interface / cli | `tests/capabilities/command-interface/cli/2026-07-29-multi-agent-skills/cli/` | `skillCli.test.js` (10) |

## REQ → 测试映射

### skill-management / skill

| REQ | 测试（seam） |
|---|---|
| REQ-SKILL-005 技能库路径与 E11 | API+单元：默认路径（settingsService）、`~/.agents/skills` 冲突 400、嵌套/父目录冲突、claude-code env 展开冲突（registryService）、合法保存后扫描生效 |
| REQ-SKILL-006 分组扫描视图 | API：git/local 分组+sourceUrl+元数据、根布局 skillName=目录名、E6 非法跳过、磁盘即真相无缓存；E2E：UI 安装后分组可见 |
| REQ-SKILL-007 git 安装 | API+git fixture（本地仓库，无网络）：浅克隆入库、无 SKILL.md 拒绝+无残留、E1 SKILL_FETCH_FAILED、E3 GIT_UNAVAILABLE 503（PATH 置空注入） |
| REQ-SKILL-008 local 安装 | API：拷贝排除 .git、E2 四类非法源、非法目录名、E12 409 不写盘、force 覆盖 |
| REQ-SKILL-009 npm/Plugin 移除 | API：两来源 400 SKILL_SOURCE_INVALID、结构性守护（无 npm/plugin 分支）；E2E：安装弹窗选项恰为 git/local |
| REQ-SKILL-010 关联建链 | API+FS：直链技能库 realpath、共享 skillsDir 去重（数据驱动选 agent 对）、幂等、E7 空声明 409、外部占用冲突跳过、E5 权限注入 failed[]、{slug,skillName} 必填；E2E：UI 关联→软链落盘 |
| REQ-SKILL-011 取消关联 | API+FS：删自有链、外部实体/外部软链不动、幂等、技能库不动 |
| REQ-SKILL-012 项目视图 | API：origin repo/external 归因、broken 标注、conflict 标注、E10 不可读目录容错；E2E：[外部] 徽标可见 |
| REQ-SKILL-013 自动收敛 | API+FS：换 agent 不丢关联（review F1 场景）、移除目录删自有链留外部、不自动关联新 skill、重叠保留、空 [] 清空、E5 收敛结果表面化；E2E：编辑页改 agentTypes→收敛摘要+新目录软链 |
| REQ-SKILL-014 手动重同步 | API+FS：重建手删链、断链清理、错指向修复、不自动关联+外部不动、空声明 no-op；E2E：重同步按钮 |
| REQ-SKILL-015 级联移除 | API+FS：多项目级联删链+删目录+外部/其他来源不动、404；E2E：确认对话框 |
| REQ-SKILL-016 来源更新 | API+git fixture：ff-only 拉新+经链读新内容（项目侧零操作）、本地改动失败表面化不 reset、local E8 400、无新提交幂等 |
| REQ-SKILL-017 旧机制清除 | API+DB：三表不存在+agentTypes 列存在、/api/skill-repos 404、无 .opc/skills、dependencies 不级联、reconcile 静态守护 |

### skill-management / agent-registry

| REQ | 测试（seam） |
|---|---|
| REQ-SKILL-018 Registry 服务 | API+单元：GET /api/agents ≥75 项含三字段、置顶五项顺序+其余 displayName 排序、~ 展开、env 白名单（CLAUDE_CONFIG_DIR 哨兵）、非白名单不泄露、key 校验+displayName 映射、未知 key 不抛错、惰性加载证据（快照替换缝） |
| REQ-SKILL-019 快照与同步脚本 | 单元（不触网）：快照 schema（kebab-case/相对 skillsDir/globalEnvDeps/universal）、模板可展开性（$VAR∈deps、~ 仅开头）、claude-code/codex 基线、脚本失败注入（畸形 --source 非零退出且快照不变） |

### workspace-management / project

| REQ | 测试（seam） |
|---|---|
| REQ-WORKSPACE-011 agentTypes 字段 | API：默认 []、创建携带、未知 key 400 不写入、去重、非数组 400、空数组合法、旧库迁移（旧 schema DB fixture + reset:false 启动） |
| REQ-WORKSPACE-012 Agent 选择器 | E2E：全量 ≥75+置顶顺序+无预选、搜索过滤（name/displayName 大小写不敏感）、创建保存一致、编辑页回显 |
| REQ-WORKSPACE-013 registry 漂移 | API（快照覆盖缝）：声明保留+收敛跳过标记、快照恢复后正常收敛；E2E（双阶段启动+userData 复用）：失效徽标可见且不消失 |

### command-interface / cli

| REQ | 测试（seam） |
|---|---|
| REQ-CLI-002 CLI 命令组 | CLI（in-process server + execFile 共享 DB）：`skill agents` 置顶序、install/list 往返、冲突非零退出+--force、npm/plugin 拒绝、local update 拒绝、`project update --agents`、`project skill link/list/resync/unlink` 全链路+FS 断言、非法 key 非零、缺参用法错误、`skill remove`、`--json` 可解析 |

## 实现者必须提供的测试缝（契约的一部分）

1. `agentRegistryService.js` 导出：`getGlobalSkillsDir(name)`、`isValidAgentKey(name)`、`getAgentKeyByDisplayName(displayName)`、`resetAgentRegistryCache()`。
2. 快照覆盖缝：env `OPC_AGENT_REGISTRY_SNAPSHOT=<path>`（测试替换快照用）。
3. 同步脚本失败注入缝：`node scripts/sync-agent-registry.mjs --source <file>`；畸形输入非零退出且不写快照。
4. `GET /api/skills/jobs/:jobId` → `{status:"running"|"success"|"error", …}`（错误码在 `error.code` 或 `code`，签核定稿）。
5. `PUT /api/projects/:id` 接受部分 body `{agentTypes}`；响应附加 `convergence.agents[]`（breaking）。
6. 错误体统一 `{error: <CODE>, message, …}`；冲突类错误携带明细（E11 `conflicts`、E9 `invalid|skipped` 标记）。
7. UI testid 契约：`tests/e2e/helpers/locators.cjs` 新增段（agent-type-multiselect / option[data-agent-name]+checkbox / project-skills-section / skill-link-button / resync-skills-button / external-skill-badge / convergence-summary / edit-project-button）。

## 旧测试退役（随本契约更新，[test] commit 内完成）

| 文件 | 处置 | 原因 |
|---|---|---|
| `skill-management/skill/codex-harness-desktop/api/skill.test.js` | 删除 | REQ-SKILL-001~004 旧三表模型，由 REQ-SKILL-005~017 接替 |
| `skill-management/skill/codex-harness-desktop/e2e/skillInstall.test.cjs` | 删除 | 同上（npm 安装路径不复存在） |
| `workspace-management/project/codex-harness-desktop/api/project.test.js` | 手术 | 移除 4 个旧关联模型测试（PATCH {skillId,linked}/孤儿 skill/.opc 链/dependencies 级联）；保留 overview、创建、删除等 |
| `workspace-management/project/codex-harness-desktop/e2e/onboarding.test.cjs` | 手术 | 移除"复选框关联 skill"测试与 npm fixture 播种；保留 settings/项目/主题等 onboarding 流 |
| `tests/e2e/helpers/seed.cjs` | 手术 | 移除 installSkill（旧契约+stream，已无引用） |
| `tests/e2e/helpers/locators.cjs` | 手术 | 移除 SKILL_LINK_CHECKBOX；新增本 story testid 段 |

`settings.test.js` 的 REQ-WORKSPACE-002（skillRepoPath 持久化）保留：`~/.opc-skills` 不触发 E11，行为在新模型下不变。

## 已知覆盖说明（非缺口，签核时确认）

- **Skill Detail 弹窗**（旧 REQ-SKILL-002）：功能在本 story 范围外（PRD 未含），旧 detail 测试随旧模型删除（npm 安装播种路径消失）。若 detail 弹窗保留，其数据改自磁盘扫描；建议 BUILD 后以 `/bug`（test-gap）或后续 story 补契约。
- **REQ-WORKSPACE-006**：overview 元数据测试保留；关联部分由 REQ-SKILL-010~012 接替。

## REFLECT 人工验收（纯审美，不进自动化）

- Agent 选择器置顶分组与其余列表的视觉分组样式（分隔/标签观感）。
- 外部条目 [外部] 徽标的呈现样式。

## 回溯检查

19 条 REQ 每条 ≥1 个自动化测试（见映射表），无 `人工(仅视觉)` 独任的 REQ；E2E 12/99 ≈ 12%，高于金字塔 5% 指引——本 story 核心交互（选择器/关联/收敛/重同步）均为新关键路径，签核时确认可接受。
