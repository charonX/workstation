# 契约式需求 — macOS 分发：GitHub Release 发布 + 应用内检查更新

> 故事 ID：`2026-08-01-macos-distribution`
> 版本：v1
> 最后更新：2026-08-02
> 输入：`prd.md` v0.3、`tech-design.md` v1、`research/electron-updater-unsigned-macos-github-feed.md`
> 编号：全新 capability `app-distribution`，REQ-DIST 从 001 起。

---

## REQ 概览

| ID | 标题 | 优先级 | 必须性 | scope | 测试类型 | capability | entity |
|---|---|---|---|---|---|---|---|
| REQ-DIST-001 | release 发布命令（main-only，自动发版） | P0 | 必须 | cross-module | CLI 单元 | app-distribution | release |
| REQ-DIST-002 | 应用内检查更新（启动静默 + 手动） | P0 | 必须 | cross-module | 单元+E2E | app-distribution | release |
| REQ-DIST-003 | 当前版本号展示（Settings 关于/更新区） | P1 | 应该 | intra-module | E2E | app-distribution | release |
| REQ-DIST-004 | 首次安装引导（Settings 批准 + /Applications） | P1 | 应该 | intra-module | E2E 文案+人工 | app-distribution | release |

---

## REQ-DIST-001：release 发布命令

**稳定块**：S1

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module（CLI ↔ 本地 fs / git / gh CLI）
- **capability/entity**：app-distribution / release
- **modules**：`src/cli/commands/release.js`（新增）、package.json scripts
- **interface_contract**：`opc-workstation release <version> [--dry-run]`；成功输出 Release URL；错误码 `E_RELEASE_INVALID_VERSION` / `E_RELEASE_VERSION_BELOW` / `E_RELEASE_NOT_MAIN` / `E_RELEASE_TAG_EXISTS` / `E_RELEASE_GH_AUTH` / `E_RELEASE_BUILD_FAILED` / `E_RELEASE_GIT_FAILED`；副作用 = package.json 版本变更 + git commit/push + tag/Release 创建 + 资产上传

### 验收标准

1. **AC1（版本校验）**：`<version>` 非语义化版本（非 `X.Y.Z` 或含非法字符）→ 拒绝执行，报 `E_RELEASE_INVALID_VERSION`，退出码非 0，package.json 不被修改。
2. **AC2（版本递增）**：`<version>` ≤ 当前 package.json version → 拒绝，报 `E_RELEASE_VERSION_BELOW`；`v` 前缀（`v1.1.0`）接受并规范化为 `1.1.0`。
3. **AC3（main 分支约束）**：当前 git 分支非 `main` → 拒绝执行，报 `E_RELEASE_NOT_MAIN`，无任何副作用。
4. **AC4（tag 防重）**：`v<version>` 对应的 tag/Release 已存在 → 拒绝，报 `E_RELEASE_TAG_EXISTS`，不覆盖。
5. **AC5（gh 认证前置）**：gh CLI 未安装或未认证 → 报 `E_RELEASE_GH_AUTH`，提示先 `gh auth login`，后续步骤不执行。
6. **AC6（打包与产物校验）**：版本校验通过后执行打包（`npm run make`）；打包后校验 `out/` 下存在 dmg 与 zip 且文件名包含目标版本；产物缺失/版本不符 → 报 `E_RELEASE_BUILD_FAILED`。
7. **AC7（git 自动提交推送）**：打包成功后自动 `git commit` package.json 版本变更并 `git push`；提交失败 → 报 `E_RELEASE_GIT_FAILED`；push 前失败时本地版本变更回滚。
8. **AC8（Release 创建与上传）**：`gh release create v<version>` 创建 Release 并上传 dmg/zip 资产；成功输出 Release URL。
9. **AC9（dry-run）**：`--dry-run` 不产生任何副作用（不改 package.json、不打包、不推送、不创建 Release），输出完整的步骤序列与校验结果（版本校验/分支/gh 认证/tag 检查）。

### 测试

- Seam：CLI `--dry-run` + 可注入执行器（npm/git/gh stub）；产物校验函数（临时目录放假文件）
- 文件：`tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/cli/release.test.js`

---

## REQ-DIST-002：应用内检查更新

**稳定块**：S2

- **优先级**：P0　**必须性**：必须
- **scope**：cross-module（主进程更新服务 ↔ renderer Settings 页）
- **capability/entity**：app-distribution / release
- **modules**：主进程更新服务（新增）、`src/main/main.js` IPC、Settings 页"关于/更新"区
- **interface_contract**：IPC `opc-check-updates`（输入无）→ `{ currentVersion: string, latestVersion: string|null, hasUpdate: boolean, error: {code, message}|null }`；错误码 `E_UPDATE_NO_RELEASE` / `E_UPDATE_PARSE` / `E_UPDATE_CHECK_NETWORK`；仓库 owner/repo 读 package.json repository 字段；无副作用、幂等

### 验收标准

