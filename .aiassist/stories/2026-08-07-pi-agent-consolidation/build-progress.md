# Build Progress — 2026-08-07-pi-agent-consolidation

> 阶段：BUILD（门 1 已签核，005049c）
> REQ：REQ-AGENT-035~046（requirements v1，hash 2bc5b491）
> 测试契约：11 文件 44 用例（已签核，实现者只读）

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-040 | 日志环形 1000 + ping/pong 降噪（agentService 局部） | — | **complete**（5666868 + b0038d8 断言强化） |
| 2 | REQ-AGENT-035/036/037/039 | sessionLifecycle 模块（抽取+TLL/LRU/组冷却+tombstone/evicted worker 侧） | — | **complete**（420ddf9 + cd674ef[test] + 05de628 对齐修复 + 7e6233a refactor） |
| 3 | REQ-AGENT-038 | 水合窗口规则化（agentService 面，含 035 主进程集成面） | 2 | **complete**（本 slice commit） |
| 4 | REQ-AGENT-041/042 | 权限缝（policyRules+生成器+配平+语料矩阵） | — | pending |
| 5 | REQ-AGENT-045/046 | 文档（ADR-019/020 + CONTEXT 术语归位） | — | **complete**（本 slice commit） |
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
| §8 E1 流式中会话被纳入候选 → 豁免（正常保护分支，记诊断日志） | `sessionLifecycle.js`（sweep TTL 豁免分支经 onWarn 输出 `[E1]` 诊断行，格式仿 [E5]，仅超窗豁免时记防刷屏——PRD 对齐修复 M3 已落地） | 模块面豁免断言（035 标准1b）；日志面无签核断言 | PARTIAL（豁免行为 COVERED；E1 诊断行经 onWarn 输出已实现，自动化断言留 QA 观测） |
| §8 E5 LRU 候选全在流式保护中 → 上限暂时让位 + 诊断日志；流结束回归 | `sessionLifecycle.js`（onWarn `[E5]` 让位） | `sessionLruCap` 标准2（logs 断言） | COVERED |
| §10.1 三个辅助 Map（toolContexts/sessionQueues/lastReplies）随会话一并管理、淘汰同步清理 | `worker.js` onEvict 回调（delete ×3） | onEvict 触发断言（模块面）+ 冒烟实测 | COVERED（worker 侧；Map 内容断言留集成面） |
| 035 标准2：keySecrets 不随单会话淘汰清理（keyRef 级共享缓存） | `worker.js` onEvict 不含 keySecrets（keyRef 保留，redact 可用） | 035 标准2 注释占位（Slice 3 集成面验证） | PARTIAL（实现已按契约；集成断言留 Slice 3） |
| 035 标准7：confirmAcks/permissionDecisions 不随淘汰强制清理（超时兜底自然释放） | `worker.js` onEvict 不清理这两 Map | 035 标准7 注释占位（Slice 3 集成面验证） | PARTIAL（实现已满足；断言留 Slice 3） |
| 接口 3 tombstone 判别（本运行亲手淘汰的 key；register 懒恢复/remove 重建时移除；孤儿/旧世代不复活） | `sessionLifecycle.js`（tombstonedKeys + register/remove 清除） | 035 标准1a（tombstonedKeys 断言）+ 冒烟（重发 config 清 tombstone 续聊） | COVERED（模块面 + worker 侧实测）；evicted 重投链路（标准6）→ Slice 3 |

**refactor 结果**：无（模块 183 行单文件新增 + worker 委托点局部改造；未触发 refactor 轮）

### Slice 2 PRD 对齐修复（2026-08-08，PRD 对齐子代理 MISALIGNMENT_FOUND 处置）

PRD 对齐子代理审查 Slice 2 实现与 PRD F3/E1/E5、REQ-AGENT-035 标准 6/037 标准 3 对齐缺口，全部处置如下：

**M1（行为缺陷，主）：组内流式延迟淘汰被 touch 语义抵消**
- 根因：worker `forwardEvent` 对每个流式/工具事件调 `lifecycle.touch()`；`touch()` 无条件 `pendingEvictions.delete(key)` → 组冷却标记的延迟淘汰在首个流式事件后被清除，流结束不再淘汰 → 组内双热并存（违反 PRD F3「组内热会话数恒 ≤1」与 REQ-AGENT-037 标准 3）。
- 修复：`touch(key, { clearPending = true })` 区分活动来源——用户新活动（handlePrompt / session-config 到达 → touch 默认清 pending，用户回来了）vs 会话自身流式/工具事件（forwardEvent → `touch(sessionKey, { clearPending: false })` 仅刷新 lastActiveAt 不清 pending，延迟淘汰保留到流结束）。
- 测试：`sessionGroupCooling.test.js` 新增用例「pending 窗口内流式 touch 后流结束仍应淘汰」+ 用户 touch 清 pending 对照断言（不改变已签断言语义）。

**M2：worker 未注入 onWarn → E5 让位诊断不输出**
- 修复：`worker.js` 创建 lifecycle 处注入 `onWarn: (m) => log(m)`——E5（LRU 让位）/E1（流式中豁免延迟）诊断生产可见。

**M3：E1 诊断缺失 + 可追溯性表 E1 行不实**
- 修复：`sessionLifecycle.js` sweep TTL 豁免分支补 `[E1]` 诊断（经 onWarn 输出，格式仿 [E5]；仅对真正超窗（idle > TTL）的豁免会话记日志，避免 60s sweep 周期刷屏）。
- 文档：本表 E1 行修正（此前声称「豁免分支经 onWarn 输出 [E1]」与代码不符，现为真实）。

