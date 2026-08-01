# 访谈笔记 — 2026-08-01-macos-distribution

## 核心问题

打包产物未签名未公证，无法外发使用（Gatekeeper 拦截），且无发布渠道与更新机制，只能本机自用。需要一条路把 macOS app 发出去并能自动更新。

## 用户画像

- 独立/小型团队开发者，务实，倾向省事路径
- 无 Apple Developer Program 账号（不愿承担 $99/年 + 签名公证维护成本）
- 有一台腾讯云轻量服务器（国内），代码仓库在 GitHub（公开）
- 国内网络环境（GitHub 访问慢是已知代价，接受）

## 关键边界

1. **渠道**：公开 GitHub Release（`charonX/workstation`）——用户明确修正，接受"更新包公开可下载 + 国内访问慢"两个代价
2. **签名**：不做签名/公证（无 ADP 账号），首次安装引导右键打开（Gatekeeper 只拦一次，quarantine 在外壳 .app，electron-updater 更新只替换 Contents，后续更新不再被拦——已向用户确认此技术事实）
3. **更新策略**：自动下载 + 提示重启安装（B 档位，非全静默）
4. **发版流程**：`npm run release` 一条命令（bump version → build → 生成 latest-mac.yml → gh release upload）；不是手动步骤
5. **应用内**：启动自动检查 + "检查更新"按钮 + 当前版本展示（C）

## 隐含假设

1. 用户能接受右键打开一次的操作成本（工具类用户 OK）
2. GitHub API 在国内"时通时不通"不会阻塞核心使用（启动检查失败静默、可手动重试——C 的检查按钮即兜底）
3. 发版人本机有 gh CLI 认证（repo 权限 token）
4. app 内不含敏感凭据（飞书凭据走环境变量，flows/项目数据在用户本机 DB）——公开 release 无数据泄露风险

## 矛盾/风险

1. **初衷修正**："内部/私有分发" → "公开 GitHub Release 分发"（用户拍板，私密性从目标移除）
2. **技术风险（最高）**：electron-forge 不生成 electron-updater 所需的 `latest-mac.yml`，release 脚本需自行计算 zip 的 sha512/size 并按其格式生成；哈希不一致则更新失败
3. **技术风险（次高）**：electron-updater 对未签名 app 在 macOS 15+（Sequoia）的兼容性未经实证——若更新后无法启动，方案退化为手动重装（需要 tech-design spike 验证）
4. 国内访问 GitHub 下载慢 → 大版本更新体验差（接受）

## 候选方向

### 方向 A：腾讯云轻量服务器自托管更新源
- 适用场景：要求私密、国内访问快
- 主要取舍：多一台服务器维护成本（Nginx/HTTPS/证书），发布流程多一步上传
- 推荐度：备选（用户已有服务器，但选了省事路径）

### 方向 B：公开 GitHub Release + electron-updater（确认）
- 适用场景：仓库已公开、团队接受公开分发、想省维护成本
- 主要取舍：更新包公开、国内访问慢；实现最标准（electron-updater GitHubProvider 开箱即用）
- 推荐度：首选（用户确认）

### 方向 C：手动重装分发（不做自动更新）
- 适用场景：低频分发
- 主要取舍：每次手动下载重装，体验差
- 推荐度：不推荐（用户明确要自动更新）

## 确认方向

最终确认的方向：**方向 B**——公开 GitHub Release + electron-updater 自动更新 + 未签名（右键打开一次）+ `npm run release` 封装发版。

确认意图（用户显式 OK）：

- Outcome: 一条 `npm run release` 完成 bump → 打包 → 生成 latest-mac.yml → 发布公开 GitHub Release；macOS 用户下载 .dmg 安装（右键打开一次），应用启动自动检查新版本、后台下载、提示重启生效；设置/关于页有"检查更新"按钮与当前版本号
- User: 任何想用 workstation 的 macOS 用户（仓库公开）
- Why now: 产物只能本机自用；forge 打包就绪，缺发布渠道 + 更新机制
- Success: 发 v1.1 → 另一台 Mac 下载安装可启动（右键打开一次）；再发 v1.2 → v1.1 检测到新版、下载、重启后为 v1.2
- Constraint: 无 Apple Developer 账号（不签名）；更新源 = 公开 GitHub Release；国内访问慢可接受
- Out of scope: 签名/公证、MDM、Windows/Linux、私有渠道、自托管服务器、更新失败复杂恢复 UI

确认理由：渠道/签名/策略/流程全部经用户逐项拍板；暴露面（公开 release）与仓库公开一致，无额外风险。

## 最窄的切入点

先做 tech-design spike 验证两个技术风险（latest-mac.yml 生成 + 未签名 app 更新后启动），再结晶 REQ。

## 待确认问题

- [ ] 发版 tag 命名约定（默认 `v<version>` 即可？）
- [ ] 检查更新的 UI 位置（设置页 vs 关于页 vs 顶部菜单）——BUILD 时按现有布局落地
- [ ] 版本号展示位置（关于弹窗内）
- [ ] Windows squirrel 资产是否顺带上传（scope 外，可不上传）
