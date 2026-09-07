# MCP 注册原生支持 SSE transport

> 状态：探索期
> 故事 ID：`2026-09-07-mcp-sse-transport`
> 最后更新：2026-09-07

---

## 1. 问题陈述

管理员想把一个只暴露 legacy SSE 端点的 MCP 服务（如部署在远程服务器上的 crawl4ai，端点 `http://<host>:11235/mcp/sse`）接入工作站，让 agent 能在项目会话里调用它的工具。今天做不到"声明即所得"：注册表单只有 stdio/http 两种类型，SSE 端点只能冒充 http 注册，能否连上取决于适配器内部一个不可见的自动回落（只在特定 4xx 错误码时触发）；探测按钮对 SSE 端点永远报"连接失败"——即使实际能用。管理员无法分辨"配置错了"还是"探测误报"，接入结果不可预期。

## 2. 解决方案

把 transport 提升为注册契约的一等公民：MCP 服务类型变为 stdio / http / sse 三选。注册 `sse` 即直连 SSE，注册 `http` 即严格 streamable-http（取消隐式回落）；探测按声明类型选用对应 transport，结果可信；bearer token 与自定义 headers 对 sse 同构支持、加密存储不变。

## 3. 用户故事

1. 作为工作站管理员，我想要在添加 MCP 服务时显式选择 sse 类型并填入 SSE 端点 URL 与 bearer token，以便 agent 能接入 crawl4ai 这类 legacy SSE 服务。
2. 作为工作站管理员，我想要探测按钮按我声明的 transport 真实握手，以便探测结果可信、能据此判断配置正误。
3. 作为工作站管理员，我想要 http 类型行为确定（streamable-http，失败即报错），以便注册语义没有隐式魔法。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | 注册/更新支持 `type: "sse"`（校验、存储、展示） | 访谈已确认形态（Q1：type 三选，否决嵌套字段） |
| 2 | 会话桥接快照按 type 输出显式 `httpTransport`（sse→`"sse"`，http→`"streamable-http"`，stdio 不变） | adapter 契约已读源码验证（types.ts:405；server-manager.ts:793/814 声明后不回落） |
| 3 | `probeTools` 按 type 选 transport（sse→SSEClientTransport） | 初衷的一半是探测可信；访谈确认同 story 修 |
| 4 | 管理页表单 transport 三选 + 列表 badge 展示 sse | 访谈确认 UI 本期；复用现有 seg 控件模式 |
| 5 | http 取消自动回落（语义变更，显式声明 streamable-http） | 用户明确选择"http 不再回落"，使行为可预期 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| 1 | 无 | — |

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 管理员打开 MCP 管理页，点"添加 MCP 服务" | 弹窗显示 transport 三选：stdio（本地命令）/ http / sse | seg 含 `data-type="sse"` 选项 |
| 2 | 选择 sse，填 name=`crawl4ai`、url=`http://10.0.0.5:11235/mcp/sse`、auth=bearer、token=`ck-test` | 提交成功，列表出现 `crawl4ai`，badge 显示 `sse` | list 返回 `type:"sse"`；token 不回显 |
| 3 | 点该条目的"工具探测" | 系统以 SSEClientTransport 直连该 URL（带 `Authorization: Bearer ck-test`），返回 tools 列表 | 返回 `[{name, description}]`；失败时显示"连接失败：…" |
| 4 | 全局启用 + 在某项目启用该 server | 该项目新会话的 session-config 携带 mcpSnapshot | 快照中该 server 条目含 `httpTransport:"sse"` 与解密后的 `bearerToken` |
| 5 | agent 在项目会话调用 crawl 工具 | adapter 按 `httpTransport:"sse"` 直接建 SSEClientTransport（不先试 streamable） | 工具调用成功 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| type 非 stdio/http/sse | 创建/更新拒绝 | `type 不合法: 仅支持 stdio/http/sse` |
| sse 的 url 非 http/https 或缺失 | 创建/更新拒绝 | `URL 不合法: 仅支持 http/https` / `URL 不合法: url is required` |
| sse + auth=bearer 且无 token（新建时） | 创建拒绝 | `auth=bearer 必须提供 token（加密存系统凭据库）` |
| sse 探测端点不可达/握手失败 | 探测返回业务错误 | `连接失败：<原因>` |
| sse 探测超过 PROBE_TIMEOUT_MS | 探测返回业务错误 | `探测超时（Ns）` |
| http 条目指向 SSE-only 端点 | 会话连接失败（不再回落） | adapter 连接错误，server 显示连接失败 |

