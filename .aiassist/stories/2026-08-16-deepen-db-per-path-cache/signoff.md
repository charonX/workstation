# 签核记录 — 2026-08-16-deepen-db-per-path-cache

## Assertion（门 1，2026-08-18）

### 检查清单

- [x] PRD §14 无 GAP 悬空（B1/B2/B3 全就地补；移动块 §5——55 点全量重构/跨库 join 归并；范围外 §12——LRU/连接参数调优）
- [x] 每个 REQ-ID 都有对应测试（REQ-WORKSPACE-014/015/016 → db 直测 1 文件 11 例）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`（v1-hash:db8799ff）、`CAPABILITY-TRACE`、
      `ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、`ASSERTIONS-SIGNED`（机械核验）
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致
      （workspace-management/server，server 行已追加 2026-08-16 测试路径与 REQ-014~016）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（grep 0 命中）
- [x] 预期值来源清晰：每条 expected 值 trace 到 prd.md §6.3/§8/§10.4 锚点
      （getDb 同句柄/并存/异句柄/句柄可持有/closeDb 关全部/定向关/no-op/:memory:/resetDb/默认路径）
- [x] 无快照当判定依据（全部字面值/行为断言）
- [x] 边界/错误 case 已覆盖（no-op 不抛、:memory: 共享与清空、resetDb 双库隔离、DB_PATH env 隔离）

### expected 值交叉验证（EXPECTED-TRACE ↔ prd.md 锚点）

| 断言组 | 锚点来源 | 值一致 |
|---|---|---|
| getDb(A) === getDb(A) | §6.3 | ✅ |
| getDb(B) 后 A 仍可执行查询 | §6.3（并存互不驱逐） | ✅ |
| getDb(A) !== getDb(B) | §6.3 | ✅ |
| 句柄可跨路径安全持有 | §6.3（database-not-open 风险消除） | ✅ |
| 无参 getDb → defaultDbPath | §6.3 + §10.4 | ✅ |
| closeDb() 关全部、重取重开 | §6.3 | ✅ |
| closeDb(pathA) 定向关、B 不受影响 | §6.3 + §10.4 | ✅ |
| closeDb(不存在) no-op 不抛 | §8 | ✅ |
| :memory: 共享 + closeDb 清 | §6.3 | ✅ |
| resetDb(pathA) 只 drop A | §10.4 | ✅ |

### 升级点结果

| 升级点 | 内容 | 处置 |
|---|---|---|
| REQ-016 AC2（清理点行为断言）无独立用例 | 清理的调用点尚未甄别（BUILD 期才知道删哪几处）；AC2 由 AC1 的回归门（全量 test:unit 零破坏）间接承载 | 非升级；REFLECT 复核清理清单 |
| closeDb() 语义升级（单槽"关当前一个"→ per-path"关全部"） | 超集语义；既有单连接调用方"只要清理"场景无感知；测试隔离（resetDb+closeDb）语义保持 | 已在 PRD 定稿时人确认 |

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-WORKSPACE-014 | api/dbPerPathCache.test.js（AC1-AC5） | workspace-management/server |
| REQ-WORKSPACE-015 | api/dbPerPathCache.test.js（AC1-AC5） | workspace-management/server |
| REQ-WORKSPACE-016 | api/dbPerPathCache.test.js（AC1）+ 全量回归门 | workspace-management/server |

既有测试承载（零改动硬约束验收面）：全量 20+ 模块 55 处 getDb 调用点 + 既有 DB 使用
测试（taskService/flowService/projectService/sessionStore/confirmationService/...）。

### 签核状态

签核时 11 断言 5 绿 6 RED（seam 未就绪门：per-path 缓存/closeDb 语义未实现）。RED 全为
per-path 语义（异路径并存/句柄跨路径/closeDb(path)/resetDb 双库），无误红。无升级点遗留。
signer = **AI**。人工验收留在 REFLECT：diff 审读（单槽→Map 迁移）+ 调用点清理清单复核。
