# Research: electron-updater 与 electron-forge 集成 + 未签名 macOS 自动更新的可行性

> 调研日期：2026-08-01
> 主题：latest-mac.yml 生成规范、未签名 macOS 应用自动更新的硬性限制、GitHub Release feed 解析逻辑、electron-updater × electron-forge 共存实践
> 来源：primary sources（electron-builder / electron-updater / electron-forge / Squirrel.Mac 源码克隆 + 官方文档 + Apple 官方文档 + GitHub 官方 API 文档；源码克隆基于 2026-08-01 的 master/main 分支）

## 执行摘要

1. **latest-mac.yml 的生成规范**（字段、sha512 编码、zip 命名）有明确源码依据：文件由 app-builder-lib 的 `updateInfoBuilder.ts` 生成，字段为 `version` / `files[{url, sha512, size}]` / `releaseDate`（ISO-8601）；`sha512` 是 **SHA-512 的 base64 编码**（`hashFile(file, "sha512", "base64")` 默认参数）；zip 默认命名 `${productName}-${version}[-${arch}]-mac.zip`；electron-forge 的任何 maker 都不生成该文件，仅 maker-zip 可选生成**旧版 Squirrel.Mac 格式**的 `RELEASES.json` — [electron-builder updateInfoBuilder.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/publish/updateInfoBuilder.ts)、[builder-util-runtime hash.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/builder-util-runtime/src/hash.ts)、[forge MakerZIP.ts](https://github.com/electron/forge/tree/main/packages/maker/zip/src/MakerZIP.ts)
2. **未签名 macOS 应用的自动更新在官方路径下不可行，这是硬性要求而非软限制**：Squirrel.Mac（electron-updater 在 macOS 上依赖的原生更新器）在初始化时要求运行中的应用必须有代码签名——`SecCodeCopyDesignatedRequirement` 失败即抛异常并禁用更新（"Could not get code signature for running application, application updates are disabled"）；更新包还必须通过以当前应用 designated requirement 校验的 `SecStaticCodeCheckValidityWithErrors`，未签名更新包报 `SQRLCodeSignatureErrorDomain: code object is not signed at all` — [SQRLUpdater.m](https://github.com/electron/Squirrel.Mac/blob/master/Squirrel/SQRLUpdater.m)、[SQRLCodeSignature.m](https://github.com/electron/Squirrel.Mac/blob/master/Squirrel/SQRLCodeSignature.m)、[Electron autoUpdater 文档](https://www.electronjs.org/docs/latest/api/auto-updater)、[electron-builder auto-update 文档](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
3. **macOS 15 Sequoia 起，未签名/未公证软件的 Gatekeeper 覆盖流程收紧了**：Apple 官方宣布 "users will no longer be able to Control-click to override Gatekeeper… They'll need to visit System Settings > Privacy & Security"；此外 Gatekeeper 会把从下载位置（如 ~/Downloads）直接启动的 app 置于"随机只读位置"（App Translocation），Squirrel.Mac 因此在只读卷上无法安装更新（"Cannot update while running on a read-only volume… move the application out of the Downloads directory"）— [Apple Developer News](https://developer.apple.com/news/?id=saqachfa)、[Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)、[SQRLUpdater.m L227-229](https://github.com/electron/Squirrel.Mac/blob/master/Squirrel/SQRLUpdater.m)
4. **GitHub feed 的"最新版本"由 `releases/latest`（最近的非 draft、非 prerelease release）+ `releases.atom` feed 共同确定**；公开仓库走 github.com 的 web 端点（刻意不用 API 以避免限流），私有仓库走 api.github.com（`Authorization: token`）；`latest-mac.yml` 从 `releases/download/<tag>/latest-mac.yml` 拉取，404 即报 `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`；检查失败时 `checkForUpdates()` **reject + 发出 `error` 事件，不是静默失败** — [GitHubProvider.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/GitHubProvider.ts)、[PrivateGitHubProvider.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/PrivateGitHubProvider.ts)、[GitHub REST API 文档](https://docs.github.com/en/rest/releases/releases)
5. **"自动下载 + 提示重启"语义**：`autoDownload` 默认 `true`（发现更新即自动下载）；macOS 上 Squirrel.Mac 在下载阶段就完成 staging，更新在下次启动时自动生效，`quitAndInstall()` 只是触发立即重启（`autoRunAppAfterInstall=true` 时重启，否则 `app.quit()`）；electron-builder 官方对 forge 的定位是 "Publishing, Auto Update, and Code Signing are only available when using electron-builder as your primary build tool" — [AppUpdater.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/AppUpdater.ts)、[MacUpdater.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/MacUpdater.ts)、[electron-builder Forge 集成文档](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/electron-forge.md)

## 详细发现

### 1. latest-mac.yml 的生成规范

#### 1.1 谁生成、文件名叫什么
- 生成代码在 `packages/app-builder-lib/src/publish/updateInfoBuilder.ts`（`createUpdateInfoTasks` / `writeUpdateInfoFiles`），mac 平台产物为 `latest-mac.yml`：文件名 = `${channel}${osSuffix}.yml`，channel 默认 `"latest"`，非 Windows 平台加 `-${buildConfigurationKey}`（mac 即 `-mac`）— [updateInfoBuilder.ts L46-68](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/publish/updateInfoBuilder.ts)
- 官方文档："`latest.yml` (or `latest-mac.yml` for macOS, or `latest-linux.yml` for Linux) will be generated and uploaded for all providers except `bintray`" — [auto-update.md](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
- 格式历史：electron-builder 27 起默认只输出现代 `files[]` 格式；仅当 `electronUpdaterCompatibility` 声明的范围与旧版交集时才补发顶层 `path`/`sha512`（<2.16.0）或 `latest-mac.json`（<2.0.0）— [updateInfoBuilder.ts L99-104, L115-126](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/publish/updateInfoBuilder.ts)、[auto-update.md "ElectronUpdaterCompatibility"](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)

#### 1.2 字段与 sha512 编码
- 结构（`UpdateInfo`）：
  - `version`：应用版本号
  - `files: [{ url, sha512, size }]`：zip 排在最前（"zip must be first"）；同一发布可能含 dmg+zip 多个条目
  - `releaseDate`：写入时生成 `new Date().toISOString()`（ISO-8601 UTC）
  - 可选 `releaseNotes`（来自 release-notes 文件）
  - 分阶段发布时可手动加 `stagingPercentage`（官方文档示例）
- `sha512` 编码为 **base64**：`hashFile(event.file)`，其实现 `builder-util-runtime/src/hash.ts: export function hashFile(file, algorithm = "sha512", encoding: "base64" | "hex" = "base64")` — [hash.ts L4](https://github.com/electron-userland/electron-builder/tree/master/packages/builder-util-runtime/src/hash.ts)
- `size` 来自 mac zip 构建时的 blockmap：`createBlockmap()` 返回 `BlockMapDataHolder { sha512, size, blockMapSize? }`，经 `event.updateInfo` merge 进 `files[0]`（`Object.assign` 逻辑）— [ArchiveTarget.ts L77-89](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/targets/ArchiveTarget.ts)、[differentialUpdateInfoBuilder.ts L62-80](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/targets/differentialUpdateInfoBuilder.ts)、[updateInfoBuilder.ts L166-184](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/publish/updateInfoBuilder.ts)
- 官方文档示例（含 base64 sha512 与 size 的真实样例）：
  ```yaml
  version: 1.1.0
  files:
    - url: TestApp Setup 1.1.0.exe
      sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
      size: 62021782
  stagingPercentage: 10
  ```
  — [auto-update.md "Staged Rollouts"](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)

#### 1.3 zip 命名约定
- 默认 artifact 名：`${productName}-${version}` +（arch 非默认时 `-${arch}`）+ `-${os}.${ext}`，即 `MyApp-1.0.0-mac.zip`、`MyApp-1.0.0-arm64-mac.zip` — [ArchiveTarget.ts L28-35](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/targets/ArchiveTarget.ts)
- 注意：`latest-mac.yml` 里 `files[].url` 是**实际文件名**（`path.basename(event.file)`）；GitHub provider 时用 `safeArtifactName`（空格等特殊字符替换为 `-`）— [updateInfoBuilder.ts L128-137](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/publish/updateInfoBuilder.ts)。因此 feed 中的 url 与上传的资产名必须完全一致。

#### 1.4 读取方如何解析
- 公开 GitHub：`GitHubProvider.getLatestVersion()` 从 `https://github.com/{owner}/{repo}/releases/download/{tag}/latest-mac.yml` 拉取（tag 来自 `releases/latest` 解析，见第 3 节），`parseUpdateInfo()` 用 js-yaml 解析 — [GitHubProvider.ts L158-190](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/GitHubProvider.ts)、[Provider.ts parseUpdateInfo](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/Provider.ts)
- `files[]` 条目必须含 `sha512` 或 `sha2`，否则抛 `ERR_UPDATER_NO_CHECKSUM`；mac 端 `MacUpdater` 只认 zip（`findFile(files, "zip", ["pkg","dmg"])`），无 zip 抛 `ERR_UPDATER_ZIP_FILE_NOT_FOUND` — [Provider.ts resolveFiles L156-165](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/Provider.ts)、[MacUpdater.ts L99-103](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/MacUpdater.ts)
- 官方文档："`zip` target for macOS is **required** for Squirrel.Mac, otherwise `latest-mac.yml` cannot be created, which causes `autoUpdater` error. Default target for macOS is `dmg`+`zip`" — [auto-update.md](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)

### 2. 未签名 macOS 应用自动更新的可行性

#### 2.1 Squirrel.Mac 的硬性要求（决定性问题）
- Electron 官方 autoUpdater 文档原文："**Your application must be signed for automatic updates on macOS. This is a requirement of `Squirrel.Mac`.**" — [Electron autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater)
- electron-builder 官方文档：":::info[Code signing is required on macOS] macOS application must be signed in order for auto updating to work. :::" — [auto-update.md L15-16](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
- 源码机制（Electron 使用的 Squirrel.Mac fork，即 electron-updater 在 mac 上 feed 给原生 `autoUpdater` 的框架）：
  - 初始化时：`_signature = [SQRLCodeSignature currentApplicationSignature:&error]; if (_signature == nil) { … @throw NSInternalInconsistencyException "Could not get code signature for running application" }`（release 构建）→ **未签名应用连更新器都初始化不了** — [SQRLUpdater.m L190-197](https://github.com/electron/Squirrel.Mac/blob/master/Squirrel/SQRLUpdater.m)
  - `currentApplicationSignature` = `SecCodeCopySelf` + `SecCodeCopyDesignatedRequirement`，任一失败即 nil — [SQRLCodeSignature.m L48-91](https://github.com/electron/Squirrel.Mac/blob/master/Squirrel/SQRLCodeSignature.m)
  - 更新包校验：`verifyAndPrepareUpdate` → `verifyBundleAtURL` → `SecStaticCodeCheckValidityWithErrors(bundle, kSecCSCheckAllArchitectures, 当前应用的 designated requirement)`；未签名更新包失败 → `SQRLCodeSignatureErrorDomain` code -1，文案 "Code signature at URL … did not pass validation: code object is not signed at all" — [SQRLCodeSignature.m L103-147](https://github.com/electron/Squirrel.Mac/blob/master/Squirrel/SQRLCodeSignature.m)
- 实证：electron-builder issue #6396，未签名更新包报 `SQRLCodeSignatureErrorDomain` "code object is not signed at all" — [issue #6396](https://github.com/electron-userland/electron-builder/issues/6396)
- 相关事实：electron-builder 默认行为是自动发现签名证书；显式跳过签名用 `identity: null`，`identity: "-"` 是 ad-hoc 签名（官方文档注明"app will only run on the machine that built it"）— [mac.md L92](https://github.com/electron-userland/electron-builder/blob/master/website/docs/mac.md)、[macPackager.ts L429-443](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/macPackager.ts)。ad-hoc 签名的 designated requirement 基于 cdhash，新版本 cdhash 必然变化，能否通过 Squirrel 校验**未找到官方文档明确说明**（社区报告称 ad-hoc 同样失败；见"不确定"节）。
- 结论（事实层面）：在 electron-updater 官方路径（下载 zip → 本地代理 → Squirrel.Mac 校验/staging → ShipIt 替换）下，未签名应用不可自动更新；社区只有绕过 ShipIt 的自研替换脚本方案，非官方支持。

#### 2.2 Gatekeeper 与 quarantine 属性在自动更新场景的行为
- 机制（Apple 官方）：Gatekeeper "verifies that the software is from an identified developer… is notarized by Apple… and hasn't been altered"；"Gatekeeper also requests user approval before opening downloaded software for the first time"；"Gatekeeper also tracks the provenance of files written by downloaded software." — [Apple Platform Security: Gatekeeper and runtime protection](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)
- 未签名/未公证 app 首次启动会被拦；覆盖方式（macOS 15 之前）：Control-click → Open → 确认（或 System Settings > Privacy & Security > Open Anyway）— [Apple Support 102445](https://support.apple.com/en-us/102445)
- **macOS 15 Sequoia 变化**（Apple Developer News, 2024-08-06）："In macOS Sequoia, users will no longer be able to Control-click to override Gatekeeper when opening software that isn't signed correctly or notarized. They'll need to visit System Settings > Privacy & Security to review security information for software before allowing it to run." — [Apple Developer News](https://developer.apple.com/news/?id=saqachfa)
- **更新包下载是否带 quarantine**：electron-updater 用 Electron 自己的 HTTP 栈下载 zip（`ElectronHttpExecutor`），该路径是否设置 `com.apple.quarantine` 没有 Apple 公开文档可查（quarantine 属性通常由浏览器等下载方设置，非系统自动）——**不确定，未找到 primary source**。可确定的是：**Squirrel.Mac 的 ShipIt 在安装时会显式对每个安装文件执行 `removexattr("com.apple.quarantine")`**（失败时报 "Couldn't remove quarantine attribute … most likely means the file is read-only"）— [SQRLInstaller.m L536-560](https://github.com/electron/Squirrel.Mac/blob/master/Squirrel/SQRLInstaller.m)。机制推论（未完全证实）：更新替换后的 .app 不带 quarantine 属性 → 不再触发 Gatekeeper 首开拦截。
- **App Translocation（比 quarantine 更早的坑）**：Apple 官方："When necessary, Gatekeeper opens apps from randomized, read-only locations."（即防恶意插件机制，将来自隔离位置的应用转置到随机只读路径）— [Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)。后果：应用若从 ~/Downloads 等位置启动，更新安装失败，Squirrel.Mac 原文："Cannot update while running on a read-only volume… If you're on macOS Sierra or later, you'll need to move the application out of the Downloads directory" — [SQRLUpdater.m L227-229](https://github.com/electron/Squirrel.Mac/blob/master/Squirrel/SQRLUpdater.m)；实证 issue #8914（"Cannot update while running on a read-only volume"）— [issue #8914](https://github.com/electron-userland/electron-builder/issues/8914)
- 其他实证：更新下载成功但安装失败多与权限/quarantine 残留相关（#7356："Permission denied … Couldn't remove quarantine attribute"）— [issue #7356](https://github.com/electron-userland/electron-builder/issues/7356)

#### 2.3 macOS 版本差异（未签名 app 启动行为）
- macOS 15 Sequoia：Control-click 覆盖被移除（见上）。
- macOS 10.15 Catalina 及之后：默认要求"签名 + 公证"，未公证软件警告后可覆盖（102445 描述的是当前流程）。
- macOS 15 之前（Sonoma 及更早）：Control-click → Open 可用。
- Apple 未提供按版本逐条的官方对照表；差异叙述以 [Apple News](https://developer.apple.com/news/?id=saqachfa) 与 [102445](https://support.apple.com/en-us/102445) 为据，更早版本（< Catalina）的行为未逐一核实。

### 3. GitHub Release feed

#### 3.1 "最新版本"的确定逻辑（公开仓库 GitHubProvider）
1. 请求 `https://github.com/{owner}/{repo}/releases.atom`（Atom feed，接受 application/xml）
2. 非 prerelease 模式：请求 `https://github.com/{owner}/{repo}/releases/latest`（**github.com web 端点**，`Accept: application/json` 返回 `{ tag_name }`）；源码注释明确："do not use API for GitHub to avoid limit, only for custom host or GitHub Enterprise" — [GitHubProvider.ts L207-225](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/GitHubProvider.ts)
3. 在 Atom feed 中按 tag 匹配 release entry（tag 正则 `/\/tag\/(v?[^/]+)$/`）
4. `allowPrerelease=true` 时不用 releases/latest，直接遍历 feed 按 semver 取最新（且通道名取 prerelease 段，如 `alpha` → 拉 `alpha-mac.yml`）
- "latest" 的 GitHub 语义（官方）："The latest release is the most recent non-prerelease, non-draft release, sorted by the created_at attribute" — [GitHub REST API: Get the latest release](https://docs.github.com/en/rest/releases/releases)
- 定位资产：`latest-mac.yml` 与 zip 都从 `{baseUrl}/releases/download/{tag}/{fileName}` 拉取（文件名空格替换为 `-`）— [GitHubProvider.ts L231-243](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/GitHubProvider.ts)
- 含义：feed 文件必须挂在 `releases/latest` 会解析到的那个 release（最新非 prerelease、非 draft）上；该 release 没有 `latest-mac.yml` 即报 `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`。

#### 3.2 公开 vs 私有仓库
- 公开：无 token，全走 web 端点（releases.atom、releases/latest、releases/download/*），不消耗 GitHub API 配额（官方文档注明的 5000/小时 是 API 配额；"An update check uses up to 3 requests per check" 针对 API 路径）— [auto-update.md](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
- 私有：provider 工厂逻辑 `private` 为真且存在 `GH_TOKEN`/`GITHUB_TOKEN`（或 `token` 配置）时创建 `PrivateGitHubProvider` — [providerFactory.ts L35-43](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providerFactory.ts)
  - 流程：`GET api.github.com/repos/{owner}/{repo}/releases/latest`（`Authorization: token <token>`）→ 在 release `assets` 里找 `latest-mac.yml` 资产 → 经 asset url（仍是 api.github.com）下载；zip 下载也走 API asset url（`fileExtraDownloadHeaders` 带 token）— [PrivateGitHubProvider.ts L32-56, L95-108](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/PrivateGitHubProvider.ts)
  - 官方文档警告：私有 GitHub provider "only for very special cases — not intended and not suitable for all users" — [auto-update.md "Private GitHub Update Repo"](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)

#### 3.3 检查失败的默认行为与可捕获事件
- **不是静默失败**：`checkForUpdates()` 的 `doCheckForUpdates` catch 分支会 `this.emit("error", e, message)` 并 **reject 返回的 promise**（"Cannot check for updates: …"）— [AppUpdater.ts L428-435](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/AppUpdater.ts)
- 典型错误码：`ERR_UPDATER_LATEST_VERSION_NOT_FOUND`（"Unable to find latest version on GitHub … please ensure a production release exists"）、`ERR_UPDATER_NO_PUBLISHED_VERSIONS`（feed 空）、`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`（latest-mac.yml 404）、`ERR_UPDATER_INVALID_RELEASE_FEED`、`ERR_UPDATER_NO_CHECKSUM`、`ERR_UPDATER_ZIP_FILE_NOT_FOUND` — [GitHubProvider.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/GitHubProvider.ts)、[Provider.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers/Provider.ts)
- 事件全集：`checking-for-update` / `update-available` / `update-not-available` / `download-progress` / `update-downloaded` / `update-cancelled` / `error` / `login` / `appimage-filename-updated` — [AppUpdater.ts L55-66](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/AppUpdater.ts)、[auto-update.md "Events"](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
- 未打包环境：`isUpdaterActive()` 为 false（非 packaged 且未强制 dev 配置）时 `checkForUpdates()` 直接返回 null，不发请求 — [AppUpdater.ts L452-461](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/AppUpdater.ts)
- macOS 上原生 autoUpdater 的 error 也会转发为 electron-updater 的 `error` 事件（MacUpdater 构造器）— [MacUpdater.ts L28-31](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/MacUpdater.ts)

### 4. electron-updater 与 electron-forge 共存的已知实践

#### 4.1 forge 侧的现状（事实）
- forge 全部 maker（appx/base/deb/dmg/flatpak/msix/pkg/rpm/snap/squirrel/wix/zip）中**没有任何 maker 生成 latest-mac.yml / latest.yml**（对 forge 源码克隆全量检索确认）。
- 唯一沾边的是 `maker-zip`：当配置 `macUpdateManifestBaseUrl` 时，为 darwin 构建生成**旧版 Squirrel.Mac 的 `RELEASES.json`**（格式 `{currentRelease, releases:[{version, updateTo:{version, pub_date, notes, name, url}}]}`，且要联网读旧文件合并）——这与 electron-updater 的 yml feed 是**两套不兼容的格式** — [MakerZIP.ts L62-107](https://github.com/electron/forge/tree/main/packages/maker/zip/src/MakerZIP.ts)、[Config.ts](https://github.com/electron/forge/tree/main/packages/maker/zip/src/Config.ts)
- electron-builder 官方文档对 forge 的立场："Publishing, Auto Update, and Code Signing are only available when using electron-builder as your primary build tool. If you need any of those features, migrate fully to electron-builder rather than using these makers."；且官方提供的 forge maker 只覆盖 NSIS/AppImage/Snap（无 mac zip）— [electron-forge.md](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/electron-forge.md)
- 社区实践：在 forge 管道中自行产出 latest-mac.yml（用 electron-builder 构建并提取，或脚本计算 sha512 base64 + size 生成 yml）并上传到 release/静态托管；代表性开源案例 waveterm（electron-builder 产出 latest-mac.yml 并发布到 S3 供 electron-updater 轮询；注意其自身用 electron-builder 而非 forge）— [waveterm buildres README](https://git.lipovcan.cz/Upstream/waveterm/raw/branch/main-legacy/buildres/README.md)。**未检索到 forge 官方或成熟的"forge → latest-mac.yml"现成工具**。

#### 4.2 依赖与主进程初始化要点（文档 + 源码事实）
- 依赖：`electron-updater` 作为 **app dependency**（非 devDependency；官方文档 "Install electron-updater as an app dependency"）— [auto-update.md](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
- 配置：`autoUpdater.setFeedURL(...)` 或直接 `new MacUpdater(options)`（options 含 `provider: "github"` / `generic` 等；github 需要 `owner`/`repo`，`private: true` + token 见 3.2）— [providerFactory.ts](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providerFactory.ts)、[auto-update.md](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
- `checkForUpdates()` 调用位置：无强制约定；官方示例在 app ready 后调用 `checkForUpdatesAndNotify()`（= checkForUpdates + 下载完成后系统通知）。仅在 packaged 后生效。
- `autoDownload`（默认 `true`）：发现更新后自动下载；`false` 时须手动 `downloadUpdate()` — [AppUpdater.ts L70, L615, L629](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/AppUpdater.ts)
- 安装时机 API 代际：
  - 稳定 6.x（electron-builder 26）：布尔 `autoInstallOnAppQuit`（默认 true）
  - master/7.x（electron-builder 27+）：枚举 `autoInstallEvent: "onQuit" | "onNextLaunch" | "manual"`（默认 `"onQuit"`）；types.ts 注释明确 onQuit=历史 autoInstallOnAppQuit true 行为、manual=历史 false 行为 — [types.ts L23-26](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/types.ts)、[AppUpdater.ts L96-110](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/AppUpdater.ts)、[auto-update.md](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
- **"自动下载 + 提示重启"在 macOS 上的语义**：下载完成时 Squirrel.Mac 已 staging，`update-downloaded` 事件触发后提示用户；用户确认后 `quitAndInstall()`：
  - macOS 上 "onQuit" 与 "onNextLaunch" 行为相同（Squirrel 原生在 relaunch 时应用已 staged 的更新）；官方文档 "macOS is unaffected: Squirrel.Mac natively stages downloaded updates and applies them on relaunch" — [auto-update.md L165-168](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)
  - Electron 官方："a successfully downloaded update will always be applied the next time the application starts"（不调 quitAndInstall 也会在下次启动生效）— [Electron autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater)
  - `quitAndInstall()` 行为：`autoRunAppAfterInstall=true`（默认）→ `nativeUpdater.quitAndInstall()`（立即重启）；否则 `app.quit()` — [MacUpdater.ts L268-301](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/MacUpdater.ts)
- macOS 下载实现细节：下载 zip 后 electron-updater 起一个本地 HTTP 代理（127.0.0.1 随机端口 + basic auth），`setFeedURL` 指向代理并调用原生 `checkForUpdates()`，让 Squirrel.Mac 从本地代理拉取 zip 做校验与 staging — [MacUpdater.ts L144-266](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/MacUpdater.ts)

## 不确定 / 待验证

1. **ad-hoc 签名能否走通 Squirrel.Mac 更新**：ad-hoc 签名的 designated requirement 基于 cdhash，版本更新后 cdhash 必然变化，`SecStaticCodeCheckValidityWithErrors` 大概率失败；社区文章称 ad-hoc "仍失败"，但 Apple/Squirrel 无官方文档直接断言——机制上可以推演，未找到逐字 primary source。
2. **Electron 的 HTTP 栈下载 zip 是否设置 `com.apple.quarantine`**：Apple 未公开 quarantine 属性设置方/继承规则；`com.apple.quarantine` 是未文档化 xattr。唯一 primary 事实是 ShipIt 安装时显式剥离它（SQRLInstaller.m）。"更新后的 app 不会再被 Gatekeeper 拦截"属于机制推论。
3. **Gatekeeper 对未签名 app 的"批准"如何持久化**（批准后 quarantine 是否被清除、是否按路径/cdhash 记录）：Apple 文档只说"该 app 被保存为例外"（102445），底层机制未公开。
4. **macOS 15 之前各版本对未签名 app 的确切对话框流程**：以 102445（当前版本文章）+ Apple News 为准，逐版本差异未逐一核实。
5. **forge zip 内部结构**（.app 是否在 zip 根目录）：MakerZIP 把 `.app` 目录传给 cross-zip，未直接验证 zip 内顶层条目名（Squirrel.Mac 要求 .app 位于 zip 根）。
6. **electron-updater 6.x 稳定版与 7.x 的 API 细节差异**：本报告源码来自 master 克隆（electron-updater 7.0.0-alpha.5 / app-builder-lib 27.0.0-alpha.6），`autoInstallEvent` 为 7.x API；6.x 的 `autoInstallOnAppQuit` 语义由 types.ts 注释佐证，未单独核对 6.x 发布代码。
7. **GitHub API 配额对私有 provider 的精确计数**：官方文档称"update check uses up to 3 requests per check"，未核对不同路径（含/不含预发布、blockmap 差异下载）的精确请求数。

## 开放问题

- 若产品必须支持未签名 macOS 自动更新：官方路径（electron-updater + Squirrel.Mac）被硬性排除，替代方案（自研"下载 zip → 退出 → unzip 替换 .app → 去 quarantine → 重启"脚本，或 ad-hoc 签名 + 绕过 ShipIt）的取舍与风险留给 tech-design。
- 未签名场景下 App Translocation / 只读卷问题的缓解策略（是否强制用户把 app 放入 /Applications；启动时检测 translocation 的兜底）。
- forge 管道中 latest-mac.yml 的生成方式（复用 electron-builder 的 publish 逻辑 / 自写脚本计算 base64 sha512 + size），以及 mac zip 由 forge maker-zip 还是 electron-builder 产出（zip 内部 .app 结构差异）。
- GitHub 公开仓库 vs 私有仓库的取舍：公开仓库零配置即可更新检查；私有仓库需要把 `GH_TOKEN` 分发到每台用户机器（或改 generic provider + 自建认证）。
- 更新检查失败（网络/限流/404）时产品的降级与提示策略（错误码/事件已列明，产品决策留给 tech-design）。
- 公证（Developer ID + notarization，需付费开发者账号）与未签名路线的成本/体验权衡。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| electron-updater 源码（master 克隆 7.0.0-alpha.5） | https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src （本地克隆 /tmp/electron-builder-src） | 2026-08-01 | AppUpdater.ts / MacUpdater.ts / providerFactory.ts / providers/*.ts：事件、错误码、GitHub feed 逻辑、mac 下载机制 |
| updateInfoBuilder.ts（latest-mac.yml 生成） | https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/publish/updateInfoBuilder.ts | 2026-08-01 | 字段格式、channel 文件名、sha512、legacy 兼容 |
| builder-util-runtime hash.ts | https://github.com/electron-userland/electron-builder/tree/master/packages/builder-util-runtime/src/hash.ts | 2026-08-01 | hashFile 默认 sha512 + base64 |
| ArchiveTarget.ts / differentialUpdateInfoBuilder.ts | https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/targets/ | 2026-08-01 | zip 命名、size/blockmap 来源 |
| electron-builder 官方文档 auto-update.md | https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md | 2026-08-01 | mac 签名要求、zip 必需、事件、private GitHub、autoInstallEvent、staged rollout |
| electron-builder 官方文档 mac.md / electron-forge.md | https://github.com/electron-userland/electron-builder/blob/master/website/docs/mac.md、…/features/electron-forge.md | 2026-08-01 | identity: null/"-"，forge 集成官方立场 |
| Squirrel.Mac（Electron fork）源码 | https://github.com/electron/Squirrel.Mac （本地克隆 /tmp/squirrel-mac-src） | 2026-08-01 | SQRLUpdater.m / SQRLCodeSignature.m / SQRLInstaller.m：签名硬要求、read-only volume、quarantine 剥离 |
| Electron autoUpdater API 文档 | https://www.electronjs.org/docs/latest/api/auto-updater | 2026-08-01 | "must be signed" 官方引文、quitAndInstall 语义 |
| electron-forge 源码（main 克隆） | https://github.com/electron/forge/tree/main/packages/maker/zip （本地克隆 /tmp/electron-forge-src） | 2026-08-01 | 无 maker 生成 yml feed；MakerZIP 生成旧版 RELEASES.json |
| Apple Platform Security: Gatekeeper and runtime protection | https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web | 2026-08-01 | quarantine 溯源、随机只读位置（App Translocation）、首次打开审批、可覆盖 |
| Apple Support: Open apps safely on your Mac (102445) | https://support.apple.com/en-us/102445 | 2026-08-01 | Control-click Open / Open Anyway 流程 |
| Apple Developer News: Updates to runtime protection in macOS Sequoia | https://developer.apple.com/news/?id=saqachfa | 2026-08-01 | Sequoia 移除 Control-click 覆盖的官方引文 |
| GitHub REST API 文档（Get the latest release） | https://docs.github.com/en/rest/releases/releases | 2026-08-01 | "latest release" 定义（非 prerelease、非 draft、created_at 排序） |
| electron-builder issue #6396 | https://github.com/electron-userland/electron-builder/issues/6396 | 2026-08-01 | SQRLCodeSignatureErrorDomain 实证 |
| electron-builder issue #8914 | https://github.com/electron-userland/electron-builder/issues/8914 | 2026-08-01 | read-only volume / translocation 实证 |
| electron-builder issue #7356 | https://github.com/electron-userland/electron-builder/issues/7356 | 2026-08-01 | 更新下载成功但安装失败（quarantine/permission）实证 |
| waveterm 构建脚本（社区实践参考） | https://git.lipovcan.cz/Upstream/waveterm/raw/branch/main-legacy/buildres/README.md | 2026-08-01 | 社区生成 latest-mac.yml + 静态托管的实例 |