### 6.3 预期值锚点（Expected-Value Anchors）

| 稳定块 | 输入 | 预期输出/结果 | 依据 |
|---|---|---|---|
| 1 | `create({name:"crawl4ai", type:"sse", url:"http://10.0.0.5:11235/mcp/sse", auth:"bearer", token:"ck-test"})` | 返回对象 `type==="sse"`、`url` 原样、`auth==="bearer"`；`list()` 同值；任何响应不含 `ck-test` 明文 | 访谈 Q4；bearer 加密是既有契约（BUG-006） |
| 1 | `create({name:"x", type:"sse", url:"ftp://h/mcp/sse"})` | 抛错 `URL 不合法: 仅支持 http/https` | 复用 validateHttp 既有规则 |
| 1 | `create({name:"x", type:"ws", url:"ws://h/mcp/ws"})` | 抛错 `type 不合法: 仅支持 stdio/http/sse` | 范围外决策（WS 不做） |
| 2 | 上述 sse 条目经 `effectiveConfig(projectId)`（全局开 ∧ 项目开） | `servers.crawl4ai` 深等于 `{url:"http://10.0.0.5:11235/mcp/sse", auth:"bearer", bearerToken:"ck-test", httpTransport:"sse"}` | adapter 契约 server-manager.ts:793 |
| 2 | 既有 http 条目（auth:none, url=`https://m.example.com/mcp`）经 `effectiveConfig` | 条目含 `httpTransport:"streamable-http"` | 稳定块 5 语义变更 |
| 2 | stdio 条目经 `effectiveConfig` | 条目不含 `httpTransport` 键 | stdio 无 transport 概念 |
| 3 | 对本 story 测试内的本地 legacy-SSE MCP stub server（注册 type:sse, auth:none）执行 `probeTools` | 返回 stub 暴露的 tools 数组，如 `[{name:"echo", description:"..."}]` | 探测可信初衷 |
| 3 | 对 `type:"sse"` 但 URL 指向已关闭端口的条目执行 `probeTools` | 抛错消息以 `连接失败：` 开头 | 既有错误契约（probeTools） |
| 4 | 表单选 sse | command/args/env 字段隐藏，url/auth/token/headers 字段可见；提交体含 `type:"sse"` | UI 契约 |
| 4 | 列表行 type 为 sse | badge 文案为 `sse` | UI 契约 |

## 7. 表单与输入验证（Form / Input Validation）

