# Research: pi SDK 嵌入模式下官方包机制可复用度

> 调研日期：2026-08-12
> 主题：包发现/安装/两级设置/启停能力中，哪些是 SDK 程序化 API，哪些要宿主复刻
> primary source：本机 `node_modules/@earendil-works/pi-coding-agent@0.83.0`（`dist/`、`docs/`、`package.json`）

## 执行摘要

1. **包管理核心类是公开 SDK API**：`DefaultPackageManager`、`SettingsManager`、`DefaultResourceLoader` 均从包根导出（`dist/index.d.ts` 第 14-20 行），宿主可直接 `new DefaultPackageManager({ cwd, agentDir, settingsManager })` 调用 `install/installAndPersist/remove/removeAndPersist/update/resolve/listConfiguredPackages`（签名见 `dist/core/package-manager.d.ts` 第 39-67 行）。即 `pi install/remove/update/list` 的底层能力全部程序化可达，无需复刻。
2. **SDK 入口默认就会读 settings.json 并加载/自动安装 packages**：`createAgentSession()` 未传 `resourceLoader` 时自建 `DefaultResourceLoader({cwd, agentDir, settingsManager})` 并 `reload()`（`dist/core/sdk.js` 第 75-79 行）；`reload()` 无条件调用 `packageManager.resolve()`，而 `resolve()` 在缺包且未传 `onMissing` 回调时**默认自动安装**缺失的 npm/git 包（`dist/core/resource-loader.js` 第 275 行；`dist/core/package-manager.js` 第 977-1006 行 `installMissing` 分支）。这不是 CLI 独有行为。
3. **CLI 的「壳」不导出**：`pi install`/`pi config` 的命令解析、信任门交互、进度打印在 `dist/package-manager-cli.js`（导出 `handlePackageCommand`/`handleConfigCommand`），`pi config` 的 enable/disable 交互与持久化在 `dist/modes/interactive/components/config-selector.js`；二者均**不在** `package.json` exports（仅 `.` 与 `./rpc-entry`）与 `dist/index.d.ts` 的导出清单内。但 enable/disable 的持久化机制只是经 `SettingsManager` 的公开 setter 写 `+path`/`-path` 模式进 settings.json，宿主可用公开 API 等价复刻。
4. **两级作用域求值在 PackageManager 内，而非 SettingsManager 合并视图**：`SettingsManager` 的 `deepMergeSettings` 对数组是「项目整体覆盖全局」（`dist/core/settings-manager.js` 第 8-33 行），但 `DefaultPackageManager.resolve()` 绕过合并视图，分别读 `getGlobalSettings()/getProjectSettings()` 后自行 dedupe：同包项目优先；项目条目带 `autoload: false` 时作为全局条目的 delta 叠加（`dist/core/package-manager.js` 第 694-727 行 `resolve`、第 1386 行起 `dedupePackages`、第 1034-1043 行 `findAutoloadDeltaBase`）。
5. **agentHome 可完全覆盖**：`createAgentSession({ agentDir })`、`DefaultResourceLoader({ agentDir })`、`SettingsManager.create(cwd, agentDir)` 均接受显式 `agentDir`；环境变量 `PI_CODING_AGENT_DIR`（常量名由包名派生，`dist/config.js` 第 396-417 行 `ENV_AGENT_DIR`/`getAgentDir()`）是进程级覆盖。workstation 主进程 spawn 注入 `PI_CODING_AGENT_DIR` 的做法与官方机制一致（worker.js 第 99-102 行注释）。

## 详细发现

### 包/设置加载链路

**CLI 入口链路**（`dist/main.js`）：

