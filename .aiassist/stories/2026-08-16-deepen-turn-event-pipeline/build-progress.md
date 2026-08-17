# Build 进度 — 回合事件管线深化（turnEventPipeline）

> 2026-08-17 · /implementer · 契约 v4（哈希 437b549f0dedfb99f9d116bc37781c6b17d6fbc4ddf572c2e5d95d9dc43c08ac）
> 测试命令：`npm run test:unit`（单文件：`NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test <file>`）

## 切片规划

| Slice | 内容 | REQ-ID | 目标测试 | 依赖 |
|---|---|---|---|---|
| 1 | turnEventPipeline 工厂模块本体（六接口 + touch 注入 + limitSize/MAX_IPC_BYTES 导出，import 无副作用） | REQ-106/107/108/109-AC1~3/110 单元面 | `api/turnEventPipeline.test.js` + `api/limitSizeSingleSource.test.js`（单元组） | — |
| 2 | worker.js 接线（forwardEvent 调用点 → onSessionEvent；evict/reset → clearSessionState + 装配态登记；handlePrompt → beginTurn/takeLastReply/takeTurnDiagnostics） | REQ-109-AC4/111 | `api/resetDropQueue.test.js` + `api/workerWiring.test.js` | 1 |
| 3 | agentService.js 单源化（enforceSizeLimit 删除 → 3 调用点 249/346/963 import limitSize） | REQ-110 集成面 | `api/limitSizeSingleSource.test.js`（集成组） | 1 |

## 切片进度

### Slice 1 完成（2026-08-17，`5f4518e` [build] + `ef48774` [test] + `7415cb9` [refactor]）

- PRD 对齐：ALIGNED（零漂移；两个 UNCERTAIN 均「照旧即对齐」）
- refactor：`7415cb9`（limitSize helper 提取 / drainPendingTextEnds / onSessionEvent 分解 / 死代码移除；父代理复验 23/24 分布不变、diff 仅模块文件）
- test-gap：REQ-109 AC3 计数 3→2（人确认分类，`ef48774`）
- 遗留：AC6 集成红 = slice 3 依赖（预期）

### Slice 2 完成（2026-08-17，`27d5c9d` [build] + 本 commit [docs]）

- PRD 对齐：ALIGNED（零漂移；接线清单 10 项全部落地）
- 产物：worker.js 接线——管线实例创建（注入 send/log/touch(clearPending:false)/setTimeout/clearTimeout/now）+ 装配态 4 Map 登记（toolContexts/sessionQueues/sessionModes/judgeModels）+ evict/reset handler 改调 `clearSessionState` + toolSurface/subscribe 调用点改 `onSessionEvent` + subscribe SDK 计数写入新接口 `recordSdkEvent` + handlePrompt 改 `beginTurn`/`takeLastReply`/`takeTurnDiagnostics`；删除 worker 内已收编代码（limitSize/MAX_IPC_BYTES/mapToContractEvent/回合状态 5 Map/pending 两函数/forwardEvent，约 240 行）；`getOriginalToolName` import 随 mapToContractEvent 迁出删除（唯一使用点）；turnEventPipeline.js 补 `recordSdkEvent`（§10.4 接口 4 写入接口补全，父代理已同步 prd/requirements 文档）
- 保持：spawn-only 零新增导出；新增 import 仅 `./turnEventPipeline.js`（src/agent 内部，§12）
- 验证：workerWiring 4/4 绿；REQ-111 AC5 回归清单（sessionEvents/workerToolEventExt/sessionIdleEviction/agentModelResolveLocal）20/20 绿；agentDialogue + sessionStop 12/12 绿；slice 1 回归 23/24（唯一红 = AC6 inMemory 出口，slice 3 依赖，预期）
- 遗留：resetDropQueue 1 例红 = **测试缺陷**（ready 监听时机：`svc.start()` 已消费首个 ready 事件后测试才挂 `svc.on("ready")` → waitUntil 恒 10s 超时；基线即红，与接线无关）——等价 harness 复现该测试全部断言 ALL PASS（流式中 reset → prompt1 按序完成 ok:true + 重建后新 prompt 正常 + 无 error 事件）；/bug 路由 test-gap 人确认（Concerns #2）

#### Slice 2 PRD→代码 可追溯性表

