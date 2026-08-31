# ADR-040: server 注册表锚定机器级固定路径,app 以固定 owner 注册

- **状态**: 已接受
- **日期**: 2026-08-31
- **相关 story**: 2026-08-24-embedded-browser(BUG-001,req-gap 就地补全)
- **相关 REQ**: REQ-BROWSER-007
- **修订**: ADR-001(「CLI 作为 HTTP 客户端;未检测到 server 时自动启动 headless server」的发现机制由本 ADR 细化;HTTP 通道本身不变)

## 背景

ADR-001 定了「CLI 经本地 HTTP API 发现运行中的 server,发现不了就自起 headless」。但发现机制的注册表锚点从未定义,实现把它挂在了 per-configDir 下(`<configDir>/server.json`)。2026-08-31 embedded-browser QA 期实证:外部 AI/CLI 对运行中 app 的内置浏览器执行 `browser read` 返回 E-BROWSER-NOT-READY,根因是请求根本没到达 app——

1. **锚点分裂**:Electron app 把 `OPC_WORKSTATION_CONFIG_DIR` 指向 `~/Library/Application Support/opc-workstation`(bootstrap-env),外部 CLI 默认落 `~/.opc-workstation`,两边各写各的注册表,互不可见;
2. **记录被覆盖**:app 启动时 `startServer` 写入标准注册记录(含 pid/owner)后,main.js 又用 E2E fixture 格式 `{port, baseUrl}` 覆盖同一文件,pid/owner 丢失,discoverServer 跳过无 pid 记录;
3. **owner 语义不覆盖 app 场景**:discoverServer 默认要求 `owner === String(process.ppid)`,外部 CLI 的 owner 永远不等于 app 的 owner(`String(process.pid)`)。

三层叠加 → 外部 CLI 发现永远失败 → ensureServer 兜底 spawn headless server(无视图)→ 工具回执 NOT-READY → AI 如实转述「读不到」。

## 决策

1. **注册表锚点固定机器级路径 `~/.opc-workstation/server.json`,与 configDir 解耦**。注册表的本职就是跨进程、跨 configDir 的机器级发现;挂在 per-configDir 下与本职矛盾。`OPC_SERVER_REGISTRY_FILE` 环境变量提供覆盖 seam(测试/E2E 隔离用);锁文件与注册表同路径(`<file>.lock`)。
2. **Electron app 以固定 well-known owner `"app"` 注册**。discoverServer 匹配顺序:精确 owner 匹配(既有 headless/测试语义不变)> owner="app" 的可达记录 > allowAnyOwner 兜底(不变)。外部 CLI 由此能发现 app;CLI headless 与测试的 owner 隔离语义不受影响。
3. **`userData/server.json`(`{port, baseUrl}`)保留为纯 E2E fixture seam**。注册表迁出 configDir 后,该文件不再是注册表、不参与发现,app 侧继续写它仅供 E2E fixture 探测端口;两文件分离后「fixture 覆盖注册记录」的冲突形态消失。
4. **app 重启保端口只考虑 owner="app" 的记录**(机器级注册表混有 headless/测试记录,不过滤会复用到别的 server 的端口)。

## 替代方案

1. **app 额外往 `~/.opc-workstation` 写一份副本**(双写):测试零改动,但双写有一致性风险(崩溃残留、两处修剪),且回避了「注册表本职是机器级」的根本问题。
2. **ensureServer 一律 allowAnyOwner**:实现最简单,但外部 CLI 可能误连测试/其他项目遗留的 server,owner 隔离语义被架空。
3. **保持 per-configDir,CLI 侧硬编码扫描 app 的 userData 路径**:平台相关路径洩入 CLI,且仍要解决 owner 匹配与记录覆盖问题。

## 影响

- `src/serverRegistry.js`:锚点固定 + `OPC_SERVER_REGISTRY_FILE` 覆盖;锁文件随注册表路径。
- `src/cli/server.js`:discoverServer 增加 owner="app" 兼容层(精确匹配优先)。
- `src/main/main.js`:`startServer({owner:"app"})`;保端口过滤 owner="app";userData/server.json 仅 E2E seam。
- 测试迁移:依赖 `OPC_WORKSTATION_CONFIG_DIR` 做注册表隔离的测试改用 `OPC_SERVER_REGISTRY_FILE`;E2E fixture(electronApp.cjs)启动 app 时注入 `OPC_SERVER_REGISTRY_FILE` 指向 per-instance 临时路径,防污染真实机器注册表;unit 测试预载 seam 默认注入 per-process 临时注册表。
- ADR-001 的发现机制条款由本 ADR 细化,HTTP 通道与「CLI 即控制面」先例不变。

## 相关文件

- `src/serverRegistry.js`、`src/cli/server.js`、`src/cli/headless-server.js`、`src/main/main.js`、`src/http/server.js`
- `.aiassist/stories/2026-08-24-embedded-browser/requirements.md`(REQ-BROWSER-007)
