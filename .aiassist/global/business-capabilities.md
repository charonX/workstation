# 业务能力地图 — OPC Workstation

> 本文件由 `/crystallize` 和 `/reflect` 维护。
> 把测试按业务实体/能力组织，而不是按 story。
> 每个能力下挂测试文件和 REQ-ID。

---

## 能力清单

### workspace-management
> 配置 Workspace 根目录、Skill 仓库位置，管理项目导入与搜索；单 server 运行时与本地存储。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| settings | `tests/capabilities/workspace-management/settings/codex-harness-desktop/api/` | REQ-WORKSPACE-001, REQ-WORKSPACE-002, REQ-WORKSPACE-007, REQ-I18N-002 | `settings.test.js`, `bootstrapEnv.test.js`, `settingsServiceLazy.test.js`, `themeLanguage.spec.js` (E2E) |
| project | `tests/capabilities/workspace-management/project/codex-harness-desktop/api/`, `tests/capabilities/workspace-management/project/2026-07-29-multi-agent-skills/api/`, `tests/capabilities/workspace-management/project/2026-07-29-multi-agent-skills/e2e/` | REQ-WORKSPACE-003~006, REQ-WORKSPACE-011~013 | `project.test.js`, `onboarding.spec.js` (E2E), `projectAgents.test.js`, `agentTypes.test.cjs` (E2E) |
| server | `tests/capabilities/workspace-management/server/2026-07-19-media-production-line/api/` | REQ-WORKSPACE-008~010 | `server.test.js` |

### flow-orchestration
> 设计、保存、执行流程图，支持条件分支与循环。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| flow | `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/`, `tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/`, `tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/api/` | REQ-FLOW-001~006, REQ-FLOW-011~022, REQ-FLOW-028（调试弹窗） | `flow.test.js`, `flowRun.test.cjs`, `flowEditor.test.cjs`, `triggerConfig.test.cjs`, `conditionConfig.test.cjs`, `agentConfig.test.cjs`, `nodeErrorHandling.test.cjs`, `variablePicker.test.cjs`, `debugModal.test.cjs`, `triggerConfig.test.js`, `conditionConfig.test.js`, `agentConfig.test.js` |
| flow-engine | `tests/capabilities/flow-orchestration/flow-engine/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/`, `tests/capabilities/flow-orchestration/flow-engine/2026-07-19-media-production-line/api/`, `tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/` | REQ-FLOW-007~010, REQ-FLOW-023~027, REQ-FLOW-029, REQ-FLOW-031~032, REQ-FLOW-035~037, REQ-FLOW-039, REQ-FLOW-042, REQ-FLOW-046, REQ-FLOW-047 | `flowEngine.test.js`, `variableRegistry.test.js`, `variableSubstitution.test.js`, `errorHandling.test.js`, `danglingReference.test.js`, `projectPathInjection.test.js`, `claudeAgentAdapter.test.js`, `triggerVariables.test.js`, `feishuMessageNode.test.js`, `feishuSendNode.test.js`, `upstreamVariables.test.js`, `subflowNodeTypes.test.js`, `subflowIsolation.test.js`, `subflowFailure.test.js`, `subflowLatestVersion.test.js`, `executorSignature.test.js`, `foreachCallflow.test.js`, `setVariables.test.js`, `nodeRegistry.test.js` |
| flow | `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/`, `tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/`, `tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/api/`, `tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/api/`, `tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/e2e/` | REQ-FLOW-001~006, REQ-FLOW-011~022, REQ-FLOW-028（调试弹窗）, REQ-FLOW-032~034, REQ-FLOW-038, REQ-FLOW-041, REQ-FLOW-043, REQ-FLOW-045, REQ-FLOW-047 | `flow.test.js`, `flowRun.test.cjs`, `flowEditor.test.cjs`, `triggerConfig.test.cjs`, `conditionConfig.test.cjs`, `agentConfig.test.cjs`, `nodeErrorHandling.test.cjs`, `variablePicker.test.cjs`, `debugModal.test.cjs`, `triggerConfig.test.js`, `conditionConfig.test.js`, `agentConfig.test.js`, `callFlowValidation.test.js`, `circularReference.test.js`, `callflowCandidates.test.js`, `subflowConfig.spec.js`, `setVariablesValidation.test.js`, `setVariablesUpstream.test.js` |
| execution | `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/api/`, `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/e2e/`, `tests/capabilities/flow-orchestration/execution/2026-07-19-media-production-line/api/`, `tests/capabilities/flow-orchestration/execution/2026-07-19-media-production-line/e2e/`, `tests/capabilities/flow-orchestration/execution/2026-07-23-nested-flow/api/`, `tests/capabilities/flow-orchestration/execution/2026-07-23-nested-flow/e2e/` | REQ-FLOW-028, REQ-FLOW-030, REQ-FLOW-040, REQ-FLOW-044 | `executionLog.test.js`, `executionLog.test.cjs`, `artifactOpenPath.test.js`, `artifactsTab.test.cjs`, `nestedExecution.test.js`, `nestedExecutionDetail.spec.js` |