- 第 416 行：先以 `SettingsManager.create(cwd, agentDir, { projectTrusted: false })` 建 bootstrap 设置管理器（项目设置默认不受信任）。
- 第 521-543 行：`ProjectTrustStore(agentDir)` 读 `trust.json`；`hasTrustRequiringProjectResources(cwd)` 判断是否需要信任提示；解析出 `projectTrusted` 后重建 runtime `SettingsManager`。
- 第 419/431 行：`handlePackageCommand(args)`（`pi install/remove/update/list`）与 `handleConfigCommand(args)`（`pi config`）在进交互模式之前拦截处理，二者来自 `dist/package-manager-cli.js`（第 516 行 `handleConfigCommand`、第 584 行 `handlePackageCommand`）。

**SDK 入口链路**（`dist/core/sdk.js` `createAgentSession`，第 66-79 行）：

```js
const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
...
if (!resourceLoader) {
    resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
    await resourceLoader.reload();
}
```

- `DefaultResourceLoader` 构造器内部自建 `DefaultPackageManager({ cwd, agentDir, settingsManager })`（`dist/core/resource-loader.js` 第 159-163 行）。
- `reload()` 第 275 行调用 `this.packageManager.resolve()`（**不传 onMissing**）→ 对 settings.json 中声明但本地缺失的 npm/git 包**直接自动安装**（`dist/core/package-manager.js` 第 992-1006 行：`if (!onMissing) { await this.installParsedSource(...); return true; }`）。`PI_OFFLINE` 环境变量可禁用（`package-manager.js` 第 36-40 行 `isOfflineModeEnabled`，离线时跳过安装）。
- 结论：**SDK 默认路径与 CLI 一样会读两级 settings.json、解析 packages、自动装缺失包**。CLI 额外做的只是信任门（projectTrusted 默认 false 起步、交互询问）与进度/错误呈现。注意 `SettingsManager.create` 的 `projectTrusted` **默认是 true**（`dist/core/settings-manager.js` 第 153 行 `options.projectTrusted ?? true`），CLI 是显式传 false 再走信任流程；SDK 宿主若用默认构造则项目设置默认被信任——这是 SDK 与 CLI 行为的一个实质差异。
- workstation 现状：worker.js 第 1014 行用 `SettingsManager.inMemory()`（无文件 I/O、packages 为空），第 1094-1106 行自建 `DefaultResourceLoader` 并设 `noExtensions/noSkills/noPromptTemplates/noThemes/noContextFiles: true`，因此官方包发现链路虽在 `reload()` 中执行，但读到的是空设置，实际不装不载。

### 程序化 API 盘点

`package.json` exports 仅两个入口：`.`（`dist/index.js`/`index.d.ts`）与 `./rpc-entry`。以下均从 `.` 导出（出处：`dist/index.d.ts`）：

| 导出 | 形态 | 来源文件 | 关键签名 |
|---|---|---|---|
| `DefaultPackageManager` | class（实现 `PackageManager` 接口） | `dist/core/package-manager.d.ts` 第 75 行；index.d.ts 第 15 行 | 见下 |
| `PackageManager` 等类型 | type | `dist/core/package-manager.d.ts` 第 2-67 行；index.d.ts 第 14 行 | `PathMetadata/ResolvedResource/ResolvedPaths/ProgressEvent/PackageUpdate/ConfiguredPackage` |
| `SettingsManager` | class | `dist/core/settings-manager.d.ts` 第 131 行；index.d.ts 第 20 行 | `static create(cwd, agentDir?, options?)` / `static fromStorage(storage, options?)` / `static inMemory(settings?, options?)` |
| `Settings`/`PackageSource` 等类型 | type | `dist/core/settings-manager.d.ts` 第 53-107 行 | `PackageSource = string \| { source, autoload?, extensions?, skills?, prompts?, themes? }` |
| `DefaultResourceLoader` / `ResourceLoader` / `loadProjectContextFiles` | class/interface/fn | `dist/core/resource-loader.d.ts` 第 29-220 行；index.d.ts 第 16-17 行 | 构造参数 `DefaultResourceLoaderOptions`（第 67-119 行） |
| `getAgentDir` / `CONFIG_DIR_NAME` / `getPackageDir` 等路径函数 | fn/const | `dist/config.d.ts` 第 65-94 行；index.d.ts 第 2 行 | `getAgentDir(): string` |
| `discoverAndLoadExtensions` / `createExtensionRuntime` / `ExtensionRunner` / `defineTool` / `wrapRegisteredTool(s)` | fn/class | `dist/core/extensions/index.ts`；index.d.ts 第 8 行 | `discoverAndLoadExtensions(configuredPaths, cwd, agentDir = getAgentDir(), eventBus)`（`dist/core/extensions/loader.js` 第 520 行） |
| `hasTrustRequiringProjectResources` / `ProjectTrustStore` | fn/class | `dist/core/trust-manager.ts`；index.d.ts 第 25 行 | 信任决策存储（`~/.pi/agent/trust.json`） |

