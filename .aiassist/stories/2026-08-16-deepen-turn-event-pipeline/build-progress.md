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

### Slice 1 完成（2026-08-17，commit `0778a80`）

**产物**：`src/agent/turnEventPipeline.js`（新建，~370 行）——`createTurnEventPipeline({ send, log, touch, setTimeout, clearTimeout, now })` 工厂 + 7 实例接口（onSessionEvent / beginTurn / takeLastReply / takeTurnDiagnostics / registerSessionScopedMap / registerSessionCleanup / clearSessionState）+ 模块导出 `limitSize` / `MAX_IPC_BYTES = 262144`；import 无副作用（模块顶层零注入调用、零定时器）。worker.js / agentService.js 未动（slice 2/3）。行为语义与 worker.js forwardEvent/mapToContractEvent/limitSize/pendingTextEnds/abort 合成逐行对应（契约由既有 REQ-AGENT-006/009/012/035/055/057/091 锁定）。

**验证**：两目标文件 24 例 → 22 绿 / 2 红：
- 单元组 21/22 绿（turnEventPipeline 15/16 + limitSize 单元 6/6）
- 集成组 1/2 红（AC6 依赖 slice 3 agentService 单源化——按预期红；AC7 文本事件与旧实现等价已绿）
- **唯一单元红 = REQ-109 AC3 末断言计数缺陷（断言 3、正确 2）**——测试缺陷不属实现问题，证据见 Concerns #1，等父代理 /bug 路由（test-gap 分类，人确认）

#### PRD→代码 可追溯性表

| PRD 意图（锚点） | 实现位置 | 测试文件（REQ） | 状态 |
|---|---|---|---|
| 工厂模块 + import 无副作用 + 注入集（§10.2/§10.4 接口 1；稳定块 1） | `createTurnEventPipeline`（模块顶层零副作用；注入默认值仅在事件处理期使用） | turnEventPipeline REQ-106 AC1-4 | COVERED |
| 事件转发/映射出站（forwardEvent 搬移，§10.3 数据流 1/5） | `onSessionEvent`（计数 → 回合起点 → text_end 延迟分支 → message_end 冲刷/abort → map → touch → send） | REQ-106 AC4 / REQ-107 AC1/AC6 / B2 | COVERED |
| 延迟 text_end + meta 三字段（§10.3 数据流 3；§6.3-1） | `pendingTextEnds` + `flushPendingTextEnds`（注入 now 精确差；usage 完备才带 tokens） | REQ-107 AC2 | COVERED |
| 5s 兜底（§6.3-2；PENDING_TEXT_END_FALLBACK_MS=5000，unref） | `onSessionEvent` text_end 分支 arm 注入 setTimeout + `timer.unref?.()`（fake clock 数字 id 安全） | REQ-107 AC3 | COVERED |
| BUG-002 计数（§6.3-4）+ 清时机 B（§10.5：beginTurn 幂等清 + 取出即删） | `turnEventCounts` + `beginTurn` + `takeTurnDiagnostics` | REQ-107 AC4/AC5 | COVERED |
| 未知 key 照常转发 + touch 时机（review B2/B3） | `onSessionEvent` 无 key 守卫；touch 仅在实际映射出站路径（延迟分支/message_end 不调） | REQ-107 AC6 / B2 | COVERED |
| abort 合成（§6.3-3；BUG-010 语义；log 含「abort 收尾」） | `onSessionEvent` message_end 分支（stopReason=aborted 且无 pending 才合成；合成入 pending 后冲刷） | REQ-108 AC1-3 | COVERED |
| 注册表统一清理（§10.4 接口 5/6；稳定块 2：装配态登记 + 一条路径清全部） | `registerSessionScopedMap` / `registerSessionCleanup` / `clearSessionState`（cleanup 钩子先于 map.delete——pending 定时器 clear 依赖条目仍在） | REQ-109 AC1-2 | COVERED |
| 回合态随 clear 清（§6.3-5：lastReplies/计数/turnStartedAt/pending） | 5 内部 Map 自登记进注册表 + pendingTextEnds 走 cleanup | REQ-109 AC3（语义断言全绿；末计数断言缺陷见 Concerns #1） | PARTIAL |
| limitSize 四分支 + MAX_IPC_BYTES 单源（§10.4 接口 7；§6.3-6/7） | `limitSize` + `export const MAX_IPC_BYTES = 256 * 1024`（≤ 原样 / content / delta / 无载体兜底） | limitSize 单元 AC1-3/AC5 | COVERED |
| 工具事件数据载体迭代收紧保契约字段（§6.3-6；§10.5 截断取强 Q2） | `limitSize` input/output carrier（优先 input）while 二分收紧 + truncated:true | limitSize 单元 AC4/AC4b | COVERED |
| mapToContractEvent 契约映射（§10.4 接口 1：toolName→name / 带 name 透传 / 其余→null） | `mapToContractEvent`（getOriginalToolName 自 `./toolAdapter.js` import，worker.js:38 同款） | REQ-107 AC4（tool 计数路径）+ limitSize AC4 形状（透传分支） | COVERED |
| sdkStats 存/取/清（worker subscribe 维护写入；§10.4 接口 4） | `sdkEventCounts`（本模块只存/取/清；未注入时空对象 {}） | REQ-107 AC4 | COVERED |
| agentService 出口单源化（稳定块 3：3 调用点 249/346/963 import limitSize） | —（slice 3） | limitSize 集成 AC6/AC7 | GAP（slice 3） |
| worker.js 接线保持（稳定块 4：spawn-only + 装配态登记 + handlePrompt 改管线接口） | —（slice 2） | resetDropQueue / workerWiring | GAP（slice 2） |

