# Review 报告 — 嵌套子流程调用 / tech

> 故事 ID：`2026-07-23-nested-flow`
> 审查阶段：`tech`
> 日期：2026-07-23

---

## 审查摘要

- **总体结果**：**WARN**
- **阻塞项数量**：0
- **警告项数量**：4（1 个重要，3 个建议）

审查基于：prd.md v0.1、tech-design.md v0.1、ADR-008、全局 CONTEXT.md、STANDARDS.md、实际代码（flowEngine.js / taskService.js / flowService.js / db.js / feishuSendExecutor.js / triggerExecutor.js）。

方案整体清晰、模块边界干净、ADR-008 决策（services 注入 + 内联递归）符合现有架构，测试 seams 覆盖全部 11 个稳定块。有 1 个**重要**但不阻塞的设计缺口（多输出节点语义未明确），和 3 个建议项。

---

## 审查项

| 维度 | 结果 | 说明 |
|---|---|---|
| 对齐 PRD | PASS | tech-design 模块/数据流覆盖全部 11 个稳定块；每个稳定块都有对应模块和测试 seam |
| 模块边界 | PASS | 13 个模块职责单一，引擎对节点类型无感知，符合现有 executor 插件模式；services 注入解耦了引擎和持久化 |
| 接口契约 | WARN | 4 个接口契约基本完整（in/out/err/副作用四要素齐全），但「多输出节点写入 context」的机制未规定（见警告项 W1） |
| 测试 seams | PASS | 每个稳定块对应清晰 seam；引擎层 `flowEngine.run()` + 服务层 validateSubflowCalls + API/CLI + E2E 分层合理；stub invokeSubflow 测同步逻辑很干净 |
| 复杂度 | PASS | 无过度设计：一期不做版本绑定/try-catch/异步/类型系统，决策有依据；8 层上限 + 双保险（保存+运行时）合理 |
| 风险与回流点 | PASS | 7 个假设全部列出，每个都标了回流层和可否 spike 验证；"applyTriggerVariableOverrides 改动破坏 REQ-FLOW-031"这个最大风险点明确点名 |
| ADR 覆盖 | PASS | D1-D4 写入 ADR-008；D5-D9 不够难逆转/纯实现细节，不需要独立 ADR |
| ADR 冲突 | PASS | 与 ADR-001（本地 HTTP API）、ADR-006（单 server + 统一存储）、ADR-007（飞书通道）无冲突；services 注入与现有 agentExecutor 通过 options.executors 注入的模式一致 |
| 术语一致性 | WARN | trigger="subflow" 是新增触发来源值，CONTEXT.md 里"触发来源"枚举（手动/调试/schedule/通道）未包含它（见建议项 S2）；其余术语（Flow、Execution、通道绑定）一致 |
| 标准/约定 | PASS | DB 命名/REST 风格/服务层 camelCase 均符合 CONTEXT 命名约定；migration 非破坏性（加字段 NULL/DEFAULT，老数据无需回填） |

---

## 警告项（建议但不阻塞）

### W1（重要）：多输出节点如何写入 context 的机制未明确

- **问题**：flowOutput 节点要"返回"多个命名值（savedUrl、title），callFlow 节点要把多个子出参写进父 context。但当前 flowEngine 的写入机制只支持**单输出 per 节点**——`flowEngine.js:152-158` 仅读 `node.config.outputVariable`（单数）+ `result.output`，写一个 fullName。
  - feishuSendExecutor 返回了 `result.outputVariables` 但**引擎完全没消费这个字段**（grep `outputVariables` in flowEngine.js 确认：只有 line 158 写 record、line 204 读 node.config）。feishuSend 的 outputVariables 是死代码。
  - tech-design 在两处提到多输出（flowOutput "把 config.outputVariables 声明的变量写进 context"、callFlow "按 outputMappings 写父 context"），但没有说**怎么写**：是 executor 直接 mutate context（绕过 record.outputVariables 跟踪）？还是引擎扩展为消费 `result.outputVariables` 映射？还是其他？
  - invokeSubflow 事后从 nodeRecords 扫 flowOutput.outputVariables 的逻辑也依赖这些值正确出现在 nodeRecord 里——如果 flowOutputExecutor 不通过引擎标准路径写，`record.outputVariables` 是空的，扫不到。

