# 访谈笔记 — 2026-09-07-mcp-sse-transport

## 核心问题

MCP 注册配置无法显式声明 legacy SSE transport。接入只暴露 SSE 端点的服务（如远程 crawl4ai 的 `/mcp/sse`）时，只能注册为 `type: http` 并依赖 pi-mcp-adapter 的隐式自动回落（仅当握手错误码 ∈ {404,405,406,415} 才触发），接入结果不可预期；且 `probeTools` 写死 StreamableHTTPClientTransport，对 SSE-only 端点报"连接失败"假阴性，管理员无法判断配置是否正确。

## 用户画像

- 工作站管理员：在管理页/API 配置 MCP server，需要"声明即所得"的注册语义和可信的探测反馈。
- agent（最终受益者）：在项目会话内通过 mcpSnapshot 桥接调用远端工具（本轮动机：crawl4ai 的 crawl 工具）。

## 关键边界

1. **形态**：`type` 三选 `stdio | http | sse`，不做 http 下嵌套字段。DB `type` 列存字符串，无需加列/迁移。
2. **语义显式化**：`toBridgeEntry` 对 http 显式输出 `httpTransport: "streamable-http"`、对 sse 输出 `"sse"`——利用 adapter 契约（server-manager.ts:792：声明了 httpTransport 就不回落）。**存量 type:http 条目的自动回落行为随之取消**（用户明确选择，语义变更需记录）。
3. **探测同修**：`probeTools` 按注册 type 选 transport（sse → SSEClientTransport），消除假阴性。
4. **UI 本期**：AdminZone → Mcp 配置表单 transport 三选；选 sse 时展示 url/auth 字段（与 http 同构）。
5. **鉴权同构**：sse 复用 http 的 URL 校验（仅 http/https）与 auth 规则（none/bearer/oauth；bearer token 加密落系统凭据库，快照解密点不变）。

## 隐含假设

1. pi-mcp-adapter 的 `definition.httpTransport` 字段接受 `"sse"` 且声明后不回落（已读源码验证：types.ts:405, server-manager.ts:793/814）。
2. crawl4ai 的 SSE 端点用 SSEClientTransport + Bearer 头可直连（标准 MCP legacy SSE 握手）——**待实测**，若失败（如非 4xx 错误以外的协议怪癖）需回到方案层。
3. 存量 http 条目没有依赖自动回落的（MCP 功能较新，用户已确认接受语义变更）。

## 矛盾/风险

1. **行为变更风险**：存量 http 条目若实际靠回落工作，升级后会断。缓解：用户已确认；PRD 记录变更语义。
2. **WS 诱惑**：crawl4ai 也暴露 `/mcp/ws`，但 adapter 与 MCP 官方 SDK 均无 WS client transport，需自写 Transport 类——已明确移出本期。
3. UI 表单分支增加（三选），前端结构/行为测试需覆盖。

## 候选方向

### 方向 A：新增 type: "sse"（三选）
- 适用场景：所有 legacy SSE-only MCP 服务（crawl4ai 及后续同类）。
- 主要取舍：注册语义最直白；代价是存量 http 回落语义取消（已确认接受）。
- 推荐度：**首选（已确认）**

### 方向 B：http 下加 httpTransport 字段
- 适用场景：追求与 MCP spec 术语严格对齐。
- 主要取舍：UI 多一层嵌套、DB 需加列；用户感知弱。
- 推荐度：不推荐（Q1 已否决）

### 方向 C：stdio 桥（supergateway/mcp-remote）
- 适用场景：零改动的临时方案。
- 主要取舍：token 明文进 args；每台 agent 机器跑桥进程；不可维护。
- 推荐度：不推荐（仅作应急兜底记录）

## 确认方向

最终确认的方向：**方向 A + 探测同修 + UI 本期**

确认意图（来自用户的显式 yes）：

- Outcome: MCP 注册支持显式 type:stdio/http/sse 三选，sse 端点声明即可连，探测结果可信
- User: 工作站管理员（配置 MCP）+ agent（消费工具）
- Why now: crawl4ai 远程部署只暴露 legacy SSE，当前接入依赖隐式回落不可预期
- Success: 注册 type:sse + bearer 的 crawl4ai 后，探测返回真实 tools 列表，项目会话内 agent 可调 crawl 工具
- Constraint: adapter 契约（httpTransport 声明后不回落）；token 必须加密存储；存量 http 条目语义变更需记录
- Out of scope: WebSocket transport；http 自动回落（取消）；存量条目的迁移工具

确认理由：type 三选对齐用户心智与 crawl4ai 文档表述；显式声明消除不可预期性，正是初衷本身。

## 最窄的切入点

mcpService：`validateHttp` 泛化为 http/sse 共用校验 + `normalizeRow`/`toBridgeEntry`/`probeTools` 三处按 type 分支；HTTP API 层透传；管理页表单加三选。以真实 crawl4ai 实例做 QA 验收。

## 待确认问题

- [ ] 无（访谈闭环；工程细节留给 /tech-design 与 REQ 结晶）
