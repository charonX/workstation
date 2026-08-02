# macOS 分发：GitHub Release 发布 + 应用内检查更新

> 状态：已锁定（用户确认 2026-08-01）
> 故事 ID：`2026-08-01-macos-distribution`
> 最后更新：2026-08-01

---

## 1. 问题陈述

打包产物未签名未公证，无法外发给他人使用（Gatekeeper 拦截），且没有发布渠道：每次想给同事/别人用，只能手动拷贝 .app，版本迭代后对方也拿不到新版。应用只能本机自用。

## 2. 解决方案

建立一条**零成本、公开 GitHub Release 的分发通道**：一条 `release` 命令完成版本号提升、打包（dmg+zip）、发布到 GitHub Releases；用户从 Releases 页下载 .dmg 安装（首次经系统设置批准后运行）；应用内提供"检查更新"入口，查询 GitHub 最新版本，发现新版引导用户下载安装。

不做签名公证（无 Apple Developer 账号），不做自动更新（Squirrel.Mac 硬性要求签名，经 research 证伪不可行）。首次安装引导用户在 macOS 15+ 的 System Settings > Privacy & Security 中批准运行。

## 3. 用户故事

1. 作为发布者，我想要一条命令完成版本提升 + 打包 + 上传 GitHub Releases，以便快速发版给使用者。
2. 作为 macOS 用户，我想要从 GitHub Releases 下载 .dmg 安装后能顺利运行（含首次批准的引导），以便不用源码就能用上 workstation。
3. 作为使用者，我想要在应用里查看当前版本、检查是否有新版并知道去哪下载，以便及时用上新版本。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| S1 | release 发布命令（仅 main 分支）：校验版本 → bump package.json → 打包（dmg+zip）→ 自动 commit+push 版本变更 → 生成/上传 GitHub Release 资产 | 渠道（公开 GitHub Release）、零成本路线（不签名）、手动重装（无自动更新）均经用户拍板；发版自动化是访谈确认的 B |
| S2 | 应用内"检查更新"（手动按钮 + 启动后静默检查一次）：查询 GitHub 最新 release 版本号，与当前版本比较，有新版时提示并引导下载；静默检查失败无感知 | 访谈确认的 C；无 Squirrel/签名依赖，纯 HTTP 查询，零成本 |
| S3 | 当前版本号展示（应用 UI） | 检查更新的必要配套（用户需要知道"自己是什么版本"） |
| S4 | 首次安装引导：macOS 15+ System Settings > Privacy & Security 批准 + 建议放入 /Applications | research 证伪右键打开（Sequoia 移除 Control-click），引导文案是分发可用性的必要组成 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| M2 | Windows squirrel 资产是否顺带上传 | scope 外；可先只传 macOS 资产 |

> 已定稿移出：M1 → Settings 页新增"关于/更新"区；M3 → 手动传参 + 校验（tech-design 2026-08-01 确认）。

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 发布者运行 `opc-workstation release 1.1.0`（或 `npm run release -- 1.1.0`） | 校验版本号 → 更新 package.json version → 打包 dmg+zip | 产物存在：`Workstation-1.1.0.dmg` + zip |
| 2 | （命令继续） | 创建 GitHub tag `v1.1.0` + Release，上传 dmg/zip 资产 | `gh release view v1.1.0` 可见两个资产 |
| 3 | 使用者在 GitHub Releases 页下载 `.dmg` | — | 下载成功 |
| 4 | 使用者双击 dmg → 拖入 /Applications → 首次启动 | macOS 弹"无法验证开发者"拦截 | 引导文案可见（README/应用内） |
| 5 | 使用者前往 System Settings > Privacy & Security → 批准 → 再启动 | 应用正常启动 | 启动无崩溃 |
| 6 | 应用启动后（异步静默）或使用者在应用内点"检查更新" | 查询 GitHub 最新 release；启动静默检查有新版才提示、失败无感知；手动检查显示"当前 v1.0.0，最新 v1.1.0" | 版本对比正确 |
| 7 | 使用者点击"去下载" | 打开 GitHub Releases 页（浏览器） | 跳转正确 |
| 8 | 发布者再发 v1.2.0 后，使用者重复 6-7 | 检查提示 v1.2.0 可用 | 新版本可被发现 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 版本号格式非法（非 semver） | 命令拒绝执行并提示格式 | E-RELEASE-INVALID-VERSION |
| 版本号低于/等于当前版本 | 命令拒绝（防误发） | E-RELEASE-VERSION-BELOW |
| 当前分支非 main | 命令拒绝执行 | E-RELEASE-NOT-MAIN |
| gh CLI 未登录/无权限 | 命令在创建 Release 前失败，明确提示认证 | E-RELEASE-GH-AUTH |
| 打包失败（构建错误） | 命令中止，不创建 tag/Release | E-RELEASE-BUILD-FAILED |
| 检查更新时网络不通/GitHub 不可达 | 显示"检查失败"可重试，不崩溃 | E-UPDATE-CHECK-NETWORK |
| 仓库尚无任何 Release | 显示"暂无发布版本" | E-UPDATE-NO-RELEASE |
| 首次启动被 Gatekeeper 拦截 | 引导文案提示 Settings 批准路径 | 文案级（非错误状态） |