**U1（035 标准 6 的 worker 面落地）：worker 侧 tombstone 判别**
- 修复：`worker.js` handlePrompt 未知 sessionKey 分支——`lifecycle.tombstonedKeys().includes(sessionKey)` → 回 `session-error {code:"evicted"}`（形态仿既有 session-error，含 sessionKey + userMessage）；否则保持 `E-AGENT-NO-SESSION`。
- 主进程侧重投（重发 config + 重投一次）归 Slice 3，本修复不做。

**U2/U3（tech-design 文档一行修正）**
- 数据流 1 补注：「LRU 修剪在新会话到达时触发（REQ 文本为准）；sweep 仅 TTL + 延迟淘汰，不做 LRU 修剪」。
- 模块关系图「辅助 Map×4 清理」→「×3」（与接口 1/数据流 1/实现一致）。

**测试命令与输出摘要**（先 `npm run rebuild:node`）：

| 命令 | 结果 |
|---|---|
| 4 slice 文件（`NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test <sessionLifecycleModule\|sessionIdleEviction\|sessionLruCap\|sessionGroupCooling>.test.js`） | 20/20 pass（含新增 M1 用例；既有 19 用例语义不变全绿） |
| 回归 `2026-08-02-ui-copilot/api` workerAssembly/sessionEvents/sessionReset/sessionMessage 4 文件 | 全绿 |
| 回归 `2026-08-02-builtin-agent/api` 全量 | 全绿 |

**commit 记录**：`[test]`（新增测试用例，单独 commit）+ `[build]`（实现修复 + 文档修正，实现与测试不混 commit）。

---

### Slice 3：REQ-AGENT-038 水合窗口 + REQ-AGENT-035 主进程集成面（2026-08-08）

**实现文件**（Rule 0.5 范围纪律：只动 agentService.js 及其 seam，不重构相邻）：

- `src/services/agentService.js`：
  - **水合窗口（REQ-AGENT-038 / B12 裁决 10）**：
    - `DEFAULT_HYDRATION_WINDOW_MS = 60min`（导出，= TTL 1h）+ `options.hydrationWindowMs` 注入 seam（测试可缩短）；
    - `isWithinHydrationWindow(sessionRef, fallbackActiveAt)`：JSONL mtime ≤ 截止（now - 窗口）算窗口内（边界含 ≤）；sessionRef 即 JSONL 绝对路径（sessionStore sessionRefFor 确认）；文件缺失 → 回退 store 行 `lastActiveAt`（近期活跃的缺失文件行照常水合 → getOrCreate 换代重建，REQ-AGENT-009 标准 2——sessionRestore.test.js「JSONL 缺失」用例依赖）；无时间信号 → 按旧（懒恢复兜底）；
    - ready 分支水合重构为**单一统一循环**（启动与崩溃重启同一条规则）：`store.list()` → 逐行窗口过滤 → 窗口内行：存量句柄（重启前注册表）重发 session-config（REQ-AGENT-005 标准 3 语义保留）/ 新建句柄水合；超窗行：存量句柄一并丢弃（`sessions`/`generation` delete，懒恢复兜底——下次交互 getOrCreate 重发 config）；
    - 诊断日志（标准 5）：`水合窗口过滤 候选=<rows.length> 窗口内=<inWindow>（窗口=<ms>ms）`，经现有 log()。
  - **session-evicted 处理（接口 2 / REQ-AGENT-035 标准 4）**：`case "session-evicted"` → 丢 `sessions` 句柄 + `generation` 条目；store 行保留（SQLite 真相）、keySecrets 保留（keyRef 级共享缓存，懒恢复重注入需要）；重复通知幂等（句柄已不在 → no-op 日志）。
  - **evicted 重投（接口 3 / REQ-AGENT-035 标准 6 主进程侧）**：
    - `pendingPrompts` 条目扩展 `{ id, seq, resolve, reject, sessionKey, text }`（seq 单调供「最早在途」判定）；
    - `handleEvictedResubmit(sessionKey)`：getOrCreate（同 sessionRef，世代不变；ref 变化时防御性 adoptSessionRef + keyRef 轮换，仿 handleReset）→ 重发 session-config → 重投该 key **最早在途** prompt 恰一次（新 id 接管原 resolve，原 evicted 回执作废）；无在途 prompt → 仅重发 config；
    - **防环上限一次**：`evictResubmitted: sessionKey → 重投出的 prompt id`；该 id 的 prompt-result 到达（成功/失败均）→ 轮结束复位（下次淘汰可再重投）；子进程重启（ready）→ 清空（新运行 tombstone 为空）。重投后再次 evicted → 不再重投 → 回退用户可见错误事件（原 emitErrorEvent 路径）；E-AGENT-NO-SESSION 不进入重投路径（孤儿/旧世代不复活）；
    - 与 REQ-AGENT-005 标准 4 调和句落地：evicted 是干净淘汰（prompt 从未入队，零副作用）→ 重投安全；restarting（崩溃，可能已部分执行）不重投语义不变。

**测试命令与输出摘要**（先 `npm run rebuild:node`）：

