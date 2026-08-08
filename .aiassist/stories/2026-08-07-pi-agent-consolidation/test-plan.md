# 测试计划 — 2026-08-07-pi-agent-consolidation

> 阶段：TEST（骨架已生成，断言待签）
> 对应：`requirements.md` v1（REQ-AGENT-035~046）
> REQ-VERSION：`v1-hash:2bc5b491ca5f1826acb810baef5baacbdb70e369ddb71546103967c9aeccdf8b`

## 总览

| REQ | 稳定块 | seam 类型 | 测试文件 | capability/entity | 状态 |
|---|---|---|---|---|---|
| REQ-AGENT-035 | B1 idle 淘汰+懒恢复 | 单元+集成 | `conversation-space/.../api/sessionIdleEviction.test.js` | agent-dialogue/conversation-space | 骨架（7 标准） |
| REQ-AGENT-036 | B2 LRU 50 | 单元 | `.../api/sessionLruCap.test.js` | agent-dialogue/conversation-space | 骨架（3 标准） |
| REQ-AGENT-037 | B3 同组单活 | 单元+集成 | `.../api/sessionGroupCooling.test.js` | agent-dialogue/conversation-space | 骨架（5 标准） |
| REQ-AGENT-038 | B12 水合窗口 | 单元+集成 | `.../api/hydrationWindow.test.js` | agent-dialogue/conversation-space | 骨架（5 标准） |
| REQ-AGENT-039 | B4 模块抽取 | 单元+回归 | `.../api/sessionLifecycleModule.test.js` | agent-dialogue/conversation-space | 骨架（3 标准） |
| REQ-AGENT-040 | B5 日志环形 | 单元 | `.../api/agentLogsRing.test.js` | agent-dialogue/conversation-space | 骨架（3 标准） |
| REQ-AGENT-041 | B6 单一真源+配平 | 单元+集成 | `.../api/policyCodegen.test.js` | agent-dialogue/conversation-space | 骨架（6 标准） |
| REQ-AGENT-042 | B7 一令一卡语料 | 单元 | `.../api/permissionCorpus.test.js` | agent-dialogue/conversation-space | 骨架（4 标准） |
| REQ-AGENT-043 | B8 T-7 UI confirm 全链 | E2E | `conversation-space/.../e2e/confirmChainUi.test.cjs` | agent-dialogue/confirmation | 骨架（3 标准） |
| REQ-AGENT-044 | B9 T-9 pre-gate→桥→执行全链 | E2E | `.../e2e/confirmChainBash.test.cjs` | agent-dialogue/confirmation | 骨架（3 标准） |
| REQ-AGENT-045 | B10 ADR-019 | 单元（文档断言）+ manual | `.../api/docAssets.test.js` | agent-dialogue/conversation-space | 骨架（2 标准） |
| REQ-AGENT-046 | B11 术语归位 | 单元（文档断言）+ manual | `.../api/docAssets.test.js`（同文件） | agent-dialogue/conversation-space | 骨架（3 标准） |

## 关键 seam 依赖（待 implementer 提供，骨架已按 tech-design 接口 1/4 声明）

1. **sessionLifecycle 模块**（新）：`createSessionLifecycle({ now?, onEvict?, maxSessions? })` → register/touch/evictGroupPeers/sweep/remove/get/has/size/tombstonedKeys；时钟与回调注入。035/036/037/039 依赖。
2. **groupOf 纯函数**：037 标准 1 语料。落点 sessionLifecycle 或独立模块（骨架注明）。
3. **生成器 CLI**：`node scripts/gen-agent-policy.mjs [--check]`；041 依赖。
4. **policyRules 规则表**：`{pattern, decision, hotPathVisible, family}`；041/042 依赖（评估器消费规则表）。
5. **agentService 水合窗口**：注入 `hydrationWindowMs` + 日志收集 seam；038/040 依赖。
6. **fake worker IPC 捕获**（沿用 ui-copilot workerAssembly 同型 seam）；035 标准 6、038 依赖。

## HTML 原型映射

- 本 story 无新 UX 原型（`ux/` 无新增）。
- T-7/T-9（043/044）映射自既有 `2026-08-02-ui-copilot/ux/assistant.html` 的内联确认卡结构——locator 约定沿用 `assistantConfirm.test.cjs`（`[data-testid*='confirm']` 等），验证既有 UI 的行为链在整理后的新缝上不回归。

## REFLECT 人工验收项（含理由）

| 项 | 自动化 | 人工（REFLECT） | 理由 |
|---|---|---|---|
| 045 ADR-019 内容质量 | 结构断言（存在/关键字面） | 内容评审（理由充分性） | 内容判断非机器可断言；结构已自动化 |
| 046 术语归位内容 | 结构断言（关键字面存在） | 内容评审（表述准确性） | 同上 |
| M1 冷恢复延迟 | — | QA 实测后转观测断言 | 移动块，QA 阶段消化（PRD 已注明） |
| 同组单活误伤观察 | 行为自动化 | 真实使用反馈观察 | 风险表末项，REFLECT 观察 |
| 成功标准 1（24h 内存有界） | QA 脚本模拟 | 实际长跑确认 | QA 观测（PRD 允许脚本模拟替代） |

## 无 `人工(仅视觉)` 项

本 story 无纯审美 REQ；全部 12 REQ 均含自动化验收标准（文档块也有结构断言）。

## 运行方式（ABI 备忘）

- 单测：`npm run test:unit`（先 `rebuild:node`）——覆盖 8 个 api 骨架 + 全仓回归。
- E2E：`npm run test:e2e`（先 `rebuild:electron`）——覆盖 2 个 confirmChain E2E + 全仓 E2E 回归。
- 混跑顺序错 → E-DB-UNWRITABLE（环境 ABI 问题，非产品缺陷，testing.md 已登记）。

## 待签断言清单（门 1 前）

- 全部 11 文件 `ASSERTIONS-SIGNED: false`；每个 `it` 内 `// TODO: HUMAN ASSERTION` 待签：
  - 035：常量 TTL 1h、sweep 60s、onEvict 触发集合、evicted 重投一次、E-AGENT-NO-SESSION 保持
  - 036：LRU 让位日志 E5、尺寸 ≤ 上限
  - 037：groupOf 语料 5 例、copilot 组同规则（无豁免分支）
  - 038：mtime 窗口（新/旧/边界 3 行）、崩溃重启同规则、诊断日志
  - 039：接口方法形态、无副作用断言
  - 040：1000 环形、ping 过滤、心跳语义不变
  - 041：golden 内容（可见族含/不可见族不含）、--check exit 码、ADR-020 关键字面
  - 042：判别表 5 例 + 变种 6 例 + 信任门 + 恰一卡
  - 043/044：E2E 启动 URL/定位/副作用断言（临时目录）
  - 045/046：ADR/CONTEXT 关键字面