`DefaultPackageManager` 公开方法（`dist/core/package-manager.d.ts` 第 39-67 行 interface `PackageManager`，第 75 行起 class）：

- `resolve(onMissing?: (source) => Promise<"install"|"skip"|"error">): Promise<ResolvedPaths>` — 从两级设置解析全部资源；`onMissing` 缺省时自动安装缺失包。
- `install(source, { local? })` / `installAndPersist(source, { local? })` — 安装（npm/git/local），`AndPersist` 版本同时写 settings.json；`local: true` 写项目级。
- `remove(source, { local? })` / `removeAndPersist(...): Promise<boolean>`。
- `update(source?)` — 不带参数更新全部；`checkForAvailableUpdates(): Promise<PackageUpdate[]>` 在 class 上（第 116 行）。
- `listConfiguredPackages(): ConfiguredPackage[]` — 对应 `pi list`。
- `resolveExtensionSources(sources, { local?, temporary? })` — 对应 `pi -e` 临时挂载。
- `addSourceToSettings(source, { local? }): boolean` / `removeSourceFromSettings(...)` — 只改设置不安装。
- `setProgressCallback(cb)` / `getInstalledPath(source, scope)`。
- 构造：`new DefaultPackageManager({ cwd, agentDir, settingsManager })`（`PackageManagerOptions`，第 68-72 行）。
- 模块级 `getExtensionTempFolder(agentDir)` 存在于 `package-manager.d.ts` 第 74 行，但**未**从 index 再导出（exports map 封锁深路径，实际不可用——见「不确定」节）。

**未导出（CLI 壳，宿主需复刻或绕开）**：

- `handlePackageCommand` / `handleConfigCommand`（`dist/package-manager-cli.d.ts` 第 6-7 行）——参数解析、`--approve` 信任门、console 输出、`process.exit`。
- `pi config` 的交互式 enable/disable UI 与持久化逻辑：`dist/modes/interactive/components/config-selector.js`（`toggleTopLevelResource` 第 419 行、`togglePackageResource` 第 468 行、`setProjectResourceOverride` 系列）。其持久化最终只调用 `SettingsManager` 的公开 setter（`setPackages/setProjectPackages/setExtensionPaths/...`），机制可复刻，UI 不可复用。
- `selectConfig`（`dist/cli/config-selector.js`）同样未导出。

### 两级作用域与 enable/disable 求值

**schema**（`dist/core/settings-manager.d.ts`）：

- `Settings.packages?: PackageSource[]`（第 85 行）；`PackageSource`（第 53-60 行）：字符串 = 全量加载；对象形式 `{ source, autoload?, extensions?, skills?, prompts?, themes? }` = 过滤；注释明确「autoload=false: start empty and only apply explicit resource patterns」。
- 顶层 `extensions?/skills?/prompts?/themes?: string[]`（第 86-89 行）——本地路径条目，支持 `!`/`+`/`-` 前缀模式（enable/disable 覆写也写在这里，见下）。
- 文件位置：`FileSettingsStorage`（`dist/core/settings-manager.js` 第 44-49 行）：global = `join(agentDir, "settings.json")`；project = `join(cwd, CONFIG_DIR_NAME, "settings.json")`（`CONFIG_DIR_NAME = ".pi"`，`dist/config.js` 第 394 行）。写文件经 `proper-lockfile` 加锁（`withLock`，settings-manager.d.ts 第 112-125 行）。