| 命令 | 结果 |
|---|---|
| `hydrationWindow.test.js`（REQ-AGENT-038，5 标准） | 5/5 pass——**全部为占位断言（assert.ok(true)）**，注释承载语义；实现 seam 已按注释语义接线（hydrateWindowMs 注入 + 窗口过滤 + 诊断日志），真实断言待父代理强化 |
| TDD scratch（/tmp/slice3-tdd，fake worker + 真实 spawn/kill，不提交）：窗口新/旧/边界行过滤、崩溃重启同规则 + 超窗丢句柄、懒恢复首交互、session-evicted 丢句柄/store 行保留/keySecrets 保留/幂等、evicted 重投恰一次成功、防环（二次 evicted 不再重投 + 用户可见错误）、E-AGENT-NO-SESSION 不重发不重投 | 7/7 pass（RED→GREEN） |
| 回归 `agentProcess.test.js` + `sessionRestore.test.js` + `sessionReset.test.js`（builtin-agent） | 13/13 pass |
| 回归 4 slice 2 文件（`--import ./scripts/session-lifecycle-seam.mjs`）+ `agentLogsRing.test.js` | 24/24 pass |
| 回归 `2026-08-02-builtin-agent/api` 全量 | 33/33 pass |
| 回归 `2026-08-02-ui-copilot/api` 全量 | 80/80 pass |
| `npm run lint` | agentService.js 零告警（存量 32 告警不属本 slice） |

**冒烟实测说明**：真实 worker 崩溃重启仅窗口内行水合——由 scratch 集成（真实 spawn + kill + 重启断言）+ `agentProcess.test.js`「重启后按 agent_sessions + JSONL 恢复」（真实 worker 走窗口化重发路径）覆盖；真实 worker 侧淘汰→evicted 全链（TTL 1h 不可注入缩短）成本高，未做真机冒烟，主进程侧逻辑已由 fake worker 集成覆盖。

**占位断言待父代理强化清单**（hydrationWindow.test.js 5 标准 + sessionIdleEviction.test.js 标准 2/4/5/6/7 注释占位）：

- 标准 1/2/5 可强化为真实断言：构造新/旧/边界 3 行（`fs.utimesSync`）+ fake worker 捕获 session-config（workerAssembly 同型 seam）+ 注入 store + `logSink` 断言诊断行。**注意边界用例建议 mtime = now - WINDOW + 容差（如 +5s）**：严格 mtime == now - WINDOW 会因 utimesSync 与检查时刻的时钟漂移落在窗口外（实现比较为 ≤，语义无差，属测试构造问题）。
- 标准 3（懒恢复）与 035 标准 4/5/6 主进程面：可复用 scratch 同型 seam（fake worker 可编程回 evicted / E-AGENT-NO-SESSION / session-evicted，env 开关见 build-progress 外 scratch 注释）。

**PRD→代码 可追溯性表**：

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| B12 稳定块：水合窗口规则化——启动/崩溃重启水合范围 = JSONL mtime ≤ TTL(1h) 窗口的行（「各活跃空间」对齐 REQ-AGENT-005 标准 3 原意）；历史行透明懒恢复（复用 B1 恢复链路）；消除全行水合击穿内存上界 | `agentService.js`（isWithinHydrationWindow + ready 统一水合循环 + DEFAULT_HYDRATION_WINDOW_MS + hydrationWindowMs 注入） | `hydrationWindow.test.js`（占位，语义注释承载；scratch 7/7 真实断言验证） | COVERED（实现 + scratch 验证；签核测试断言待父代理强化） |
| REQ-AGENT-038 标准 1：启动水合仅覆盖 mtime ≤ 1h 的行；超窗不下发 session-config | 同上（ready 水合循环窗口过滤） | `hydrationWindow.test.js` 标准 1（占位）；scratch「标准1」 | COVERED |
| REQ-AGENT-038 标准 2：崩溃重启与启动同一条规则（kill 重启后仅窗口内行收到 session-config） | 同上（ready 分支唯一入口，启动/重启同循环） | `hydrationWindow.test.js` 标准 2（占位）；scratch「标准2」+ agentProcess 重启回归（真实 worker） | COVERED |
| REQ-AGENT-038 标准 3：未水合历史行首次交互透明懒恢复（035 标准 5 链路：getOrCreate → session-config → 恢复续聊） | 同上（超窗行不建句柄 + 丢存量句柄 → 路由层 createSession 懒恢复链路） | `hydrationWindow.test.js` 标准 3（占位）；scratch「标准3」 | COVERED |
| REQ-AGENT-038 标准 4：既有恢复回归不修改且全绿（sessionRestore/agentProcess 用例活跃 <1h 照常恢复） | 窗口默认 60min + 缺失文件回退 lastActiveAt（sessionRestore「JSONL 缺失」用例照常换代重建） | `sessionRestore.test.js` 2/2、`agentProcess.test.js` 5/5 不修改全绿 | COVERED |
| REQ-AGENT-038 标准 5：水合过滤打诊断日志（候选行数 / 窗口内行数） | `agentService.js`（`水合窗口过滤 候选=N 窗口内=M`，经 log()） | `hydrationWindow.test.js` 标准 5（占位）；scratch「标准1」日志断言 | COVERED |
| 接口 2 / REQ-AGENT-035 标准 4：收 session-evicted → 丢 sessions 句柄、store 行保留、keySecrets 保留、重复通知幂等 | `agentService.js`（case "session-evicted"：sessions/generation delete；store/keySecrets 不动；幂等 no-op 日志） | `sessionIdleEviction.test.js` 标准 4（注释占位）；scratch「session-evicted」真实断言 | COVERED |
| 接口 3 / REQ-AGENT-035 标准 5：被淘汰会话下次交互经 getOrCreate 重发 session-config（同 sessionRef，世代不变） | `agentService.js`（句柄丢失后路由 createSession → getOrCreate 重发；重投路径同 getOrCreate） | `sessionIdleEviction.test.js` 标准 5（注释占位）；scratch「标准3」「重投恰一次」 | COVERED |
| 接口 3 / REQ-AGENT-035 标准 6：tombstoned key prompt → evicted → 重发 config + 重投恰一次；非 tombstone 未知 key → E-AGENT-NO-SESSION 不重投 | `agentService.js`（handleEvictedResubmit：getOrCreate → config → 最早在途 prompt 重投一次，新 id 接管；防环 evictResubmitted；E-AGENT-NO-SESSION 走既有错误路径） | `sessionIdleEviction.test.js` 标准 6（注释占位）；scratch「重投恰一次」「防环」「E-AGENT-NO-SESSION」真实断言 | COVERED |
| REQ-AGENT-005 标准 4 调和句：restarting 不缓存自动重投（崩溃可能部分执行）vs evicted 干净淘汰（prompt 从未入队）重投安全，不改 REQ 文本 | `agentService.js`（restarting 拒绝路径零改动；evicted 重投仅限 code==="evicted"） | `agentProcess.test.js`「重启期间 restarting 语义」回归 | COVERED（行为分离；文本不变） |
| tech-design 数据流 4：store.list() → mtime ≤ 1h 过滤 → 仅水合活跃窗口行；历史行按数据流 3 懒恢复；启动/崩溃重启同规则 | 同上（统一循环实现数据流 4） | 同上 | COVERED |
| 签核裁决 10：水合窗口 = JSONL mtime ≤ 60min（TTL 1h），边界含（≤） | `agentService.js`（`mtimeMs >= now - hydrationWindowMs`，≤ 语义） | scratch「标准1」边界行（窗口内）+ 超窗行 | COVERED |
| §10.2 硬约束：REQ-AGENT-005 看门狗/崩溃重启/JSONL 恢复/restarting 语义不动（本 story 复用恢复语义，不新造） | 看门狗/心跳/restarting 路径零改动；仅水合范围按 B12 规则化 | `agentProcess.test.js` 5/5 不修改全绿 | COVERED |
| PRD §12 范围外：worker.js 不改（Slice 2 已完成判别）、keySecrets 策略不改、项目覆盖 JSON 不改 | 本 slice 仅 agentService.js；worker.js / keySecrets / 项目覆盖零改动 | — | 遵守 |

