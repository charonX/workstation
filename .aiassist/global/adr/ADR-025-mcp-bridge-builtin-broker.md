# ADR-025：MCP 桥内置内联 + DB 快照注入 + broker 权限接线

> 状态：已接受
> 日期：2026-08-12
> 相关 story：2026-08-12-pi-mcp-plugin（B4/B5/B6）
> 关联：ADR-024（插件机制）、ADR-017/020/022/023（权限体系）

## 上下文

pi 官方无内置 MCP（README 明示由 extension 承担）。社区事实标准为 `pi-mcp-adapter`（官方画廊收录，~354K 下载/月，MIT）。它提供两种配置方式：6 层文件 precedence（`~/.config/mcp/mcp.json` 等）或程序化 `createMcpAdapter({ config })` 内存快照（隔离语义：不与任何文件 merge）；权限挂接面为 broker 事件 `pi-mcp-adapter:tool-approval-request`（claim 返回 allow_once/allow_for_session/deny/abstain，载荷含 serverName/originalToolName/args）。

决策点：①桥作为「用户可装插件」还是「应用内置能力」；②MCP server 配置真相在哪；③权限怎么接。

## 决策

1. **桥 = 应用内置内联工厂**：`pi-mcp-adapter` 打包为 workstation 依赖，worker 会话装配时以 `createMcpAdapter({ config })` 注入，配置 = mcpService 从 DB 计算的「本项目生效快照」。桥不走插件管理机制（不可被用户停用/卸载）。
2. **MCP server 配置真相 = workstation DB**（新表 `mcp_servers` + 项目启用映射），不写任何 pi/mcp 配置文件。内存快照的隔离语义保证用户机器上散落的 mcp.json 不会漏进会话。
3. **权限 = broker → 授权桥 → gotgenes `mcp` 面**：claim 内调 `checkPermission("mcp", "<server>:<tool>")`（gotgenes 原生预留 mcp 面，public.d.ts L62）；allow→`allow_once`，deny→`deny`+reason，ask→确认挂起队列（auto 模式先过 ADR-023 模型 link）；一期不用 `allow_for_session`。配置面规则族扩 `mcp`（server:tool glob，默认 ask），权限配置 UI 跟随扩分组。

## 后果

- 正面：配置单一真相（DB）；无文件同步一致性负担；权限语义与 bash/write 等面同构，三档模式与确认队列零新机制；remote/bearer/OAuth 由桥现成支持。
- 负面：桥版本随应用发布（用户不能自升级桥）；`allow_for_session` 未映射（会话级放行体验缺失，留待模式系统演进）；MCP 代理模式下 pi 层 `tool_call` 只见 `mcp` 包装工具，细粒度拦截完全依赖 broker 事件（adapter 升级变更 broker 语义会直接冲击权限链路——pin 版本 + 集成测试守护）。

## 替代方案

- **桥作为受管插件 + 写 mcp.json 文件**：插件机制可管桥本身，但 DB→文件同步是一致性负担，且文件模式的 6 层 precedence 会混入用户级散落配置。被否。
- **pi 层 tool_call 拦截替代 broker**：代理模式下只见包装工具名，粒度不足。被否（作为兜底保留：direct tools 提升后 toolName 可见）。

## 相关文件

- `src/agent/worker.js`、`src/services/permissionBridge.js`、`src/services/policyRules.js`
- `.aiassist/stories/2026-08-12-pi-mcp-plugin/research/pi-community-mcp-bridge.md`
