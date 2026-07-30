# Signoff — 2026-07-29-multi-agent-skills

## Assertion（阶段 1：断言签核）

- 签核日期：2026-07-29
- 签核方式：逐项过 `// TODO: HUMAN ASSERTION`（44 处占位 → 归并为 24 项决策），全部经人拍板后回写测试文件
- REQ 版本：`v1-hash:48b5bb090689d0ae76858eee7132e228805e6eb09ff701686d30cc1e6863ee4f`

### REQ-ID 列表（19 条，全部有自动化测试）

| REQ-ID | capability / entity | 测试文件 |
|---|---|---|
| REQ-SKILL-005 | skill-management / skill | api/skillLibrary.test.js |
| REQ-SKILL-006 | skill-management / skill | api/skillLibrary.test.js, e2e/skillLibrary.test.cjs |
| REQ-SKILL-007 | skill-management / skill | api/skillInstall.test.js |
| REQ-SKILL-008 | skill-management / skill | api/skillInstall.test.js |
| REQ-SKILL-009 | skill-management / skill | api/skillInstall.test.js |
| REQ-SKILL-010 | skill-management / skill | api/skillSync.test.js |
| REQ-SKILL-011 | skill-management / skill | api/skillSync.test.js |
| REQ-SKILL-012 | skill-management / skill | api/skillSync.test.js |
| REQ-SKILL-013 | skill-management / skill | api/skillSync.test.js |
| REQ-SKILL-014 | skill-management / skill | api/projectSkills.test.js |
| REQ-SKILL-015 | skill-management / skill | api/projectSkills.test.js |
| REQ-SKILL-016 | skill-management / skill | api/projectSkills.test.js, e2e/skillLibrary.test.cjs |
| REQ-SKILL-017 | skill-management / skill | api/projectSkills.test.js, e2e/skillLibrary.test.cjs |
| REQ-SKILL-018 | skill-management / agent-registry | api/agentRegistry.test.js |
| REQ-SKILL-019 | skill-management / agent-registry | api/agentRegistrySnapshot.test.js |
| REQ-WORKSPACE-011 | workspace-management / project | api/projectAgents.test.js |
| REQ-WORKSPACE-012 | workspace-management / project | e2e/agentTypes.test.cjs |
| REQ-WORKSPACE-013 | workspace-management / project | api/projectAgents.test.js, e2e/agentTypes.test.cjs |
| REQ-CLI-002 | command-interface / cli | cli/skillCli.test.js |

旧模型 REQ-SKILL-001~004 已被 005~017 取代（business-capabilities.md 已标注），旧测试随 test-author 退役（删 2 文件 + 手术 4 文件）。

### capability/entity 覆盖摘要

- **skill-management / skill**：12 REQ（005–017），46 个测试，覆盖安装（git/local）、库扫描视图、更新、删除、同步/重同步、项目关联。新端点契约（jobs 轮询、DELETE 200+body、404 语义）全部有断言。
- **skill-management / agent-registry**（新实体，已登记能力地图）：2 REQ（018–019），12 个测试，覆盖快照 schema、排序、模板展开、同步脚本失败保护。
- **workspace-management / project**：3 REQ（011–013），14 个测试，覆盖 agentTypes CRUD/校验、registry 漂移、迁移。
- **command-interface / cli**：1 REQ（002），10 个测试，覆盖 skill 子命令与 project skill 链路。
- E2E 占比 12/99 ≈ 12%，符合"能下沉则下沉"（skill detail modal 结构缺口已在 test-plan.md 显式接受）。

### 24 项已签断言决策（摘要）

1. **Job 模型**：`{id, status, error:{code, message}}` 嵌套结构；E1 fetch 失败 = `SKILL_FETCH_FAILED`。
2. **安装校验**：内容校验失败 = `SKILL_SOURCE_INVALID`（job error code）；git 不可用 = POST 同步 503 `GIT_UNAVAILABLE`；slug 冲突 409/`--force`。
3. **库视图**：来源分组 `slug`=basename；root 形态 skillName=目录名；git 组 `sourceUrl`=remote origin、local 组 `sourceUrl=null`。
4. **删除**：`DELETE /api/skills/:slug` → 200 + `{deleted: slug}` body。
5. **项目 skill**：`failed` 为字符串数组；缺 slug/skillName → 404；外部条目 `{name, agents, origin}`；失效关联 `broken:true`；repo 冲突 `conflict:true`。
6. **Registry 规模**：精确 **75**（用户拍板，非 ≥75）；置顶 claude-code/codex/opencode/cursor/kimi-code-cli。
7. **模板展开**：claude-code `globalSkillsDir` 受白名单 `CLAUDE_CONFIG_DIR` 驱动；非白名单 env 不泄漏。
8. **Registry service 导出**：`getGlobalSkillsDir` / `isValidAgentKey` / `getAgentKeyByDisplayName` / `resetAgentRegistryCache`；未知 key → `null` / `false`，不抛。
9. **测试缝**：`OPC_AGENT_REGISTRY_SNAPSHOT` env 覆盖 + 缓存重置；同步脚本 `--source <file>` 失败注入（畸形上游 → 非零退出、快照不被覆写）。
10. **项目 agentTypes**：非法 key → 400 `INVALID_AGENT_TYPES` + `invalidAgents[]`；去重保留首次出现序；漂移标记收敛结果 `invalid:true` 且 `linked:[]`；PUT 响应含 `convergence` 字段。
11. **CLI**：install 输出 `{slug, sourceType, skills[]}`；`skill agents` 全量 75 + 置顶序；保留 regex 结构防护；`--source` 仅 `git` / `local`。
12. **E2E**：dialog/badge 只做存在性断言（视觉走 REFLECT）；agent 选择器 75 选项、无预选、搜索过滤、漂移 badge。

### 实现者测试缝契约（已随测试固定，BUILD 必须满足）

- `src/services/agentRegistryService.js` 导出上述 4 个函数（惰性加载，无模块顶层副作用）。
- `src/services/agentRegistry.json` 快照 + `scripts/sync-agent-registry.mjs`（含 `--source` 注入缝）。
- Job 轮询端点 `GET /api/skills/jobs/:jobId` 返回上述 job 模型。
- 错误 body 统一 `{error: CODE}`（+ 可选附加字段如 `invalidAgents`）。
- PUT `/api/projects/:id` 支持部分字段 body，响应含 `convergence`。
- UI 定位器：`data-testid` 多选器/搜索框/选项（`option[data-agent-name]` + checkbox input）、置顶分组、失效 badge、编辑按钮、收敛摘要、项目 skill 区/行/link/unlink/resync、外部 badge、删除确认 dialog。

### 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`（PRD 完整性已通过 /crystallize 审查）
- [x] PRD 第 6-8 节（操作流、验证规则、错误状态）已覆盖（E1/E3/E5/E10/E11/E12、400/404/409/503 均有测试）
- [x] 每个 REQ-ID 都有对应测试（19/19，见上表）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致（agent-registry 新实体已登记）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（grep 清零）
- [x] 预期值来源清晰，非代码输出：所有期望值由人逐项拍板（24 项决策），均从 tech-design 接口契约推导而非现有代码抄写
- [x] 无快照当判定依据（E2E 仅存在性/结构断言，无 screenshot 比对）
- [x] 边界/错误 case 已覆盖（重复安装、空数组、去重、权限失败 E5/E10、漂移、迁移、畸形上游、无 git、slug 冲突）
- [x] `signoff.md` Assertion 部分已创建并通过 `[test] assertion-signoff for 2026-07-29-multi-agent-skills` commit 提交

**结论：断言签核通过，BUILD 解锁。**
