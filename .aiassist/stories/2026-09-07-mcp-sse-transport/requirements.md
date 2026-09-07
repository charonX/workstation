# MCP 注册原生支持 SSE transport — 需求

> 故事 ID：`2026-09-07-mcp-sse-transport`
> 版本：`v1`
> 哈希：见 `requirements-v1.hash`
> 最后更新：2026-09-07

---

## 全局约束

- **显式 transport 契约**：MCP Server 注册时显式声明 `type ∈ {stdio, http, sse}`；桥接快照按声明输出 `httpTransport` 字段，pi-mcp-adapter 声明后不回落（server-manager.ts:792 契约），http 不再隐式回落 SSE。
- **凭据安全不变**：bearer token 经 `secretStore` 加密存 `token_enc` 列；HTTP API 任何响应不回显 token 明文；明文解密仅在 `effectiveConfig`/`probeTools` 快照构造时单点发生（既有 BUG-006 契约，sse 同构）。
- **校验同构**：sse 与 http 共用同一套 url/auth/headers/token 校验规则与错误消息字面量，防校验漂移。
- **两层启用模型不变**：全局开关 ∧ 项目启用 = 项目内可用，`effectiveConfig(projectId)` 只含两层皆启用的 server。
- **术语规范**：遵循 `CONTEXT.md`「MCP Server」「两层启用」「Transport 类型」。

---

## REQ 列表

### REQ-MCP-SSE-001: 注册与更新支持 `type: "sse"`

**分类：** P0
**优先级：** 必须
**Scope：** `intra-module`
**Capability：** `plugin-management`
**Entity：** `mcp-server`
**测试类型：** 集成

#### 验收标准

1. `create({name:"crawl4ai", type:"sse", url:"http://10.0.0.5:11235/mcp/sse", auth:"bearer", token:"ck-test"})` 成功，返回对象 `type==="sse"`、`url==="http://10.0.0.5:11235/mcp/sse"`、`auth==="bearer"`；`list()` 中该条目同值——EXPECTED-TRACE: PRD §6.3 块 1 row 1。
2. create/update 的任何返回值与 `list()` 输出均不含 token 明文 `ck-test`（既有脱敏契约对 sse 同构）——EXPECTED-TRACE: PRD §6.3 块 1 row 1, 全局约束「凭据安全不变」。
3. `create({name:"x", type:"sse", url:"ftp://h/mcp/sse"})` 抛错，消息恰为 `URL 不合法: 仅支持 http/https`——EXPECTED-TRACE: PRD §6.3 块 1 row 2, §7。
4. `create({name:"x", type:"sse", url:""})`（或缺 url）抛错，消息恰为 `URL 不合法: url is required`——EXPECTED-TRACE: PRD §7 url 行。
5. `create({name:"x", type:"ws", url:"ws://h/mcp/ws"})` 抛错，消息恰为 `type 不合法: 仅支持 stdio/http/sse`——EXPECTED-TRACE: PRD §6.3 块 1 row 3, §7 type 行。
6. `create({name:"x", type:"sse", url:"http://h/mcp/sse", auth:"bearer"})`（无 token）抛错，消息恰为 `auth=bearer 必须提供 token（加密存系统凭据库）`——EXPECTED-TRACE: PRD §7 token 行。
7. `create({name:"x", type:"sse", url:"http://h/mcp/sse", auth:"basic"})` 抛错，消息恰为 `auth 不合法: 仅支持 none/bearer/oauth`——EXPECTED-TRACE: PRD §7 auth 行。
8. update 语义同构：`update("crawl4ai", {url})` 仅改 url、未给新 token 时保留既有密文（更新后探测/快照仍用旧 token），不抛「bearer 必须有 token 来源」错误——EXPECTED-TRACE: PRD §7.1 行 2（既有 BUG-006 语义，sse 同构）。
9. `type:"sse"` 条目支持 headers 自定义键值（经既有 validateKeyValue 校验）；非法结构拒绝——EXPECTED-TRACE: PRD §7 headers 行。

#### 测试可追溯性

- 测试：`mcpSseRegister.test.js`
- Seam：`src/services/mcpService.js` create/update/list（临时 SQLite 库直调 service）
- 断言：EXPECTED-TRACE PRD §6.3 块 1, §7, §7.1

---

### REQ-MCP-SSE-002: 桥接快照输出显式 `httpTransport`

**分类：** P0
**优先级：** 必须
**Scope：** `cross-module`（mcpService → agentService session-config → pi-mcp-adapter）
**Capability：** `plugin-management`
**Entity：** `mcp-server`
**测试类型：** 集成

#### 接口契约（PRD §10.4 effectiveConfig → toBridgeEntry）