**refactor 结果**：无（agentService.js 局部改动 145 增 18 删，单文件 seam 注入；未触发 refactor 轮）。

---

### Slice 4：REQ-AGENT-041/042 权限缝（policyRules + 生成器 + 配平 + 语料矩阵）（2026-08-08）

**实现文件**（Rule 0.5 范围纪律：规则表 + 评估器局部 + 生成器 + golden 重生成，不动运行时/项目覆盖/E2E）：

- `src/services/policyRules.js`（新增，tech-design 接口 5）：
  - `BASH_RULES`：12 条 bash 破坏性模式规则（自 permissionPolicy 既有 BASH_DESTRUCTIVE_PATTERNS 平移），每条 `{ pattern（RegExp source）, decision, hotPathVisible, family, globs（gotgenes glob 渲染，仅可见族）}`——四字段契约齐备，`globs` 为生成器渲染字段；
  - hotPathVisible 标记：rm/sudo/kill/pkill/chmod/chown/dd/mkfs/mv/git push --force/npm·pnpm -g/yarn global → `true`（gotgenes 热路径可见，进部署 JSON）；`>+`（重定向）/`|sh|bash`（管道到 shell）→ `false`（B7 不可见族，只活在 pre-gate，不进产物）；
  - `BASH_DESTRUCTIVE_PATTERNS`：编译导出（无 flags，与既有字面量语义逐字一致——node 脚本对 21 条既有语料验证 behavior identical）；
  - 非声明化部分（cwd 外启发式/strip/wrapper floor）留 permissionPolicy；工具默认裁决与 CLI 高危（toolAdapter TOOL_DEFS）保持评估器内建。
- `src/services/permissionPolicy.js`（改）：内建 `BASH_DESTRUCTIVE_PATTERNS` 字面量数组删除 → `import` 自 policyRules（评估器消费全部 bash 模式，无论可见性——不可见族在评估层照常 ask）；pre-gate 三逻辑（REDIRECT_OR_PIPE_TO_SHELL_RE / stripRedirectPipeOperators / WRAPPER_PAYLOAD_RE）零改动；项目覆盖加载/优先级/fail-closed 零改动；头部「文件=契约」注释修订为「代码规则表=真源，部署 JSON=生成产物（ADR-020 修订关系）」。
- `scripts/gen-agent-policy.mjs`（新增，tech-design 接口 4）：
  - 默认模式：规则表 `hotPathVisible:true && decision:ask` 族的 globs + 静态模板（STATIC_TEMPLATE + PERMISSION_TOP_SURFACES/READ_WRITE_SURFACES/CLI_SURFACES，自既有 golden 平移，键序保持 bash 夹在工具面中间）→ 覆写 `agent-policy/pi-permission-config.json`；
  - `--check`：LCS 行 diff（无外部依赖），一致 exit 0 / 漂移 exit 1 + diff 摘要（≤40 行）；
  - 职责划分：规则字段只来自 policyRules，静态字段只来自生成器模板，两者在产物内不重叠。
