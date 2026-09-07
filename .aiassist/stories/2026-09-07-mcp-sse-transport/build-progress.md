# Build Progress — 2026-09-07-mcp-sse-transport

> 故事 ID：`2026-09-07-mcp-sse-transport`  
> 初衷：接入只提供 legacy SSE 端点的 MCP 服务(如 crawl4ai /mcp/sse)时无法显式配置 transport,依赖适配器自动回落,探测报假阴性,接入结果不可预期。  
> 阶段：BUILD  
> 模式：父代理调度 + 子代理实现

---

## 切片规划

| 切片 | 名称 | 涉及 REQ | 涉及实现代码 | 覆盖测试 | 状态 |
|---|---|---|---|---|---|
| Slice 1 | mcpService SSE transport 注册、快照与探测 | REQ-MCP-SSE-001, REQ-MCP-SSE-002, REQ-MCP-SSE-003 | `src/services/mcpService.js` | `api/mcpSseRegister.test.js`<br>`api/mcpSseBridge.test.js`<br>`api/mcpSseProbe.test.js` | COMPLETED |
| Slice 2 | Mcp.jsx 管理页 transport 三选与 sse 展示 | REQ-MCP-SSE-004 | `src/renderer/pages/Mcp.jsx` | `e2e/mcpSsePage.test.cjs` | COMPLETED |

---

## 进度记录

### Slice 1: mcpService SSE transport 注册、快照与探测
- **状态**：COMPLETED
- **涉及模块**：`src/services/mcpService.js`
- **实现内容**：
  1. `create` 与 `update` 接受 `type === "sse"`，与 `http` 同构复用 `validateHttp`（url/auth/token/headers 校验一致）；非法 type 报错字面量对齐 `type 不合法: 仅支持 stdio/http/sse`。
  2. `computeTokenEnc(row, existingTokenEnc)`：支持 `(row.type === "http" || row.type === "sse") && row.auth === "bearer"` 加密存储。
  3. `validateKeyValue`：新增 `HEADER_KEY_RE` 允许 HTTP header 名称中包含中划线等合法字符（如 `X-Team`）。
  4. `toBridgeEntry(row, tokenEnc)`：
     - `row.type === "sse"` 输出 `httpTransport: "sse"`，透传 url、headers、auth、bearerToken（解密）。
     - `row.type === "http"` 输出 `httpTransport: "streamable-http"`，透传 url、headers、auth、bearerToken（解密）。
     - `row.type === "stdio"` 不注入 `httpTransport` 键。
  5. `probeTools(name)`：从 `@modelcontextprotocol/client` 导入 `SSEClientTransport`，`server.type === "sse"` 时使用 `new SSEClientTransport(new URL(server.url), { eventSourceInit: { headers }, requestInit: { headers } })`，注入 bearer token 与自定义 headers；保留 stdio 与 http 分支。

#### PRD → 代码可追溯性表 (Slice 1)

