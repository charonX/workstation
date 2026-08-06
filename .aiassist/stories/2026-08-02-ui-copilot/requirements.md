# 需求规格 — UI Copilot 会话中心

> Story: `2026-08-02-ui-copilot`
> 版本: v1（2026-08-06，/crystallize）
> 输入: PRD v1（S1~S9）+ tech-design v1（D1~D4）+ ADR-016/017/018 + CONTEXT.md（2026-08-06 登记）+ research（H1/H2 已证实）
> UX 参照: `ux/assistant.html`（approved）

## 假设与验证方式（spike，signoff 前置验证项）

以下假设在 BUILD 前必须经 spike 验证，结论记录于 signoff 检查项；失败则按 tech-design 回退预案处理（ADR-017：回退自实现 `tool_call` 钩子）：

| # | 假设 | 涉及 REQ | 验证方式 |
|---|---|---|---|
| H3 | gotgenes 在本应用 SDK 嵌入形态下 config 发现正常（自定义 agentDir、无 `~/.pi` 布局；全局策略 + 项目目录策略两级加载） | REQ-AGENT-033 | spike 脚本：嵌入装配 → 断言两级策略生效 |
| H4 | gotgenes 在单 worker 进程多并发独立会话下策略隔离正确（globalThis 单槽服务不串扰） | REQ-AGENT-033 | spike 脚本：双会话并发 ask → 断言隔离 |
| H5 | 多 AgentSession 各持独立 DefaultResourceLoader 共存不串扰（cwd/skills/extensions 各自独立） | REQ-AGENT-031/032 | spike 脚本：双空间会话 → 断言装配独立 |

## REQ-AGENT-026 双区信息架构与默认落地（S1，里程碑 M1）

- 优先级 P0 / 必须 / cross-module / App.jsx, Sidebar.jsx / agent-dialogue / conversation-space / E2E
- UX 参照：`ux/assistant.html`

验收标准：
1. 应用启动后默认路由为会话区（`/assistant`），渲染会话区左导：「新对话」按钮 + 通用分组 + 项目分组 + 飞书分组 + 底部 ⚙ 设置。
2. 点 ⚙ → 切换为管理区：旧左导八条目（仪表盘/工作区/流程/执行/内容源/技能/通知/设置）+ 顶部「← 返回对话」。
3. 管理区点旧条目 → 旧路由与页面本体同改前一致（`/workspace`、`/flows` 等全部可达，渲染内容不变）。
4. 点「← 返回对话」→ 回到会话区。
5. 直接访问旧路由（如 `#/flows`）→ 以管理区壳呈现（含「← 返回对话」）。

## REQ-AGENT-027 空间 = 会话模型与新对话归属（S2，里程碑 M1）

- 优先级 P0 / 必须 / cross-module / sessionStore, agentService, routes/agentSessions / agent-dialogue / conversation-space / 单元+集成
- 接口契约：`POST /api/agent/sessions`、`POST /api/agent/sessions/:spaceKey/reset`（tech-design 接口契约节）

验收标准：
1. `POST /api/agent/sessions { spaceKind: "general" }` → 200 `{ spaceKey }`，spaceKey 匹配 `^ui:copilot:.+`，`agent_sessions` 建行且 JSONL 占位落盘。
2. `{ spaceKind: "project", projectId }` → spaceKey 匹配 `^ui:project:<pid>:.+`；projectId 不存在 → 400。
3. 会话首条用户消息发送后 `title` = 该消息截断（≤40 字）；后续消息不更新 title。
4. `POST .../reset`（UI 空间）→ 返回**新** spaceKey（同分组新行）；旧行保留且其历史仍可读、可继续发送。
5. `feishu:*` 空间 /reset 世代制行为不变（既有测试回归）。
6. 表迁移：既有 `feishu:*` 行无损，`title` 列 NULL 兼容。

## REQ-AGENT-028 对话收发与 SSE 流式渲染（S3，里程碑 M1）

- 优先级 P0 / 必须 / cross-module / routes/agentSessions, agentService, Assistant.jsx / agent-dialogue / conversation-space / 集成+E2E
- 接口契约：`POST .../messages`、`GET .../events`（SSE）（tech-design 接口契约节）

验收标准：
1. `POST .../messages { text }` 合法 → 202 `{ messageId }`；trim 后空 → 400；超 enforceSizeLimit 上限 → 400。
2. `GET .../events`（SSE）推送 agentService session-event 序列（FAUX provider 下 `text_start`/`text_delta`×N/`text_end`），顺序与内容一致；含 `confirmation-pending` 事件类型（REQ-AGENT-030）。
3. 错误映射：agent 未配置 → 409 `E-AGENT-CONFIG`；孤儿空间 → 409 `E-SESSION-ORPHAN`；`feishu:*` → 403 `E-SESSION-READONLY`；spaceKey 不存在 → 404。
4. E2E：发送后用户气泡即时出现；agent 气泡流式增量渲染；完成后发送按钮恢复可用；流式中按钮置灰防重复提交。
5. SSE 断线重连：渲染层重连后先 `GET .../messages` 全量对齐再续流（E2E 断言重连后历史完整）。
6. 单事件 >256KB 截断契约沿用（既有 enforceSizeLimit 回归不断言新行为，跑通即可）。