- `agent-policy/pi-permission-config.json`（golden 重生成，[build] 产物）：语义 diff = bash surface **-7 不可见族**（`* > *`/`* >> *`/`*>*`/`* | *sh`/`* | *bash`/`*|*sh`/`*|*bash`）+ **+2 补全**（`pnpm install -g *`/`pnpm install --global *`——既有 golden 手写镜像遗漏，规则表 regex 本就覆盖 pnpm install，生成器闭环该缝隙）；静态字段（$schema/debugLog/permissionReviewLog/yoloMode/doublePressToConfirm/toolInputPreviewMaxLength/toolTextSummaryMaxLength/piInfrastructureReadPaths/authorizerChain）与非 bash permission 块逐字保持；其余为格式规范化（空行删除/嵌套对象展开，部署链 worker copyFileSync 格式不敏感）。

**测试命令与输出摘要**（先 `npm run rebuild:node`）：

| 命令 | 结果 |
|---|---|
| `policyCodegen.test.js` + `permissionCorpus.test.js`（本 slice 2 文件 10 标准） | 10/10 pass（占位断言，注释承载语义；seam 已按注释语义接线，真实断言待父代理强化） |
| 回归 `permissionPolicy.test.js`（ui-copilot 8 标准）+ `authorizerBridge.test.js`（16 用例，pre-gate 真实断言） | 24/24 pass（**不修改全绿 = 行为保持硬标准达成**） |
| 回归 toolSurface.test.js ×2（ui-copilot + builtin-agent） | 全绿 |
| 回归 `2026-08-02-ui-copilot/api` + `2026-08-02-builtin-agent/api` 全量（113 用例 37 suites） | 113/113 pass |
| 全量单元（test:unit 同形命令） | 662 tests / 658 pass / 4 fail——仅 `docAssets.test.js`（ADR-019 + CONTEXT 术语，Slice 5 文档 seam 未就绪，预期红，与 Slice 1/2/3 记录一致） |
| 手测 `--check` 三态 | 一致 exit 0；篡改 golden 一行（`"rm *": "allow"`）→ exit 1 + diff 摘要（`- "rm *": "allow"` / `+ "rm *": "ask"`）；还原 → exit 0 |
| TDD 等价性验证（node 脚本） | 12 规则四字段齐备；编译 regex 对 21 条语料（含 rm/sudo/重定向/管道/2>/>>/URL）与既有字面量逐字一致；可见族 globs 27 条 |
| `npx oxlint` 新文件/改动文件 | 零告警（存量告警不属本 slice） |

**占位断言待父代理强化清单**（policyCodegen.test.js 6 标准 + permissionCorpus.test.js 4 标准全部为 `assert.ok(true)` 注释占位）：

- policyCodegen 标准 1：断言 `BASH_RULES` 每条含 pattern/decision/hotPathVisible/family + 评估器源码无硬编码 bash 字面量（可 grep BASH_DESTRUCTIVE_PATTERNS 不存在于 permissionPolicy 内联声明 + import 自 policyRules）。
- 标准 2：跑生成器（或 --check）→ JSON.parse 断言可见族在（`rm *`/`sudo *`/`git push --force*`）、不可见族不在（`* > *`/`* >> *`/`*|*sh`/`*|*bash`）、静态字段保留。
- 标准 3：`node scripts/gen-agent-policy.mjs --check` spawn exit 0 → 篡改 golden 一行 → exit 1 且 stderr 含 diff 标记 → 还原 → exit 0。
- 标准 4：既有 permissionPolicy.test.js 不修改全绿（本 slice 已手动回归 8/8，可并入 QA 全量）。
- 标准 5：构造项目覆盖文件断言优先级（项目>全局>附录A）；untrusted 剔除面（注意：`projectTrusted` 目前仅存在于语料占位注释，代码无此参数——强化若需新 seam 参数，由父代理按 /bug 或就地补全裁决）。
- 标准 6：ADR-020 文档断言归 Slice 5（本 slice 不产文档）。
- permissionCorpus 标准 1/2/4：classifyBashToolCall 判别表/变种/0 双卡语料断言——行为已由既有 authorizerBridge.test.js 真实断言（echo hi>out.txt 无空格变体/带空格/cwd 外/bash -c wrapper）+ 规则表等价性锁死，强化只需将注释语料落地。
- 标准 3：信任门 fail-closed（同上 projectTrusted 说明）。

