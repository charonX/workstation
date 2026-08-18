# Build Progress — 2026-08-16-deepen-db-per-path-cache

> BUILD 开始：2026-08-18（门 1 通过，signer=AI）
> 契约：requirements v1（hash db8799ff）+ signoff.md + prd.md §10（simple）+ 全量 55 调用点零改动硬约束
> 硬约束：既有测试文件零改动全绿；commit 纪律（[build] 不含测试文件）

## 切片计划

| Slice | REQ | 内容 | 测试载体 | 依赖 |
|---|---|---|---|---|
| 1 | REQ-WORKSPACE-014/015 | db.js 单槽 → per-path Map<path, Database>（同路径同句柄/多路径并存/句柄可缓存）；closeDb(path?) 无参关全部/定向关；:memory: 缓存但 closeDb 清；resetDb(path?) 语义保持（无参→defaultDbPath） | dbPerPathCache.test.js 11 例（6 RED→绿）+ 全量回归 | 无 |
| 2 | REQ-WORKSPACE-016 | 最少必要调用点防御注释删除（直接受益于"句柄可缓存"的调用点，逐个甄别）+ 全量回归零破坏 | 全量回归 + 具体清理点行为断言 | Slice 1 |

## 基线

- 全量单测基线（2026-08-18，`npm run test:unit`）：972 tests / 972 pass / 0 fail（两已收 story 全绿）。
  本 story 加入后：978 tests / 972 pass / 6 fail（6 = dbPerPathCache 的 per-path RED）。
  停机条件：6 fail → 0 fail（仅本 story seam 测试转绿，其余零回归）。

## Slice 进度

### Slice 1（2026-08-18）：db.js per-path 连接缓存（REQ-WORKSPACE-014/015）✅

实现：`src/db.js` 单槽 `{db, currentPath}` → `Map<path, Database>`。getDb 同路径命中缓存直接
返回、未命中 open+initSchema+migrateSchema+cache.set；closeDb() 无参关全部 / closeDb(path)
定向关（不存在 no-op）；resetDb(path?) 无参 → defaultDbPath()（`:memory:` 兜底因无 currentPath
撤除，真实服务路径均 data.db）；:memory: 进缓存、closeDb 清全部。

PRD→代码 可追溯性表：

| REQ AC | 实现位置（src/db.js） | 测试 | 状态 |
|---|---|---|---|
| REQ-014 AC1 同路径两次 getDb 同一句柄 | getDb：`if (cache.has(target)) return cache.get(target)` | dbPerPathCache AC1 | COVERED |
| REQ-014 AC2 异路径并存互不驱逐 | getDb 移除关旧库逻辑（切路径不再 close） | dbPerPathCache AC2 | COVERED |
| REQ-014 AC3 不同路径不同句柄 | Map 以 path 为 key → 异 path 异连接 | dbPerPathCache AC3 | COVERED |
| REQ-014 AC4 句柄可跨路径安全持有 | 连接仅 closeDb 显式关闭，getDb(B) 不伤 A | dbPerPathCache AC4 | COVERED |
| REQ-014 AC5 无参 getDb 走默认路径 | `const target = dbPath \|\| defaultDbPath()` | dbPerPathCache AC5 | COVERED |
| REQ-015 AC1 closeDb() 关全部 | closeDb 无参分支遍历 `cache.values()` + `cache.clear()` | dbPerPathCache AC1 | COVERED |
| REQ-015 AC2 closeDb(path) 定向关 | closeDb 定向分支 `cache.get` → close → `cache.delete` | dbPerPathCache AC2 | COVERED |
| REQ-015 AC3 closeDb(不存在) no-op | `if (!db) return`（不抛） | dbPerPathCache AC3 | COVERED |
| REQ-015 AC4 :memory: 共享 + closeDb 清 | :memory: 进缓存；closeDb() 清全部 | dbPerPathCache AC4 | COVERED |
| REQ-015 AC5 resetDb(path) 只 drop 该路径 | resetDb `getDb(dbPath ?? defaultDbPath())` + 固定 DROP 列表 + 动态清遗留表 | dbPerPathCache AC5 | COVERED |
| REQ-016 AC1 全量回归零破坏 | 55 调用点零改动；全量 test:unit 999/999 | 全量回归门 | COVERED |

