# ADR-024：PI 插件机制全量复用官方包管理——worker 从封闭装配转官方发现链路

> 状态：已接受
> 日期：2026-08-12
> 相关 story：2026-08-12-pi-mcp-plugin（B1/B2/B3/B8）
> 关联：ADR-013（PI 运行时）、ADR-014/019（进程形态）、ADR-017/020/022（权限体系）、ADR-023（模式）

## 上下文

workstation 的 PI agent 会话装配（worker.js）一直是**封闭盒子**：`SettingsManager.inMemory()`（无文件 I/O）+ `DefaultResourceLoader` 全 `noExtensions/noSkills/...` 关闭官方发现，gotgenes 权限系统经 jiti 手工加载为内联 extensionFactory。

本 story 要支持第三方 PI 插件（extension）的应用内安装与按项目启用。pi 0.83+ 官方包机制（`DefaultPackageManager`/`SettingsManager`/`DefaultResourceLoader`）在 SDK 模式下全部程序化可达（research-2 实证）：npm/git/本地三种来源、全局/项目两级 settings、`+`/`-` 模式启停、`resolve()` 求值含 enabled/scope。

两条路线：

- **A 全量转官方**：worker 改读文件 settings + 开自动发现，插件清单真相 = pi settings.json，项目启用 = 项目 `.pi/settings.json` 覆盖模式。
- **B 管理面官方 + 运行面白名单**：管理面用官方 API 写 settings，运行面仍封闭，由 workstation 计算启用清单注入 inMemory settings。

## 决策

选 **A：全量转官方**。具体姿态：

1. worker 会话装配改用 `SettingsManager.create(cwd, agentDir)` + 官方自动发现链路；插件清单与项目启用**全部落在 pi settings 文件**（全局 `agentHome/settings.json` + 项目 `.pi/settings.json`），workstation DB 不抄一份。
2. **gotgenes + 授权桥保持 `extensionFactories` 内联注入**（官方宿主注入面，docs/sdk.md），数组顺序宿主控制（授权桥先于 gotgenes 的语义不变）。第三方插件走自动发现，排在内联之后；`emitToolCall` 所有 handler 跑完工具才执行，权限门不可被绕过。
3. **缺包不自动装**：worker 传 `onMissing → "error"`，缺包即报错并指引去插件页重装（关闭官方「启动期联网自愈」行为）。
4. **项目默认信任**：接受 SDK `projectTrusted` 默认 true，不复刻 CLI 信任门（单用户本机产品，项目皆用户自己登记）。

## 后果

- 正面：与 pi 生态行为一致（用户用 pi CLI 管理同一份配置不打架）；两级求值/启停清单/身份 dedupe 全部白拿官方实现；未来 pi 升级自动获益。
- 负面：会话启动引入目录扫描与文件读取（此前为零）；官方包机制行为变化随 pi 升级传导（B9 升级切片已含回归）。
- 口子显式化：项目 `.pi/settings.json` 被默认信任——若未来支持导入外部项目/多用户，必须重审本条第 4 点。

## 替代方案

- **B（运行面白名单）**：会话装配确定性更高，但两级求值要自己复刻、与 pi CLI 行为分叉，且「管理面写文件、运行面读 DB 计算」引入双真相换算层。被否：复用度与一致性优先。

## 相关文件

- `src/agent/worker.js`（会话装配）
- `.aiassist/stories/2026-08-12-pi-mcp-plugin/research/pi-embedded-sdk-package-mechanism.md`