| 输入字段 | 规则 | 有效例子 | 无效例子（→错误提示） | 错误状态 |
|---|---|---|---|---|
| type | 枚举 stdio/http/sse | `sse` | `ws` → `type 不合法: 仅支持 stdio/http/sse` | 创建/更新拒绝 |
| url（sse/http） | 必填；仅 http/https | `http://10.0.0.5:11235/mcp/sse` | `ftp://h/x` → `URL 不合法: 仅支持 http/https`；`""` → `URL 不合法: url is required` | 创建/更新拒绝 |
| auth | 枚举 none/bearer/oauth | `bearer` | `basic` → `auth 不合法: 仅支持 none/bearer/oauth` | 创建/更新拒绝 |
| token | auth=bearer 时必填（新建） | `ck-test` | 空 → `auth=bearer 必须提供 token（加密存系统凭据库）` | 创建/更新拒绝 |
| headers | 键值对字典 | `{"X-Team":"infra"}` | 非法结构 → 既有 validateKeyValue 错误 | 创建/更新拒绝 |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 例子（触发 → 期望结果） | 错误状态 |
|---|---|---|---|
| sse 与 http 共用同一套 url/auth/token/headers 校验 | create/update | type=sse 的条目校验行为与 type=http 一致 | 见上表 |
| 更新时 bearer 未给新 token → 保留既有密文 | update | 仅改 url 后探测仍带旧 token | 既有 BUG-006 语义，sse 同构 |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| 非法 type | create/update | `type 不合法: 仅支持 stdio/http/sse` | 表单/接口错误提示 | 无写入 |
| 非法 URL | create/update（http/sse） | `URL 不合法: 仅支持 http/https` | 同上 | 无写入 |
| bearer 缺 token | create（http/sse） | `auth=bearer 必须提供 token（加密存系统凭据库）` | 同上 | 无写入 |
| 探测连接失败 | probeTools（任意类型） | `连接失败：<原因>` | 探测弹窗错误 | 无（即连即断，不写库） |
| 探测超时 | probeTools 超 PROBE_TIMEOUT_MS | `探测超时（Ns）` | 同上 | 无 |
| 会话桥接失败 | 快照中 sse 端点不可达 | adapter 连接错误 | agent 会话该 server 不可用，其余 server 不受影响 | 桥剔除 + 诊断（既有 sessionAssembly 语义） |
| 存量 http 指向 SSE-only 端点 | 升级后会话连接 | streamable 握手失败即报错（不回落） | 管理员需改注册 type 为 sse | 无自动迁移（范围外） |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **simple** |
| 判断理由 | 3 个模块（mcpService / routes/mcp.js / Mcp.jsx），均为既有模式的枚举扩展；无新外部依赖（adapter 契约已读源码验证）；分支数为有限枚举分派；DB 无 schema 变更（type 列即字符串）。不确定性已在访谈期消除，无需 /tech-design 深潜。 |

## 10. 技术方案（Implementation Decisions）

### 10.1 设计目标

把 MCP transport 从"适配器内部隐式决策"变为"注册时显式声明"，并使注册、存储、探测、会话桥接、UI 五层对 `sse` 的处理同构于 `http`。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| mcpService（services 层） | type 枚举扩展（sse 走 http 同构校验）；toBridgeEntry 输出 httpTransport；probeTools 按 type 选 transport | 否（改） |
| routes/mcp.js（http 层） | 透传 body 给 service；无类型判断逻辑 | 否（仅确认无需改） |
| Mcp.jsx（renderer） | 表单 seg 三选、sse 表单分支、列表 badge | 否（改） |
| pi-mcp-adapter | 消费 `httpTransport` 字段 | 否（不动，契约已满足） |

#### 模块关系图

```
[管理页表单 Mcp.jsx]
   │ POST/PUT /api/mcp（body.type ∈ stdio|http|sse）
   ▼
[routes/mcp.js] ──透传──> [mcpService]
                              │ 校验（sse 复用 validateHttp）+ 存储（type 列）
                              ├─> effectiveConfig → toBridgeEntry → {…, httpTransport}
                              │        └─> session-config mcpSnapshot → pi-mcp-adapter
                              └─> probeTools → type=sse ? SSEClientTransport : 既有分支
```

### 10.3 数据流

1. **触发**：管理员在表单选 sse 并提交（或直接调 API）。
2. **输入校验**：`normalizeRow` 保留 type=sse；`validateHttp` 泛化用于 sse（url/auth/headers 校验完全一致）；type 白名单变 stdio/http/sse。
3. **核心处理**：落库 `mcp_servers.type = 'sse'`；bearer token 走既有 `encryptSecret` 落 `token_enc`。
4. **副作用**：`effectiveConfig` 快照中 sse 条目携带 `httpTransport:"sse"` + 解密 `bearerToken`；http 条目携带 `httpTransport:"streamable-http"`；stdio 条目不携带该键。
5. **输出**：列表/探测按声明类型工作；adapter 按声明建 transport，无隐式回落。

