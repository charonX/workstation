# 技术方案 — UI Copilot 会话中心

> 故事 ID：`2026-08-02-ui-copilot`
> 版本：`v1`
> 最后更新：2026-08-06
> 输入：`prd.md`（S1~S9）、`ux/assistant.html`（approved 原型）、`research/pi-permission-extensions.md`（H1 ✅）、`research/pi-skills-mechanism.md`（H2 ✅）
> 关联 ADR：ADR-001（本地 HTTP API）、ADR-013（PI 双运行时）、ADR-014（worker 子进程）、ADR-015（看门狗带外心跳）；本方案新增 ADR-016/017/018（见第 9 节）

---

## 设计目标

- 在**不动内核**（worker/PI 适配/session 持久化/确认挂起队列）的前提下，给渲染层接入 agentService 全量会话能力：多会话列表、对话收发、SSE 流式、内联确认。
- **空间 = 会话**：每条 chat 一个独立上下文空间，空间 key 语法承载分组与项目归属，零 schema 破坏（仅 `agent_sessions` + `title` 附加列）。
- **工具面按空间分级**是硬边界：通用/飞书空间 = CLI-only（现状）；项目空间 = CLI + skills（`additionalSkillPaths`）+ FS/脚本工具，权限策略 = gotgenes 全局+项目两级文件，`ask` 桥接既有确认挂起队列。
- **双区模型**：会话区（默认落地，新路由）与管理区（旧壳原样）共存在同一 React 应用内，旧路由/E2E 零改动。

## 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| renderer `pages/Assistant.jsx` | 会话区页面：双栏布局（会话列表 + 对话窗）；空态/只读/未配置引导态 | 是 |
| renderer `components/assistant/*` | SessionList（分组/项目行＋）/ ChatView / MessageList（气泡/工具行/确认卡）/ Composer | 是 |
| renderer `api/agentSessions.js` | 会话/消息/事件端点的 fetch 封装 + SSE 订阅封装 | 是 |
| renderer `App.jsx` + `components/layout/Sidebar.jsx` | 双区路由：默认路由 `/assistant`；管理区壳顶部加「← 返回对话」；旧路由不变 | 改 |
| http `routes/agentSessions.js` | 会话 REST + SSE 端点（列表/历史/发送/重置/事件流），委托 agentService/sessionStore | 是 |
| services `sessionStore.js` | 扩展：按前缀列会话（含 title/lastActiveAt/项目 join/孤儿判定）；title 首条截断写入；`/reset`（UI）= 新行 | 改（不动既有行为） |
| services `agentService.js` | UI 空间会话创建参数化（spaceKey → cwd/resourceLoader 参数/skills/权限装配 下发 worker）；消息分发复用 agentRouter 纯函数（跳过飞书绑定检查） | 改（不动内核） |
| agent `worker.js` | 按 session-config 的 spaceKey 装配 per-session `DefaultResourceLoader`：cwd（项目空间=项目目录）、`additionalSkillPaths`（项目关联 skills 目录）、extensionFactories（gotgenes + 授权桥）；通用空间维持现状装配 | 改（不动 PI 适配） |
| services `permissionBridge.js` | gotgenes `registerAuthorizer` → 确认挂起队列（confirmationService 既有）→ 授权结果回传；高危分类清单（CLI 高危 + FS 写/脚本） | 是 |
| services `confirmationService.js` | 既有挂起队列；仅扩展：确认项可携带 UI 空间来源（确认卡渲染目标） | 改（不动语义） |
| 策略文件 `agent-policy/`（应用资源） | gotgenes 全局策略（随应用分发，只读默认）；项目策略 = 项目目录内约定文件（可选，用户手写） | 是 |

### 模块关系图

