# Build 进度 — 回合事件管线深化（turnEventPipeline）

> 2026-08-17 · /implementer · 契约 v2（哈希 ce30bc5a5b38a48fb78ab31fd56d388918e59094597535cdedd97028604f5d15）
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