**两级求值**：

- 一般设置项：`deepMergeSettings(global, project)`（settings-manager.js 第 8-33 行）——嵌套对象递归合并；**数组与原始值项目方整体胜出**（文档 `docs/settings.md`「Project Overrides」节示例一致）。
- `packages` 例外：`DefaultPackageManager.resolve()`（`dist/core/package-manager.js` 第 694-727 行）分别读 `getGlobalSettings()/getProjectSettings()`，项目条目先入列（`allPackages.push({pkg, scope:"project"})` 先于 user），然后：
  - `dedupePackages`（第 1386 行起，注释第 1382-1385 行）：同身份包项目覆盖全局；身份规则 = npm 按包名、git 按无 ref 的规范化 URL（SSH/HTTPS 视为同库）、local 按解析后绝对路径（`getPackageIdentity`，.d.ts 第 145 行注释）。项目条目 `autoload: false` 时两条都保留（delta 先行）。
  - `findAutoloadDeltaBase`（第 1034-1043 行）：项目 `autoload:false` 条目以全局同身份条目为基座解析资源，再叠加项目自己的显式模式。
- 与 `docs/packages.md`「Scope and Deduplication」节一致。

**enable/disable 的持久化与求值**：

- 持久化（TUI，`config-selector.js`）：顶层资源 → 往对应 scope 的 `extensions/skills/prompts/themes` 数组写 `+pattern`（启用）/`-pattern`（禁用），先剔除同目标旧模式（第 419-466 行 `toggleTopLevelResource`）；包内资源 → 把包条目升级为对象形式，往 `pkg[resourceType]` 写 `+`/`-` 相对包根模式；过滤清空后回退为字符串形式（第 468-512 行 `togglePackageResource`）。项目模式还有三态 inherit/load/unload（`setProjectResourceOverride` 系列，可对继承自全局的条目写覆盖）。
- 求值（PackageManager）：`applyPatterns`（package-manager.js 第 533 行附近，glob+`!` 排除）、`isEnabledByOverrides`（第 520-530 行：`+` 强制启用、`-`/`!` 禁用）、`applyAutoloadDisabledPatterns`（第 1823 行，autoload=false 时默认全禁、仅显式模式启用）。结果体现在 `ResolvedResource.enabled`，`DefaultResourceLoader.reload()` 只加载 `enabled` 的路径（resource-loader.js 第 287-296 行 `getEnabledResources`）。
- 宿主复刻成本：写侧 = `settingsManager.getGlobalSettings()/getProjectSettings()` + 上述 setter（全公开）；求值侧无需复刻（`DefaultPackageManager.resolve` 已做）。`pi config` 里「按资源列出 enabled 状态」的清单可由 `resolve()` 返回的 `ResolvedPaths`（含 `enabled` 与 `metadata.source/scope/origin`）直接得到——`handleConfigCommand` 自己也是这么组装的（`dist/package-manager-cli.js` 第 566-582 行，两次 new DefaultPackageManager 分别求 global/project 的 ResolvedPaths）。

**信任门**：项目级安装/读取项目包存储前 `assertProjectTrustedForScope` 抛错（package-manager.js `assertProjectTrustedForScope`：「Project is not trusted; refusing to access project package storage」）；项目设置整体在 `projectTrusted=false` 时不加载（settings-manager.js 第 172-186 行 `loadFromStorage`）。非交互模式的信任回退由 `defaultProjectTrust` 全局设置控制（`docs/settings.md` 第 14-20 行）。

### extensionFactories 与自动发现的合并