- **建议**：明确引擎扩展一条规则——executor 可返回 `result.outputVariables: Record<string, unknown>`（key 是 bare varName），引擎在写 `result.output`（单变量）后，再把 `result.outputVariables` 的每个 key 写成 `${nodeId}.${key}` 和 bare `${key}` 到 context 和 record.outputVariables。这样：
  1. 顺势让 feishuSend 的死代码活过来（向后兼容）
  2. flowOutputExecutor 返回 `{status:"success", outputVariables: {savedUrl: ..., title: ...}}`，引擎自动写 context
  3. callFlowExecutor 返回 `{status:"success", outputVariables: childOutputs}`，引擎自动按 outputMappings 或 childVar 名写父 context
  - 这样 invokeSubflow 从 nodeRecord 扫 flowOutput 的 outputVariables 就是可靠的。
- **建议动作**：在 tech-design 第 10 节实现决策或接口契约补一段「多输出节点」说明；不需要回流，实现时按上述约定执行即可。

### S1（建议）：callFlow 写 legacy 裸 key 会覆盖父 flow 已有变量

- **问题**：tech-design 场景 2 第 5 步提到"legacy 裸 key 也写一份 childVar → childOutputs[childVar]"。如果父 flow 有 feishuMessage 节点提供裸 `text`，callFlow 子出参也叫 `text`，会覆盖。这和现有单 outputVariable 节点的行为一致（line 157 也写裸 key），但 callFlow 多输出放大了冲突面。
- **建议**：callFlow 节点可考虑**只写 fullName**（`${callFlowNodeId}.savedUrl`），不写裸 key。用户在子 flow 里已经要显式声明变量名、父 flow 里要显式映射，强制用 fullName 引用（`{{n5.savedUrl}}`）是合理约束，避免命名空间污染。或者：outputMappings 让用户显式选父侧 key 名，而不是自动裸名外泄。一期最小改动：不写裸 key，看用户反馈再加。
- **建议动作**：tech-design 范围外加个注记，实现时 callFlowExecutor 只写 namespaced key。

### S2（建议）：trigger="subflow" 新枚举值需要登记到 CONTEXT.md

- **问题**：executions.trigger 字段现有值为 manual/schedule/channel（CONTEXT.md），本次新增 "subflow"。术语表没同步。
- **建议**：crystallize 阶段（或 domain-model 阶段）更新 CONTEXT.md "触发来源"行，加上 subflow（"被父 flow 通过 callFlow 节点调用启动"）。

### S3（建议）：orphaned subflow 引用的运行时行为可记录为已知限制

- **问题**：如果 flow A callFlow → B，用户编辑 B 删掉 flowInput 节点，A 的保存配置就失效了。现在只有运行时 E-FLOW-NO-INPUT 报错。反向校验（改 B 时扫描所有引用 B 的 flow）一期不做没问题，但 tech-design 没明说"这是已知限制"。
- **建议**：在 tech-design 范围外或风险节里加一句「子 flow 被改坏（删 flowInput、改 flowInput 的 var 名）不会反向校验引用方；运行时父 flow 触发时 E-FLOW-NO-INPUT / E-CALLFLOW-MAP-MISSING 报错」。

---

## 已验证的积极点

1. **现有 testAgentExecutor 注入机制不受影响**：executors merge 逻辑 `{...defaultExecutors, ...flowOrConfig.executors, ...options.executors}` 和 services 字段正交，grep 确认无冲突。
2. **channelReply 跨 flow 显式映射方案可行**：flowInput 声明 channelReply 作为入参 → seedTriggerVariables 播种 bare `channelReply` → applyTriggerVariableOverrides 用父映射覆盖 → 子 flow 内 feishuSend 读 `context.channelReply` 正常工作。不需要特殊处理。
3. **DFS 环检测正确**：以保存时 flow 为根 DFS targetFlowId 链路，环在闭合时必抓到；入口选择不影响环检测（因为子 flow 整体加载，任一内部 callFlow 都在图里）。
4. **depth/startNodeId 改动对现有测试影响可控**：顶层 run 不传 startNodeId 时走现有逻辑；currentDepth 是新参数，现有 executor 忽略即可；maxDepth（per-run edge 遍历上限）在父子 run 之间独立计数，子 flow 从 0 开始是正确的——澄清一下：现有 maxDepth:100 不是"循环深度"，是"边遍历总数上限"（每跨一条边就 +1，看 flowEngine.js:173/183），tech-design 里那句"现有 maxDepth:100 针对 while/foreach 循环"不准确，但不影响方案正确性（子 run 独立计数器是对的）。

---

## 结论

- [x] **可进入下一阶段**（WARN 不阻塞）
- [ ] 需修复阻塞项后重审
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `BUILD`

W1 建议在进入 `/crystallize` 前补进 tech-design 第 10 节（引擎消费 `result.outputVariables`），但不改变任何稳定块或接口语义，是实现层明确化，不是回流。S1-S3 是锦上添花，实现阶段顺手做即可。

---

## 审查人决策记录

**决策**：（人填写）

**理由**：

**下一步动作**：
