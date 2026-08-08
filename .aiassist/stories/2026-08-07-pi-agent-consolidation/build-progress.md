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

### Slice 2：REQ-AGENT-035/036/037/039 sessionLifecycle 模块（2026-08-08）

**实现文件**（Rule 0.5 范围纪律：只加模块 + worker 委托点，不重构 worker 其他部分）：

- `src/agent/sessionLifecycle.js`（新增，tech-design 接口 1）：
  - `createSessionLifecycle({ now?, onEvict?, maxSessions?, onWarn? })` → register/touch/evictGroupPeers/sweep/remove/get/has/size/tombstonedKeys（+worker 内部用 entries/maxSessions 公开属性）；
  - `groupOf(spaceKey)` 纯函数（ADR-016 语法：feishu→自身；ui:copilot:*→"ui:copilot"；ui:project:<pid>:*→"ui:project:<pid>"；畸形→自身不抛错）；
  - 三触发淘汰：TTL 1h（sweep 60s 周期语义，时钟注入）/ LRU 50（注册时淘汰最久未活动非流式，候选全豁免 → E5 让位 + onWarn）/ 同组单活（evictGroupPeers 冷却同组非流式，流式中 → pendingEvictions 延迟，sweep 流结束立即淘汰不等 TTL）；
  - 流式/队列豁免（entry.streaming/queued 活读）；tombstone 内部记录（register/remove 清除）；模块零自身副作用（dispose/通知经 onEvict 回调）；
  - TTL 保护窗口实现注解：`age > TTL 且自上次 sweep 无 touch`（lastTouchAt < previousSweepTime）——生产 60s sweep 下与「age > TTL 即汰」等价（活动周期内 age < 60s ≪ TTL），仅对延迟大间隔 sweep 给「最近活动过」宽容，满足 035 标准 1 签核断言（被 touch 者保留、仅未活动者被汰）；
  - 幂等（重复淘汰 no-op）+ 未知 key 的 touch/evictGroupPeers 静默 no-op（消息乱序容忍）。
- `src/agent/worker.js`（委托点）：
  - sessions Map 移除，存取改经 lifecycle（get/has/register/remove/entries）；`handleSessionConfig` 顶部 evictGroupPeers（session-config 到达=活动，B3 冷却）；`createSessionEntry` 注册改 `lifecycle.register`；`handlePrompt`/`handleNotifyResult` 到达 touch + evictGroupPeers，处理期 `entry.queued/streaming` 标记（finally 复位，流结束回归候选）；`forwardEvent` 流式/工具事件 touch；`/reset` 走 lifecycle.remove（不触发 onEvict）；shutdownAll 经 lifecycle.entries；
  - onEvict 回调：dispose + 辅助 Map×3（toolContexts/sessionQueues/lastReplies）清理 + 发 `session-evicted` IPC（接口 2）+ 诊断日志；**keySecrets/confirmAcks/permissionDecisions 不随淘汰清理**（035 标准 2/7）；
  - 60s sweep 定时器（unref 不阻塞退出）。
- `scripts/session-lifecycle-seam.mjs`（新增）+ `package.json`（test:unit 加 `--import`）：4 个签核测试文件以裸全局引用 `createSessionLifecycle/groupOf`（测试只读不可 import），经 node --import 预载注入（node --test 子进程继承 execArgv；生产零影响）。

**测试命令与输出摘要**（先 `npm run rebuild:node`）：

| 命令 | 结果 |
|---|---|
| 4 slice 文件（`NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test <sessionLifecycleModule\|sessionIdleEviction\|sessionLruCap\|sessionGroupCooling>.test.js`） | 19/19 pass（039 标准1/2；035 标准1a/1b/3 真实断言 + 标准2/4/5/6/7 注释占位 pass；036 标准1/2/3；037 标准1-5） |
| 回归 `2026-08-02-builtin-agent/api` 全量（33 用例 13 suites） | 33/33 pass |
| 回归 ui-copilot 4 文件（workerAssembly/sessionEvents/sessionReset/sessionMessage） | 27/27 pass |
| 回归 `2026-08-02-ui-copilot/api` 全量（80 用例） | 80/80 pass |
| 全量单元（`test:unit` 同形命令，661 tests） | 657 pass / 4 fail——仅 `docAssets.test.js`（REQ-AGENT-045/046 ADR-019+CONTEXT 术语，Slice 5 文档 seam 未就绪，预期红） |
| 冒烟实测（真实 worker + FAUX）：同组双会话 → 后注册冷却先注册（会话淘汰日志 + session-evicted IPC，主进程未接默认分支容忍不崩）；被汰 key 重发 session-config（懒恢复链路）→ register 清 tombstone → prompt 恢复 OK；反向冷却 OK | 4/4 通过 |
| `npm run lint` | 新文件/改动文件零告警（存量告警不属本 slice） |

**预期红（本 story 其他切片，seam 未就绪，不实现）**：`docAssets.test.js` 045/046 2 组 4 例（Slice 5）；035 标准 2/4/5/6/7 注释占位断言为 pass 但真实语义待 Slice 3（主进程丢句柄/evicted 重投/水合窗口）集成验证；036 标准 3 后半与 037 标准 5 后半同理。