| PRD 意图（锚点） | 实现位置 | 测试文件（REQ） | 状态 |
|---|---|---|---|
| 管线实例接线 + touch 注入（§10.2/§10.4 接口 1；§10.3 数据流 5；review B2） | worker.js `createTurnEventPipeline({ send, log, touch, setTimeout, clearTimeout, now })`（lifecycle 之后、sweepTimer 之前） | workerWiring REQ-111 AC1-4（spawn 全链） | COVERED |
| 装配态登记（稳定块 2：toolContexts/sessionQueues/sessionModes/judgeModels 登记、worker 持有） | worker.js `registerSessionScopedMap`×4（管线创建后） | resetDropQueue REQ-109 AC4（注册表 reset 清理接入无回归；harness 验证） | COVERED |
| 淘汰清理一条路径（§10.3 数据流 6；§6.3-4） | worker.js handleSessionEvicted → `turnPipeline.clearSessionState(key)`（dispose/session-evicted/log 保留） | sessionIdleEviction 回归 20/20（含 evict 侧） | COVERED |
| reset 清理一条路径（§10.4 接口 6；决策 A 清队列；§8 排队场景不存在行） | worker.js handleResetSession → `turnPipeline.clearSessionState(msg.sessionKey)`（dispose/lifecycle.remove/log 保留） | resetDropQueue REQ-109 AC4（harness 复现全断言 PASS） | COVERED |
| 调用点迁移：forwardEvent → onSessionEvent（§10.4 接口 1） | worker.js toolSurface onEvent（tool_execution_error）+ agentSession.subscribe（全事件） | workerWiring REQ-111 AC2（事件链形状/meta） | COVERED |
| sdkStats 写入接口（§10.4 接口 4；BUG-002 诊断 4） | turnEventPipeline.js `recordSdkEvent(sessionKey, t)` + worker subscribe 调用（条件筛选不变） | 管线单元 REQ-107 AC4/AC5（存/取/清）；workerWiring 经 prompt-result 日志 | COVERED |
| handlePrompt 改管线接口（§10.4 接口 2/3/4；决策 B：beginTurn 幂等清 + 取出即删） | worker.js `beginTurn`（enqueue 回调开头）/ `takeLastReply`（读取不删）/ `takeTurnDiagnostics`（取出即删） | workerWiring REQ-111 AC3（两轮 reply 不串轮） | COVERED |
| spawn-only 保持（稳定块 4；§12：不增加导出，import 仅 src/agent 内部） | worker.js 零新增导出；新增 import 仅 `./turnEventPipeline.js` | workerWiring REQ-111 AC1（spawn 启动照旧） | COVERED |
| 截断单真源 worker 侧收编（§10.4 接口 7；MAX_IPC_BYTES 单源） | worker.js limitSize/MAX_IPC_BYTES 删除（管线导出承接；grep 零残留除注释） | limitSize 单元 AC1-5 + workerWiring 全链 | COVERED |
| 主进程侧单源化（稳定块 3：agentService enforceSizeLimit 删除、3 调用点 import） | —（slice 3） | limitSize 集成 AC6/AC7 | GAP（slice 3） |

#### Concerns（等父代理裁决）

1. ~~**REQ-109 AC3 末断言计数缺陷**~~ → 已解决（`ef48774` [test] 3→2 落地，slice 1 回归 23/24 证实）。
2. **resetDropQueue 1 例红 = 测试缺陷（test-gap 候选，需人确认分类）**：`svc.start()` 内部 `emitter.once("ready")` 已消费首个 ready（agentService.js:1446「await start() = 等待首个 ready」），测试在 `await svc.start()` 之后才挂 `svc.on("ready", ...)`（resetDropQueue.test.js:83-85）→ ready 事件永不二次到达（worker 只在启动发一次 ready，worker.js 启动帧）→ `waitUntil` 恒 10s 超时。基线（接线前）即红，与 slice 2 实现无关；workerWiring 同 seam 在 start **之前**挂监听故绿。等价 harness 复现该测试全部断言（流式中 reset → prompt1 按序完成 ok:true + 重建后新 prompt ok:true + 无 error 事件）**ALL PASS**——生产 reset 语义与注册表清理接入无回归。处置建议：/bug 分类 test-gap → /test-author 将 `svc.on("ready")` 移到 `svc.start()` 之前（或删除 ready 等待——start() 已保证就绪）（[test] commit，人确认）。
3. **toolAdapter import 环依赖（低风险，slice 3 起生效）**：turnEventPipeline → toolAdapter → cli/server → http/server → routes/settings → agentService →（slice 3 起）turnEventPipeline 成环。已实证安全：① agentService 现已在主进程闭包内 import cli/server.js（无新增模块入图）；② 环上全部导出为函数声明、仅调用期使用（ESM live binding，无 TDZ 求值序风险）；③ worker bundle（rollup）对环处理成熟。若 slice 3 接线后出现求值序问题，回退方案 = getOriginalToolName 改注入（工厂选项）。**slice 2 实证**：worker bundle 侧未受影响——本 slice 起 worker 已 import turnEventPipeline（经 toolAdapter）并全链 spawn 测试 20/20 绿，未观测到求值序问题。
4. ~~**sdkEventCounts 写入方归属**~~ → 已解决（slice 2 接线：`recordSdkEvent` 补入管线 §10.4 接口 4 写入接口，worker subscribe 调用）。

### Slice 3 完成（2026-08-17，`d92f23e` [build]）