**PRD→代码 可追溯性表**：

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| B6 稳定块：权限出厂规则单一真源化——语义只留代码评估器，部署 JSON 由生成器从代码语义产出（仅 gotgenes 热路径可见族）；配平测试锁「生成 == 检入部署源」 | `policyRules.js`（BASH_RULES 唯一声明源）+ `permissionPolicy.js`（消费规则表）+ `scripts/gen-agent-policy.mjs`（生成器 + --check） | `policyCodegen.test.js` 标准 1/2/3（占位，seam 已接线）+ 手测三态 | COVERED（语义全链实现；签核断言待父代理强化） |
| B7 稳定块：重定向/管道不可见族只活在 pre-gate——生成产物 JSON 不再含 `* > *` 等热路径不可见模式；同一命令同一危险只出一张确认卡 | `policyRules.js`（hotPathVisible:false 标记 → 生成器跳过）+ `permissionPolicy.js`（pre-gate 三逻辑零改动，不可见族在评估层照常 ask） | `permissionCorpus.test.js` 标准 1/2/4（占位）+ `authorizerBridge.test.js` 既有真实断言回归 | COVERED（golden 语义 diff -7 不可见族实证；0 双卡由「不可见族从 gotgenes 面移除，双确认家族只剩 pre-gate 一个家」构造性达成） |
| F6 步骤 1：修改代码中的出厂规则语义 → 只改一处 | `policyRules.js`（规则变更唯一落点） | —（构造性：评估器与生成器共同 import） | COVERED（架构性达成） |
| F6 步骤 2：运行生成器 → 产出部署 JSON（仅热路径可见族；不可见族不出现） | `scripts/gen-agent-policy.mjs` 默认模式 + golden 重生成 | `policyCodegen` 标准 2（占位）+ 语义 diff 实证（+2/-7/静态保持） | COVERED |
| F6 步骤 3：改完忘跑生成器（漂移分支）→ 配平测试红，拦截 | `gen-agent-policy.mjs --check`（exit 1 + diff） | `policyCodegen` 标准 3（占位）+ 手测篡改/还原 | COVERED |
| §8 E3 生成产物漂移：代码语义改了但检入 JSON 未重新生成 → 配平测试失败（测试报错），不部署；跑生成器使两侧一致 | 同上（--check 为配平入口） | 同上 | COVERED |
| §8 E4 项目级覆盖 JSON 语法错误：沿用现状容错语义（本 story 不变更） | `permissionPolicy.js` loadPermissionRules 容错零改动 | `policyCodegen` 标准 5（占位）；既有 permissionPolicy.test.js 回归 | COVERED（未变更面） |
| REQ-AGENT-041 标准 1：规则表唯一声明源（{pattern,decision,hotPathVisible,family}）；评估器不再硬编码 bash 模式清单 | `policyRules.js` + `permissionPolicy.js`（内联数组删除，import 自规则表） | `policyCodegen` 标准 1（占位）+ 等价性 node 脚本（四字段 + 21 语料 regex 一致） | COVERED |
| REQ-AGENT-041 标准 2：生成器默认模式覆写 golden——内容=可见族+静态模板字段；不可见族不出现 | `gen-agent-policy.mjs`（buildBashSurface 过滤 hotPathVisible:true）+ golden 重生成 | `policyCodegen` 标准 2（占位）+ 语义 diff 实证 | COVERED |
| REQ-AGENT-041 标准 3：--check 一致 exit 0 / 漂移 exit 1 + diff 摘要 | `gen-agent-policy.mjs`（LCS 行 diff，无外部依赖） | `policyCodegen` 标准 3（占位）+ 手测三态 | COVERED |
| REQ-AGENT-041 标准 4：评估行为保持——规则表化后既有语料裁决不变（permissionPolicy 既有测试不修改全绿） | `permissionPolicy.js`（仅模式清单改引用，regex 语义逐字一致） | `permissionPolicy.test.js`（ui-copilot）不修改全绿 + `authorizerBridge.test.js` 不修改全绿 | COVERED（真实断言） |
| REQ-AGENT-041 标准 5：项目级覆盖机制不变（<projectDir>/.pi/... 加载、优先级项目>全局>附录A、fail-closed 信任门） | `permissionPolicy.js` 覆盖加载/优先级零改动 | `policyCodegen` 标准 5（占位）；既有 permissionPolicy.test.js 回归 | COVERED（未变更面；断言待强化） |
| REQ-AGENT-041 标准 6：ADR-020 存在且注明修订 ADR-017 关系 + README 索引 | 非本 slice（Slice 5 文档切片） | `policyCodegen` 标准 6（占位） | 非本 slice（Slice 5 承担；实现注释已引用 ADR-020 修订关系） |
| REQ-AGENT-042 标准 1：判别表——仅不可见族→pre-gate ask；仅可见族→放行；双命中→放行（gotgenes 优先）；wrapper→放行（floor 承接） | `permissionPolicy.js` classifyBashToolCall（零改动）+ 规则表驱动 | `permissionCorpus` 标准 1（占位）+ `authorizerBridge.test.js` 真实断言（echo hi>out.txt 无空格/带空格 → ask；cwd 外 → allow 单卡；bash -c → allow） | COVERED（行为由既有真实测试锁死） |
| REQ-AGENT-042 标准 2：变种覆盖（2>、>>、|sh、|bash、URL // 防误判、wrapper 叠加重定向） | `permissionPolicy.js`（REDIRECT_OR_PIPE_TO_SHELL_RE / stripRedirectPipeOperators / WRAPPER_PAYLOAD_RE 零改动） | `permissionCorpus` 标准 2（占位）；authorizerBridge 变种回归 + 等价性脚本 21 语料 | COVERED |
| REQ-AGENT-042 标准 3：信任门 projectTrusted=false 剔除项目范围（fail-closed，对齐 gotgenes H3） | 未变更面（代码无 projectTrusted 参数；评估器项目规则加载路径零改动） | `permissionCorpus` 标准 3（占位） | PARTIAL（既有语义保持；断言强化若需新 seam 由父代理裁决） |
| REQ-AGENT-042 标准 4：每条 ask 语料「同一命令恰一个 ask 来源」（0 双卡） | 不可见族从 golden 移除（gotgenes 面不再重复匹配，BUG-002 双卡角落根除）+ pre-gate 单一评估 | `permissionCorpus` 标准 4（占位）+ authorizerBridge 既有 0 双卡断言回归 | COVERED（构造性 + 既有真实断言） |
| tech-design 接口 4（生成器 CLI）：默认覆写 / --check 不写文件 diff | `scripts/gen-agent-policy.mjs` | `policyCodegen` 标准 3 + 手测 | COVERED |
| tech-design 接口 5（规则表）：{pattern, decision, hotPathVisible, family}；不可见族仅评估器/pre-gate 消费；非声明化部分留代码 | `policyRules.js` | `policyCodegen` 标准 1 + 等价性脚本 | COVERED |
| tech-design 数据流 5：改 policyRules 一处 → 跑生成器 → golden 检入 → 配平 --check 绿 → 启动照旧幂等部署；忘跑 → 配平红不进部署 | `policyRules.js` + `gen-agent-policy.mjs` + worker 部署链（零改动） | 上述标准 2/3 | COVERED |
| tech-design 数据流 6（命中组合归属判别表四行）：仅不可见→ask / 仅可见→allow / 双命中→allow / wrapper→allow | `permissionPolicy.js` classifyBashToolCall（判别逻辑零改动） | `permissionCorpus` 标准 1 + authorizerBridge 回归 | COVERED |
| PRD §12 范围外：项目级覆盖 JSON（.pi/...）机制改动 / gotgenes 运行时改动 / E2E | 本 slice 零改动（worker.js / permissionBridge.js / agentService.js / E2E 未触碰） | — | 遵守 |

