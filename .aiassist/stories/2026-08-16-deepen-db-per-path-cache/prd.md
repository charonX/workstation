# DB 连接 per-path 缓存——消除全局单槽互斥驱逐

> 状态：已完结（历史记录）——REFLECT 门 2 通过（2026-08-19），本 story spec 降级为历史记录；逻辑真值看代码，意图真值看全局文档（ADR-033 / engineering-lessons / STANDARDS / business-capabilities）。含 BUG-001（notificationService 单槽残留迁移）。

## 1. 问题陈述

`db.js` 是全局单槽连接：`getDb(path)` 在路径变化时**关旧库开新库**。后果：

- 每个模块被迫"每次操作重新取"（55 处 `getDb()` 横跨 20+ 模块），缓存一次句柄就可能
  被别的模块切路径时关掉 → database-not-open；
- 模块间互相驱逐对方的连接（`data.db` 与 `agent-sessions.db` 不能同时持有）→ 跨库 join
  全部 JS 侧手工归并；
- 正确用法（"不要缓存句柄，每次重取"）靠注释与纪律维持，是持续的正确性陷阱。

一句话痛点：**连接生命周期是全局隐式状态，正确用法靠注释与纪律维持。**

## 2. 解决方案

db.js 从单槽改为 **per-path 连接缓存**（Map<path, Database>）：

- `getDb(path)` 同路径返回同一句柄（**可缓存**，database-not-open 风险消除）；
- `data.db` 与 `agent-sessions.db` **同时打开互不驱逐**；
- `closeDb()` 语义升级为**关闭全部**（+ 可选 `closeDb(path)` 关单个）；
- `:memory:` 保持共享语义（缓存），`closeDb()` 清全部；
- 透明替换——`getDb(path)` 签名不变，55 处调用零改动；最少必要调用点顺带清理防御注释。

## 3. 用户故事

- 作为读写 DB 的模块（taskService/flowService/projectService/sessionStore/... 20+），
  我持有 `getDb(path)` 返回的句柄后，**其他模块切到别的路径不会关掉我的连接**——我不再
  需要每次操作重取，也不用担心句柄失效。
- 作为测试作者，我在测试里同时用 `data.db` 和 `agent-sessions.db`（或 `:memory:`），
  不需要在两者间反复切槽，`closeDb()` 一次清干净。

## 4. 稳定块

| 块 | 内容 |
|---|---|
| B1 | per-path 连接缓存（db.js 单槽 → Map<path, Database>；同路径同句柄；多路径并存互不驱逐） |
| B2 | closeDb 语义升级（closeDb() 关全部 + 可选 closeDb(path)；:memory: 缓存但 closeDb 清全部） |
| B3 | 最少必要调用点清理（直接受益于句柄可缓存的防御注释删除；非全量 55 点） |

## 5. 移动块

- 55 处调用点的全量重构（防御注释删除随模块逐个跟进，另立切片/story）。
- 跨库 join 的 JS 侧手工归并改进（依赖连接并存能力，但归并逻辑本身另立）。

## 6. 用户操作流

### 6.1 主路径（模块/测试调用方视角）

1. `const a = getDb(pathA)` → 打开 data.db，返回句柄。
2. `const b = getDb(pathB)` → 打开 agent-sessions.db，**不关闭 a**（原行为会关）。
3. `a.prepare(...)` 与 `b.prepare(...)` 均可正常执行（双库并存）。
4. 重复 `getDb(pathA)` → 返回**同一**句柄（可缓存、可安全持有）。
5. 测试结束 `closeDb()` → 全部连接关闭；下次 `getDb(path)` 重开。

### 6.3 预期值锚点

| 场景 | 锚点值 |
|---|---|
| `getDb(A) === getDb(A)` | 同路径两次返回同一句柄（strictEqual） |
| `getDb(A)` 后 `getDb(B)` | A 仍可执行查询（未被关闭） |
| `getDb(A) !== getDb(B)` | 不同路径不同句柄（并存） |
| `closeDb()` 后 `getDb(A)` | A 重新打开（新句柄，可再查） |
| `closeDb(A)` 后 `getDb(B)` | B 仍可用（定向关只关 A） |
| `:memory:` 两服务同路径 | 共享同一内存库（同句柄）；`closeDb()` 后重新取为新库 |
| DB_PATH 未设 | `getDb()` → defaultDbPath()（`~/.opc-workstation/data.db`，既有语义不变） |

## 7. 表单与输入验证

- `getDb(path)`：path 为 string 或 undefined（undefined → defaultDbPath）；`:memory:` 特例
  （无文件操作）；其余按既有 unwritable 校验。
- `closeDb(path?)`：无参 → 关全部；传 path → 只关该路径（不存在则 no-op）。
- 无新增用户输入。

## 8. 错误状态与失败响应

| 场景 | 行为 |
|---|---|
| DB 目录不可写 | `E-DB-UNWRITABLE`（既有，不变） |
| DB 文件被删 + 持有缓存句柄 | 句柄操作抛 SQLITE 错（better-sqlite3 语义）；`getDb(path)` 重取会重开（文件不存在 → 新建）——与既有单槽行为一致 |
| `closeDb(path)` 路径不存在 | no-op（不抛） |
| `:memory:` | 无文件错误路径（缓存 + closeDb 清） |

