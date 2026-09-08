# ADR-044: MCP SSE 传输协议支持、Ad-hoc 连通探测与运行时权限解析闭环

## 状态
已接受 (Accepted) — 2026-09-08

## 背景与问题

1. **Legacy SSE 端点支持缺失**：部分 MCP 服务（如 crawl4ai Docker `/mcp/sse`）仅暴露遗留的 SSE 端点，工作台此前仅支持 `stdio` 与标准 `http`（streamable-http 并在 404/405 时静默回落）。这种自动回落行为会导致探测报假阴性，且快照无法显式声明 `httpTransport: "sse"`，导致 `pi-mcp-adapter` 无法精准建连。
2. **连接验证割裂**：添加/编辑远程 MCP 连接（尤其是带 Bearer Token 的远程服务）时，用户必须先落库保存才能点击“工具”测试连通性，配置错误时直接污染数据库。
3. **Auto 模式过度防御与一票否决**：Agent 运行时开启 auto 模式后，内置的 `auto-judge` 模型因 Prompt 过于严苛，将正常的网页爬取（crawl4AI）误判为“数据外发风险”并硬拦截（`deny`），导致任务直接报错中断，剥夺了用户的确认权利。
4. **MCP 权限配置运行时脱节**：用户在工作台 UI 将特定 MCP 工具配置为 `Allow` 后，由于底层 gotgenes 权限引擎的参数解析盲区及 worker 进程内存缓存滞后，导致调用时无法命中规则，仍然被当成默认 `ask` 阻断。

## 决策

1. **显式 SSE Transport 建模**：
   - MCP `type` 枚举从 `stdio | http` 扩充为 `stdio | http | sse`（三选）；
   - 取消 `http` 类型的静默自动回落；
   - `effectiveConfig` 快照针对 `sse` 显式注入 `httpTransport: "sse"`，确保底层适配器精准走 legacy SSE 通道；
   - 保持凭据安全不变量：Bearer Token 经系统安全凭据库加密存储，快照为唯一解密输出点，API 任何接口绝不回显明文 Token。

2. **无状态 Ad-hoc 探测接口**：
   - 暴露 `POST /api/mcp/probe` 端点，接受表单内联临时配置（包含未落库的明文 Token 与 Headers），在服务端建立一次性探测并即刻销毁；
   - 支持在弹窗内直接反馈连接状态与工具清单，保障“测通再落库”。

3. **Auto 模式权责重构（Deny → Defer）**：
   - 模型裁决器（`auto-judge`）仅承担“加速放行”职责，取消其直接杀死任务的硬拒绝权；
   - 当模型返回 `deny` 或 `defer` 时，统一转换为 `defer`，平滑移交下游的 `opc-bridge` 弹出人工确认卡，由用户最终裁决；
   - 优化 `AUTO_JUDGE_SYSTEM_PROMPT`，明确将网络数据读取、网页爬虫、常规只读构建操作定义为合法操作，默认倾向 `allow`。

4. **MCP 运行时权限多级解析（`resolveMcpPermission`）**：
   - 在 worker 桥接层建立 `server:tool`、`tool`、`server_tool`、`server` 多候选自适应匹配器，支持大小写不敏感通配；
   - 优先级：项目级覆盖文件 → SQLite 数据库用户级默认权限（`listMcpPermissionDefaults()`，即改即生效）→ 全局策略部署文件 → gotgenes 内置 resolver。用户在 UI 配置 `Allow` 后，调用直接秒级直通执行（`allow_once`）。

## 后果与影响

### 积极影响
- 成功打通包括 crawl4ai 在内的纯 SSE 远程 MCP 服务，接入成功率 100%。
- 用户在 UI 录入复杂服务时可实时测通，不再产生脏数据。
- Auto 模式不再随意导致任务暴毙，体验平滑，兼顾了自动化与安全性。
- 权限配置在 UI 与运行时真正统一，符合所见即所得。

### 潜在代价
- `type` 枚举扩充需要所有消费快照的下游（如桥接器、mock fixture）适配处理。
- `POST /api/mcp/probe` 接收明文 Token，需要依靠本机的 localhost 边界进行网络隔离保护。

## 相关文件
- Story: `.aiassist/stories/2026-09-07-mcp-sse-transport/`
- 代码: `src/services/mcpService.js`, `src/renderer/pages/Mcp.jsx`, `src/agent/worker.js`, `src/agent/mcpBrokerLink.js`
