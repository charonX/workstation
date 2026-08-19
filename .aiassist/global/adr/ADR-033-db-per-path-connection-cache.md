# ADR-033：DB 连接 per-path 缓存——全局单槽互斥驱逐消除

- 状态：已接受
- 日期：2026-08-18
- 相关 REQ：REQ-WORKSPACE-014~016（story 2026-08-16-deepen-db-per-path-cache）

## 上下文

`db.js` 是全局单槽连接：`getDb(path)` 在路径变化时**关旧库开新库**。后果：

- 模块缓存句柄不安全（其他模块切路径即关掉它）→ 55 处 `getDb()` 被迫"每次操作重新取"，
  堆防御注释（sessionStore/notificationService 等）；
- `data.db` 与 `agent-sessions.db` 不能同时持有 → 跨库 join 全 JS 侧手工归并；
- 正确用法（不要缓存句柄、每次重取）靠注释与纪律维持，是持续的正确性陷阱。

## 决策

1. **per-path 连接缓存**：`getDb(path)` 内部从单槽 `{db, currentPath}` 改
   `Map<path, Database>`——同路径返回同一句柄（**可缓存**），多路径并存互不驱逐。
   `getDb(path)` 签名不变（透明替换，55 处调用零改动）。
2. **closeDb() 升级为关全部**（+ 可选 `closeDb(path)` 定向关，不存在 no-op）：
   单槽语义是"关当前一个"；per-path 下"关全部"是唯一自洽语义，且是既有单连接调用方的
   安全超集。测试隔离（resetDb + closeDb）语义保持。
3. **resetDb(path?) = 该路径 full reset**：固定 DROP 列表（19 标准表）+ sqlite_master
   动态清遗留表（identifier 白名单防注入，标准表由 initSchema 重建）。无参 → defaultDbPath()
   （原 `currentPath ?? ":memory:"` 兜底在 per-path 下无 currentPath，撤除）。
4. **`:memory:` 缓存但 closeDb 清**：保持单槽下 ":memory:" 共享语义；测试靠 closeDb 隔离。
5. **进程生命周期 + 显式 closeDb**：不做 LRU/引用计数/自动关闭（过度设计否决）。

## 后果

- 句柄可安全缓存——database-not-open 风险消除；调用点防御注释可删（逐模块甄别）。
- closeDb() 关全部是语义升级（超集）；resetDb 语义强化为 full reset（测试锚定，signoff
  显式声明）。
- 全量回归零破坏（999→1010）；55 调用点零改动。

## 替代方案

- **保持单槽**：问题原样（互斥驱逐/防御注释），否决。
- **LRU/引用计数**：进程生命周期 + 显式 closeDb 足够，否决。
- **resetDb 仅固定列表**：无法满足"reset = 清库"的测试锚定语义，否决（动态清是超集）。

## 相关文件

- `src/db.js`（getDb/closeDb/resetDb per-path 实现）
- `src/services/sessionStore.js`（防御注释清理；同型惰性访问器保留）
- `src/services/notificationService.js`（BUG-001：模块级句柄+自愈迁移 per-op getDb）
- PRD：`.aiassist/stories/2026-08-16-deepen-db-per-path-cache/prd.md` §10
- 关联：ADR-006（单 server 统一本地存储）；2026-08-16-deepen-session-domain（ADR-030，
  先行不动 store 接口与 DB 访问方式，本 story 接续）
