# 交接文档 — 2026-08-07-pi-agent-consolidation

> 用途：新会话直接起手。读这份 + `workflow-state.yaml` 即可 `/story` 续跑（phase: THINK → `/demand-insight`）。
> 来源：2026-08-02-ui-copilot（已验收完成）BUG-004 轮保活讨论 + REFLECT 遗留裁决。

## 初衷（痛点，非方案）

PI agent 集成是三次 story 叠加出来的，边角在累积：会话只建不收、日志无界泄漏、全空间混居单子进程、权限双层评估有重复确认角落、worker/桥/策略文件职责交叠——需要一次整体整理与优化，而不是继续贴补丁。

## 议题清单（人裁决转入，全部带实证）

### ① 会话 idle TTL 淘汰 + LRU 上限（方向已初步议定 A+B）

- **实证**：`src/agent/worker.js:56` `sessions = new Map()`（sessionKey → PI AgentSession，对话上下文常驻内存）；释放仅三条路径——同 key 重建（worker.js:508）、出错（:758）、`/reset`（:793）。**无 idle 淘汰、无上限**。
- **增量点**：每飞书 chat（`feishu:<chatId>`）、UI 会话（`ui:copilot:<sid>`）、项目空间会话（`ui:project:<pid>:<sid>`）各持一个；辅助 Map ×3（`toolContexts`/`sessionQueues`/`lastReplies`）随会话涨。
- **方向（已议定，勿重谈）**：idle TTL 淘汰（dispose 出 Map，JSONL 懒恢复——上下文真理源是 JSONL，`SessionManager.open` 可恢复，REQ-AGENT-005 标准 3 已证）+ sessions LRU 容量上限。
- **待访谈拍板**：TTL 值与 idle 定义（最后 prompt 活动？流式中保护？）、LRU 上限值、淘汰时活跃流式会话的保护、恢复延迟容忍度（冷会话首 token 成本）。

### ② 主进程 logs 无界 + ping/pong 日志降噪（方向已议定 D）

- **实证**：`src/services/agentService.js:424` `const logs = []` 无界，`:494` 每行 push，**全代码库无消费者**（http 层无人读）；每 2s 一条 `→ ping`（`logSend`）+ 全部子进程 stderr → ~43,200 条/天纯泄漏。
- **方向（已议定）**：logs 环形上限（如保留最近 N 条）+ ping/pong 不逐条打日志。
- **注意**：ping 心跳本身是 REQ-AGENT-005 签核契约（看门狗），**不是 bug**——只动日志，不动心跳语义。

### ③ 进程隔离模型拍板（用户点名议题，核心待谈）

- **现状**：单子进程托管全部会话（三类空间混居），看门狗 2s 心跳 + 崩溃自动重启 + 重启后按 `agent_sessions` 引用全量恢复（REQ-AGENT-005 / ADR-014 / ADR-015）。
- **待访谈的痛点轴**（demand-insight 第一题已问未答）：单进程崩溃时最不能接受的是 (a) 全空间对话同断（爆炸半径）(b) 内存共池拖累（c) 重启全量恢复变慢？——**(a) 只有分进程能解；(b)(c) idle 淘汰 + 懒恢复即可解**。先答这题再谈方案。
- **取舍面**：隔离性/内存独立回收 vs 进程开销、启动延迟、看门狗语义变化（REQ-AGENT-005 契约影响面）、恢复编排复杂度。

### ④ gotgenes 规则级重复确认去重（REFLECT 裁决转入）

- **实证**：`echo hi > ../out.txt` 类命令同时命中「cwd 外路径 → ask」与「`*>` 重定向模式 → ask」两条规则 → 同一命令出两张确认卡（QA 报告登记"罕见双确认卡，无安全洞"）。
- **约束**：BUG-001/002 已确立「唯一执行者/单一评估」原则（ADR-017 补充、engineering-lessons 2026-08-07）——同一命令同一危险只出一张卡；去重规则要在接缝层写清优先级。
- **相关**：`src/services/permissionPolicy.js` classifyBashToolCall（pre-gate）、`stripRedirectPipeOperators`、WRAPPER_PAYLOAD_RE（#481 例外）。

### ⑤ 整体整理（worker/桥/策略文件职责交叠）

- 三次 story 叠加（builtin-agent → multi-agent-skills → ui-copilot）的零散修补点：依赖声明/策略文件双真源（bash 模式冷路径 `*>` 是后补的）、worker.js 体量、诊断日志散布。整理边界在访谈中收敛。
- 2026-08-07 BUG-002 轮登记的待办：bash 模式双真源补策略文件模式（当时"待做"）。

### ⑥ 转入的 test-gap（本 story 承接补测）

- **T-7**：UI 空间「worker confirm 级工具 → IPC confirm-request → submit」生产全链无端到端用例（Slice 4 对齐 G-1；直桥 submit seam 已覆盖，链路其余为已验收接线）。
- **T-9**：bash pre-gate → 授权桥挂起 → 批准 → 执行的生产全链无端到端用例（BUG-002 回归覆盖了分类与桥分段，未覆盖全链）。

## 硬约束（不可推翻的契约层）

- **REQ-AGENT-005**（已签核）：看门狗心跳/崩溃重启/JSONL 恢复/restarting 错误语义——进程模型讨论若动这些 = REQ 变更，走 req-gap/签核流程。
- **ADR-014**（PI 运行时子进程）、**ADR-015**（心跳控制面带外、任何入站消息计存活）、**ADR-017 + 2026-08-07 补充**（gotgenes+授权桥：唯一执行者/单一评估）。
- 测试纪律：REQ-TRACE / 业务测试只读 / commit 标签（[test]/[build]/[bugfix] 不混）。

## 环境备忘（新会话必读）

- 单测与 E2E 的原生模块 ABI 互斥：跑单测前 `npm run rebuild:node`，跑 E2E 前 `npm run rebuild:electron`（混跑顺序错会 E-DB-UNWRITABLE，**不是产品缺陷**，testing.md 已登记）。
- 单测：`NODE_ENV=test node --test $(find tests/capabilities -type f \( -path '*/api/*.test.js' -o -path '*/cli/*.test.js' \))`（当前全仓 618 例）。
- E2E：`npm run test:e2e`（148 例；flow 域 REQ-FLOW-012/013 有 flaky，全量并行偶发、隔离复跑全绿——与本 story 无关，勿误判）。

## 关键参考

- 教训库：`.aiassist/global/engineering-lessons.md`（2026-08-07 三条新教训：mock 契约假设盲区 / 诊断先行排查法 / 唯一执行者单一询问）
- 权限全景：`.aiassist/global/adr/ADR-017-agent-permission-gotgenes-authorizer-bridge.md`（含 2026-08-07 补充）
- 术语：`.aiassist/global/CONTEXT.md`（对话空间/授权桥/卡片定型）
- 来源 story QA：`.aiassist/stories/2026-08-02-ui-copilot/qa-report.md`（遗留项裁决记录）

## 续跑方式

```
/story   # 读 workflow-state → THINK → /demand-insight
```

demand-insight 从**议题③的痛点轴问题**接着问（第一题已问未答，见上）；①②④⑥ 方向已定，访谈只需拍参数与边界，不要重新访谈已确认事实。