- `extensionFactories` 是 `DefaultResourceLoaderOptions` 的字段（`dist/core/resource-loader.d.ts` 第 76 行，类型 `InlineExtension[]`；`InlineExtension` = 裸工厂或 `{ name, factory, hidden? }`）。`createAgentSession` 自身不接受该参数，需经 `DefaultResourceLoader` 注入（`docs/sdk.md` 第 583-601 行示例）。
- 合并方式：`loadCurrentExtensionSet`/`loadFinalExtensionSet` 先用 `loadExtensionsCached(extensionPaths, cwd, eventBus)` 加载文件系统扩展，再 `loadExtensionFactories(runtime)` 把内联工厂**追加到末尾**（`dist/core/resource-loader.js` 第 415-418 行、第 424-432 行 `extensionsResult.extensions.push(...inlineExtensions.extensions)`）。内联扩展路径标记为 `<inline:N>` 或 `<inline:name>`（第 743-756 行 `loadExtensionFactories`）。
- 即：**SDK 传 extensionFactories 不抑制自动发现**；两者并集，内联在后。`noExtensions: true` 时才跳过设置/目录发现的扩展（但 CLI `-e` 临时扩展仍加载；resource-loader.js 第 315-317 行、第 408-411 行），内联工厂不受影响——与 worker.js 第 1092-1093 行注释一致。
- 顺序语义：`ExtensionRunner.emitToolCall`（`dist/core/extensions/runner.js` 第 698-715 行）按扩展数组顺序逐 handler 调用，**首个返回 `{ block: true }` 的结果立即短路返回**。由于内联工厂排在文件系统扩展之后，若宿主需要自有 gate 先于某个内联扩展执行，须在 `extensionFactories` 数组内部排序（worker.js 第 1071-1081 行正是把授权桥工厂排在 gotgenes 工厂之前）。
- 冲突检测：同名 tool/command/flag 不阻止加载，只追加 diagnostics，先后按加载顺序定优先（resource-loader.js `addExtensionConflictDiagnostics`，第 458-466 行）。
- 动态工具注册：`ExtensionAPI.registerTool(tool: ToolDefinition): void`（`dist/core/extensions/types.d.ts` 第 890 行）；文档明确「`pi.registerTool()` 在扩展加载期与启动后都可调用……新工具立即刷新进同一会话，无需 /reload」（`docs/extensions.md` 第 1337-1341 行附近）。SDK 侧另有 `defineTool()` 帮助函数（types.d.ts 第 385 行；index.d.ts 第 8 行导出）与 `createAgentSession({ customTools: ToolDefinition[] })`（sdk.d.ts 第 45 行），`customTools` 与扩展注册工具合并（`docs/sdk.md` 第 573-575 行）。
- 官方文件扩展的加载机制本身就是 jiti：`dist/core/extensions/loader.js` 第 14 行 `import { createJiti } from "jiti/static"`、第 325-332 行 `jiti.import(extensionPath, { default: true })`。workstation 手工 jiti 加载 gotgenes 再经 `extensionFactories` 传入，与官方 loader 同机制、不同入口。

### agentHome/cwd 路径解析与可覆盖性

- 默认 agentDir：`getAgentDir()`（`dist/config.js` 第 412-417 行）= `process.env[ENV_AGENT_DIR]`（即 `PI_CODING_AGENT_DIR`，常量在第 396-397 行由 `APP_NAME.toUpperCase() + "_CODING_AGENT_DIR"` 派生）展开 `~` 后的值；未设则 `join(homedir(), ".pi", "agent")`。文档：`docs/environment-variables.md` 第 76 行。
- 覆盖点（全部公开）：
  - `createAgentSession({ agentDir })`（sdk.d.ts 第 14 行注释「Global config directory. Default: ~/.pi/agent」；sdk.js 第 68 行 `options.agentDir ? resolvePath(...) : getDefaultAgentDir()`）。显式传 agentDir 还会把 `auth.json`/`models.json` 路径带进 `ModelRuntime.create`（sdk.js 第 70-72 行）。
  - `SettingsManager.create(cwd, agentDir = getAgentDir())`（settings-manager.js 第 147-149 行）。
  - `DefaultResourceLoader({ cwd, agentDir })`（resource-loader.d.ts 第 67-69 行）。
  - `new DefaultPackageManager({ cwd, agentDir, settingsManager })`。
  - 进程级：`PI_CODING_AGENT_DIR` 环境变量（workstation 主进程正是注入它，worker.js 第 99-102 行注释）。