```
[渲染层]  Assistant.jsx ── api/agentSessions.js ──┐
   （会话区，默认路由）        │ REST / SSE           │
                              ▼                     │
[HTTP]    routes/agentSessions.js ────────────────┤
              │ 列表/历史/发送/重置/SSE             │
              ▼                                     │
[主进程]  sessionStore（+title，前缀列表）           │
          agentService ── 复用 agentRouter 纯函数 ──┘
              │ session-config（spaceKey/cwd/skills/权限装配）
              ▼
[worker]  per-session DefaultResourceLoader
              ├─ cwd = 项目目录（项目空间）
              ├─ additionalSkillPaths = 项目关联 skills
              └─ extensions = [gotgenes 策略引擎, 授权桥]
                     │ ask
                     ▼
          permissionBridge ──> confirmationService（既有挂起队列）
                     │                       │
                     ▼                       ▼
              SSE → UI 确认卡          飞书卡片（既有，不动）
```

## 数据流

### F1 发送消息（UI 空间）
1. **触发**：用户在 Composer 输入并发送（Enter / 发送按钮）。
2. **输入校验**：trim 非空；长度 ≤ agentService enforceSizeLimit 上限；会话非只读、非孤儿、agent 已配置。
3. **核心处理**：`POST /api/agent/sessions/:spaceKey/messages` → agentService 按 spaceKey 取/建会话句柄（首次：sessionStore 建行 + 下发 session-config）→ 斜杠命令识别（复用 agentRouter 纯函数，/status /list /help 直通、/reset 见 F4）→ prompt 入队 worker。
4. **副作用**：title 首次写入（首条用户消息截断 40 字）；lastActiveAt 更新；SSE 推送 user/assistant 事件。
5. **输出**：202 + `{ messageId }`；流式回复经 SSE 逐段推送（F2）。

### F2 SSE 流式渲染
1. 渲染层选中会话 → `GET /api/agent/sessions/:spaceKey/events`（EventSource）。
2. 主进程订阅该会话句柄 `"session-event"` → 转 SSE data 帧（事件原样 ≤256KB 契约沿用）。
3. 断线：EventSource 自动重连；重连后先 `GET .../messages` 全量对齐再续流（SSE 只推增量，不做事件回溯）。
4. 切会话：关闭旧 EventSource，开新连接。后台会话（未选中）不建连接，靠列表轮询刷新 lastActiveAt/标题（低频，仅会话区前台时）。

### F3 高危确认（UI 空间）
1. gotgenes 评估 `ask` → 授权桥创建挂起确认项（含操作描述/来源 spaceKey）→ SSE 推送 `confirmation-pending` 事件。
2. UI 渲染内联确认卡 → 用户点确认/拒绝 → `POST /api/agent/confirmations/:id/{approve|reject}`（**既有端点**）。
3. confirmationService 回调 → 授权桥返回 allow/deny → agent 继续/中止 → 结果经 SSE 流式呈现；确认卡置灰"已处理"。
4. 飞书空间高危确认路径完全不变（同一队列，渲染目标按 spaceKey 前缀分流）。

### F4 新对话与 /reset
- 顶部「新对话」→ `POST /api/agent/sessions` `{ spaceKind: "general" }` → 生成 `ui:copilot:<sid>` 行 → 切换选中。
- 项目行「＋」→ `POST /api/agent/sessions` `{ spaceKind: "project", projectId }` → `ui:project:<pid>:<sid>`。
- UI 会话内 `/reset`（或 /clear）→ 等效于"在当前空间所属分组新建会话并切换"（`ui:...:<new-sid>` 新行，旧行保留）；**不触发世代机制**（世代留给飞书空间与 provider/key 变更重建）。

### F5 会话列表
`GET /api/agent/sessions` → 按 key 前缀分组：通用（`ui:copilot:*`）、项目（`ui:project:<pid>:*`，join `projects` 取名；pid 不存在 → 孤儿标记）、飞书（`feishu:*`，join 通道元数据取 chat 名）。按 lastActiveAt 倒序。历史读取：`GET /api/agent/sessions/:spaceKey/messages`（读 PI JSONL 投影为消息列表；飞书会话同路径，只读由前端按前缀判定）。

## 接口契约

### HTTP：会话与消息（遵循 ADR-001，错误 = HTTP 状态码 + JSON `{ error, message }`）