- PRD 对齐：ALIGNED（零漂移；§4 稳定块 3 / §10.2 agentService 行 / §10.4 接口 7 调用方 249/346/963 / §10.5 截断取强人拍板 Q2 / §8「主进程兜底超限」行）
- 产物：agentService.js 单源化——本地 `enforceSizeLimit`（L228-242）与本地 `MAX_IPC_BYTES` 常量（L66）删除；3 调用点（emitErrorEvent / inMemory runTurn / 子进程消息回传 case "session-event"）改 import `limitSize`（+ `MAX_IPC_BYTES` 单源引用，turnEventPipeline 导出）；保持其它一切不动（不顺手重构）
- 行为变化（§2 唯二之一 ①）：主进程侧工具事件超限**不再整条降级**——保 toolCallId/name/status/isError + 数据载体迭代收紧截断 + truncated:true（REQ-AGENT-055 语义）；文本事件行为与旧弱实现等价（AC7 回归）
- ESM 环实证安全（Concerns #3 落地验证）：agentService → turnEventPipeline → toolAdapter → cli/server → http/server → agentService 成环——环上导出全部函数声明、仅调用期使用（ESM live binding，无 TDZ 求值序问题）；worker 侧全链 spawn 测试不受影响
- 验证：node --check 过；`limitSizeSingleSource.test.js` 8/8 全绿（**AC6 转绿** = slice 1 起唯一红消失；AC7 保持）；api 全套（turnEventPipeline/resetDropQueue/workerWiring/limitSizeSingleSource）**30/30 全绿**
- 遗留：无（QA 阶段 REQ-111 AC5 回归清单覆盖见 slice 2 记录）

#### Slice 3 PRD→代码 可追溯性表

| PRD 意图（锚点） | 实现位置 | 测试文件（REQ） | 状态 |
|---|---|---|---|
| 截断单真源（§4 稳定块 3；§10.5 截断取强人拍板 Q2） | turnEventPipeline.js `limitSize`/`MAX_IPC_BYTES` 导出（slice 1） | limitSizeSingleSource REQ-110 AC1-5（单元四分支） | COVERED |
| 本地 enforceSizeLimit 删除（§10.2 agentService 行「enforceSizeLimit 删除 → 3 调用点 import limitSize」） | agentService.js 函数体删除（grep 零残留除注释） | 删除即覆盖——行为经 AC6/AC7 集成断言 | COVERED |
| 调用点 249：emitErrorEvent（§10.4 接口 7 调用方） | agentService.js emitErrorEvent → `limitSize({type:"error",...})` | 既有 session-error 形状回归（error 事件契约不变） | COVERED |
| 调用点 346：inMemory runTurn（§10.4 接口 7 调用方；§11.1 seam 3 集成） | agentService.js runTurn → `session.emit("session-event", limitSize(ev))` | limitSizeSingleSource REQ-110 **AC6**（超限工具事件保契约字段，转绿）/ **AC7**（文本等价） | COVERED |
| 调用点 963：子进程消息回传（§10.4 接口 7 调用方；§8「主进程兜底超限」行） | agentService.js case "session-event" → `limitSize(msg.event)` | workerWiring REQ-111 AC2（spawn 全链）+ 既有黑盒回归 | COVERED |
| 主进程兜底超限保契约字段（§6.3-6 锚点：300KB 工具事件保四字段、序列化 ≤ 262144） | limitSize 工具数据载体分支（shrinkToolCarrier 迭代收紧，slice 1） | limitSizeSingleSource REQ-110 AC4/AC4b（单元）+ AC6（主进程侧集成实证） | COVERED |
| MAX_IPC_BYTES 常量单源（§10.4 接口 7；REQ-106 AC3 锚点 262144） | 本地常量删除；单源 = turnEventPipeline 导出（agentService import 引用） | limitSizeSingleSource（`pipelineMod.MAX_IPC_BYTES === 262144` 断言） | COVERED |
| 保持 agentService.js 其它一切不动（§12 范围外；不留手重构） | diff 仅 3 处（import + 删除 + 3 调用点改名），30 行净减 | api 全套 30/30 无回归 | COVERED |

### Slice 3 完成（2026-08-17，`d92f23e` [build] + `df18752` [docs] + `1da6157` [refactor]）

- PRD 对齐：ALIGNED（单源零残留、3 调用点一个不漏、AC6 转绿实证）
- refactor：`1da6157`（移除死绑定 MAX_IPC_BYTES import，1 行；父代理复验 30/30）
- 验证：limitSizeSingleSource 8/8、api 全套 30/30（AC6 修复后最后一个红消失）

### BUILD 完成汇总（2026-08-17）

| Slice | commit（build） | commit（refactor） | 验证 |
|---|---|---|---|
| 1 管线模块 | 5f4518e | 7415cb9 | 单元 22/22 + limitSize 单元 6/6 |
| 2 worker 接线 | 27d5c9d | 6992614a | spawn 5/5 + 回归 20/20 + slice1 回归 |
| 3 agentService 单源 | d92f23e | 1da6157 | 30/30 全绿 |

- test-gap 修正 ×3（人确认分类）：REQ-109 AC3 计数 3→2（ef48774）/ resetDropQueue ready 监听（49d33cf）/ recordSdkEvent 单元覆盖 + AC2 计数 7→8（7d58ac2，v4）
- 契约版本：v1→v2（review B1-B4）→v3（recordSdkEvent 接口补全）→v4（AC2 计数修正）；当前 v4 哈希 437b549f
- 全量回归：npm run test:unit（结果见 QA 报告）
