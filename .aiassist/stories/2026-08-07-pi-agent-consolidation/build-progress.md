# Build Progress — 2026-08-07-pi-agent-consolidation

> 阶段：BUILD（门 1 已签核，005049c）
> REQ：REQ-AGENT-035~046（requirements v1，hash 2bc5b491）
> 测试契约：11 文件 44 用例（已签核，实现者只读）

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-040 | 日志环形 1000 + ping/pong 降噪（agentService 局部） | — | pending |
| 2 | REQ-AGENT-035/036/037/039 | sessionLifecycle 模块（抽取+TLL/LRU/组冷却+tombstone/evicted worker 侧） | — | pending |
| 3 | REQ-AGENT-038 | 水合窗口规则化（agentService 面，含 035 主进程集成面） | 2 | pending |
| 4 | REQ-AGENT-041/042 | 权限缝（policyRules+生成器+配平+语料矩阵） | — | pending |
| 5 | REQ-AGENT-045/046 | 文档（ADR-019/020 + CONTEXT 术语归位） | — | pending |
| 6 | REQ-AGENT-043/044 | E2E T-7/T-9 全链（真实 Electron） | 2,4 | pending |

## 关键 seam 契约速记（供子代理简报引用）

- sessionLifecycle（tech-design 接口 1）：`createSessionLifecycle({ now?, onEvict?, maxSessions?, onWarn? })` → register/touch/evictGroupPeers/sweep/remove/get/has/size/tombstonedKeys；淘汰副作用经 onEvict 回调（worker 注入）；groupOf 纯函数。
- IPC `session-evicted`（接口 2）：`{ type:"session-evicted", sessionKey }`；主进程丢句柄、store 行保留。
- prompt 竞态（接口 3）：tombstoned key → `session-error {code:"evicted"}` → 主进程重发 config + 重投一次；非 tombstone → E-AGENT-NO-SESSION。
- 生成器 CLI（接口 4）：`node scripts/gen-agent-policy.mjs [--check]`；golden `agent-policy/pi-permission-config.json`。
- 规则表（接口 5）：`{ pattern, decision, hotPathVisible, family }`；评估器与生成器共同消费。
- 水合窗口：JSONL mtime ≤ 60min 的行水合（启动/崩溃重启同规则）。

## Slice 记录

### Slice 1：REQ-AGENT-040 日志环形 + 心跳降噪（2026-08-08）

**实现文件**（仅此一处，Rule 0.5 范围纪律）：

- `src/services/agentService.js`：
  - `DEFAULT_LOG_RING_LIMIT = 1000`（导出，供测试注入共享；D7 拍板）+ `isHeartbeatMessageType()`（导出判别）；
  - `options.logRingLimit`（可注入环形上界，测试 seam）+ `options.logSink`（行收集器注入，test-plan B5 seam）+ `service.log`（直调注入 seam，标准 1「注入 1000+N 条」能力）；
  - `log()`：环形有界——满 1000 时 shift 覆盖最旧，恒保留最新尾部；
  - `logSend()`：ping/pong 类型跳过入 `logs[]`（仅日志面过滤，传输路径不变）；`pong` 收包分支仅注释说明（原就无日志，存活判定原样）。

**测试命令与输出摘要**（先 `npm run rebuild:node`）：

| 命令 | 结果 |
|---|---|
| `NODE_ENV=test node --test tests/.../2026-08-07-pi-agent-consolidation/api/agentLogsRing.test.js` | 3/3 pass（标准 1/2/3） |
| 回归：`agentHeartbeatBusy.test.js` + `agentProcess.test.js` + `sessionRestore.test.js`（2026-08-02-builtin-agent） | 8/8 pass（BUG-008 长生成 1/1、REQ-AGENT-005 5/5、REQ-AGENT-009 2/2） |
| 全 `2026-08-02-builtin-agent/api` 回归（33 用例 13 suites） | 33/33 pass |
| 实测（真实子进程，7s ≈ 3+ 心跳周期） | logs 无 `→ ping`/`→ pong` 行；无「心跳超时」误判；`isAlive()` 正常（心跳语义不变） |
| 实测（ring sanity） | 注入 1025 条 → `logs.length===1000`、首条=第 26 条、末条=第 1025 条；`logRingLimit=5` 缩小注入 8 条 → 保留最新 5 条 |

**预期红（本 story 其他切片，seam 未就绪，不实现）**：`sessionLifecycleModule.test.js`（REQ-AGENT-039）、`sessionIdleEviction.test.js`（REQ-AGENT-035）及 036/037/038/041/042/045/046 同型——依赖 Slice 2（sessionLifecycle 模块）与 Slice 4（权限缝）seam。

**PRD→代码 可追溯性表**：

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| B5 稳定块：`logs[]` 环形 1000 条（超界覆盖最旧）；ping/pong 心跳不逐条入日志（看门狗心跳语义不动） | `src/services/agentService.js`（log 环形 + logSend/pong 过滤 + 常量导出） | `.../agentLogsRing.test.js`（REQ-AGENT-040 标准 1/2） | COVERED |
| F5 步骤 1：长跑（含 2s 心跳常态）→ `logs[]` 恒 ≤1000（覆盖最旧）；ping/pong 不逐条入日志；锚点=内存有界、日志无心跳噪音 | 同上（log() 满 1000 shift + 心跳类型过滤） | `agentLogsRing.test.js` 标准 1（长度/首尾断言）+ 标准 2（心跳过滤）；实测 7s 真实进程无心跳行 | COVERED |
| F5 步骤 2：崩溃后能看到出事前最近现场（非心跳刷屏）→ 诊断窗口可用 | 同上（环形保留最新 1000 条 + 心跳降噪） | `agentLogsRing.test.js` 标准 1（保留最新尾部语义）+ 既有 `agentProcess.test.js` 看门狗/重启日志回归 | COVERED |
| §8 E6 看门狗心跳异常（非本 story 变更面）：心跳/重启语义沿用 REQ-AGENT-005，本 story 只动日志不动心跳 | `agentService.js` 心跳路径零改动（sendPing 2s、pong 入站计存活原样；仅日志面过滤） | `agentHeartbeatBusy.test.js`、`agentProcess.test.js` 不修改全绿（回归）+ 实测存活判定 | COVERED |
| §8 E1/E2/E5（会话生命周期错误状态）、E3/E4（权限缝错误状态） | 非本 slice 范围 | 归 Slice 2（sessionLifecycle）/ Slice 4（权限缝）承担 | 非本 slice（对应切片跟踪） |

**refactor 结果**：无（本 slice 改动仅 31 行增 1 行删，单文件局部；未触发 refactor 轮）

---

## 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-08-08 | 初始化：切片规划 + seam 速记 |
