# 签核记录 — 2026-08-12-pi-mcp-plugin

## Assertion（门 1，2026-08-13）

### 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`
- [x] PRD 第 6-8 节（操作流 F0-F4 / 验证规则 §7 / 错误状态 E1-E7）已覆盖
- [x] 每个 REQ-ID 都有对应测试（REQ-AGENT-078 经 D7 确认：既有全量套件 356+ 用例即回归网，不新增文件）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致（plugin-management/{extension,mcp-server}、command-interface/cli）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（48 处全部落签）
- [x] 预期值来源清晰：D1-D7 均为人拍板决策，非代码输出
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖（E2 非法输入矩阵、E6 幂等/未安装先启用、fail-closed、三态流转、组合矩阵）

### 人签决策（批量确认 2026-08-13）

- **D1 extensionService**：`createExtensionService({ agentDir, packageManager? })`；`PluginRow = { name, source, version, scope, enabled, error? }`；packageManager 为 npm/git stub 注入缝。
- **D2 项目启用落盘**：`.pi/settings.json` 写 `+<resolved-source>`；停用剔除行（不写 `-`）；幂等先剔后写。
- **D3 worker 装配缝**：`src/agent/sessionAssembly.js` 暴露 `assembleSessionExtensions({ cwd, agentDir, mcpSnapshot?, packageManager? }) → { resolved, factories, diagnostics }`；factories 固定序且带稳定 name：`["opc-permission-bridge", "gotgenes-permission-system", "pi-mcp-adapter"]`。
- **D4 mcp 出厂规则**：零预置规则；族注册 + 部署 JSON 默认 ask（`"mcp": { "*": "ask" }` 等价物）。
- **D5 CLI 命令面**：`plugin add|remove|list|enable|disable`、`mcp add|list|enable|disable`（参数形态见 pluginMcpCli.test.js 头注释）；stdout JSON；业务错误非零退出 + stderr 含错误文案。
- **D6 缺包报错**：错误消息含包名 + 「请到 管理区 → 插件 页重新安装」指引（E2E 只锁「插件」+包名）。
- **D7 REQ-078 覆盖**：既有全量套件即回归网，不新增测试文件。

补充契约（同批落签，记入测试头注释）：
- mcpService：`createMcpService()`；`ServerRow.enabled` 全局开关默认 true；`effectiveConfig(projectId) → { servers: { [name]: … } }`，仅含「全局开 ∧ 项目启用」；错误文案锁「已存在」/「URL」/「KEY=VALUE」。
- mcpBrokerLink：`createMcpBrokerLink({ checkPermission, askConfirmation, mode, decide?, reviewLog? })`；恒以 `("mcp", "<server>:<tool>")` 求值；映射 allow→allow_once / deny→deny / ask→确认卡（auto 先 decide，defer 才弹卡）；异常 fail-closed = deny；一期不用 allow_for_session。
- 故障隔离细化：畸形 MCP 快照 → 桥剔除、授权链保留、诊断含记录（089 标准 3）。
- E2E 路由：插件页 `#/plugins`（新导航项）；权限 mcp 分组在 `#/workspace` 权限区。
- fixture 断言点：MCP 调用日志文件 =「server 是否收到调用」权威来源（stdio/http fixture 均支持 `MCP_FIXTURE_CALL_LOG`）。

### 覆盖摘要

- REQ-AGENT-078（pi 0.84.1 升级）：存量回归网（D7）。
- REQ-AGENT-079~083/089（extension）：api/extensionService、api/workerAssembly、e2e/pluginsPage。
- REQ-AGENT-084~088（mcp-server）：api/mcpService、api/mcpBridge、api/mcpPermissionBroker、api/policyRulesMcp、api/channelParity、e2e/permissionMcpGroup。
- REQ-AGENT-090（cli）：cli/pluginMcpCli。

### 签核状态

签核时全量 43 用例 RED（seam 未就绪 / CLI 缺命令 / golden 缺 mcp 族），0 例误绿。
人工验收留在 REFLECT：OAuth 真实链路体验；插件页/表单/权限分组视觉观感。