| REQ ID | 验收标准 / 预期行为 | 覆盖测试 | 实现代码落点 | 状态 |
|---|---|---|---|---|
| REQ-MCP-SSE-001 | AC1: create sse+bearer 成功，type/url/auth 原样，list 同值 | `mcpSseRegister.test.js` 标准 1 | `src/services/mcpService.js`: `create` 支持 sse、落库与 `list` 读取 | PASS |
| REQ-MCP-SSE-001 | AC2: create 返回值与 list 输出均不含 token 明文 | `mcpSseRegister.test.js` 标准 2 | `src/services/mcpService.js`: `computeTokenEnc` 密文落库，`rowToServerRow` 不回显 | PASS |
| REQ-MCP-SSE-001 | AC3: url=ftp://... 抛 `URL 不合法: 仅支持 http/https` | `mcpSseRegister.test.js` 标准 3 | `src/services/mcpService.js`: `validateHttp` 协议白名单 | PASS |
| REQ-MCP-SSE-001 | AC4: url 空抛 `URL 不合法: url is required` | `mcpSseRegister.test.js` 标准 4 | `src/services/mcpService.js`: `validateHttp` 必填检查 | PASS |
| REQ-MCP-SSE-001 | AC5: type=ws 抛 `type 不合法: 仅支持 stdio/http/sse` | `mcpSseRegister.test.js` 标准 5 | `src/services/mcpService.js`: `create`/`update` 枚举校验 | PASS |
| REQ-MCP-SSE-001 | AC6: sse+bearer 无 token 抛 `auth=bearer 必须提供 token（加密存系统凭据库）` | `mcpSseRegister.test.js` 标准 6 | `src/services/mcpService.js`: `validateHttp` bearer token 校验 | PASS |
| REQ-MCP-SSE-001 | AC7: auth=basic 抛 `auth 不合法: 仅支持 none/bearer/oauth` | `mcpSseRegister.test.js` 标准 7 | `src/services/mcpService.js`: `validateHttp` auth 枚举校验 | PASS |
| REQ-MCP-SSE-001 | AC8: update 仅改 url 保留既有 bearer 密文 | `mcpSseRegister.test.js` 标准 8 | `src/services/mcpService.js`: `update` 读取 `existingTokenEnc` 并在未提供新 token 时保留 | PASS |
| REQ-MCP-SSE-001 | AC9: sse 支持 headers 键值，非法结构拒绝 | `mcpSseRegister.test.js` 标准 9 | `src/services/mcpService.js`: `validateKeyValue` + `HEADER_KEY_RE` | PASS |
| REQ-MCP-SSE-002 | AC1: sse+bearer 快照深等于 `{url, auth, bearerToken, httpTransport: "sse"}` | `mcpSseBridge.test.js` 标准 1 | `src/services/mcpService.js`: `toBridgeEntry` sse 分支解密与输出 `httpTransport: "sse"` | PASS |
| REQ-MCP-SSE-002 | AC2: http 快照含 `httpTransport: "streamable-http"` | `mcpSseBridge.test.js` 标准 2 | `src/services/mcpService.js`: `toBridgeEntry` http 分支显式输出 `streamable-http` | PASS |
| REQ-MCP-SSE-002 | AC3: stdio 快照不含 `httpTransport` 键 | `mcpSseBridge.test.js` 标准 3 | `src/services/mcpService.js`: `toBridgeEntry` stdio 分支不注入 `httpTransport` | PASS |
| REQ-MCP-SSE-002 | AC4: sse+headers 快照 headers 原样 + `httpTransport: "sse"` | `mcpSseBridge.test.js` 标准 4 | `src/services/mcpService.js`: `toBridgeEntry` 拷贝 headers | PASS |
| REQ-MCP-SSE-002 | AC5: 仅全局开未项目启用的 sse 条目不进快照 | `mcpSseBridge.test.js` 标准 5 | `src/services/mcpService.js`: `effectiveConfig` SQL 保持两层启用内联 | PASS |
| REQ-MCP-SSE-002 | AC6: 快照是唯一解密点，DB 存密文不存明文 | `mcpSseBridge.test.js` 标准 6 | `src/services/mcpService.js`: DB `token_enc` 经 `encryptSecret`，仅 `toBridgeEntry` 解密 | PASS |
| REQ-MCP-SSE-003 | AC1/AC2: sse 探测 legacy-only stub 返回 tools（含 echo），证明走 `SSEClientTransport` | `mcpSseProbe.test.js` 标准 1+2 | `src/services/mcpService.js`: `probeTools` 创建 `SSEClientTransport` | PASS |
| REQ-MCP-SSE-003 | AC3: sse 指向已关闭端口抛错以 `连接失败：` 开头 | `mcpSseProbe.test.js` 标准 3 | `src/services/mcpService.js`: `probeTools` 统一 catch 包装 `连接失败：` | PASS |
| REQ-MCP-SSE-003 | AC4: sse+bearer 探测请求携带 `Authorization: Bearer <token>` | `mcpSseProbe.test.js` 标准 4 | `src/services/mcpService.js`: `probeTools` 在 `eventSourceInit`/`requestInit` 注入 Authorization | PASS |
| REQ-MCP-SSE-003 | AC5: 回归——http 探测既有 streamable fixture 仍成功 | `mcpSseProbe.test.js` 标准 5 | `src/services/mcpService.js`: `probeTools` http 分支保持 `StreamableHTTPClientTransport` | PASS |

