# 签核记录 — 2026-08-01-macos-distribution

## Assertion Signoff（门 1）

- **日期**：2026-08-02
- **stage**：assertion
- **REQ 覆盖**：REQ-DIST-001 / REQ-DIST-002 / REQ-DIST-003 / REQ-DIST-004（4/4）
- **测试文件**：
  - `tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/cli/release.test.js`（REQ-DIST-001，7 用例）
  - `tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/api/checkUpdates.test.js`（REQ-DIST-002，7 用例）
  - `tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/e2e/versionDisplay.test.cjs`（REQ-DIST-002/003/004，3 用例）
- **capability/entity 覆盖**：app-distribution / release（能力地图已登记，CONTEXT.md 已新增实体）
- **断言签核**：20 处 TODO 占位归并为 12 项决策（A1-A5 / B1-B5 / C1-C2），**全部经人逐项确认**；测试已回写真实断言，TODO 清零，`ASSERTIONS-SIGNED: true`
- **预期值来源**：错误码（REQ/tech-design 契约）、版本规则（semver 语义）、产物命名（tech-design 契约）、GitHub API 响应形态（research 依据）——均来自已签契约，非代码输出
- **红态验证**：实现未存在时 CLI 7/7、API 7/7 红（Prove-It 成立）

### 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`
- [x] PRD 第 6-8 节已覆盖（操作流/验证/错误状态）
- [x] 每个 REQ-ID 都有对应测试（4/4）
- [x] 每个测试文件都有 REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE
- [x] capability/entity 与 business-capabilities.md 一致
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（0 处）
- [x] 预期值来源清晰，非代码输出
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖（非法版本/版本过低/非 main/tag 防重/gh 未认证/产物缺失/push 失败回滚；检查更新 4 降级态；compareVersions 数值边界）
- [x] signoff.md 已创建，随 `[test] assertion-signoff` commit 提交

### 测试缝契约（实现者必须遵守）

见 `test-plan.md`：release 模块导出签名（`release(version, {dryRun, run, cwd})`）、更新服务导出（`checkForUpdates({fetchImpl, getVersion, repo})` / `compareVersions`）、Settings 关于/更新区 testid（update-section/version/check-button/status/guide）、错误码全集。
