# ADR-012: macOS 分发走"未签名 + 公开 GitHub Release + 手动重装 + 轻量检查更新"路线

- **状态**: 已接受
- **日期**: 2026-08-02
- **相关 story**: 2026-08-01-macos-distribution
- **相关 REQ**: REQ-DIST-001 ~ REQ-DIST-004（2026-08-01-macos-distribution）

## 背景

打包产物未签名未公证，无法外发给他人使用（Gatekeeper 拦截），且无发布渠道。候选方案中最"标准"的是 electron-updater 自动更新，但调研（`research/electron-updater-unsigned-macos-github-feed.md`）证伪了"不签名 + 自动更新"的组合：

1. **Squirrel.Mac 硬性要求代码签名**：初始化时 `SecCodeCopyDesignatedRequirement` 失败即抛异常禁用更新（未签名应用连更新器都初始化不了）；更新包还需通过基于当前应用 designated requirement 的静态校验，未签名报 `SQRLCodeSignatureErrorDomain`。Electron 官方文档原文："Your application must be signed for automatic updates on macOS. This is a requirement of Squirrel.Mac."
2. 自动更新唯一官方路径需要 Apple Developer Program 账号（$99/年）+ Developer ID 证书，团队无账号且不打算投入。
3. macOS 15 (Sequoia) 起移除 Control-click 覆盖 Gatekeeper，未签名/未公证软件需去 System Settings > Privacy & Security 批准；App Translocation 使从 ~/Downloads 启动的应用无法更新（只读卷）。

## 决策

1. **不做签名/公证**（无 Apple Developer 账号），分发渠道 = **公开 GitHub Release**（仓库 `charonX/workstation` 已公开；接受更新包公开可下载 + 国内访问慢）。
2. **不做自动更新**，采用**手动重装**：用户从 Releases 下载 .dmg 安装；应用内提供**轻量检查更新**（fetch `api.github.com/.../releases/latest` → semver 比较 → 提示 → 跳转 Releases 页），启动后异步静默检查一次 + Settings 页手动按钮。
3. **首次安装引导**：README + 应用内文案引导 System Settings > Privacy & Security 批准（macOS 15+），并建议拖入 /Applications（规避 App Translocation 只读卷问题）。
4. **CLI `release` 命令为 dev-time 发布者工具，绕过本地 HTTP server**（对 ADR-001 的例外）：纯本地执行（bump → `npm run make` → git commit/push → `gh release create`），不暴露在产品 API 上（renderer 无调用方）。

## 后果

- 无自动更新：使用者需手动下载新版重装；"知道有新版本"靠启动静默检查 + 手动按钮双触点。
- 首次安装成本：每台机器一次 Settings 批准（macOS 15+），之后正常使用。
- release 命令与现有 CLI 命令模式不一致（不走 server），代码中需注释说明该例外；未来若引入多分支协作，main-only 约束需放宽。
- 若未来购买 Apple Developer 账号：可迁回 electron-updater 自动更新（Squirrel 签名校验通过即可），检查更新逻辑届时可替换为官方路径，轻量查询作为降级保留。

## 替代方案

- **A. Apple Developer 账号 + Developer ID 签名 + electron-updater**：$99/年 + 证书管理；自动更新完整可用。因成本与团队意愿排除，未来可重新评估。
- **B. 自托管更新源（腾讯云轻量服务器）**：私密、国内快，但多一台服务器维护成本；当前零成本路线下不需要。
- **C. ad-hoc 签名尝试**：免费但 designated requirement 基于 cdhash、版本更新必然失效，机制上大概率失败（无官方文档逐字支持），不投入。

## 相关文件

- story: `.aiassist/stories/2026-08-01-macos-distribution/{prd,tech-design}.md`
- research: `.aiassist/stories/2026-08-01-macos-distribution/research/electron-updater-unsigned-macos-github-feed.md`