### scheduling-execution
> 手动触发、定时触发、执行队列、查看执行历史与详情。UI 仅保留执行历史页；任务创建 UI 已移除，Task 在 API/CLI 层作为手动触发的别名保留。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| task | `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/` | REQ-SCHEDULE-001 | `task.test.js` |
| schedule | `tests/capabilities/scheduling-execution/schedule/codex-harness-desktop/api/`, `tests/capabilities/scheduling-execution/schedule/2026-07-19-media-production-line/api/` | REQ-SCHEDULE-002, REQ-SCHEDULE-004~006 | `schedule.test.js`, `scheduleTriggers.test.js` |
| execution | `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/`, `tests/capabilities/scheduling-execution/execution/2026-07-19-media-production-line/api/` | REQ-SCHEDULE-001, REQ-SCHEDULE-003, REQ-SCHEDULE-007~009 | `task.test.js`, `flowRun.test.js` (E2E), `executionQueue.test.js`, `artifacts.test.js` |

### skill-management
> 技能库（workstation 私有磁盘目录，磁盘即真相）管理、git/local 来源安装、按项目 agentTypes 声明的软链分发与收敛、agent registry。skill repo 一级实体在 2026-07-29-multi-agent-skills 中消解为磁盘"来源目录"（ADR-003 修订）；REQ-SKILL-001~004（旧三表模型）由 REQ-SKILL-005~017 接替。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| skill-repo | `tests/capabilities/skill-management/skill/codex-harness-desktop/api/`, `tests/capabilities/skill-management/skill/codex-harness-desktop/e2e/` | REQ-SKILL-001, REQ-SKILL-003, REQ-SKILL-004（接替：REQ-SKILL-005~009, 015~017） | `skill.test.js`, `skillInstall.test.cjs` (E2E); rescan/update via HTTP API |
| skill | `tests/capabilities/skill-management/skill/codex-harness-desktop/api/`, `tests/capabilities/skill-management/skill/codex-harness-desktop/e2e/`, `tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/api/`, `tests/capabilities/skill-management/skill/2026-07-29-multi-agent-skills/e2e/` | REQ-SKILL-001, REQ-SKILL-002, REQ-SKILL-005~017 | `skill.test.js`, `skillInstall.test.cjs` (E2E), `skillLibrary.test.js`, `skillInstall.test.js`, `projectSkills.test.js`, `skillSync.test.js`, `skillLibrary.test.cjs` (E2E) |
| agent-registry | `tests/capabilities/skill-management/agent-registry/2026-07-29-multi-agent-skills/api/` | REQ-SKILL-018~019 | `agentRegistry.test.js`, `agentRegistrySnapshot.test.js`, `agentRegistryBuild.test.js` |