#### Concerns（等父代理裁决）

1. **REQ-109 AC3 末断言计数缺陷（test-gap 候选，需人确认分类）**：AC3 最后断言 `sends.filter(m => m.type === "session-event").length === 3`，实际 2。三重证据「3 应为 2」：
   - worker.js forwardEvent 同序列（delta + text_end + message_end）恒 2 条出站（delta 即时 1 + message_end 冲刷 1）；
   - 同文件自证：REQ-107 AC4「2 delta + 1 end + 1 tool 共 4 条出站」（end 冲刷恰 1 条）、AC1「text_end 尚未出站」（排除即时发送）、AC2（1 delta + 1 end = 2 条）；
   - PRD 锚点：§6.3-1（2 delta + 1 end → 3 条，即单 delta 对应 2 条）、§6.3-2（1 delta + 兜底 end → 2 条）。
   不存在满足 AC1（text_end 必须延迟）又出 3 条的实现——断言为 test-author 计数笔误（v1 起存在；签核时全 RED、import 即失败，0 例执行故未暴露）。处置建议：/bug 分类 test-gap → /test-author 改 `3 → 2`（[test] commit，人确认）。本 slice 遵守「实现者对测试只读」，未改业务测试、未迁就实现。
2. **toolAdapter import 环依赖（低风险，slice 3 起生效）**：turnEventPipeline → toolAdapter → cli/server → http/server → routes/settings → agentService →（slice 3 起）turnEventPipeline 成环。已实证安全：① agentService 现已在主进程闭包内 import cli/server.js（无新增模块入图）；② 环上全部导出为函数声明、仅调用期使用（ESM live binding，无 TDZ 求值序风险）；③ worker bundle（rollup）对环处理成熟。若 slice 3 接线后出现求值序问题，回退方案 = getOriginalToolName 改注入（工厂选项）。
3. **sdkEventCounts 写入方归属**：本模块只存/取/清（beginTurn / takeTurnDiagnostics / clearSessionState 清；takeTurnDiagnostics 返回时未注入 → 空对象 {}），写入仍归 worker subscribe 回调（slice 2 接线时迁入）。