## REQ-AGENT-029 分组会话列表与历史回看（S4，里程碑 M1）

- 优先级 P0 / 必须 / cross-module / sessionStore, routes/agentSessions, SessionList / agent-dialogue / conversation-space / 集成+E2E
- UX 参照：`ux/assistant.html`

验收标准：
1. `GET /api/agent/sessions` → `{ general: [...], projects: [{ projectId, projectName, orphan, sessions: [...] }], feishu: [...] }`；项目名 join `projects` 表。
2. projectId 在 `projects` 不存在 → 该组 `orphan: true`；前端划线呈现且会话只读（发送 409 由 REQ-AGENT-028 标准 3 兜底）。
3. 各组内会话按 `lastActiveAt` 倒序。
4. `GET .../messages?limit&before` → 按时间序返回；分页参数生效；默认 limit=100。
5. 飞书会话出现在 `feishu` 组，显示名取通道元数据 chat 名。
6. E2E：点会话 → 右栏渲染完整历史气泡；左栏 active 态跟随；项目分组可展开/收起。

## REQ-AGENT-030 内联高危确认卡（S5，里程碑 M1）

- 优先级 P0 / 必须 / cross-module / confirmationService, permissionBridge（M1 雏形：命令保险层分类直桥）, routes, SSE, MessageList / agent-dialogue / conversation-space / 集成+E2E
- UX 参照：`ux/assistant.html`
- 接口契约：复用既有 `POST /api/agent/confirmations/:id/approve|reject`

验收标准：
1. CLI 高危操作（既有命令保险层分类）在 UI 空间触发 → 挂起确认行创建 + SSE `confirmation-pending` 事件（含确认 id、操作描述）。
2. E2E：确认卡渲染操作描述 + 确认/拒绝按钮；点确认 → 调既有端点 → 执行结果以 agent 消息流式呈现；点拒绝 → agent 告知已取消。
3. 用户暂不处理：卡片保留在历史中，稍后点击仍有效（确认与执行解耦，挂起队列 = SQLite 真相）。
4. 已处理卡片置灰标注"已处理"；重复回调幂等（既有语义回归）。
5. 飞书空间确认卡片路径回归：同一挂起队列，飞书渲染与回调不变（既有测试套件不断言新行为，跑通即可）。

## REQ-AGENT-031 项目空间 SKILL.md 注入（S6，里程碑 M2）

- 优先级 P1 / 应该 / cross-module / agentService, worker, projectService / agent-dialogue / conversation-space / 集成（worker 级）
- 接口契约：session-config 扩展字段 `skillPaths`（tech-design IPC 契约节）
- 依赖：H5 spike 通过

验收标准：
1. `ui:project:<pid>:*` 会话的 session-config `skillPaths` = 该项目已关联 skills 的技能库绝对路径列表（projectService 关联查询）；通用/飞书会话 = 空数组。
2. worker 按 `skillPaths` 装配 `additionalSkillPaths`（fake worker 捕获 session-config 断言，BUG-004/005 同型 seam）。
3. 项目空间会话 system prompt 的 available_skills 段含项目 skills 的 name/description（渐进披露）；agent 可经 read 工具读到对应 SKILL.md 全文。
4. 通用空间会话 available_skills 不含任何项目 skills（空间隔离）。
5. 项目关联变更后新建的会话生效；已建会话经 PI `session.reload()` 语义刷新（不断言热更新——变更后新会话为准）。

## REQ-AGENT-032 项目空间 FS/脚本工具面（S7，里程碑 M2）

- 优先级 P0 / 必须 / cross-module / worker, toolAdapter / agent-dialogue / conversation-space / 集成
- 接口契约：session-config 扩展字段 `cwd`、`permissionProfile`（tech-design IPC 契约节）
- 依赖：H5 spike 通过

验收标准：
1. `permissionProfile="project"` 会话挂载 read/write/bash 工具且 `cwd` = 项目目录绝对路径（fake worker 断言）。
2. `permissionProfile="default"`（通用/飞书空间）会话**不出现** FS/bash 工具（工具面分级硬边界；fake worker 断言工具清单）。
3. 项目空间 agent 可在 cwd 内读文件（FAUX/集成：read 工具返回项目文件内容）。
4. cwd 外路径的写/执行请求 → 权限层拦截（与 REQ-AGENT-033 附录 A 联动断言）。

## REQ-AGENT-033 高危权限策略（gotgenes + 授权桥）（S8，里程碑 M2）

- 优先级 P0 / 必须 / cross-module / worker, permissionBridge, gotgenes / agent-dialogue / conversation-space / 单元+集成
- 接口契约：授权桥契约（tech-design 接口契约节）；策略文件两级（tech-design gotgenes 策略节）
- 依赖：H3/H4 spike 通过（失败回退 ADR-017 预案：自实现 `tool_call` 钩子 + 自写策略评估，本 REQ 验收标准语义不变）

