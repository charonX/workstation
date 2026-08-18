# 访谈笔记 — 2026-08-16-deepen-db-per-path-cache

> 触发：/story 路由（架构评审候选 #5）。日期：2026-08-18。
> 状态：四问已确认（用户"按你说的来"= 接受四项 GUESS 推荐）。

## 核心问题

db.js 全局单槽连接：切路径即关旧库 → 每个模块被迫"每次操作重新取"并堆防御注释，
跨库 join 全靠 JS 侧手工归并，缓存一次句柄即埋 database-not-open。连接生命周期是
全局隐式状态，正确用法靠注释与纪律维持。

## 已勘察事实（诊断输入）

1. **55 处 `getDb()`** 横跨 20+ 模块（taskService 11 / flowService 10 / projectService 7 /
   executionRunner 7 / ...）——"每次操作重新取"是普遍模式。
2. **单槽逻辑确认**（db.js:23-59）：`getDb(path)` 若 path ≠ currentPath → 关旧库开新库；
   模块缓存句柄不安全（可能被其他模块切路径时关掉）。
3. **closeDb() 只关单连接**；测试靠 `resetDb(DB_PATH) + closeDb()` 隔离。
4. **`:memory:` 使用**：`createConfirmationService({dbPath: ":memory:"})` 等——单槽下
   共享同一内存库；per-path 缓存需保持此语义。
5. 评审"after"态：`data.db — open` / `agent-sessions.db — open`（per path）、
   comments deleted、handles cacheable。涉及文件：db.js / sessionStore / confirmationService /
   agentSessions。

## 关键边界（用户确认 2026-08-18，四项）

1. **缓存关闭策略**：进程生命周期 + 显式 `closeDb()` 关全部（Map 遍历关）；不做 LRU/引用计数。
2. **范围**：只改 db.js（per-path 缓存安全）+ 最少必要调用点；防御注释删除随模块逐个
   做（避免 20 文件大 diff）。评审 "after" 是"能力"，不是"全部调用点本 story 重构"。
3. **`:memory:` 处理**：缓存（保持共享语义）但 `closeDb()` 清全部（含 :memory:）；测试隔离
   靠 closeDb。
4. **API 形状**：透明替换——`getDb(path)` 签名不变（内部 Map），`closeDb()` = 关全部，
   `closeDb(path)` 可选新增；55 处调用零改动。

## 隐含假设

1. per-path Map<path, Database>；同一路径重复 getDb 返回同一句柄（可缓存）。
2. closeDb() 语义升级为"关全部"——现有单连接调用方不受影响（关一个=关全部的子集）。
3. DB 文件删除场景：closeDb() 后句柄失效，重取 getDb 重开（既有语义保持）。

## 矛盾/风险

1. `:memory:` 缓存 + closeDb 清全部：若某测试不 closeDb 就期望 :memory: 新开 → 会共享污染。
   需在实现时检查 serverPermissionWiring.test.js 等 :memory: 用法的隔离性。
2. closeDb() 关全部 vs 部分调用方期望只关自己的连接：当前无此语义（单槽本来就只一个），
   升级为关全部是超集，无回归。
3. 55 处调用点本 story 不动 → "每次操作重新取"的注释还在；这是接受的部分清理（逐模块跟进）。

## 候选方向（单一方向，scope 已定）

### 方向 A：per-path 连接缓存（透明替换）——确认
- db.js 内部改 Map<path, Database>；getDb(path) 不变；closeDb() 关全部（+closeDb(path) 可选）；
  :memory: 缓存 + closeDb 清全部；最少必要调用点清理（如确有依赖单槽的防御注释）。
- 取舍：改动集中在 db.js + 边界测试；55 处调用零破坏；防御注释删除逐模块后续。
- 推荐度：首选（评审 "after" 态 + 四项用户确认）。

## 确认方向（步骤 7，用户"按你说的来"接受四项 GUESS）

- Outcome: db.js 支持多路径连接并存——data.db 与 agent-sessions.db 同时打开互不驱逐，
  句柄可缓存（database-not-open 风险消除），closeDb() 关闭全部。
- User: 所有读写 DB 的模块（taskService/flowService/projectService/executionRunner/... 20+）。
- Why now: session-domain 收编后跨库访问更频繁（sessionStore/confirmationService/agentSessions
  同进程并存）；单槽互斥驱逐是持续的正确性陷阱。
- Success: 同时打开双库不互斥；getDb(同路径) 返回同一句柄（可缓存）；closeDb() 关全部；
  全量测试绿（55 调用点零改动）；:memory: 语义保持。
- Constraint: getDb(path) 签名不变（透明）；closeDb() 升级为关全部；不做 LRU/引用计数；
  :memory: 缓存但 closeDb 清。
- Out of scope: 55 处调用点全量重构（防御注释删除随模块逐个后续）；跨库 join 的 JS 手工
  归并改进（另立）；LRU/引用计数/自动关闭。

## 最窄的切入点

db.js 内部单槽 → Map 缓存 + closeDb 遍历关 + :memory: 保持 + 一条"同路径句柄稳定可缓存"
的 API 级测试；全量回归确认 55 调用点零破坏。

## 待确认问题
- [x] 缓存关闭策略（Q1）：进程生命周期 + closeDb 关全部——确认
- [x] 范围（Q2）：只改 db.js + 最少必要调用点；注释删除逐模块——确认
- [x] :memory: 处理（Q3）：缓存 + closeDb 清全部——确认
- [x] API 形状（Q4）：透明替换 getDb 不变——确认
