# Test Plan — 2026-07-16-flow-refinement

> 生成阶段：TEST
> 来源：`.aiassist/stories/2026-07-16-flow-refinement/requirements.md`
> 测试目录：`tests/capabilities/flow-orchestration/`

## 总览

本 story 共 11 条 REQ，全部映射到 `flow-orchestration` 能力，涉及 `flow`、`flow-engine`、`execution` 三个实体。测试按 capability/entity 组织，共生成 13 个测试文件。

## REQ 覆盖矩阵

| REQ-ID | capability | entity | 测试类型 | 测试文件 | 备注 |
|---|---|---|---|---|---|
| REQ-FLOW-018 | flow-orchestration | flow | API + E2E | `flow/2026-07-16-flow-refinement/api/triggerConfig.test.js`<br>`flow/2026-07-16-flow-refinement/e2e/triggerConfig.test.cjs` | Trigger 变量声明 |
| REQ-FLOW-019 | flow-orchestration | flow | API + E2E | `flow/2026-07-16-flow-refinement/api/conditionConfig.test.js`<br>`flow/2026-07-16-flow-refinement/e2e/conditionConfig.test.cjs` | Condition 表达式与分支标识 |
| REQ-FLOW-020 | flow-orchestration | flow | API + E2E | `flow/2026-07-16-flow-refinement/api/agentConfig.test.js`<br>`flow/2026-07-16-flow-refinement/e2e/agentConfig.test.cjs` | Claude Agent 配置面板 |
| REQ-FLOW-020 | flow-orchestration | flow-engine | 集成 | `flow-engine/2026-07-16-flow-refinement/api/claudeAgentAdapter.test.js` | adapter 集成测试（mock SDK） |
| REQ-FLOW-021 | flow-orchestration | flow | E2E | `flow/2026-07-16-flow-refinement/e2e/nodeErrorHandling.test.cjs` | 节点错误处理配置 |
| REQ-FLOW-022 | flow-orchestration | flow | E2E | `flow/2026-07-16-flow-refinement/e2e/variablePicker.test.cjs` | 变量选择器分组展示 |
| REQ-FLOW-023 | flow-orchestration | flow-engine | API | `flow-engine/2026-07-16-flow-refinement/api/variableRegistry.test.js` | FlowEngine 变量注册表 |
| REQ-FLOW-024 | flow-orchestration | flow-engine | API | `flow-engine/2026-07-16-flow-refinement/api/variableSubstitution.test.js` | 变量替换机制 |
| REQ-FLOW-025 | flow-orchestration | flow-engine | API | `flow-engine/2026-07-16-flow-refinement/api/errorHandling.test.js` | 节点错误处理执行 |
| REQ-FLOW-026 | flow-orchestration | flow-engine | API + E2E | `flow-engine/2026-07-16-flow-refinement/api/danglingReference.test.js`<br>`flow/2026-07-16-flow-refinement/e2e/danglingReference.test.cjs` | 悬空引用行为 |
| REQ-FLOW-027 | flow-orchestration | flow-engine | API | `flow-engine/2026-07-16-flow-refinement/api/projectPathInjection.test.js` | 工作目录注入 |
| REQ-FLOW-028 | flow-orchestration | execution | API + E2E | `execution/2026-07-16-flow-refinement/api/executionLog.test.js`<br>`execution/2026-07-16-flow-refinement/e2e/executionLog.test.cjs` | 执行日志持久化与清理 |

## 测试目录结构

```
tests/capabilities/flow-orchestration/
├── flow/2026-07-16-flow-refinement/
│   ├── api/
│   │   ├── triggerConfig.test.js
│   │   ├── conditionConfig.test.js
│   │   └── agentConfig.test.js
│   └── e2e/
│       ├── triggerConfig.test.cjs
│       ├── conditionConfig.test.cjs
│       ├── agentConfig.test.cjs
│       ├── nodeErrorHandling.test.cjs
│       ├── variablePicker.test.cjs
│       └── danglingReference.test.cjs
├── flow-engine/2026-07-16-flow-refinement/
│   └── api/
│       ├── variableRegistry.test.js
│       ├── variableSubstitution.test.js
│       ├── errorHandling.test.js
│       ├── danglingReference.test.js
│       ├── projectPathInjection.test.js
│       └── claudeAgentAdapter.test.js
└── execution/2026-07-16-flow-refinement/
    ├── api/
    │   └── executionLog.test.js
    └── e2e/
        └── executionLog.test.cjs
```

## 测试头部规范

所有测试文件头部必须包含：

```js
// REQ-TRACE: REQ-FLOW-XXX
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow | flow-engine | execution
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
```

## 待签核断言（TODO: HUMAN ASSERTION）

以下测试包含 `// TODO: HUMAN ASSERTION` 占位符，等待用户在 assertion-signoff 阶段签核：

1. **triggerConfig.test.js**：变量名/类型/重复名称的校验方式（异常 vs 400）。
2. **conditionConfig.test.js**：空表达式校验方式；变量引用格式（`n1.result` vs `{{n1.result}}`）。
3. **agentConfig.test.js**：adapter 接口签名；prompt 变量插入格式。
4. **variableRegistry.test.js**：Trigger 变量暴露方式；mock adapter 注入方式；同名变量隔离；注册表隔离。
5. **variableSubstitution.test.js**：mock adapter 捕获替换后 prompt 的方式；undefined 比较结果。
6. **errorHandling.test.js**：mock adapter 返回 error/fatal 的方式；重试次数验证；onError=ignore 时下游执行验证。
7. **danglingReference.test.js**：undefined 类型判断是否导致 true 分支。
8. **projectPathInjection.test.js**：mock adapter 验证 projectPath 的方式；路径不存在时的错误返回。
9. **executionLog.test.js**：执行记录表结构；agent 调用详情字段；清理逻辑实现方式。
10. **claudeAgentAdapter.test.js**：mock SDK 的创建方式；统一输入到 SDK 参数的映射验证。
11. **所有 E2E 测试**：页面 URL、元素定位器、错误提示文案、默认值、变量选择器交互细节。

## 纯审美判断（REFLECT 人工验收）

以下项不进入自动化测试，在 REFLECT 阶段人工验收：

- 变量选择器的分组样式、图标、颜色是否符合设计系统。
- Condition 节点 true/false 端口标签的视觉呈现。
- 节点配置面板的整体布局密度与交互手感。

## 依赖与前置条件

- 需要 `tech-design.md` 明确 Claude Agent adapter 的具体 provider/SDK 选择（当前测试用 mock/stub 隔离）。
- 需要 `tech-design.md` 明确执行日志清理逻辑的实现方式（启动时清理 / 后台定时清理 / 每次执行后触发）。
- E2E 测试需要 Flow Editor 前端组件已存在，或提供可运行的 stub 页面。
- API 测试需要 `flowService`、`projectService`、`taskService` 已支持新节点配置字段的持久化。

## 下一步

1. 用户签核断言（`/signoff --stage=assertion`）。
2. 实现者按测试契约实现代码（`/implementer`）。
3. QA 运行测试并收集证据（`/qa-runner`）。
