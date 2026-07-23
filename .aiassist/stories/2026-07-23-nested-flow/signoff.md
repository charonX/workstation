# Signoff — 2026-07-23-nested-flow

---

## Stage 1: Assertion Signoff

**签核日期**：2026-07-23
**REQ-VERSION**：v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4

### REQ 覆盖摘要

| REQ | 测试文件 | 类型 | 断言状态 |
|---|---|---|---|
| FLOW-032 flowInput 节点 | subflowNodeTypes.test.js | 单元 | 已签 |
| FLOW-033 flowOutput 节点 | subflowNodeTypes.test.js | 单元 | 已签 |
| FLOW-034 callFlow 字段校验 | callFlowValidation.test.js | API 集成 | 已签 |
| FLOW-035 同步执行与变量隔离 | subflowIsolation.test.js | 单元 | 已签 |
| FLOW-036 startNodeId 多入口 | subflowIsolation.test.js | 单元 | 已签 |
| FLOW-037 失败传播 | subflowFailure.test.js | 单元 | 已签 |
| FLOW-038 循环/深度校验 | circularReference.test.js | API 集成 | 已签 |
| FLOW-039 调最新版本 | nestedExecution.test.js | API 集成 | 骨架（端到端断言待实现落地） |
| FLOW-040 嵌套执行记录 | nestedExecution.test.js | API 集成 | 骨架（端到端断言待实现落地） |
| FLOW-041 候选列表 API | callflowCandidates.test.js | API 集成 | 已签 |
| FLOW-042 executor 签名/多输出 | executorSignature.test.js | 单元 | 已签 |
| FLOW-043 节点面板/配置 UI | subflowConfig.spec.cjs | E2E | 骨架（locator 文案待 UI 落地） |
| FLOW-044 执行详情展开 | nestedExecutionDetail.spec.cjs | E2E | 骨架（locator 文案待 UI 落地） |
| FLOW-045 跳转子流程 | subflowConfig.spec.cjs | E2E | 骨架（locator 文案待 UI 落地） |
| FLOW-046 foreach + callFlow | foreachCallflow.test.js | 单元 | 已签 |

### Capability / Entity 覆盖

- capability：`flow-orchestration`（已登记，无需新增能力）
- entity：`flow`、`flow-engine`、`execution`（均已登记）
- business-capabilities.md 已更新测试路径映射

### 关键断言决策

1. **错误文案/路径**：validateNodeList 返回 details 数组含 `{path, message}`，测试用正则匹配（不硬编码具体文案，i18n 友好）。
2. **flowOutput 出口识别**：通过 nodeRecords 最后一个 flowOutput 类型记录；多出口时取实际跑到的那个。
3. **__childExecutionId**：以 `${callFlowNodeId}.__childExecutionId` 写入父 record.outputVariables，bare key 不写。
4. **循环检测**：单 flow 为根 DFS，不做反向扫描；环闭合时必被抓到。
5. **深度限制**：保存时静态 DFS + 运行时 invokeSubflow 双保险；硬上限 8。
6. **变量隔离**：子流程空 context 起跑；入参映射保留类型（number/object/array 不字符串化）。
7. **多输出机制**：引擎消费 `result.outputVariables`，同时写 `${nodeId}.var` 和 bare `var`（callFlow 的 __childExecutionId 例外）。
8. **顶层向后兼容**：不传 startNodeId/currentDepth/services 时，现有 REQ-FLOW-031 行为不变。

### 剩余 HUMAN ASSERTION 位置（13 处，均为依赖 UI/端到端实现的占位）

- 单元/集成（FLOW-032/033/035/036/037/041/042/046）：断言全部填实，无 TODO
- API 集成 FLOW-039/040（nestedExecution.test.js）：AC4-AC6 端到端依赖 invokeSubflow 落地，骨架已建
- E2E FLOW-043/044/045：locator/i18n 文案/seed helper 待 UI 落地后补

这些 TODO 不阻塞 BUILD——它们是**实现完成后自然转绿**的骨架断言，而非"等人做决定"的开放项。

### 检查清单

- [x] 不存在未关闭的 prd-gap-report.md
- [x] PRD 第 6-8 节（操作流、验证规则、错误状态）已覆盖
- [x] 每个 REQ-ID 至少一个测试文件
- [x] 每个测试文件含 REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE
- [x] capability/entity 与 business-capabilities.md 一致
- [x] 无快照当判定依据
- [x] 边界/错误 case 覆盖（AC 各错误码、循环、深度、类型保留、未达出口）
- [ ] 全部预期值被人审阅（人审阅本文件即完成）

### 人签核

**断言归人**：我已审阅测试骨架、断言、接口契约，承诺以上预期值即为"做对"的定义。

签名：____________________（人填写）
日期：____________________