## 7. 表单与输入验证（Form / Input Validation）

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| release 版本参数 | 必须为语义化版本 `X.Y.Z`（可带 `v` 前缀，规范化存储）；必须大于当前 package.json version | "版本号必须是 X.Y.Z 形式且高于当前版本" | E-RELEASE-INVALID-VERSION / E-RELEASE-VERSION-BELOW |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 错误状态 |
|---|---|---|
| tag 名 = `v<version>`（规范化后） | release 命令创建 tag 时 | — |
| 同名 tag/Release 已存在 | 创建前检查，已存在则中止（防覆盖） | E-RELEASE-TAG-EXISTS |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| release 版本非法 | 非 semver | `E-RELEASE-INVALID_VERSION` | 命令报错退出码非 0 | 无副作用（先校验后改文件） |
| release 版本过低 | ≤ 当前版本 | `E-RELEASE_VERSION_BELOW` | 命令报错 | 无 |
| gh 未认证 | `gh auth status` 失败 | `E_RELEASE_GH_AUTH` | 提示先 `gh auth login` | 无 |
| tag 已存在 | `gh release view vX` 成功 | `E_RELEASE_TAG_EXISTS` | 提示换版本或先删 | 无 |
| 打包失败 | 构建/打包抛错 | `E_RELEASE_BUILD_FAILED` | 报错中止 | 已改的 version 回滚（命令内处理） |
| 检查更新网络失败 | fetch 超时/断网 | `E_UPDATE_CHECK_NETWORK` | UI 显示"检查失败，请重试" | 无 |
| 仓库无 Release | GitHub 404/latest 为空 | `E_UPDATE_NO_RELEASE` | UI 显示"暂无发布版本" | 无 |
| 版本比较异常 | 最新版本解析失败 | `E_UPDATE_PARSE` | UI 显示检查失败 | 无 |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | simple |
| 判断理由 | 模块数 3（CLI 命令、主进程更新检查服务、renderer UI 组件）；输入量 1（版本参数）；分支中等（检查更新 3 个失败态）；外部依赖 2（GitHub API、gh CLI） |

> 虽为 simple，仍完整填写第 6-8 节（外部依赖多，失败态必须定义）。

## 10. 实现决策（高层，不写代码）

- release 命令加入现有 CLI 命令组（对齐 ADR-001 CLI 优先惯例；不新增独立脚本工具）；内部按序：校验 → 改 package.json → `npm run make`（或 forge package+zip）→ 生成/校验资产 → `gh release create`。
- 检查更新服务放主进程（fetch GitHub API 不受 renderer CORS 限制），经 `ipcMain.handle("opc-check-updates")` 暴露；查询逻辑与 UI 解耦，便于单元测试。
- 版本比较用 semver 规范比较（自己实现或最小依赖），不信任字符串序。
- "去下载"跳转用 `shell.openExternal(GitHub Releases 页)`（主进程已有 shell 用法）。
- release 命令支持 `--dry-run`：只打印将执行的步骤与命令，不实际 bump/打包/上传——测试 seam。
- release 命令前置校验：当前 git 分支必须为 main；变更 package.json 后自动 commit + push（tag 由 gh release create 推送）；命令内记录原版本，失败时恢复。
- 检查更新：主进程 fetch `api.github.com/repos/{owner}/{repo}/releases/latest`（公开仓库免 token，未认证限流 60 req/h，手动+启动静默频率远低于此）；仓库 owner/repo 读 package.json 的 repository 字段。
- 版本比较：手写最小 semver 比较（X.Y.Z 数值比较），不引入新依赖。
- 启动静默检查：app ready 后异步触发一次，超时短（~5s），失败仅记日志；有新版时复用同一套 UI 提示。

## 11. 测试决策

### 11.1 覆盖接缝（coverage seams）

| 稳定块 | seam | 测试类型 |
|---|---|---|
| S1 release 命令 | CLI 测试：`--dry-run` 断言步骤序列与版本校验；gh 命令经可注入执行器 mock | CLI（单元） |
| S2 检查更新 | 主进程服务函数：注入 fetch 的 mock（有/无 release、网络错误）；版本比较函数（当前≥最新/当前<最新） | 单元 |
| S3 版本展示 | E2E：应用内可见当前版本号（读 package.json 同步的显示） | E2E |
| S4 首次安装引导 | 发布 README 章节 + 应用内文案存在性 | 人工 + E2E 文案存在性 |

## 12. 范围外

- 签名/公证/notarization（需 Apple Developer 账号）
- 自动更新（Squirrel.Mac 签名硬要求，research 证伪；手动重装替代）
- Windows / Linux 打包分发
- 私有渠道、自托管更新服务器
- MDM 部署
- 更新失败后的复杂恢复 UI

## 13. 补充说明

- 技术事实依据：`research/electron-updater-unsigned-macos-github-feed.md`（2026-08-01）——Squirrel.Mac 硬性签名要求、macOS 15+ 移除 Control-click、App Translocation 影响 Downloads 启动。
- 首次安装引导必须同时覆盖：Settings 批准路径（macOS 15+）与"放入 /Applications"建议（避免 Translocation 只读卷问题）。
- 应用内不含敏感凭据（飞书凭据走环境变量），公开 Release 无数据泄露风险——访谈确认。
- 国内访问 GitHub 慢/不稳：检查更新失败态必须清晰可重试（E_UPDATE_CHECK_NETWORK）。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | 6.1 覆盖 S1-S4 全部 happy path；6.2 覆盖分支异常 |
| 输入验证 | PASS | 第 7 节：release 版本参数（唯一用户输入） |
| 错误状态 | PASS | 第 8 节：发布 5 态 + 检查更新 3 态 |
| 复杂度分级 | simple | 理由见第 9 节 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-01 | 初稿（访谈 + research 后） | AI + 人 |
| v0.2 | 2026-08-01 | 用户确认，锁定进入 tech-design | 人 |
| v0.3 | 2026-08-02 | tech-design 讨论反向同步：S1 加 main 分支约束+自动 commit/push；S2 加启动静默检查；M1/M3 定稿移出移动块；检查更新 API 端点/版本比较/仓库来源定稿 | AI + 人 |
