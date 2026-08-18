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

（待 Slice 2）