### 10.4 接口契约

#### 接口名称：mcpService.create / update（type 扩展）

| 项目 | 说明 |
|---|---|
| 调用方 | routes/mcp.js（POST /api/mcp、PUT /api/mcp/:name） |
| 被调用方 | mcpService |
| 输入 | row 对象，`type ∈ {"stdio","http","sse"}`；sse 时字段集 = http（url/headers/auth/token） |
| 输出 | 规范化 server 行（token 不回显） |
| 业务错误 | `type 不合法: 仅支持 stdio/http/sse`；validateHttp 同构错误 |
| 系统错误 | DB 异常原样上抛 |
| 副作用 | 写 mcp_servers 表；token_enc 加密列 |
| 幂等性 | create 否（重名报错）；update 是 |

**样例（golden values）**：见 §6.3 稳定块 1 三行。

#### 接口名称：mcpService.effectiveConfig → toBridgeEntry（快照形态）

| 项目 | 说明 |
|---|---|
| 调用方 | agentService.createModuleConfigMessage（session-config 装配） |
| 被调用方 | mcpService.effectiveConfig(projectId) |
| 输入 | projectId |
| 输出 | `{servers: {name: entry}}`；http→`httpTransport:"streamable-http"`，sse→`httpTransport:"sse"`，stdio→无此键；bearer 条目含解密 `bearerToken`（快照是唯一解密点，既有契约不变） |
| 业务错误 | 无（计算失败由调用方跳过注入，既有语义） |
| 副作用 | 无 |
| 幂等性 | 是 |

**样例（golden values）**：见 §6.3 稳定块 2 三行。

#### 接口名称：mcpService.probeTools（transport 分派）

| 项目 | 说明 |
|---|---|
| 调用方 | routes/mcp.js（GET /api/mcp/:name/tools） |
| 被调用方 | mcpService.probeTools(name) |
| 输入 | server name |
| 输出 | `[{name, description}]` |
| 业务错误 | `连接失败：…`、`探测超时（Ns）`、`MCP server 不存在: <name>` |
| 副作用 | 无（即连即断） |
| 幂等性 | 是 |

**样例（golden values）**：见 §6.3 稳定块 3 两行。

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| sse 形态 | type 枚举 vs http 嵌套字段 | 用户确认；对齐 crawl4ai 文档心智；DB 无迁移 | 低 |
| http 取消回落 | toBridgeEntry 显式声明 `httpTransport:"streamable-http"` | 用户确认；adapter 契约支持（声明即不回落） | 存量依赖回落的 http 条目会断——用户已接受，无自动迁移 |
| sse 校验复用 validateHttp | 复用 vs 独立校验函数 | 字段集完全相同；复用防漂移 | 低 |
| WebSocket | 不做 | adapter/SDK 无 WS transport，需自写 Transport | 已在 §12 声明 |

> ADR 评估：以上均属 story 内局部决策，未达"难逆转/全局约束"门槛，不新增 ADR；语义变更（http 不回落）在 PRD §13 记录并在 commit 中说明。

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| adapter 声明 `httpTransport:"sse"` 后正确建 SSEClientTransport | sse 会话连接失败 | TECH-DESIGN（改桥接策略） | 能（QA 用真实 crawl4ai 或本地 stub） |
| crawl4ai SSE 握手兼容标准 legacy SSE 客户端 | agent 调不通，需退 stdio 桥 | PRD（重新评估方案 A vs C） | 能（QA 实测） |
| 存量 http 条目无回落依赖 | 升级后某条目断连 | 配置层（改 type 为 sse），不回炉 | 能（列出现存条目人工确认） |

