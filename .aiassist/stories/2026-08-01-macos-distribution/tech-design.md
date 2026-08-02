# 技术方案 — macOS 分发：GitHub Release 发布 + 应用内检查更新

> 故事 ID：`2026-08-01-macos-distribution`
> 版本：`v1`
> 最后更新：2026-08-02

---

## 设计目标

用一条零成本、不签名的路径把 workstation 分发给 macOS 使用者：发布者一条命令发版到公开 GitHub Release；使用者下载 .dmg 安装（首次经系统设置批准），应用内能知道自己版本、检查新版并跳转下载。核心约束：无 Apple Developer 账号（不签名、无自动更新），技术依据 `research/electron-updater-unsigned-macos-github-feed.md`。

## 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| CLI `release` 命令（`src/cli/commands/release.js`） | 发布者工具：版本校验 → bump → 打包 → git 提交推送 → gh release 创建/上传。**纯本地，不经过本地 HTTP server**（与现有 CLI 命令不同） | 是 |
| 主进程更新服务（`src/main/updates.js` 或并入 main.js） | fetch GitHub 最新 release、解析版本、semver 比较；暴露 `opc-check-updates` IPC handler；启动静默检查调度 | 是 |
| Settings 页"关于/更新"区（renderer） | 版本号展示 + 检查更新按钮 + 结果状态 + "去下载"跳转 | 是（扩展现有 Settings 页） |
| 首次安装引导文案（README + 应用内） | Settings 批准路径（macOS 15+）+ 放入 /Applications 建议 | 否（文档/文案） |

### 模块关系图

```
[发布者终端]
   │  opc-workstation release 1.1.0   （纯本地，不经 server）
   ▼
[release 命令] ──校验/分支检查──> [package.json bump] ──> [npm run make] ──> [out/ 产物]
   │  └─ 失败恢复原版本
   ├──> [git commit + push 版本变更]
   └──> [gh release create v1.1.0 + upload dmg/zip] ──> [GitHub]

[使用者 app]
   ├─ 启动（异步静默） / Settings"检查更新"点击
   ▼
[主进程更新服务] ──fetch──> api.github.com/releases/latest ──> {tag_name}
   │  └─ semver 比较 vs app.getVersion()
   ▼
[IPC opc-check-updates] ──> [Settings 页 UI] ──"去下载"──> shell.openExternal(Releases 页)
```

## 数据流

### 流 1：发布（release 命令）

1. **触发**：`opc-workstation release 1.1.0`（或 `npm run release -- 1.1.0`）
2. **输入校验**：版本参数 semver 合法（可带 `v` 前缀 → 规范化）；必须 > package.json 当前 version；当前 git 分支 = main
3. **核心处理**：更新 package.json version → `npm run make`（产出 dmg+zip 到 out/）→ 校验产物存在且文件名含目标版本
4. **副作用**：`git commit` 版本变更 + `git push`；`gh release create v<ver>`（自动推 tag）+ `gh release upload` dmg/zip 资产
5. **输出**：命令成功打印 Release URL；失败按错误态处理（见第 8 节）

### 流 2：检查更新（启动静默 / 手动）

1. **触发**：app ready 后异步一次（静默）；或用户点击"检查更新"
2. **输入校验**：无用户输入
3. **核心处理**：主进程 `fetch(api.github.com/repos/{owner}/{repo}/releases/latest)` → 取 `tag_name` → 解析版本 → 与 `app.getVersion()` semver 比较
4. **副作用**：无（只读查询）
5. **输出**：IPC 返回 `{currentVersion, latestVersion|null, hasUpdate, error?}`；UI 渲染三种状态（有新版 / 已是最新 / 检查失败）

## 接口契约

### 接口名称：IPC `opc-check-updates`

| 项目 | 说明 |
|---|---|
| 调用方 | Settings 页"检查更新"按钮 / 启动静默检查（同一服务函数） |
| 被调用方 | 主进程更新服务 |
| 输入 | 无（仓库信息从 package.json repository 字段读） |
| 输出 | `{ currentVersion: string, latestVersion: string\|null, hasUpdate: boolean, error: {code, message}\|null }` |
| 业务错误 | `E_UPDATE_NO_RELEASE`（仓库无 release）、`E_UPDATE_PARSE`（tag 解析失败） |
| 系统错误 | `E_UPDATE_CHECK_NETWORK`（fetch 失败/超时） |
| 副作用 | 无 |
| 幂等性 | 是（纯查询） |

### 接口名称：CLI `release <version> [--dry-run]`