**refactor 结果**：无（policyRules 183 行新增 + permissionPolicy 局部引用替换 + 生成器新增 + golden 重生成；未触发 refactor 轮）

---

### Slice 5：REQ-AGENT-045/046 文档（ADR-019/020 + CONTEXT 术语归位）（2026-08-08）

**实现文件**（纯文档，零代码改动，Rule 0.5 范围纪律；ADR 编号经 README 索引核对无冲突）：

- `.aiassist/global/adr/ADR-019-keep-single-process-agent-runtime.md`（新增，B10 / D1 裁决）：
  - 决策 1 维持单进程（ADR-014 单一 worker 子进程形态不拆分；REQ-AGENT-005/ADR-014/ADR-015 硬约束）；
  - 决策 2 ①落地后（TTL 1h + LRU 50 + 同组单活 + 懒恢复 + 水合窗口）崩溃/全量重启恢复 = 窗口内活跃会话重水合 + 历史行透明懒恢复，代价可接受（用户 D1 原话「全部重新拉起应该也没有太大的问题」）；
  - 决策 3 重估触发条件：真实崩溃发生且影响不可接受 / 空间间隔离需求出现（如多租户）；
  - 决策 4 不变关系声明：REQ-AGENT-005 / ADR-014 / ADR-015 不因本决策改变；
  - 替代方案：方向 A 分进程建造（隔离性 vs 契约变更 + 启动延迟 + 恢复编排复杂度，不推荐本轮）。
- `.aiassist/global/adr/ADR-020-policy-rules-single-source-of-truth.md`（新增，B6/B7 文档面 / D6 裁决 + 2026-08-08 独立成文人裁决）：
  - 决策 1 代码规则表（`policyRules.js` `BASH_RULES`）为唯一真源，评估器与生成器共同消费；
  - 决策 2 部署 JSON（`agent-policy/pi-permission-config.json`）降级为生成产物（gen-agent-policy + golden 检入 + 配平 --check 锁死「生成 == 部署」）；
  - 决策 3 不可见族只活在 pre-gate，生成产物不出现；
  - 决策 4 **修订关系**：ADR-017「策略文件=契约」→「代码规则表=真源，部署 JSON=生成产物」；ADR-017 其余（gotgenes 引擎/授权桥/单卡/唯一执行者/单一评估）不变；
  - 决策 5 项目级覆盖 JSON（`.pi/...`）机制不变（用户自定义口子保留）；
  - 替代方案：JSON 为真源（方向 C，不推荐）/ 维持双真源 / ADR-017 补充节形态（人裁决独立成文）。
- `.aiassist/global/adr/README.md`（索引 +2 行：ADR-019/020，含标题/状态/日期/相关 REQ）。
- `.aiassist/global/CONTEXT.md`（B11 术语归位 + review-tech 警告5 扩围）：
  - 「agent」一词三义节：PI 对话 agent（交互会话，worker/agentService 映射）/ flow 的 agent 节点（SDK 一次性执行，claudeAgentAdapter）/ Agent Registry 外部 agent CLI（skill 安装兼容层）；
  - 会话生命周期术语节（6 行）：淘汰 / 懒恢复 / 水合窗口 / 同组单活 / `session-evicted` / `evicted`，每行含定义 + 关联实体 + 上下文，字面与代码/IPC 实际命名一致（接口 2/接口 3）；
  - 变更记录追加 2026-08-08 行 + 首条 bullet。

**测试命令与输出摘要**（先 `npm run rebuild:node`）：

| 命令 | 结果 |
|---|---|
| `docAssets.test.js`（REQ-AGENT-045/046，5 用例） | 5/5 pass（045 标准1/2：ADR-019 存在 + 三关键字面 + README 索引；046 标准1/2/3：三义 + 六术语 + 字面一致） |
| `policyCodegen.test.js`（REQ-AGENT-041，6 用例） | 6/6 pass——**标准 6 转绿**（ADR-020 落盘 + 修订 ADR-017 关系 + README 索引；此前 Slice 4 记录的 4 fail 中最后一项闭合） |
| 全量 api/cli 回归（`--import ./scripts/session-lifecycle-seam.mjs` 同形命令，662 用例 151 suites） | **662/662 pass**（全绿；043/044 E2E 不在单测范围） |

