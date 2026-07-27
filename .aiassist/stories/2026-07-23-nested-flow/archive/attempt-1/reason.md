# 回流原因 — Attempt 1

## 触发时间
2026-07-27

## 根因层
TECH-DESIGN（技术方案层）

## 回流原因
BUG-001 修复过程中发现：`src/renderer/components/flow/upstreamVariables.js` 对每种新节点类型都需要硬编码分支来暴露输出变量，setVariables 节点因此遗漏。

用户决定将问题升级为通用机制：强制所有节点类型统一使用 `config.outputVariables` 作为唯一输出变量声明位置，移除/合并 `agent.outputVariable`、`callFlow.outputMappings`、`setVariables.assignments` 等异构字段。

该决策推翻了 Attempt 1 的技术方案（D11 中 setVariables 使用 `assignments`、callFlow 使用 `outputMappings`），因此回流到 TECH-DESIGN 重新设计。

## 初衷是否变化
未变化。Story 初衷仍是：为 flow 引擎增加子流程同步调用能力，把通用逻辑封装为可复用流程模块。

## 被推翻的承诺层产物
- `tech-design.md` v0.2（含 D10/D11 设计：多输出机制、setVariables.assignments、callFlow.outputMappings）
- `requirements.md` v1.1（含 REQ-FLOW-047 setVariables 基于 assignments 的验收标准）
- `signoff.md` 中的断言签核（基于旧契约）

## 下一步
进入 TECH-DESIGN Attempt 2，输出新的技术方案：
1. 统一节点输出模型：`config.outputVariables` 为所有节点类型的唯一输出声明。
2. 数据迁移策略：启动时把旧字段（agent.outputVariable、callFlow.outputMappings、setVariables.assignments）迁移到 outputVariables。
3. 更新 ADR-008 或新增 ADR，记录统一输出模型决策。
4. 重新结晶 REQ-FLOW-032 ~ 047，确保测试契约与新模型一致。