**PRD→代码 可追溯性表**：

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| B1 idle 淘汰：TTL=1h、活动刷新（prompt/流式/工具事件）、流式/队列豁免、淘汰=dispose 出内存 JSONL 保留、下次活动透明懒恢复（worker 侧） | `sessionLifecycle.js`（TTL sweep/touch/豁免/lastActiveAt）+ `worker.js`（touch 接线、streaming/queued 标记、onEvict dispose+辅助Map×3+session-evicted 发送） | `sessionIdleEviction.test.js` 标准1a/1b/3（模块面真实断言） | COVERED（worker 侧）；035 标准2/4/5/7 主进程集成面 → Slice 3 |
| F1 步骤2：淘汰后 sessions Map 不再含 key、内存释放（JSONL 保留） | `sessionLifecycle.js` evict/remove + has() | `sessionIdleEviction` 标准1a（has=false + tombstonedKeys）、`sessionLifecycleModule` 标准1（remove 后 has=false） | COVERED |
| B2 LRU 上限 50：超限淘汰最久未活动非流式会话；稳态 ≤50（让位例外） | `sessionLifecycle.js`（maxSessions 默认 50、register 时 LRU 淘汰，新会话自身不作牺牲品） | `sessionLruCap.test.js` 标准1/3 | COVERED |
| B2/E5：候选全豁免 → 新会话照常创建（上限让位）+ E5 诊断日志；豁免会话流结束回归候选集合 | `sessionLifecycle.js`（onWarn 注入、豁免回归） | `sessionLruCap.test.js` 标准2 | COVERED |
| B3 groupOf 语料：feishu 自身组 / copilot 组 / 项目组 / 畸形自身不抛错 | `sessionLifecycle.js` groupOf 纯函数 | `sessionGroupCooling.test.js` 标准1 | COVERED |
| B3 同组单活：copilot 与项目组同一规则（无特殊逻辑）、跨组不互汰、组内流式延迟淘汰（流结束立即执行不等 TTL）、反向冷却（组内恒 ≤1 热会话） | `sessionLifecycle.js` evictGroupPeers + pendingEvictions + sweep 延迟淘汰 | `sessionGroupCooling.test.js` 标准2/3/4/5 | COVERED |
| B3 worker 接线：session-config/prompt 到达即冷却同组其他会话 | `worker.js`（handleSessionConfig/handlePrompt 调 evictGroupPeers） | 冒烟实测（真实 worker：同组冷却/反向冷却/懒恢复） | COVERED（实测；自动化 fake-worker seam 留 Slice 3 集成面） |
| B4 模块抽取：sessions Map 归模块、worker 委托存取、时钟/onEvict 可注入、模块零自身副作用（dispose/通知经回调） | `sessionLifecycle.js`（接口 1 全方法）+ `worker.js` 委托点 | `sessionLifecycleModule.test.js` 标准1/2 | COVERED |
| B4 行为保持：除 035/036/037/038 新语义外 worker 可观察行为不变（618+148 水位不退） | `worker.js` 行为保持改造（无其他重构） | `sessionLifecycleModule` 标准3 占位 + 回归（builtin-agent 33/33、ui-copilot 80/80、全量 657/661） | COVERED（全仓回归；全量红仅 docAssets=Slice 5 seam 预期） |
| F2 流式保护：进行中回复不掐断；流结束重新进入可淘汰集合 | `worker.js`（entry.queued/streaming 标记 + finally 复位）；`sessionLifecycle.js`（豁免活读） | `sessionIdleEviction` 标准1b、`sessionLruCap` 标准2 | COVERED |
| F3 步骤4：（飞书）`/reset` 沿用现状 dispose+重建，语义不回退 | `worker.js` handleResetSession（lifecycle.remove 显式路径不触发 onEvict） | `sessionReset.test.js` 回归 | COVERED |
| §8 E1 流式中会话被纳入候选 → 豁免（正常保护分支，记诊断日志） | `sessionLifecycle.js`（豁免分支经 onWarn 输出 `[E1]` 诊断行） | 模块面豁免断言（035 标准1b）；日志面无签核断言 | PARTIAL（豁免行为 COVERED；E1 诊断行经 onWarn 输出，自动化断言留 QA 观测） |
| §8 E5 LRU 候选全在流式保护中 → 上限暂时让位 + 诊断日志；流结束回归 | `sessionLifecycle.js`（onWarn `[E5]` 让位） | `sessionLruCap` 标准2（logs 断言） | COVERED |
| §10.1 三个辅助 Map（toolContexts/sessionQueues/lastReplies）随会话一并管理、淘汰同步清理 | `worker.js` onEvict 回调（delete ×3） | onEvict 触发断言（模块面）+ 冒烟实测 | COVERED（worker 侧；Map 内容断言留集成面） |
| 035 标准2：keySecrets 不随单会话淘汰清理（keyRef 级共享缓存） | `worker.js` onEvict 不含 keySecrets（keyRef 保留，redact 可用） | 035 标准2 注释占位（Slice 3 集成面验证） | PARTIAL（实现已按契约；集成断言留 Slice 3） |
| 035 标准7：confirmAcks/permissionDecisions 不随淘汰强制清理（超时兜底自然释放） | `worker.js` onEvict 不清理这两 Map | 035 标准7 注释占位（Slice 3 集成面验证） | PARTIAL（实现已满足；断言留 Slice 3） |
| 接口 3 tombstone 判别（本运行亲手淘汰的 key；register 懒恢复/remove 重建时移除；孤儿/旧世代不复活） | `sessionLifecycle.js`（tombstonedKeys + register/remove 清除） | 035 标准1a（tombstonedKeys 断言）+ 冒烟（重发 config 清 tombstone 续聊） | COVERED（模块面 + worker 侧实测）；evicted 重投链路（标准6）→ Slice 3 |

**refactor 结果**：无（模块 183 行单文件新增 + worker 委托点局部改造；未触发 refactor 轮）

---

## 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v2 | 2026-08-08 | Slice 2 记录：sessionLifecycle 模块（抽取+TTL/LRU/组冷却/tombstone）+ worker 委托 + seam 注入 |
| v1 | 2026-08-08 | 初始化：切片规划 + seam 速记 |