| 项目 | 说明 |
|---|---|
| 调用方 | agentService.createModuleConfigMessage |
| 被调用方 | mcpService.effectiveConfig(projectId) |
| 输入 | projectId |
| 输出 | `{servers:{name:entry}}`；entry 形态按 type 分派（见验收标准） |
| 副作用 | 无 |

#### 验收标准

1. type=sse 条目（全局开 ∧ 项目开，auth=bearer, token=`ck-test`, url=`http://10.0.0.5:11235/mcp/sse`）经 `effectiveConfig` 后，`servers.crawl4ai` 深等于 `{url:"http://10.0.0.5:11235/mcp/sse", auth:"bearer", bearerToken:"ck-test", httpTransport:"sse"}`——EXPECTED-TRACE: PRD §6.3 块 2 row 1。
2. type=http 条目（auth=none, url=`https://m.example.com/mcp`）经 `effectiveConfig` 后，条目含 `httpTransport:"streamable-http"`——EXPECTED-TRACE: PRD §6.3 块 2 row 2（**行为变更：http 不再回落**）。
3. type=stdio 条目经 `effectiveConfig` 后，条目不含 `httpTransport` 键——EXPECTED-TRACE: PRD §6.3 块 2 row 3。
4. sse 条目带 headers 时，快照同时含 `headers` 原样与 `httpTransport:"sse"`——EXPECTED-TRACE: PRD §6.3 块 2 row 1 扩展。
5. 两层启用语义不变：仅全局开未项目启用的 sse 条目不出现在 `effectiveConfig(projectId)` 输出中——EXPECTED-TRACE: 全局约束「两层启用模型不变」。
6. 快照是 bearer token 的唯一解密点：`bearerToken` 值等于注册时明文，DB 中 `token_enc` 列不等于明文——EXPECTED-TRACE: 全局约束「凭据安全不变」。

#### 测试可追溯性

- 测试：`mcpSseBridge.test.js`
- Seam：`src/services/mcpService.js` effectiveConfig（临时库预置三类条目）
- 断言：EXPECTED-TRACE PRD §6.3 块 2, §10.4

---

### REQ-MCP-SSE-003: 探测按声明 transport 分派

**分类：** P0
**优先级：** 必须
**Scope：** `intra-module`（mcpService.probeTools → MCP SDK transport）
**Capability：** `plugin-management`
**Entity：** `mcp-server`
**测试类型：** 集成

#### 验收标准

1. 对 `type:"sse"`、auth=none、url 指向测试内本地 legacy-SSE MCP stub server 的条目执行 `probeTools(name)`，返回 stub 暴露的 tools 数组（stub 固定暴露 `echo` 工具），如 `[{name:"echo", description:"..."}]`——EXPECTED-TRACE: PRD §6.3 块 3 row 1。
2. 探测 sse 条目时使用 `SSEClientTransport` 而非 `StreamableHTTPClientTransport`：对只实现 legacy SSE 握手、对 streamable POST 直接拒绝的 stub server，探测成功——EXPECTED-TRACE: PRD §6.3 块 3 row 1, §10.3 步骤 5。
3. 对 `type:"sse"`、url 指向已关闭端口的条目执行 `probeTools`，抛错且消息以 `连接失败：` 开头——EXPECTED-TRACE: PRD §6.3 块 3 row 2, §8。
4. sse + auth=bearer 探测时请求携带 `Authorization: Bearer <token>` 头（stub server 断言收到的 Authorization 头）——EXPECTED-TRACE: PRD §10.3 步骤 5, 全局约束「凭据安全不变」。
5. 既有 stdio/http 探测行为不回归：stdio 条目仍走 StdioClientTransport，http 条目仍走 StreamableHTTPClientTransport——EXPECTED-TRACE: PRD §8 回归面, REQ-AGENT-084 AC7 既有契约。

#### 测试可追溯性

- 测试：`mcpSseProbe.test.js`
- Seam：`src/services/mcpService.js` probeTools（本地 SSE stub server，随机端口，即连即断）
- 断言：EXPECTED-TRACE PRD §6.3 块 3, §8, §10.3

---

### REQ-MCP-SSE-004: 管理页 transport 三选与 sse 展示

**分类：** P0
**优先级：** 必须
**Scope：** `intra-module`（renderer Mcp.jsx → /api/mcp）
**Capability：** `plugin-management`
**Entity：** `mcp-server`
**UX 参照：** 无新增原型（复用现有 seg 控件模式，PRD §6.1）
**测试类型：** 浏览器（结构/行为）

#### 验收标准