| 端点 | 说明 | 错误 |
|---|---|---|
| `GET /api/agent/sessions` | 分组会话列表（通用/项目/飞书；含 title/lastActiveAt/孤儿标记/项目名） | — |
| `POST /api/agent/sessions` | 新建会话 `{ spaceKind, projectId? }` → `{ spaceKey }`；projectId 无效 → 400 | E-SESSION-CREATE |
| `GET /api/agent/sessions/:spaceKey/messages` | 历史消息列表（JSONL 投影；飞书会话只读语义由前端呈现，后端不拒读） | 404 E-SESSION-NOT-FOUND |
| `POST /api/agent/sessions/:spaceKey/messages` | 发送 `{ text }` → 202 `{ messageId }`；空/超限 → 400；agent 未配置 → 409 E-AGENT-CONFIG；孤儿项目空间 → 409 E-SESSION-ORPHAN；`feishu:*` → 403 E-SESSION-READONLY | 沿用 E-AGENT-* |
| `POST /api/agent/sessions/:spaceKey/reset` | = 新建同分组会话 → `{ spaceKey: 新 }`（F4 语义） | — |
| `GET /api/agent/sessions/:spaceKey/events` | SSE 流（`text/event-stream`；事件 = agentService session-event 原样 + `confirmation-pending`） | 404 |
| `POST /api/agent/confirmations/:id/approve|reject` | **既有端点复用**（飞书卡片回调同端点） | 既有 |

### IPC：session-config 扩展（主进程 → worker，新增字段）

| 字段 | 说明 |
|---|---|
| `spaceKey` | 既有（task run 注入已用） |
| `cwd` | 新增：项目空间 = 项目目录；通用/飞书 = 现状默认值 |
| `skillPaths` | 新增：项目空间 = 项目关联 skills 的技能库绝对路径列表（来自 projectService 关联查询）；其他空间 = 空 |
| `permissionProfile` | 新增：`"default"`（CLI-only 空间，无 gotgenes 装配）/ `"project"`（装配 gotgenes + 授权桥 + 项目策略目录） |

### gotgenes 策略（文件驱动，两级）

| 文件 | 位置 | 内容方向（清单在 crystallize 细化） |
|---|---|---|
| 全局策略 | 应用资源 `agent-policy/`（只读默认，随分发） | CLI 高危（delete/config/cancel 类通配）= ask；FS 写/编辑 = ask；bash 破坏性模式（`rm -rf` 等）= ask；其余 = allow |
| 项目策略 | 项目目录约定文件（可选，用户手写，无 UI） | 项目级放宽/收紧覆盖 |

### 授权桥契约（permissionBridge）

| 项目 | 说明 |
|---|---|
| 调用方 | gotgenes（registerAuthorizer 链） |
| 输入 | 操作描述（工具名/命令/路径）、来源 spaceKey |
| 输出 | `"allow" / "deny"`（挂起确认回调决议） |
| 副作用 | 写 agent_confirmations 行；SSE/飞书卡片按 spaceKey 前缀分流渲染 |
| 幂等性 | 确认回调幂等（既有语义：重复回调 → 已处理） |

## 测试 seams

- **HTTP API（主 seam，CLI 同源）**：会话 CRUD/发送/reset/列表分组/孤儿/只读 403 → node --test 直接打 HTTP（CLI seam 已有先例）。
- **SSE**：node --test 起 server + 真实 HTTP 客户端读流，FAUX provider（`OPC_AGENT_FAUX` + `OPC_AGENT_FAUX_TPS`）驱动确定性流式 → 断言事件序列。
- **权限策略**：gotgenes 策略文件 + 授权桥 → 单元（策略评估 fake 工具调用）+ 集成（ask → 挂起行 → approve → allow 全链）。
- **按空间装配**：worker 级测试（fake worker 捕获 session-config，断言 cwd/skillPaths/permissionProfile 按空间正确——BUG-004/005 同型 seam）。
- **E2E（Playwright Electron）**：双区导航（默认落地/⚙进出管理区/返回对话）、对话收发流式、分组列表与项目行＋、确认卡、只读/孤儿/未配置态、/reset=新会话。
- **测试组织**：`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/`（entity = 对话空间 conversation-space，/domain-model 登记确认）。