1. **AC1（版本查询与比较）**：调用 `opc-check-updates` 后返回结构含 `currentVersion`（= app 当前版本）、`latestVersion`（GitHub 最新 release tag 解析出的版本）、`hasUpdate`（latest > current，semver 数值比较）；无 release 时 `latestVersion: null, hasUpdate: false`。
2. **AC2（有新版状态）**：latest > current → `hasUpdate: true`；UI 显示"发现新版本 vX.Y.Z"与"去下载"入口，点击经主进程 `shell.openExternal` 打开 GitHub Releases 页。
3. **AC3（已是最新状态）**：latest ≤ current → `hasUpdate: false`；UI 显示"当前已是最新版本"。
4. **AC4（网络失败降级）**：fetch 失败/超时 → 返回 `error: {code: E_UPDATE_CHECK_NETWORK}`；UI 显示"检查失败，请重试"，应用不崩溃。
5. **AC5（无 release 降级）**：仓库无 release（404/空）→ `error: {code: E_UPDATE_NO_RELEASE}` 或 `latestVersion: null`；UI 显示"暂无发布版本"。
6. **AC6（解析失败降级）**：tag 无法解析为版本 → `error: {code: E_UPDATE_PARSE}`，UI 显示检查失败。
7. **AC7（启动静默检查）**：app 启动后异步触发一次检查；有新版时复用同一提示路径；失败/无新版完全静默（不打扰用户、不弹错误）。
8. **AC8（手动检查按钮）**：Settings 页"关于/更新"区提供"检查更新"按钮，点击后触发检查并展示上述状态。

### 测试

- Seam：主进程服务函数注入 fetch stub（有 release / 无 release / 网络错误 / 解析失败 4 态）；semver 比较函数（相等/低/高/边界）；IPC handler 契约（注入服务 stub）；E2E 按钮存在与点击后三态之一
- 文件：`tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/api/checkUpdates.test.js`、`.../e2e/versionDisplay.test.cjs`

---

## REQ-DIST-003：当前版本号展示

**稳定块**：S3

- **优先级**：P1　**必须性**：应该
- **scope**：intra-module（renderer）
- **capability/entity**：app-distribution / release
- **modules**：Settings 页"关于/更新"区

### 验收标准

1. **AC1（版本号显示）**：Settings 页"关于/更新"区显示当前版本号，值与打包进应用的 `package.json` version 一致（经主进程 IPC 或 app.getVersion() 获取，不硬编码在 renderer）。
2. **AC2（结构可定位）**：版本号元素带可定位 testid，E2E 可断言其可见性与文本非空。

### 测试

- Seam：Playwright Electron E2E（Settings 页 → 关于/更新区 → 版本号可见且非空）
- 文件：`tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/e2e/versionDisplay.test.cjs`

---

## REQ-DIST-004：首次安装引导

**稳定块**：S4

- **优先级**：P1　**必须性**：应该
- **scope**：intra-module
- **capability/entity**：app-distribution / release
- **modules**：README 发布章节、Settings 页"关于/更新"区文案

### 验收标准

1. **AC1（README 引导章节）**：README 提供"从 Release 安装"章节，说明：下载 .dmg → 拖入 /Applications → 首次启动被 Gatekeeper 拦截时前往 System Settings > Privacy & Security 批准（macOS 15+，无右键打开）→ 批准后正常启动。
2. **AC2（应用内引导文案）**：Settings 页"关于/更新"区含安装引导摘要文案（Settings 批准路径 + 建议放入 /Applications），元素可定位（testid），E2E 断言存在。
3. **AC3（人工验收）**：发布首个 Release 后，在另一台 macOS 机器完成"下载 → 批准 → 启动"全流程（REFLECT 人工验收项）。

### 测试

- Seam：E2E 文案存在性（AC2）+ 人工验收（AC3）；AC1 为文档审查项
- 文件：`tests/capabilities/app-distribution/release/2026-08-01-macos-distribution/e2e/versionDisplay.test.cjs`（文案存在性）

---

## 测试计划映射

| REQ | seam | 文件 | 类型 |
|---|---|---|---|
| REQ-DIST-001 | CLI dry-run + 注入执行器 + 产物校验 | `cli/release.test.js` | 单元 |
| REQ-DIST-002 | 更新服务 fetch stub 4 态 + semver 比较 + IPC 契约 | `api/checkUpdates.test.js` | 单元 |
| REQ-DIST-002/003 | Settings 关于/更新区 UI + 检查按钮 + 版本号 | `e2e/versionDisplay.test.cjs` | E2E |
| REQ-DIST-004 | 引导文案存在性 | `e2e/versionDisplay.test.cjs` | E2E 文案 |

## REFLECT 人工验收备注

- REQ-DIST-004 AC3：真实发布 + 另一台机器全流程（分发可用性的最终证明，无法自动化）。
- 检查更新状态区的视觉呈现（颜色/间距）为纯审美，REFLECT 人工验收。