### 10.7 安全/性能/可观测性

- 安全：bearer token 加密存储与"快照唯一解密点"契约不变；sse 与 http 共用同一 URL 协议白名单（仅 http/https），无 SSRF 面变化；headers 校验复用 validateKeyValue。
- 性能：无新热路径；探测即连即断。
- 可观测性：探测失败消息沿用 `连接失败：<原因>`，包含 transport 实际错误，便于区分配置错误与端点故障。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 注册校验/存储 | mcpService.create/update/list（直接调 service，临时 DB） | 集成（api 层） | 真实 SQLite 临时库 |
| 2 桥接快照 | mcpService.effectiveConfig | 集成 | 真实临时库 + 预置加密 token |
| 3 探测分派 | mcpService.probeTools | 集成 | 本地 legacy-SSE MCP stub server（MCP SDK SSEServerTransport 起在随机端口）；失败用例指向已关闭端口 |
| 4 UI 三选 | Mcp.jsx 表单结构/行为 | 组件/浏览器结构行为测试（既有 renderer 测试模式） | stub API |
| 5 http 不回落 | effectiveConfig 输出断言（httpTransport:"streamable-http"） | 并入块 2 集成测试 | 同上 |

测试目录：`tests/capabilities/plugin-management/mcp-server/2026-09-07-mcp-sse-transport/{api,e2e}`（沿用 2026-08-12-pi-mcp-plugin 的 api/e2e 结构先例）。

### 11.2 测试策略与先例

- 只测外部行为：service 的输入→输出/错误消息字面量；快照字典深等于；UI 的 DOM 结构与提交体形状。不断言内部函数调用。
- 先例：`tests/capabilities/plugin-management/mcp-server/2026-08-12-pi-mcp-plugin/api/mcpPermissionBroker.test.js`（service 直调 + 临时库）；cli-service story 的 `cliServiceConfig.test.js`（校验错误消息断言先例）。
- 真实 crawl4ai 实例连通属 QA 手工验证（REFLECT 前由人确认 §6.1 步骤 3-5），不进自动化断言（外部依赖不可控）。

## 12. 范围外

- WebSocket transport（`/mcp/ws`）——adapter/SDK 无支持，需自写 Transport，另开 story。
- 存量 http 条目的自动迁移工具/迁移提示——由管理员手工改 type。
- oauth 流程对 sse 的端到端验证（字段同构放行，但 crawl4ai 场景用 bearer；oauth+sse 组合不做专项验收）。
- 探测结果缓存/轮询——探测保持即连即断。

## 13. 补充说明

- **行为变更记录**：本 story 上线后，`type: http` 条目在会话桥接中显式声明 `httpTransport:"streamable-http"`，pi-mcp-adapter 不再对其执行 SSE 自动回落。若有 http 条目实际指向 SSE-only 端点且此前靠回落工作，需管理员将其 type 改为 sse。
- 动机场景（crawl4ai 部署于远程服务器，`CRAWL4AI_API_TOKEN` bearer 鉴权，端点 `/mcp/sse`）作为本 story 的 QA 验收基准。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | §6.1 覆盖 5 个稳定块的 happy path；§6.2 分支异常齐全 |
| 输入验证 | PASS | §7 每字段有效/无效例子 + 错误消息字面量 |
| 错误状态 | PASS | §8 含跨模块（adapter 桥接）失败 |
| 预期值锚点 | PASS | §6.3 每稳定块 ≥1 条机器可验锚点（深等于字典、错误消息字面量、DOM 断言） |
| 复杂度分级 | simple | §9 理由：枚举扩展、无 schema 变更、adapter 契约已验证 |
| 技术方案（§10） | PASS | simple 高层完整；接口契约含 golden values |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-09-07 | 初稿（访谈确认方向 A：type 三选 + 探测同修 + UI 本期 + http 不回落 + WS 出范围） | AI + 人 |
