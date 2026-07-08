# Signoff: OPC Workstation Desktop App

> story: `codex-harness-desktop`
> workflow: `loop-workflow`
> attempt: 2
> requirements-v1.hash: `71624856165d7ccd8e88041a8f92ec3a2c552457e9e514f29ef3eb747ccf1685`

---

## Assertion Signoff

### 检查清单

- [x] 每个 REQ-ID 都有对应测试或 feel-signoff 映射。
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`。
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致。
- [x] 无 `// TODO: HUMAN ASSERTION` 占位。
- [x] 预期值来源清晰（来自 PRD/REQ / 本次 assertion 访谈确认，非代码输出）。
- [x] 无快照当判定依据。
- [x] 边界/错误 case 已覆盖（空值、必填校验、非法表达式、循环保护、关联幂等）。
- [x] `signoff.md` Assertion 部分已创建。

### REQ 覆盖

| REQ-ID | Capability / Entity | 测试文件 | 关键断言 |
|---|---|---|---|
| REQ-WORKSPACE-001 | workspace-management / settings | `settings.test.js` | Workspace Root 持久化、空值校验 |
| REQ-WORKSPACE-002 | workspace-management / settings | `settings.test.js` | Skill Repository Path 持久化 |
| REQ-WORKSPACE-003 | workspace-management / project | `project.test.js` | 本地项目创建、name 必填 |
| REQ-WORKSPACE-004 | workspace-management / project | `project.test.js` | Git 项目创建、URL 必填、默认 branch main |
| REQ-WORKSPACE-005 | workspace-management / project | `project.test.js` | 名称过滤（大小写不敏感）、空过滤 |
| REQ-WORKSPACE-006 | workspace-management / project | `project.test.js` | Project Detail Overview/Skills Tab、skill 关联幂等 |
| REQ-WORKSPACE-007 | workspace-management / settings | `settings.test.js` | 密度偏好持久化（compact / comfortable），默认 comfortable |
| REQ-FLOW-001 | flow-orchestration / flow | `flow.test.js` | Flow 列表含 project/node count/scheduleEnabled |
| REQ-FLOW-002 | flow-orchestration / flow | `flow.test.js` | 创建 Flow、name/project 必填 |
| REQ-FLOW-003 | flow-orchestration / flow | feel-signoff (UX 原型) | Node Palette 分类、画布渲染 |
| REQ-FLOW-004 | flow-orchestration / flow | feel-signoff (UX 原型) | Agent 节点暴露 model/systemPrompt |
| REQ-FLOW-005 | flow-orchestration / flow | feel-signoff (UX 原型) | Run 状态切换、Zoom 控制 |
| REQ-FLOW-006 | flow-orchestration / flow | `flow.test.js` | Flow JSON import/export |
| REQ-FLOW-007 | flow-orchestration / flow-engine | `flowEngine.test.js` | Condition true/false 分支、非法表达式 fatal |
| REQ-FLOW-008 | flow-orchestration / flow-engine | `flowEngine.test.js` | ForEach 遍历数组 |
| REQ-FLOW-009 | flow-orchestration / flow-engine | `flowEngine.test.js` | While 循环 |
| REQ-FLOW-010 | flow-orchestration / flow-engine | `flowEngine.test.js` | maxIterations / maxDepth 循环保护 |
| REQ-SCHEDULE-001 | scheduling-execution / task | `task.test.js` | 手动任务创建、完成状态 |
| REQ-SCHEDULE-002 | scheduling-execution / schedule | `schedule.test.js` | Schedule 创建/启用停用/cron 描述/必填校验 |
| REQ-SCHEDULE-003 | scheduling-execution / task | `task.test.js` | 执行历史倒序、Logs/Variables/Output、分支路径/迭代 |
| REQ-SKILL-001 | skill-management / skill | `skill.test.js` | Skill 列表无 Linked Projects、含 category |
| REQ-SKILL-002 | skill-management / skill | `skill.test.js` | Skill Detail Overview/Parameters/Examples/README、无项目链接 |
| REQ-SKILL-003 | skill-management / skill | `skill.test.js` | npm/npx、Claude Plugin、Local Files 安装 |
| REQ-DASH-001 | information-aggregation / dashboard | `dashboard.test.js` | 指标卡片、最近执行、快捷项目入口 |
| REQ-I18N-001 | internationalization-theme / theme | `theme.test.js` + feel-signoff | dark/light 切换与持久化 |
| REQ-I18N-002 | internationalization-theme / language | `language.test.js` | 语言偏好持久化（zh-CN / en-US），默认 en-US |
| REQ-CLI-001 | command-interface / cli | `cli.test.js` | CLI 入口、`--help`、`--pretty`、退出码 |

### Capability / Entity 覆盖摘要

| Capability | Entities | 测试数 |
|---|---|---|
| workspace-management | settings, project | 17 |
| flow-orchestration | flow, flow-engine | 14 |
| scheduling-execution | task, schedule | 11 |
| skill-management | skill | 7 |
| information-aggregation | dashboard | 4 |
| internationalization-theme | language, theme | 5 |
| command-interface | cli | 3 |

### 本次 assertion 访谈确认的关键预期值

- 语言代码：`zh-CN`（中文）、`en-US`（英文）；默认 `en-US`。
- 显示密度：`compact` / `comfortable`；默认 `comfortable`。
- Dashboard 成功率：0~1 数字。
- Skill 详情 Tab：`["Overview", "Parameters", "Examples", "README"]`。
- Project Detail 计数字段：`flowsCount`、`runsCount`。
- CLI 退出码：`0` 成功，`1` 业务错误，`2` 系统错误。
- HTTP 错误体：`{error, message}`，配合标准 HTTP 状态码。
- Flow JSON 格式包含：`id`、`projectId`、`name`、`description`、`nodes`、`edges`、`scheduleEnabled`、`updatedAt`。

### 当前测试运行状态

```
npm test: 61 tests / 3 passed / 58 failed
```

58 个失败是**预期的红色契约**，对应实现层尚未补全的 seams，不构成 assertion signoff 的阻塞。

Assertion signoff 通过后，这些失败将交由 BUILD 阶段实现者逐一变绿。

---

## Feel Signoff

> 待 BUILD 与 QA 完成后，依据 `.aiassist/stories/codex-harness-desktop/ux/*.html` 与已实现产品进行观感签核。

- [ ] 产品在目标环境启动无崩溃。
- [ ] 关键用户流程可走完。
- [ ] `preview.html` 已生成且能正常渲染。
- [ ] `_d_meta.json` 中所有 asset 状态已确认（needs-review → approved/changes-requested）。
- [ ] 视觉层面对照 HTML UX 参照：结构、元素顺序、颜色、排版、间距、动效。
- [ ] 无系统错误弹窗 / 空白页。
- [ ] 降级/错误状态表达温和、不焦虑。
- [ ] implementer 报告的偏差已被确认。