| 项目 | 说明 |
|---|---|
| 调用方 | 发布者终端（`npm run release -- <version>`） |
| 被调用方 | release 命令（本地执行 npm/git/gh） |
| 输入 | `<version>`：semver，可带 `v` 前缀；`--dry-run`：打印步骤序列不执行副作用 |
| 输出 | 成功：Release URL；`--dry-run`：步骤/命令清单 + 校验结果 |
| 业务错误 | `E_RELEASE_INVALID_VERSION`、`E_RELEASE_VERSION_BELOW`、`E_RELEASE_NOT_MAIN`、`E_RELEASE_TAG_EXISTS` |
| 系统错误 | `E_RELEASE_GH_AUTH`（gh 未认证）、`E_RELEASE_BUILD_FAILED`（打包失败）、`E_RELEASE_GIT_FAILED`（commit/push 失败） |
| 副作用 | package.json 变更、git commit+push、tag+Release 创建、资产上传；失败时恢复原版本号（git 层面在 push 前失败则本地可回滚） |
| 幂等性 | 否（版本/tag 唯一，重跑需新版本） |

## 测试 seams

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| S1 release 命令 | CLI：`--dry-run` 断言步骤序列/版本校验/分支校验；npm/git/gh 经可注入执行器 stub | CLI（单元） | stub（不真打包/不真 push/不真 gh） |
| S1 产物校验 | release 命令内建校验函数（给定 out/ 目录 + 版本 → 断言 dmg/zip 存在） | 单元 | 真实临时目录（手工放假文件） |
| S2 检查更新 | 主进程服务函数：注入 fetch stub（有 release / 无 release / 网络错误 / 版本解析失败） | 单元 | stub fetch |
| S2 版本比较 | 手写 semver 比较函数（相等/低于/高于/边界 0.x） | 单元 | 无 |
| S2 IPC 契约 | IPC handler 调用服务并返回规范结构（注入服务 stub） | 单元 | stub 服务 |
| S3 版本展示 | E2E：Settings 页可见当前版本号（与 package.json 一致） | E2E | 真实 app |
| S2/S3 检查更新 UI | E2E：Settings 页"检查更新"按钮存在 + 点击后展示三种状态之一（注入 IPC 返回 stub 或真实网络宽松断言） | E2E | 真实 app + 弱断言（或 stub） |
| S4 首次安装引导 | README 章节存在性 + 应用内引导文案存在性 | 人工 + E2E 文案 | — |

## 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 发布走 gh CLI 而非 GitHub REST API | gh CLI / API+token | 本机已登录 gh 即可发布，无 token 管理面；`E_RELEASE_GH_AUTH` 前置检查简单 | 依赖 gh 安装与认证；README 写明 |
| release 绕过本地 HTTP server | 走 server / 纯本地 | release 是 dev-time 发布者工具，不应暴露在产品 API（renderer 无调用方）；ADR-001 的 transport 统一是针对产品运行时接口 | 与现有 CLI 模式不一致，需注释说明 |
| 检查更新用 GitHub REST API 而非 electron-updater | electron-updater / 轻量自研 | research 证伪：Squirrel.Mac 硬性要求签名，未签名 app 更新器无法初始化；轻量查询零依赖 | 无自动更新（用户已接受手动重装） |
| 版本比较手写最小 semver | 手写 / semver 依赖 | 仅需 X.Y.Z 数值比较（± prerelease 解析），~30 行可测，保持零新增依赖 | 若未来要复杂 semver 语义再换依赖 |
| 仓库信息读 package.json repository 字段 | 硬编码 / package.json | 可配置、可测（测试注入不同 repo） | repository 字段缺失时 fallback 报错提示 |
| release 仅 main 分支 + 自动 commit/push | 任意分支 / 仅 main | 单人维护，main 即真相；前置校验防误发 | 多分支协作时不适用（未来需放宽） |
| 启动静默检查一次 | 仅手动 / 启动静默+手动 | 手动重装路线下"知道有新版本"是唯一触点，静默检查把触点自动化；失败静默不打扰 | 每次启动一次 GitHub 请求（国内网络异步失败无感） |

## 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| GitHub API 未认证限流（60 req/h）对检查频率足够 | 限流导致检查失败频繁 → UI 频繁显示网络错误 | TECH-DESIGN（换 releases.atom 免配额端点） | 能（发布后实测） |
| forge make 在 macOS 产出 dmg+zip 且文件名含版本 | 产物命名/格式不符 → release 命令资产校验失败 | TECH-DESIGN（调整产物定位逻辑） | 能（一次本地打包验证） |
| 未签名 .dmg 在目标 macOS（15+）经 Settings 批准可运行 | 无法批准/运行 → 分发通道失效 | PRD（需评估签名或换分发方式） | 能（发布后另一台机器验证） |
| gh CLI 在发布者机器可用且已认证 | 不可用 → release 命令 E_RELEASE_GH_AUTH | TECH-DESIGN（备选 API+token） | 能 |

## 范围外与约束

- 签名/公证/自动更新（research 证伪，PRD 范围外）
- Windows/Linux 分发、私有渠道、自托管
- 多分支协作发版（当前 main-only 单维护者）

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-08-02 | 初稿（PRD v0.3 + research 依据 + 三项对抗决策） | AI + 人 |