验收标准：
1. 全局策略文件随应用分发（应用资源，只读默认）；项目目录约定策略文件存在时加载（H3 验证 config 发现路径）。
2. 附录 A 分类逐项断言：读类 → allow；写/编辑/删除文件 → ask；bash 破坏性模式 → ask；bash 非破坏 → allow；CLI 高危（既有 REQ-AGENT-015 分类）→ ask。
3. ask → 授权桥创建挂起确认行（含操作描述 + 来源 spaceKey）→ approve → allow 且操作执行；reject → deny 且 agent 收到工具错误可转述。
4. 用户 `!` bash（`user_bash` 事件）走同一策略评估与拦截（不经 `tool_call` 的路径单独断言）。
5. 双会话并发 ask 策略隔离（H4）：A 空间项目策略不影响 B 空间评估结果。
6. 无权限 UI 配置面：设置页无权限相关 tab/区（E2E 断言）。

### 附录 A：高危操作分类清单（FS/脚本延伸，2026-08-06 细化）

| 分类 | 判定 | 说明 |
|---|---|---|
| 读类 → **allow** | read/ls/grep/find/cat 等只读工具与 bash 只读管道（无重定向/删除/权限变更） | 直接放行 |
| 写类 → **ask** | write/edit/create/delete 文件工具 | 任意路径均 ask（cwd 内外） |
| bash 破坏性模式 → **ask** | `rm`/`rmdir`、`sudo`、`>`/`>>` 重定向、`curl\|sh`、`wget\|sh` 管道、`kill`/`pkill`、`chmod`/`chown`、`dd`、`mkfs`、`mv` 覆盖、`git push --force`、全局包安装 | 通配模式清单可在 signoff 增补，增补需重算 hash |
| bash 其他 → **allow** | 不匹配破坏性模式 | 直接放行 |
| cwd 外写/执行 → **ask** | 任何工具的目标路径在项目目录外 | 与写类叠加时一次 ask |
| CLI 高危 → **ask** | 既有 REQ-AGENT-015 分类（删除/配置变更/取消类） | 命令保险层既有分类沿用 |
| **deny** | 无 | 首版不设 deny；全部高危走 ask 人工裁决 |

## REQ-AGENT-034 飞书会话只读视图（S9，里程碑 M3）

- 优先级 P1 / 应该 / intra-module / routes/agentSessions, SessionList, ChatView / agent-dialogue / conversation-space / 集成+E2E
- UX 参照：`ux/assistant.html`

验收标准：
1. 飞书会话选中后右栏渲染历史气泡（REQ-AGENT-029 标准 5 列表覆盖），**无输入区**（composer 不存在），呈现"飞书会话 · 请到飞书继续对话"标注。
2. `POST .../messages` 到 `feishu:*` spaceKey → 403 `E-SESSION-READONLY`（后端兜底，REQ-AGENT-028 标准 3 同断言）。
3. 飞书侧新消息到达后：UI 列表 lastActiveAt 更新可见；选中该会话时 SSE 增量呈现新消息。
4. UI 侧不产生任何向飞书通道的发送调用（无消息桥；代码审查 + 集成断言无 sendCard 调用路径自 UI 端点触发）。

## REFLECT 人工验收备注

- 流式渲染体感（逐字顺滑度、长回复）。
- 确认卡/气泡/空态/引导态观感（含暗色主题）。
- 会话区/管理区往返体验与导航直觉性。

## 测试文件规划

| REQ | seam | 测试类型 | 路径 |
|---|---|---|---|
| 026 | Playwright Electron | E2E | `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/e2e/assistantNav.test.cjs` |
| 027 | HTTP API + sessionStore | 单元+集成 | `.../api/sessionSpace.test.js`、`.../api/sessionReset.test.js` |
| 028 | HTTP API + SSE（FAUX） | 集成+E2E | `.../api/sessionMessage.test.js`、`.../api/sessionEvents.test.js`、`.../e2e/assistantChat.test.cjs` |
| 029 | HTTP API | 集成+E2E | `.../api/sessionList.test.js`、`.../e2e/assistantSessions.test.cjs` |
| 030 | HTTP API + SSE + 确认端点 | 集成+E2E | `.../api/uiConfirmation.test.js`、`.../e2e/assistantConfirm.test.cjs` |
| 031 | fake worker session-config | 集成 | `.../api/skillInjection.test.js` |
| 032 | fake worker session-config | 集成 | `.../api/workerAssembly.test.js`、`.../api/toolSurface.test.js` |
| 033 | 策略评估 + 授权桥全链 | 单元+集成 | `.../api/permissionPolicy.test.js`、`.../api/authorizerBridge.test.js` |
| 034 | HTTP API + E2E | 集成+E2E | `.../api/feishuReadonly.test.js`、`.../e2e/assistantFeishu.test.cjs` |

（`...` = `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/`）