### channel-integration
> 外部 IM 通道接入：长连接收发、消息去重与路由、通道绑定、文档同步。（第一实现：飞书）

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| channel | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/` | REQ-CHANNEL-001~005 | `feishuChannel.test.js`, `imRouting.test.js` |

### collection-pipeline
> 内容源管理、按主题/tag 的定时与 IM 触发收集、产物落素材库。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| content-source | `tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/api/`, `.../cli/`, `.../e2e/` | REQ-SRC-001~003 | `contentSources.test.js` (api), `contentSources.test.js` (cli), `sourcesPage.test.cjs` |
| collection | `tests/capabilities/collection-pipeline/collection/2026-07-19-media-production-line/api/`, `.../e2e/` | REQ-COLL-001~002 | `dailyDigest.test.js`, `linkCapture.test.js` |

### information-aggregation
> Dashboard 展示关键指标与最近活动；应用内通知中心。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| dashboard | `tests/capabilities/information-aggregation/dashboard/codex-harness-desktop/api/` | REQ-DASH-001 | `dashboard.test.js`, `dashboard.spec.js` (E2E) |
| notification | `tests/capabilities/information-aggregation/notification/2026-07-19-media-production-line/api/`, `.../e2e/` | REQ-NOTIFY-001~002 | `notifications.test.js`, `notificationCenter.test.cjs` |

### app-distribution

| entity | 测试目录 | REQ | 测试文件 |
|---|---|---|---|
| release | `tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/cli/`、`.../api/`、`.../e2e/` | REQ-DIST-001~004 | `release.test.js`, `checkUpdates.test.js`, `versionDisplay.test.cjs` (E2E) |

### internationalization-theme
> 语言切换、主题切换、显示密度。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| theme | `tests/capabilities/internationalization-theme/theme/codex-harness-desktop/api/` | REQ-I18N-001 | `theme.test.js`, `themeLanguage.spec.js` (E2E) |
| language | `tests/capabilities/internationalization-theme/language/codex-harness-desktop/api/` | REQ-I18N-002 | `language.test.js`, `themeLanguage.spec.js` (E2E) |

### command-interface
> CLI 产品入口，统一把业务命令映射到本地 HTTP API。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| cli | `tests/capabilities/command-interface/cli/codex-harness-desktop/cli/`, `tests/capabilities/command-interface/cli/2026-07-29-multi-agent-skills/cli/` | REQ-CLI-001~002 | `cli.test.js`, `skillCli.test.js` |

### agent-dialogue
> 内置对话 agent（PI 运行时 + 飞书入口）：配置、对话空间会话、用户绑定、确认挂起、命令直通、卡片流式。（2026-08-02-builtin-agent 登记）

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| settings | `tests/capabilities/agent-dialogue/settings/2026-08-02-builtin-agent/api/`, `.../e2e/` | REQ-AGENT-001~004, REQ-AGENT-023~025 | `agentConfig.test.js`, `systemPrompt.test.js`, `settingsTabs.spec.js` (E2E) |
| conversation-space | `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/api/` | REQ-AGENT-005~013 | `agentProcess.test.js`, `agentDialogue.test.js`, `sessionStore.test.js`, `toolSurface.test.js` |
| user-binding | `tests/capabilities/agent-dialogue/user-binding/2026-08-02-builtin-agent/api/` | REQ-AGENT-014~015 | `userBinding.test.js` |
| confirmation | `tests/capabilities/agent-dialogue/confirmation/2026-08-02-builtin-agent/api/` | REQ-AGENT-016 | `confirmation.test.js` |
| channel | `tests/capabilities/agent-dialogue/channel/2026-08-02-builtin-agent/api/` | REQ-AGENT-017~022 | `agentRoute.test.js`, `cardStream.test.js`, `slashCommands.test.js` |

## 能力依赖图

```
command-interface ──> workspace-management ──> flow-orchestration ──> scheduling-execution
                                    │                │                      │
                                    ├─> skill-management ───┘               │
                                    │                                       │
                                    ├─> information-aggregation             │
                                    │                                       │
                                    └─> internationalization-theme          │
                                                                            │
channel-integration ──> workspace-management                                │
collection-pipeline ──> scheduling-execution、flow-orchestration、skill-management、channel-integration
```

## 健康指标

| 能力 | 实体数 | 测试数 | 最后更新 |
|------|--------|--------|----------|
| workspace-management | 3 | 58 | 2026-08-01 |
| flow-orchestration | 3 | 58 | 2026-07-28 |
| scheduling-execution | 3 | 16 | 2026-07-19 |
| skill-management | 3 | 122 | 2026-08-01 |
| channel-integration | 1 | 0 | 2026-07-19 |
| collection-pipeline | 3 | 0 | 2026-07-19 |
| information-aggregation | 2 | 7 | 2026-07-19 |
| app-distribution | 1 | 17 | 2026-08-02 |
| internationalization-theme | 2 | 13 | 2026-07-16 |
| command-interface | 1 | 4 | 2026-07-29 |
| agent-dialogue | 5 | 0 | 2026-08-03 |
