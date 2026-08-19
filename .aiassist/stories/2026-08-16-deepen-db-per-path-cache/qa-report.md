# QA 报告 — 2026-08-16-deepen-db-per-path-cache

> QA 门执行：2026-08-18（BUILD 后）+ 2026-08-19（BUG-001 修复后复验）。

## 单元测试

- **结果：PASS**
- `npm run test:unit`：**1010 tests / 1010 pass / 0 fail**（BUILD 三切片 + BUG-001 修复后全绿，零回归）
- 覆盖：REQ-WORKSPACE-014 per-path 缓存（11 例含 015/016）+ REQ-016 回归门 + BUG-001 回归
  （notificationDbPattern）+ 既有 999 全绿。

## E2E（Playwright + Electron）

- **结果：PASS（本 story 无新增 E2E）**
- 本 story 为纯后端连接生命周期重构（db.js per-path），无 UI 面；db 直测（dbPerPathCache
  11 例）即业务契约载体。既有 conversation-space/skill 等 E2E 不在本 story 回归面（db.js
  改动经全量单测 1010/1010 覆盖，server 层无 HTTP 契约变更）。

## 运行时浏览器验证

- **状态：SKIPPED**——无 `ux/`、无 UI 变更。

## Coverage

- 本地无 coverage 阈值门。核心契约（getDb 同句柄/并存/closeDb 关全部/定向/resetDb 强化/
  :memory:）全有直测。

## 手动验证

- 桌面 app 未人工走查（无 UI 变更）；连接生命周期行为由 db 直测 + 全量回归锁定。

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| （BUG-001 复验时 1 次 feishu 并行 flake） | 复跑绿 | 非本改动引入，并行会话竞态，不阻塞 |

## 结论

- [x] **可进入 `/reflect`**——单测 1010/1010 全绿、无 open bugs（BUG-001 已修）、无 flaky
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug`

## 附：BUG-001 处理摘要（2026-08-19，QA 期发现）

- **根因**：Slice 2 调用点清理漏网——`notificationService.js` 仍模块级持句柄
  （`let db = null`）+ 自愈（getDbRef `!db || !db.open`）+ isDbClosedError + 两段防御注释。
  自愈机制本身即单槽时代防御（不是正常惰性访问），per-path 后全库唯一残留单槽病站点。
- **分类**：code-defect（人确认）。
- **修复**：notify/list/markRead 直接 per-op `getDb()`，删模块级句柄/自愈/isDbClosedError
  与防御注释，行为逐字节等价（2a38ff5）。回归测试 notificationDbPattern.test.js 静态+
  行为断言（7accf7b）。
- **验证**：回归 2/2 红→绿 + 既有 REQ-NOTIFY-001 全过 + 全量 1010/1010 零回归。