- **验证记录**：
  - `Slice 1: complete (9682aac..bd50b56, tests green, PRD alignment passed)`
  - `Slice 1: refactor pass done (bd50b56..bd50b56, tests green, no changes needed)`

### Slice 2: Mcp.jsx 管理页 transport 三选与 sse 展示
- **状态**：COMPLETED
- **涉及模块**：`src/renderer/pages/Mcp.jsx`
- **实现内容**：
  1. `mcp-type-seg` 控件增加第三项 `data-type="sse"`，按钮文本为 `SSE（流式服务）`；点击重置 url 与 headers。
  2. 表单字段展示条件调整为 `(mcpForm.type === "http" || mcpForm.type === "sse")`，展示 url、auth、token、headers 字段，隐藏 command、args、env 字段。
  3. `endpointText(s)`：支持 `s.type === "sse"` 与 `http` 同构展示 URL 与 auth 信息。
  4. 列表行 badge：支持 `s.type === "sse"` 匹配样式 `badge-git`，文本显示 `sse`。
  5. 表单提交（`handleMcpSave`）：`mcpForm.type !== "stdio"` 时收集 url、auth、token、headers，排除 command/args/env。
  6. 编辑回显（`openEditMcp`）：正确回显 `server.type === "sse"`，激活 seg `data-type="sse"` 并回填 url。

#### PRD → 代码可追溯性表 (Slice 2)

| REQ ID | 验收标准 / 预期行为 | 覆盖测试 | 实现代码落点 | 状态 |
|---|---|---|---|---|
| REQ-MCP-SSE-004 | AC1: 添加/编辑弹窗 transport seg 含 stdio/http/sse 三选项，sse 项带 `data-type="sse"` | `mcpSsePage.test.cjs` 用例 1 | `src/renderer/pages/Mcp.jsx`: `mcp-type-seg` 新增 `data-type="sse"` 按钮 | PASS |
| REQ-MCP-SSE-004 | AC2: 选 sse 隐藏 command/args/env，显示 url/auth/token/headers；切回 stdio 恢复 | `mcpSsePage.test.cjs` 用例 2 | `src/renderer/pages/Mcp.jsx`: `(mcpForm.type === "http" \|\| mcpForm.type === "sse")` 条件渲染 | PASS |
| REQ-MCP-SSE-004 | AC3: 选 sse 填表提交，列表出现 server 且 badge 为 sse，提交体含 `type: "sse"` 且无 command/args/env | `mcpSsePage.test.cjs` 用例 3 | `src/renderer/pages/Mcp.jsx`: `handleMcpSave` 提交分支与 badge 渲染 | PASS |
| REQ-MCP-SSE-004 | AC4: 编辑既有 sse 条目，seg 激活 sse 且 url 回填 | `mcpSsePage.test.cjs` 用例 4 | `src/renderer/pages/Mcp.jsx`: `openEditMcp` 回填 server.type 与 server.url | PASS |
| REQ-MCP-SSE-004 | AC5: 回归——stdio/http 原有表单与字段切换行为不回归 | `mcpSsePage.test.cjs` 用例 2 | `src/renderer/pages/Mcp.jsx`: 保持原有 stdio/http 分支逻辑 | PASS |

- **验证记录**：
  - `Slice 2: complete (e2e 4/4 passed, api 19/19 passed, PRD alignment passed)`