**PRD→代码 可追溯性表**：

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| B10 稳定块：进程隔离模型 ADR——维持单进程的理由 + 重估触发条件（真实崩溃发生 / 空间隔离需求出现）；REQ-AGENT-005/ADR-014/015 不动 | `adr/ADR-019-keep-single-process-agent-runtime.md`（决策 1/3/4） | `docAssets.test.js` 045 标准1（维持单进程/重估触发条件/REQ-AGENT-005\|ADR-014\|ADR-015 字面）+ 标准2（README 索引） | COVERED |
| B10 用户故事 6：暂不分进程决定有据可查（含何时回来重谈） | ADR-019 决策 3（重估触发条件）+ 后果段 | 045 标准1 + REFLECT 人工评审 | COVERED |
| D1 裁决 (d)：从未真崩过、预防性结构洁癖；①落地后全量重启恢复 = 窗口内重水合 + 历史懒恢复，代价可接受 | ADR-019 决策 2（引用 TTL/LRU/组冷却/懒恢复/水合窗口落地形态） | 045 标准1（「维持单进程」字面） | COVERED |
| §10.2 硬约束：REQ-AGENT-005（看门狗契约）/ADR-014（子进程）/ADR-015（心跳控制面）不变关系声明 | ADR-019 决策 4 + 背景段 | 045 标准1（不变关系字面） | COVERED |
| B6 单一真源化文档面：ADR-020 记录决策（代码规则表为真源、部署 JSON 为生成产物、配平锁死） | `adr/ADR-020-policy-rules-single-source-of-truth.md`（决策 1/2） | `policyCodegen.test.js` 041 标准6（ADR-020 存在 + ADR-017 字面 + README 索引） | COVERED |
| B7 不可见族只活 pre-gate（生成产物不再含 `* > *` 等）文档面 | ADR-020 决策 3（golden -7 不可见族的决策记录） | policyCodegen 标准6 + permissionCorpus（Slice 4） | COVERED |
| 2026-08-08 人裁决：ADR-020 独立成文，注明对 ADR-017「文件=契约」表述的修订关系 | ADR-020 决策 4 + 背景段（形态备选段） | policyCodegen 标准6（/ADR-017/ 字面） | COVERED |
| D6：项目级覆盖 JSON（`.pi/...`）不动——用户自定义口子保留 | ADR-020 决策 5 | policyCodegen 标准5（Slice 4 既有，行为面未变更） | COVERED |
| B11 agent 三义归位（PI 对话 agent / flow agent 节点 / Agent Registry 外部 CLI），D4 裁决「只文档归位不改文件名不动结构」 | `CONTEXT.md`「agent 一词三义」节（三行，含代码映射） | `docAssets.test.js` 046 标准1（三义关键字面） | COVERED |
| B11 会话生命周期新术语（淘汰/懒恢复/水合窗口/同组单活/`session-evicted`/`evicted`）+ review-tech 警告5 扩围 | `CONTEXT.md`「会话生命周期术语」节（6 行，定义 + 关联实体 + 上下文） | docAssets 046 标准2（六术语字面） | COVERED |
| REQ-AGENT-046 标准 3：文档术语与代码/IPC 实际命名一致（防漂移） | 术语表字面与接口 2（`session-evicted`）/接口 3（`evicted` 错误码）/groupOf 语义一致 | docAssets 046 标准3 | COVERED |
| D7 成功标准 5：③ ADR（暂不分进程 + 重估触发条件）落盘；agent 三义写入 CONTEXT.md | ADR-019 + CONTEXT.md 三义节 | docAssets 045/046 + REFLECT 人工验收 | COVERED |
| PRD §12 范围外：分进程任何建造 / 代码改动 / E2E | 本 slice 纯文档（4 文件，零 src/ 改动、零 E2E） | 全量 api/cli 662/662（无行为面变更） | 遵守 |

**refactor 结果**：无（纯文档切片，无代码）。

---

## 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v6 | 2026-08-08 | Slice 5 记录：ADR-019（维持单进程 + 重估触发条件 + 不变关系）/ ADR-020（权限单一真源化 + 修订 ADR-017 关系）+ adr/README 索引 +2 + CONTEXT.md 术语归位（agent 三义 + 六术语）+ docAssets 5/5 与 policyCodegen 标准6 转绿 + 全量 662/662 + PRD→代码可追溯性表 |
| v5 | 2026-08-08 | Slice 4 记录：权限缝（policyRules 规则表唯一真源 + 评估器消费规则表 + gen-agent-policy 生成器 + golden 重生成 -7 不可见族/+2 pnpm 补全）+ 占位断言待强化清单 + PRD→代码可追溯性表 |
| v4 | 2026-08-08 | Slice 3 记录：水合窗口规则化（统一水合循环 + hydrationWindowMs seam + 诊断日志）+ session-evicted 丢句柄（接口 2）+ evicted 重投（接口 3，防环一次）+ 占位断言待强化清单 + PRD→代码可追溯性表 |
| v3 | 2026-08-08 | Slice 2 PRD 对齐修复记录：M1 touch 来源区分（clearPending）、M2 onWarn 注入、M3 E1 诊断 + 表修正、U1 worker 侧 tombstone 判别（evicted）、U2/U3 tech-design 数据流 1 与模块关系图修正 |
| v2 | 2026-08-08 | Slice 2 记录：sessionLifecycle 模块（抽取+TTL/LRU/组冷却/tombstone）+ worker 委托 + seam 注入 |
| v1 | 2026-08-08 | 初始化：切片规划 + seam 速记 |
