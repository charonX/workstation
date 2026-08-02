# 测试计划 — 2026-08-01-macos-distribution

> 生成：/test-author（2026-08-02）
> REQ 版本：v1（hash `3167cf20...`）

## REQ → 测试映射

| REQ | seam | 测试文件 | 类型 | 断言状态 |
|---|---|---|---|---|
| REQ-DIST-001 | CLI release（无副作用路径真实命令；副作用路径注入 runner） | `tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/cli/release.test.js` | CLI 单元 | TODO × 9（待签） |
| REQ-DIST-002 | 更新服务 checkForUpdates（注入 fetch 4 态）+ compareVersions | `.../api/checkUpdates.test.js` | 单元 | TODO × 7（待签） |
| REQ-DIST-002/003 | Settings 关于/更新区 E2E | `.../e2e/versionDisplay.test.cjs` | E2E | TODO × 3（待签） |
| REQ-DIST-004 | 引导文案存在性 | `.../e2e/versionDisplay.test.cjs` | E2E 文案 | TODO × 1（待签） |

## 测试缝契约（实现者必须遵守，否则测试不绿）

1. **release 模块导出** `release(version, { dryRun, run, cwd })`：
   - `run` = 异步命令执行器（默认封装 node:child_process；测试注入 fake 记录调用序列）
   - 错误码：`E_RELEASE_INVALID_VERSION` / `E_RELEASE_VERSION_BELOW` / `E_RELEASE_NOT_MAIN` / `E_RELEASE_TAG_EXISTS` / `E_RELEASE_GH_AUTH` / `E_RELEASE_BUILD_FAILED` / `E_RELEASE_GIT_FAILED`
   - `--dry-run` 无任何副作用，输出步骤序列（校验→分支→gh→tag→打包→push→create）
   - 产物命名约定：`Workstation-<version>.dmg` / `.zip` 位于 `out/`
2. **主进程更新服务**（`src/main/updates.js`）导出：
   - `checkForUpdates({ fetchImpl, getVersion, repo })` → `{ currentVersion, latestVersion|null, hasUpdate, error:{code,message}|null }`
   - `compareVersions(a, b)` → -1/0/1（数值比较，非字符串序）
   - 仓库信息从 package.json repository 字段解析（owner/repo）
3. **Settings 页"关于/更新"区 testid**：`update-section` / `update-version` / `update-check-button` / `update-status` / `update-guide`（与 locators.cjs 一致）
4. IPC `opc-check-updates` 返回契约与 checkForUpdates 一致

## 明确例外（对"CLI 测试跑真实命令"纪律）

release 的有副作用路径（`npm run make` / `git push` / `gh release create`）**不可在测试中真实执行**——副作用是发布到公开 GitHub（不可逆外部操作）。因此：
- 校验类路径（AC1/2/3/5/9 无副作用部分）跑真实 CLI 命令
- 副作用路径（AC6/7/8）经注入 runner 覆盖
- 真实 `gh release create` 的成功路径由首次人工发布验证（REFLECT 验收项）

## REFLECT 人工验收项（仅纯审美或不可自动化）

1. REQ-DIST-004 AC3：发布首个 Release 后在另一台 macOS 完成"下载→Settings 批准→启动"全流程（分发可用性最终证明，无法自动化）
2. 检查更新状态区视觉呈现（颜色/间距/字体）——纯审美
3. release 命令实际跑通一次完整发版（含真实打包耗时体验）——低频操作，人工

## 未覆盖说明

- E2E 不验证"有新版/无新版"具体状态（依赖真实 GitHub release，E2E 无法稳定复现）→ 状态逻辑由 api 单元（fetch stub 4 态）覆盖，E2E 只断言结构/交互存在性
- 启动静默检查的"静默"行为（无 UI 打扰）由实现保证 + 服务不抛断言覆盖