## 9. 复杂度分级

**simple**——单模块（db.js）内部数据结构替换（单槽 → Map）+ closeDb 语义升级 + 边界测试；
不触碰 55 处调用点，无新基础设施，无跨模块契约变更。

## 10. 技术方案（simple 高层）

### 10.2 模块与边界

| 模块 | 职责（本 story 增量） |
|---|---|
| `src/db.js` | 单槽 `{db, currentPath}` → `Map<path, Database>`；`getDb(path)` 命中缓存直接返回、未命中 open+initSchema+migrateSchema+cache；`closeDb(path?)` 无参关全部 / 传 path 关单个；`resetDb(path?)` 保持（操作指定/默认路径库）；`:memory:` 进缓存但 closeDb 清 |
| 调用点（最少必要） | 顺带删除直接受益于"句柄可缓存"的防御注释（如 sessionStore/confirmationService 中"不要缓存"类注释）——**逐个甄别，非全量** |

### 10.3 数据流

`getDb(path)` → `cache.get(path)` 命中 → 返回同一句柄；未命中 → `new Database(path)` +
initSchema + migrateSchema → `cache.set(path, db)` → 返回。`closeDb()` → 遍历 `cache`
逐个 close + 清空；`closeDb(path)` → 定向 close + delete。

### 10.4 接口契约

| 接口 | 变化 |
|---|---|
| `getDb(path?)` | 签名不变；语义升级：同路径返回同一句柄（可缓存），多路径并存互不驱逐 |
| `closeDb(path?)` | 语义升级：无参关全部；新增可选 path 参数关单个（no-op 若不存在） |
| `resetDb(path?)` | 不变（操作指定/默认路径库，drop 表） |
| `defaultDbPath()` | 不变 |

### 10.5 关键决策

- **D1 per-path Map 缓存**：句柄可缓存是核心收益（消除 database-not-open + 每次重取）。
- **D2 closeDb() = 关全部**：单槽语义是"关当前一个"；升级为关全部是超集，既有单连接调用方
  不受影响；测试隔离（resetDb+closeDb）语义保持。
- **D3 :memory: 缓存 + closeDb 清**：保持单槽下 ":memory:" 共享语义；测试靠 closeDb 隔离。
- **D4 不做 LRU/引用计数/自动关闭**：进程生命周期 + 显式 closeDb 足够（过度设计否决）。
- **D5 透明替换**：55 处调用零改动；防御注释删除逐个甄别，不进大 diff。

### 10.7 安全/性能/可观测性

- 无新信任边界（连接句柄仍由模块内部持有，不跨进程/不落盘）。
- 性能正向：多库并存减少重开次数；每路径一次连接开销（better-sqlite3 单连接天然）。
- 可观测性：无新 telemetry；closeDb 遍历日志可选（不强制）。

## 11. 测试决策（含覆盖接缝）

### 11.1 覆盖接缝

| 块 | seam | 载体 |
|---|---|---|
| B1 | db.js 直测（node:test） | `tests/capabilities/workspace-management/server/<story>/api/dbPerPathCache.test.js`：同路径同句柄 / 异路径并存互不驱逐 / 句柄缓存安全（getDb(B) 后 A 仍可用） |
| B2 | db.js 直测 | closeDb() 关全部 / closeDb(path) 定向关 / :memory: 共享 + closeDb 清 / resetDb 保持 |
| B3 | 回归面 | 全量 `npm run test:unit`（55 调用点零改动全绿）——最少必要调用点清理后仍全绿 |

- 既有 DB 使用测试（全量 20+ 模块）是零改动硬约束回归面。
- fixture：临时目录多 DB 文件 + :memory:。

## 12. 范围外

- 55 处调用点全量重构（防御注释删除随模块逐个，另立）。
- 跨库 join 的 JS 手工归并改进。
- LRU/引用计数/自动连接回收。
- WAL/并发写等连接参数调优。

## 13. 补充说明

- 承接 `2026-08-16-deepen-session-domain`（ADR-030 边界：该 story 已先行不动 store 接口与
  DB 访问方式）；本 story 落地后 sessionStore/confirmationService 的句柄持有可安全化。
- 评审 "after" 态（per path 双开、comments deleted、handles cacheable）为本 story 的
  验收画像；"comments deleted" 指最少必要调用点，非全量。

## 14. PRD 完整性自检查

- [x] 每个稳定块至少一条 happy path（§6.1 步骤 1-5）
- [x] 涉及字段有验证规则（§7 getDb/closeDb 参数 + :memory: 特例）
- [x] 每块有预期值锚点（§6.3 六行，全可机器断言）
- [x] 失败场景覆盖（§8：不可写/文件删除/closeDb no-op）
- [x] 复杂度 simple（§9，理由充分：单模块 + 透明替换 + 零调用点改动）
- [x] §10 高层方案完整（模块表/数据流/接口契约/决策）
- [x] §11 seams 每块 ≥1 可测载体
- GAP：无悬空（B1/B2/B3 就地；移动块 §5；范围外 §12）