Slice 1 停机条件达成：`dbPerPathCache.test.js` 11/11 绿（修复前 5 绿 6 RED）→ 全量
`npm run test:unit` 999 tests / 999 pass / 0 fail（含本文件）。本 slice 无既有测试回归。

实现备注：
- REQ-015 AC5 契约要求 resetDb 也 drop 调用方自定义表（用例中的 `t` 不在固定 DROP 列表内）——
  固定 DROP 列表保持不动，其后追加 sqlite_master 遗留表动态清除（DROP TABLE IF EXISTS，identifier
  白名单校验），再 initSchema。既有 resetDb 调用点（executionLog/skillInjection/workerAssembly/
  agentConfig/conditionConfig/triggerConfig + server.js:85 + 三服务无参 resetDb）全为标准 schema，
  动态清除无影响（全量 999/999 证实）。
- closeDb() 由"关当前一个"升级为"关全部"（超集语义，signoff 已确认）；server.js:462 停服路径受益。

### Slice 2（2026-08-18）：最少必要调用点防御注释清理（REQ-WORKSPACE-016）✅

实现：逐个甄别全部 55 处 getDb 调用点（20+ 模块）——仅 1 处存在直接因单槽切路径语义而写的
防御注释（sessionStore），删除/重写；其余 54 处为正常"每操作取一次"用法或无单槽防御注释，
一律 KEEP。行为逐字节等价（只省去防御注释，未动任何逻辑/错误处理/表操作）。

清理点清单：

| 文件:行 | 原防御注释 | 清理后 |
|---|---|---|
| src/services/sessionStore.js:64-68 | "全局 getDb() 单连接按路径切换——其他服务（taskService 等走 data.db）切换会关闭本库连接，捕获引用会在切换后失效（"database is not open"）。按操作重新获取保证跨服务切换后本库仍可用" | 删除单槽切路径防御说明，重写为 per-path 现状："数据库连接经 getDb(dbPath) 按路径缓存（同路径同句柄、可安全持有）——惰性访问器延迟到首次操作才打开（ADR-009 模块级无副作用），路径一致时每次调用零开销"。`const db = () => getDb(dbPath)` 惰性访问器保留（ADR-009 惰性初始化 + 同路径零开销），不做跨函数状态化。 |

KEEP 代表调用点（为何不动）：

| 调用点 | 保留理由 |
|---|---|
| src/services/notificationService.js:6-14（getDbRef + `!db \|\| !db.open` 自愈） | 防御对象是 closeDb()（测试隔离）而非单槽切路径——per-path 后 closeDb() 仍关全部（REQ-015 AC1），缓存句柄仍可能被关，自愈机制功能上必需，注释仍准确 |
| src/services/mcpService.js:224 / permissionAdjudicator.js:85（`const db = () => getDb(path)` 惰性访问器） | 无单槽防御注释，属正常惰性访问用法 |
| src/services/taskService.js / flowService.js / projectService.js / contentSourceService.js / executionRunner.js / channelBindingService.js / schedulerService.js / main.js / http/server.js / http/routes/agentSessions.js / sessionDomain.js / imRouter.js（"每操作取一次 getDb"） | 每函数一次取句柄、函数内复用，属正常使用方式；无同函数冗余重取 |
| src/http/server.js:105 注释（"propagate the path so the lazily-opened getDb() lands on the requested file"） | 解释 DB_PATH 传递（惰性打开落到请求文件），非单槽防御 |

测试证据：`npm run rebuild:node -- --foreground-scripts` + 全量 `npm run test:unit` →
**999 tests / 999 pass / 0 fail**（REQ-016 AC1：55 调用点 + 全部既有 DB 测试零回归；
AC2 由回归门 + sessionStore 建行/读行既有用例承载）。

实现备注：
- REQ-016 AC2（清理点行为断言）无独立用例——signoff 已裁决由 AC1 全量回归门间接承载；
  本次清理点仅删注释，无行为改动，回归门 + sessionStore 既有用例已覆盖。
- 工作树遗留：signoff.md 含 Slice 1「实现期语义声明」10 行未提交（Slice 1 两个 commit
  未包含）——不在本 slice commit 范围（只 add 被清理 src + build-progress.md），留给父代理
  归档处理。