- 派生路径（均以 agentDir 为根，随覆盖联动）：`settings.json`、`auth.json`、`models.json`、`themes/`、`tools/`、`bin/`、`prompts/`、`sessions/`、`npm/`、`git/`（config.d.ts 第 76-94 行；package-manager.js `getNpmInstallRoot`/`getGitInstallRoot` = `join(agentDir, "npm"|"git")` / 项目级 `join(cwd, ".pi", ...)`）。sessionDir 另有 `PI_CODING_AGENT_SESSION_DIR` 与 `settings.sessionDir`（environment-variables.md 第 77 行；settings-manager.d.ts 第 103 行）。
- 项目级根固定为 `join(cwd, CONFIG_DIR_NAME)` = `<cwd>/.pi`，`CONFIG_DIR_NAME` 来自 package.json 的 `piConfig.configDir`（dist/config.js 第 394 行），不可由宿主运行时覆盖（编译期常量）。
- `docs/sdk.md` 第 336-365 行明确列出 cwd/agentDir 各自的发现面；传自定义 `ResourceLoader` 后 cwd/agentDir 不再控制资源发现，仅影响会话命名与工具路径解析。

## 不确定 / 待验证

1. **`getExtensionTempFolder` 的可达性**：在 `dist/core/package-manager.d.ts` 第 74 行导出，但 `dist/index.d.ts` 未再导出，且 `package.json` exports 仅暴露 `.` 与 `./rpc-entry`——Node exports 封锁下无法深路径 import。判定为「事实上不可用」，未实际运行验证。
2. **`resolve()` 无 `onMissing` 时自动安装**在 SDK 默认路径的实际触发面：代码路径明确（resource-loader.js:275 → package-manager.js:992-996），但未验证 `PI_OFFLINE` 之外是否还有守卫。`installParsedSource` 内部对项目 scope 有信任断言，用户 scope 未见额外守卫。
3. **workstation 当前 `SettingsManager.inMemory()` 下 `reload()` 的自动发现副作用**：`addAutoDiscoveredResources`（package-manager.js）仍会扫描 `<agentDir>/extensions` 等目录（不依赖 settings 内容），只因 `noExtensions: true` 结果被丢弃。扫描本身是否产生其他副作用（如 `.agents/skills` 祖先目录遍历）未逐行核实。
4. **pi.dev 网站文档**：本地 `docs/` 随包发布（package.json files 含 docs），与 pi.dev 内容同源；本调研未抓取 pi.dev 在线版本，假定二者一致（可能存在版本漂移）。
5. **`extensionFactories` 与 `extensionsOverride` 的交互**：`extensionsOverride`（resource-loader.d.ts 第 84 行）作用于合并后的最终 `LoadExtensionsResult`（含内联扩展），未见文档说明，语义从 reload() 代码推断。

## 开放问题

1. SDK 模式下若宿主想启用官方包发现，`projectTrusted` 的信任门流程（ProjectTrustStore + 提示 UI）有多少需要宿主自己实现？`hasTrustRequiringProjectResources`/`ProjectTrustStore` 已导出，但「何时问、怎么问」的交互在 CLI/TUI 层未导出。
2. `DefaultPackageManager.install*` 的进度/错误 UX（`ProgressCallback` 已导出）在 Electron 宿主中如何映射到 UI，不在本次调研范围。
3. `npmCommand` 设置（mise/asdf 包装）在宿主无 npm 环境的打包形态下的行为，未调研。
4. 官方自动安装语义（启动即联网装包）对 workstation「离线/受控分发」诉求的影响，属工程决策，本次不展开。

