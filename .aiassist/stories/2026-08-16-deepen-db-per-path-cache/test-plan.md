# 测试计划 — 2026-08-16-deepen-db-per-path-cache

> 载体：db.js 直测（node:test，单元 seam）+ 全量回归（55 调用点零改动硬约束）。

## REQ → 测试映射

| REQ | AC | seam | 测试方法/断言 | 载体文件 |
|---|---|---|---|---|
| REQ-WORKSPACE-014 | AC1 | 单元 | getDb(pathA)===getDb(pathA)（strictEqual 同句柄） | api/dbPerPathCache.test.js |
| REQ-WORKSPACE-014 | AC2 | 单元 | getDb(A) 后 getDb(B) → A 仍可查（queryOk） | 同上 |
| REQ-WORKSPACE-014 | AC3 | 单元 | getDb(A) !== getDb(B) | 同上 |
| REQ-WORKSPACE-014 | AC4 | 单元 | 持 A 句柄反复 getDb(B) 5 次，A 每次可查 | 同上 |
| REQ-WORKSPACE-014 | AC5 | 单元 | 无参 getDb() → defaultDbPath（DB_PATH env 隔离） | 同上 |
| REQ-WORKSPACE-015 | AC1 | 单元 | closeDb() 关全部 → getDb 重取新句柄可查 | 同上 |
| REQ-WORKSPACE-015 | AC2 | 单元 | closeDb(pathA) 定向关 → B 仍可查、A 重开新连接 | 同上 |
| REQ-WORKSPACE-015 | AC3 | 单元 | closeDb(不存在) → no-op 不抛、既有连接不受影响 | 同上 |
| REQ-WORKSPACE-015 | AC4 | 单元 | :memory: 两次同句柄；closeDb 后重新取为新库 | 同上 |
| REQ-WORKSPACE-015 | AC5 | 单元 | resetDb(pathA) 只 drop A 表、B 不受影响 | 同上 |
| REQ-WORKSPACE-016 | AC1 | 单元+回归 | 句柄持有+切路径的代表性调用点形态断言 + 全量 test:unit（QA 门） | 同上 + 全量 |

## 当前状态（单槽下预期 RED）

- AC1/AC3/AC5（014）与 REQ-015 AC4（:memory: 共享）在单槽下**已绿**（单槽同路径本就同句柄）。
- **RED**（seam 门，待 per-path 实现转绿）：014 AC2（getDb(B) 会关 A）、014 AC4（反复切 B 关 A）、
  015 AC2（closeDb 无 path 参数语义）、015 AC5（resetDb(B) 会关 A，双库并存不成立）。

## REFLECT 人工验收

- 无纯审美项；无 UI。REFLECT 复核：调用点清理的甄别清单（哪些防御注释被删、是否漏删）。
