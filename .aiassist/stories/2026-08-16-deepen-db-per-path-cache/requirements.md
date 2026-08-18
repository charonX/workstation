# 需求 — 2026-08-16-deepen-db-per-path-cache

> 契约锚点：prd.md §6.3 预期值锚点（六行全机器断言）+ §10.4 接口契约 + §7 验证规则。
> db.js per-path 连接缓存——消除全局单槽互斥驱逐；透明替换（getDb 签名不变）。

## REQ 概览

| REQ-ID | 标题 | 优先级 | 必须性 | scope | 测试类型 | capability | entity |
|---|---|---|---|---|---|---|---|
| REQ-WORKSPACE-014 | per-path 连接缓存（同路径同句柄、多路径并存） | P1 | 必须 | intra-module | 单元 | workspace-management | server |
| REQ-WORKSPACE-015 | closeDb 语义升级（关全部 + 定向关 + :memory:） | P1 | 必须 | intra-module | 单元 | workspace-management | server |
| REQ-WORKSPACE-016 | 最少必要调用点清理（防御注释删除，全量零回归） | P1 | 应该 | cross-module | 单元+回归 | workspace-management | server |

## 稳定块 → REQ 映射

| PRD 块 | REQ |
|---|---|
| B1 per-path 缓存 | REQ-WORKSPACE-014 |
| B2 closeDb 语义升级 | REQ-WORKSPACE-015 |
| B3 最少调用点清理 | REQ-WORKSPACE-016 |

---

## REQ-WORKSPACE-014：per-path 连接缓存

`db.js` 从全局单槽改为 per-path Map 缓存——同路径返回同一句柄（可缓存），多路径并存
互不驱逐，句柄缓存不再埋 database-not-open。

- capability: `workspace-management`；entity: `server`
- scope: `intra-module`；modules: src/db.js
- 测试路径：`tests/capabilities/workspace-management/server/2026-08-16-deepen-db-per-path-cache/api/dbPerPathCache.test.js`

### AC1 — 同路径两次 getDb 返回同一句柄

`getDb(pathA)` 与再调 `getDb(pathA)` → `===`（strictEqual 同一连接）。
EXPECTED-TRACE：prd.md §6.3（`getDb(A) === getDb(A)`）。

### AC2 — 异路径并存互不驱逐

`getDb(pathA)` 后 `getDb(pathB)` → 两连接并存；`getDb(pathA)` 的句柄仍可执行查询
（未被关闭）。
EXPECTED-TRACE：prd.md §6.3（`getDb(B)` 后 A 仍可用）。

### AC3 — 不同路径不同句柄

`getDb(pathA) !== getDb(pathB)`。
EXPECTED-TRACE：prd.md §6.3。

### AC4 — 句柄可跨路径安全持有

持有 `getDb(pathA)` 句柄，期间 `getDb(pathB)` 多次调用，A 句柄始终可执行查询。
EXPECTED-TRACE：prd.md §6.3（句柄可缓存）。

### AC5 — 无参 getDb 走默认路径

`getDb()`（无参）→ `defaultDbPath()` 路径的连接（`~/.opc-workstation/data.db` 或
DB_PATH env）。
EXPECTED-TRACE：prd.md §6.3（DB_PATH 未设 → defaultDbPath）。

**接口契约（intra-module）**：
```
getDb(path?: string) → Database
```
签名不变；语义升级：同路径同句柄（可缓存）、多路径并存互不驱逐。`:memory:` 特例见
REQ-WORKSPACE-015。

---

## REQ-WORKSPACE-015：closeDb 语义升级

`closeDb()` 关闭全部缓存连接（+ 可选 `closeDb(path)` 定向关）；`:memory:` 缓存但
`closeDb()` 清全部（测试隔离语义保持）。

- capability: `workspace-management`；entity: `server`
- scope: `intra-module`；modules: src/db.js
- 测试路径：`tests/capabilities/workspace-management/server/2026-08-16-deepen-db-per-path-cache/api/dbPerPathCache.test.js`

### AC1 — closeDb() 关全部

打开 A、B 两库后 `closeDb()` → 全部关闭；下次 `getDb(A)`/`getDb(B)` 重新打开
（新句柄，可查询）。
EXPECTED-TRACE：prd.md §6.3（closeDb 后重取重开）。

### AC2 — closeDb(path) 定向关

打开 A、B 后 `closeDb(A)` → A 关闭、B 仍可用；`getDb(A)` 重开为独立新连接。
EXPECTED-TRACE：prd.md §6.3（定向关只关 A）。

### AC3 — closeDb(path) 不存在 no-op

`closeDb("nonexistent-path")` → 不抛错（no-op）。
EXPECTED-TRACE：prd.md §8（no-op 不抛）。

### AC4 — :memory: 共享 + closeDb 清

两次 `getDb(":memory:")` → 同一句柄（共享语义）；`closeDb()` 后重新 `getDb(":memory:")`
→ 新句柄（清空）。
EXPECTED-TRACE：prd.md §6.3（:memory: 两服务同路径共享；closeDb 后新库）。

### AC5 — resetDb(path) 保持

`resetDb(pathA)` → 只 drop pathA 库的表，pathB 不受影响。
EXPECTED-TRACE：prd.md §10.4（resetDb 不变）。

**接口契约（intra-module）**：
```
closeDb(path?: string) → void
```
无参 → 关全部；传 path → 只关该路径（不存在 no-op）。`resetDb(path?)` 不变。

---

## REQ-WORKSPACE-016：最少必要调用点清理

直接受益于"句柄可缓存"的防御注释（如"不要缓存句柄/每次重取"类）逐个甄别删除；行为
不变，全量回归零破坏。

- capability: `workspace-management`；entity: `server`
- scope: `cross-module`；modules: src/db.js 直接消费者（sessionStore/confirmationService/
  agentSessions 等，逐个甄别）
- 测试路径：全量回归 `npm run test:unit`（55 调用点零改动硬约束）+ 具体清理点行为断言

### AC1 — 全量回归零破坏

清理后 `npm run test:unit` 全绿（既有 55 处 getDb 调用点 + 全部既有 DB 使用测试零改动）。
EXPECTED-TRACE：prd.md §11.1（55 调用点零改动全绿为硬约束）。

### AC2 — 清理点行为不变

被删防御注释的调用点（若有具体清理）行为断言保持——如 sessionStore 建行/读行正常。
EXPECTED-TRACE：prd.md §10.5 D5（透明替换，行为不变）。

**接口契约（cross-module）**：无契约变更——只删防御注释/冗余重取，不动 getDb 调用语义。