## 参考来源清单

| 来源 | 路径/URL | 访问日期 | 用途 |
|---|---|---|---|
| package.json（本地安装包） | `/Users/zhanglei/charon/code/workspace/workstation/node_modules/@earendil-works/pi-coding-agent/package.json` | 2026-08-12 | exports map、版本 0.83.0、jiti 依赖 |
| SDK 入口实现 | `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js`（第 66-79 行）、`sdk.d.ts` | 2026-08-12 | createAgentSession 默认 loader/settings 链路、agentDir 覆盖 |
| 包管理器 | `dist/core/package-manager.d.ts`、`package-manager.js`（resolve 694-727、resolvePackageSources 977-1060、dedupePackages 1386+、findAutoloadDeltaBase 1034-1043、isOfflineModeEnabled 36-40、install root 1630+） | 2026-08-12 | 程序化 API 签名、两级求值、自动安装、路径布局 |
| 设置管理器 | `dist/core/settings-manager.d.ts`、`settings-manager.js`（deepMergeSettings 8-33、create 147-149、FileSettingsStorage 44-49、getPackages 682+） | 2026-08-12 | settings schema、两级文件位置、合并语义、inMemory |
| 资源加载器 | `dist/core/resource-loader.d.ts`、`resource-loader.js`（构造 153-205、reload 263-330、loadCurrentExtensionSet 401-418、loadFinalExtensionSet 424-456、loadExtensionFactories 740-757） | 2026-08-12 | extensionFactories 合并、noExtensions 语义、enabled 过滤 |
| 扩展加载器/运行时 | `dist/core/extensions/loader.js`（jiti 14/325-332、loadExtensionFromFactory 385、discoverAndLoadExtensions 520）、`runner.js`（emitToolCall 698-715）、`types.d.ts`（registerTool 890、defineTool 385） | 2026-08-12 | jiti 机制、tool_call 顺序短路、动态工具注册 |
| 路径配置 | `dist/config.js`（394-417）、`config.d.ts`（65-94） | 2026-08-12 | PI_CODING_AGENT_DIR、~/.pi/agent 派生路径 |
| 根导出清单 | `dist/index.d.ts` | 2026-08-12 | 公开 API 边界（哪些导出/未导出） |
| CLI 包命令壳 | `dist/package-manager-cli.js`（516-582、584+）、`dist/main.js`（416/419/431/521-543） | 2026-08-12 | CLI 独有层、信任门接线 |
| enable/disable 持久化 | `dist/modes/interactive/components/config-selector.js`（380-560） | 2026-08-12 | +/- 模式写法、三态项目覆盖 |
| 包文档 | `docs/packages.md` | 2026-08-12 | install 命令、源类型、过滤、autoload、dedupe 规则 |
| 设置文档 | `docs/settings.md`（第 3-22、232-271、280-310 行） | 2026-08-12 | 两级文件、信任流程、项目覆盖语义 |
| SDK 文档 | `docs/sdk.md`（第 50-63、330-365、573-640 行） | 2026-08-12 | SDK 目录约定、extensionFactories 示例 |
| 扩展文档 | `docs/extensions.md`（第 1337-1355 行等） | 2026-08-12 | registerTool 动态加载语义 |
| 环境变量文档 | `docs/environment-variables.md`（第 76-79 行） | 2026-08-12 | PI_CODING_AGENT_DIR / PI_OFFLINE / SESSION_DIR |
| workstation 嵌入点 | `/Users/zhanglei/charon/code/workspace/workstation/src/agent/worker.js`（第 46、97-149、1014、1071-1107 行） | 2026-08-12 | 现状对照：agentHome 注入、jiti 手工加载、inMemory settings、noExtensions |