1. 添加/编辑弹窗的 transport seg（`data-testid="mcp-type-seg"`）含三个选项：stdio（本地命令）/ http / sse，sse 选项带 `data-type="sse"`——EXPECTED-TRACE: PRD §6.3 块 4 row 1, §6.1 步骤 1。
2. 选择 sse 后：command/args/env 字段不可见，url/auth/token/headers 字段可见——EXPECTED-TRACE: PRD §6.3 块 4 row 1。
3. 选 sse 填表提交（name=`crawl4ai`, url=`http://10.0.0.5:11235/mcp/sse`, auth=bearer, token=`ck-test`），POST /api/mcp 请求体含 `type:"sse"` 且不含 command/args/env 键——EXPECTED-TRACE: PRD §6.3 块 4 row 1。
4. 列表行 type 为 sse 的条目 badge 文案恰为 `sse`；编辑回显时 seg 激活 sse 且 url 字段回填——EXPECTED-TRACE: PRD §6.3 块 4 row 2。
5. 既有 stdio/http 表单行为不回归：选 stdio 显示 command/args/env、选 http 显示 url/auth/token/headers——EXPECTED-TRACE: PRD §8 回归面。

#### 测试可追溯性

- 测试：`mcpSsePage.test.cjs`
- Seam：Mcp.jsx 管理页（stub /api/mcp 系列接口）
- 断言：EXPECTED-TRACE PRD §6.3 块 4, §6.1

---

### REQ-MCP-SSE-005: 未落库配置的 ad-hoc 测试连接（req-gap 就地补全，2026-09-07 人裁决）

**分类：** P1
**优先级：** 必须
**Scope：** `cross-module`（Mcp.jsx 弹窗 → routes/mcp.js → mcpService）
**Capability：** `plugin-management`
**Entity：** `mcp-server`
**测试类型：** 集成 / 浏览器

#### 接口契约（PRD §10.4 probeConfig / POST /api/mcp/probe）

| 项目 | 说明 |
|---|---|
| 调用方 | Mcp.jsx 弹窗「测试连接」按钮 → POST /api/mcp/probe |
| 被调用方 | mcpService.probeConfig(row) |
| 输入 | 未落库内联配置 `{type, command?, args?, env?, url?, headers?, auth?, token?}`（无需 name） |
| 输出 | `{tools:[{name, description}]}` |
| 业务错误 | 校验字面量同 create；`连接失败：…`；`探测超时（Ns）` |
| 副作用 | 无持久化；token 不落库不回显 |
| 幂等性 | 是 |

#### 验收标准

1. `POST /api/mcp/probe`，body=`{type:"sse", url:"http://127.0.0.1:<port>/sse"}`（本地 legacy-SSE stub）→ 200，响应 tools 含 `{name:"echo"}`（description 非空）——EXPECTED-TRACE: PRD §6.3 块 6 row 1。
2. 探测后 `mcp_servers` 表无新增（`list()` 为空）——无持久化副作用——EXPECTED-TRACE: PRD §6.3 块 6 row 1。
3. url 指向已关闭端口 → 业务错误，message 以 `连接失败：` 开头——EXPECTED-TRACE: PRD §6.3 块 6 row 2。
4. body=`{type:"ws", url:"ws://h/x"}` → 业务错误 `type 不合法: 仅支持 stdio/http/sse`（校验与注册同构）——EXPECTED-TRACE: PRD §6.3 块 6 row 3。
5. sse + auth=bearer 的内联配置探测时携带 `Authorization: Bearer <token>` 头（stub 端断言）；token 不落库——EXPECTED-TRACE: PRD §10.4 probeConfig 副作用行。
6. 弹窗内（未点保存）填 sse 表单点「测试连接」（`data-testid="mcp-test-conn-button"`）→ 结果显示区（`data-testid="mcp-test-conn-result"`）出现成功态且列出工具名 `echo`；指向不可达端点时呈 `连接失败：` 文案——EXPECTED-TRACE: PRD §6.3 块 6 row 4。

#### 测试可追溯性

- 测试：`api/mcpAdhocProbe.test.js`、`e2e/mcpSsePage.test.cjs`（追加用例）
- Seam：`src/http/routes/mcp.js` handleMcp（mock req/res，对齐 mcpProbeTools.test.js 先例）+ 管理页弹窗
- 断言：EXPECTED-TRACE PRD §6.3 块 6, §10.4 probeConfig

---

## REFLECT 人工验收备注
- 真实 crawl4ai 远程实例端到端连通（§6.1 步骤 3-5）：注册 type:sse + bearer → 探测返回真实 tools → 项目会话 agent 调用 crawl 工具成功。外部依赖不可控，不进自动化断言，由 QA/REFLECT 人工确认。
