# QA 报告 — 2026-08-12-conversation-toolbar-ext

> 由 `/qa-runner` 生成（2026-08-13）。BUILD 5/5 切片完成后全量回归。
> **v0.6 扩展补充（2026-08-14）**：全量 provider + catalog 端点（S6）——见文末「v0.6 扩展 QA」。

## 单元测试（API/CLI，`npm run test:unit`）

- 结果：**PASS（821/823）**——本 story 全部套件绿（providerModelConfig 16 / providerSwitch 11 / autoJudgeDefaultModel 5 / imageAttachment 7 = 39/39）
- 失败 2 项（均非本 story 缺陷）：
  1. `sessionMessage.test.js:160` 「agent 未配置时发送返回 409」——**环境性先存**：用例读真实 `~/.opc-workstation/settings.json`（本机已配置 agent → 202 非 409）；build-progress 已记录，S4 时 stash 基线验证为既有
  2. `mcpService.test.js:104` 「标准 5」——**并行 story（pi-mcp-plugin）RED 态**：其 BUILD 切片未完成，seam 依赖未就绪

## E2E/UITests（`npx playwright test` 全量）

- 结果：**PASS（211/213）**——本 story 18/18 + 旧套件契约演化（modeToolbar/settingsTabs）全绿
- 失败 2 项（均属**并行 story 自己的 in-progress UI 测试**）：
  - `pluginsPage.test.cjs` REQ-AGENT-083 标准 3（行内启用切换持久）/ 标准 4（错误态标红）——其 slice 5 进行中
- flaky：无（首轮 108 红经根因定位 = better-sqlite3 ABI 被并行进程翻转的环境竞态，重建 electron ABI 后 211/213；非测试本身不稳定）

## 运行时浏览器验证

- 状态：**SKIPPED**（Chrome DevTools MCP 未配置）

## Coverage

- 状态：N/A（项目未配置 coverage 工具）

## 手动验证

- 未执行（E2E 已覆盖核心用户路径；REFLECT 时人可抽查 UI 观感）

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| （无） | 首轮 E2E 108 红系 ABI 环境竞态（E-DB-UNWRITABLE），重建后全绿 | 已记录环境先例（build-progress 偏差 6：E2E 前必须 rebuild:electron） |

## 结论

- [x] **可进入 `/reflect`**（本 story 无 open bug，业务断言 57/57 全绿：API 39 + E2E 18）
- 说明：全量回归的 4 个红（unit 2 + e2e 2）全部归因外部——1 环境性先存（sessionMessage 读真实配置）+ 3 并行 story 的 in-progress RED（其 BUILD 未完成）；与本 story 代码无关，REFLECT 前无需处理，但 REFLECT 时向人如实呈现

## 证据

- 单元：823 tests / 821 pass（`tmp/unit-full.log`）
- E2E：213 tests / 211 pass（`tmp/e2e-full2.log`；首轮 ABI 竞态 108 红见 `tmp/e2e-full.log`）
- 根因探针：`E-DB-UNWRITABLE cannot open database`（ABI 翻转实证，`tmp/e2e-probe.cjs`）

---

## v0.6 扩展 QA（2026-08-14，REQ-AGENT-100/101/102）

### 单元（API）

- 结果：**PASS（45/45）**——catalog 6 + providerModelConfig 16 + providerSwitch 11 + autoJudgeDefaultModel 5 + imageAttachment 7
- 全量单元：**828/829**（唯一 1 红 = sessionMessage 环境性先存，QA 基线已记录）

### E2E

- 结果：**PASS（22/22）**——settingsProviders 7（含新标准 6/7）+ imageAttachmentUi 9（含新标准 8/9）+ modelSelector 6；邻接 modeToolbar + settingsTabs 16/16
- 3 处测试侧修正（闭合 select 可见性语义 / selectOption value / 标准 8 先 seed 再切换）已清

### 实现验收

- `modelCapabilities.js` 移除（grep 无残留）；settings 保存校验单一真源化（isApiKeyProvider）；lint 0 错误

### v0.6 结论

- [x] **可进入 `/reflect`**——本 story 业务断言 67/67（API 45 + E2E 22）全绿；全量回归红均归因外部（1 环境性先存 + 并行 story in-progress RED）

---

## REFLECT 前全量回归（2026-08-14，BUG-001~003 修复后）

### 单元（全量）

- 结果：**843/844**（`reflect-unit.log`）——唯一 1 红 = `sessionMessage.test.js`「agent 未配置 409」环境性先存（测试读真实用户配置，本机已配 agent 故 202；8-13 QA 已归因接受，与本次修复无关）
- 本 story 业务断言 API 60/60（REQ-090~092/099~104：providerModelConfig 20 + catalog 6 + testConnection 7 + providerSwitch 11 + autoJudge 5 + imageAttachment 7 + statusBarContext 4）

### E2E（全量）

- 结果：**218/218 全绿**（`reflect-e2e.log`）——本 story 23 条（settingsProviders 8 + imageAttachmentUi 9 + modelSelector 6）含 REQ-103 标准 8（E-TEST-UNSUPPORTED 中性展示）

### bug 循环总结

- BUG-001/002/003 全部 req-gap 就地补全（REQ-103/104/105 追加）+ 修复；BUG-003 症状① not-a-bug 记录（上下文窗口随模型变化机制实证成立）
- 三道闸门全程未触发（首修即绿；单次 fix ≤3 文件）

### 结论

- [x] **REFLECT 验收通过（人确认 2026-08-14）**——story completed