## 安全 / 性能 / 可观测性

- **安全**（checklists/security）：权限策略文件 = 应用资源只读 + 项目目录可选（用户本机，信任边界 = 项目目录属主）；`!` bash 走 `user_bash` 事件需同策略拦截（research 标记，实现期覆盖）；SSE/HTTP 仅绑 localhost（现状沿用）；孤儿空间禁止写操作（409）；飞书空间 UI 只读 403。
- **性能**（checklists/performance）：会话列表 = 单查询 + join（行数有界，本地）；JSONL 历史投影分页（`?limit/ before`，默认 100 条）；SSE 每选中会话一条连接，后台会话不建；title 截断在首条消息时一次写入。
- **可观测性**（checklists/observability）：沿用 `NODE_ENV!=test` 诊断日志模式——会话创建装配（spaceKey→cwd/skills/profile）、SSE 连接开/合、授权桥 ask→决议耗时、孤儿/只读拦截计数；E-SESSION-*/E-AGENT-* 错误码沿用。

## 风险与回退

| 风险 | 影响 | 缓解 |
|---|---|---|
| H3：gotgenes 自定义 agentDir 下 config 发现行为未实证 | 项目策略文件不被加载 → 权限策略失效 | **签核前 spike**（同 builtin-agent H1~H4 模式）：最小嵌入复现 + 断言策略生效 |
| H4：gotgenes 单进程多并发会话正确性（globalThis 单槽）未实证 | 会话间策略串扰 | **签核前 spike**：双会话并发 ask 断言隔离；若不成立 → 回退自实现 `tool_call` 钩子（research 证实可行，策略评估自写） |
| 多 AgentSession 各持独立 loader 共存无官方示例 | 会话间资源串扰 | 代码可行（research）；E2E 双会话隔离断言覆盖 |
| JSONL 历史投影性能（大会话） | 列表/打开卡顿 | 分页 + 本地规模有界；性能清单复核 |
| 默认路由切换影响既有 E2E | 套件大面积红 | 双区模型下旧路由全部保留；仅初始落地断言需适配（Settings 三套件已有同型适配先例） |

## 里程碑切分

- **M1 会话中心骨架**：双区路由 + 会话 REST/SSE + 空间=会话模型（含 title/reset 语义）+ 对话收发/流式/历史 + 内联确认卡（CLI 高危既有分类接入授权桥雏形——不含 gotgenes，先用既有命令保险层分类直桥）+ 孤儿/只读/未配置态。
- **M2 项目空间增强**：per-session cwd/skills 装配 + gotgenes 全局/项目策略 + 授权桥全量（H3/H4 spike 前置）+ FS/脚本工具面（按 permissionProfile 挂载）。
- **M3 飞书只读**：飞书空间进列表（F5 分组）+ 只读呈现（前端前缀判定 + 后端 403 兜底）。

## 决策记录（拟写 ADR，见第 9 节）

- **D1 空间 = 会话**（`ui:copilot:<sid>` / `ui:project:<pid>:<sid>`；/reset(UI)=新会话；title 附加列）→ ADR-016
- **D2 权限层 = gotgenes + 授权桥**（全局+项目策略文件；ask → 既有挂起队列）→ ADR-017
- **D3 双区模型**（会话区默认落地 + 管理区旧壳原样 + 返回对话）→ ADR-018
- **D4 流式 = SSE**（不重 ADR：可逆、局部、无不解之处）

## 9. ADR 计划

| ADR | 决策 | 为什么够格 |
|---|---|---|
| ADR-016 | 空间=会话的多会话模型与 /reset 语义 | 数据模型语义难逆转；世代机制共存易困惑；A/B 方案有真实取舍 |
| ADR-017 | 权限层采用 gotgenes + 授权桥（策略文件两级，不做 UI 配置） | 引入运行时依赖难逆转；与自实现钩子的取舍真实；未来读者会疑惑"为什么有两套拦截" |
| ADR-018 | 双区信息架构（会话区默认落地 + 管理区旧壳） | 默认路由变更难逆转；路线 A 被否决的理由需留痕；影响全部后续导航相关决策 |
