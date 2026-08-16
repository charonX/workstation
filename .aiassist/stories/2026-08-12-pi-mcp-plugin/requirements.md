# Requirements — PI 插件管理与 MCP 支持（Extensions + MCP）

> 故事 ID：`2026-08-12-pi-mcp-plugin`
> 版本：v1
> 最后更新：2026-08-12
> 来源：`prd.md` v0.2（B1-B9）+ `tech-design.md` v0.1（接口契约 1-4）
> 移动块 M2（添加确认文案）/M4（通用 extension 工具粒度）/M5（更新 UI）留 PRD，不入 REQ。
> UX 参照：ux/plugins-page.html（插件页+MCP 管理，REQ-083/084）、ux/permission-mcp-group.html（权限 mcp 族，REQ-087）、ux/oauth-present.html（OAuth 呈现，REFLECT 人工验收参照）；DESIGN 阶段已定稿（2026-08-13 人确认），结构契约以 data-testid 锚定，形态对齐既有「技能」页/权限配置页。
> 技术事实（research-1/2 实证）：官方包机制程序化可达（DefaultPackageManager/SettingsManager 包根导出）；`resolve()` 两级求值含 enabled/scope；enable/disable 持久化 = 公开 setter 写 `+`/`-` 模式；gotgenes 原生预留 mcp 面（public.d.ts L62）；桥 broker 事件每次未缓存 MCP 调用都发；`createMcpAdapter({config})` 快照隔离不 merge 文件。
> ADR：ADR-024（全量转官方 + 三姿态）、ADR-025（桥内置 + broker 接线）。

---

## REQ-AGENT-078 pi 0.83 → 0.84.1 前置升级（B9）

- 优先级 P0 / 必须 / cross-module / worker 会话装配 + 流式渲染链 / plugin-management / extension / 全量回归（单元+集成+E2E）
- 接口契约：升级后对外行为不变——`message_update` 纯 delta 语义下 worker 自行组装累积文本（`message_end` 权威）；会话 v4 harness 适配；ModelRegistry 签名适配
- 前置切片：本 REQ 为第 0 切片，独立 commit，绿后才进后续 REQ

验收标准：
1. 升级后既有全量测试套件通过（agent-dialogue 356+ 用例即回归网，含 modes/ux/权限三个 story 的 E2E）。
2. 流式渲染在 delta 语义下正确：assistant 消息逐 delta 累积、无重复/丢失（API：worker 流式事件序列断言 + E2E 流式渲染用例）。
3. 升级切片不引入任何功能变化（diff 只含迁移代码；既有效能不变）。

## REQ-AGENT-079 插件安装——三种来源（B1）

- 优先级 P0 / 必须 / cross-module / extensionService + 官方 DefaultPackageManager / plugin-management / extension / 集成 + 单元
- 接口契约：`add(source) → PluginRow`；source ∈ `npm:pkg[@ver]` / git URL[@ref] / 本地路径；真相 = 全局 `agentHome/settings.json`（官方 installAndPersist）

验收标准：
1. 本地路径来源：存在性校验通过后登记成功，settings.json 含 resolved 绝对路径，磁盘不拷贝（集成：临时目录 fixture 包）。
2. npm/git 来源：格式解析与拼装正确（单元：合法/非法来源串矩阵）；真实网络安装走 stub——安装成功写 settings，失败不留半成品（集成：stub PackageManager）。
3. 非法来源格式 → 字段级错误，不落盘（E2）（集成：错误消息含格式指引）。
4. 重复添加同一来源（官方身份规则：npm 包名/git URL 去 ref/本地 resolved 路径）→ 幂等，无重复记录（E6）（集成）。

## REQ-AGENT-080 插件清单读取（B1/B3 数据面）

- 优先级 P0 / 必须 / intra-module / extensionService / plugin-management / extension / 集成
- 接口契约：`list() → PluginRow[]`，行 = { 名称, 来源, 版本, scope(global/project), enabled, 错误态? }；数据来自官方 `resolve()` 的 `ResolvedPaths`

验收标准：
1. 空态：无插件时返回空列表（集成）。
2. 已装插件行字段完整：名称/来源/版本/scope 均可读出（集成：fixture 包 + resolve 输出断言）。
3. 加载失败的插件以错误态行呈现而非消失（集成：坏插件 fixture；依赖官方 per-extension 错误隔离——BUILD 前 spike 验证点①）。

## REQ-AGENT-081 插件项目启用/停用（B2）

- 优先级 P0 / 必须 / cross-module / extensionService + SettingsManager setter / plugin-management / extension / 集成
- 接口契约：`setProjectEnabled(projectId, source, enabled)`；写 `<projectDir>/.pi/settings.json` 资源覆盖模式（`+`/`-`，先剔除同目标旧模式——复刻 pi config 持久化）；读取经 `resolve()` 两级求值

验收标准：
1. 启用 → 项目 `.pi/settings.json` 写入对应 `+` 模式；`resolve()` 求值该项 enabled=true 且 scope=project（集成）。
2. 停用/取消 → 写入 `-` 模式或剔除覆盖，回到全局继承态（集成：三态流转断言）。
3. 未全局安装的插件不可启用 → 业务错误（E6）（集成）。
4. 重复启用幂等，不产生重复模式行（集成）。
5. 进行中会话不受启用切换影响；新会话生效（集成：装配两次断言工具面差异）。

## REQ-AGENT-082 会话装配接入官方发现链路（B1/B2/B8 worker 侧）

- 优先级 P0 / 必须 / cross-module / worker.js / plugin-management / extension / 集成
- 接口契约：装配 = `SettingsManager.create(cwd, agentDir)` + 自动发现开 + extensionFactories 固定序 `[授权桥, gotgenes, MCP桥]`；`onMissing → "error"`
- ADR-024 姿态：gotgenes/授权桥保持内联；缺包报错不自动装；projectTrusted 默认 true

验收标准：
1. 项目 A 启用插件后，A 的会话工具面含该插件工具；未启用的项目 B 会话不含（集成：两项目对照）。
2. 授权桥仍先于 gotgenes 执行（集成：tool_call 分发顺序断言——授权桥 handler 先于 gotgenes 被调用）。
3. settings 声明但磁盘缺失的包 → 会话装配失败，错误消息含包名与「到插件页重装」指引；不发网络安装请求（集成：删目录后断言 onMissing 路径 + 无网络调用 stub 见证）。
4. 通用空间（无项目）会话只加载全局启用面，不读项目 settings（集成）。

## REQ-AGENT-083 插件管理 UI（B3）

- 优先级 P1 / 必须 / intra-module / 管理区插件页 / plugin-management / extension / E2E（Playwright Electron）
- 接口契约：`[data-testid='plugins-page']`、`plugin-add-button`、`plugin-source-input`、`plugin-row-<name>`、`plugin-row-error`、`plugin-project-toggle`；形态对齐既有「技能」页
- UX 参照：`ux/plugins-page.html`（已定稿）；结构契约以 testid 锚定
- IA 注记（BUG-013 req-gap 就地补全 2026-08-16，人拍板）：插件页只承载扩展插件清单；MCP 服务管理拆出为管理区独立导航项「MCP」（位于「技能」之下）+ 独立路由 `#/mcp`，页面契约见 REQ-AGENT-084 注记。

验收标准：
1. 管理区出现「插件」页入口，页面渲染插件清单（E2E：行数与 API 清单一致）。
2. 添加流程：来源输入 → 成功列表新增行 / 失败弹窗内报错（E2E：本地 fixture 路径成功 + 非法来源报错）。
3. 行内项目启用切换可点且状态持久（E2E：切换后刷新页面状态保持）。
4. 错误态插件行标红 + 详情可见（E2E：坏插件 fixture 行呈现）。
5. 添加动作带「第三方代码拥有完全系统权限」告知文案（E2E：文案存在；DESIGN 已定稿为添加弹窗内常驻告知条 `plugin-safety-note`，非每次确认——M2 消解）。

## REQ-AGENT-084 MCP server 配置 CRUD + 项目启用（B4）

- 优先级 P0 / 必须 / cross-module / mcpService + DB 新表 / plugin-management / mcp-server / 集成 + 单元
- 接口契约：CRUD `{ name, type: "stdio"|"http", command?, args?, env?, url?, headers?, auth?: "none"|"bearer"|"oauth", token?: string }`；`setProjectEnabled(projectId, serverId, enabled)`；`effectiveConfig(projectId|spaceKey) → McpConfigSnapshot`（桥可直接消费）
- token 语义（BUG-006 req-gap 就地补全 2026-08-14，人拍板「表单输入 + secretStore 加密」）：`token` 仅在 `type=http ∧ auth=bearer` 时有意义（此时必填）；落库前经 secretStore 加密存 `token_enc` 列，DB/API/列表**永不出现明文**；`effectiveConfig` 快照解密映射桥 `bearerToken` 字段（pi-mcp-adapter ServerEntry 原生字段，桥据此注入 Authorization 头）。auth=none/oauth 或 stdio 时忽略 token。
- IA + 工具探测注记（BUG-013 req-gap 就地补全 2026-08-16，人拍板）：MCP 管理 UI 独立成页——管理区导航项「MCP」（位于「技能」之下），路由 `#/mcp`，UX 参照 `ux/mcp-page.html`；`[data-testid='mcp-page']`、`mcp-tools-button`、`mcp-tools-modal`、`mcp-tools-table`。新增工具探测契约：`probeTools(name) → [{ name, description }]`（HTTP `GET /api/mcp/:name/tools`）——按库内配置**直连** server（stdio spawn / http+bearer 解密 token 注入 Authorization，同 effectiveConfig 解密路径）拉取 `tools/list`；连接失败 → 业务错误（前端弹窗内呈「连接失败 + 详情」）；探测即连即断，不写库、不影响会话快照；**API 不回显 token 明文**。

验收标准：
1. 建 stdio server：合法配置落库（API：字段断言）。
2. 建 http server：url 合法性校验（http/https），headers/env 为 KEY=VALUE 且 KEY 合法（单元：校验矩阵；非法 → E2 字段错误）。
3. 名称库内唯一；重复 → 业务错误（API）。
4. 项目启用/停用持久化；`effectiveConfig` 只含「全局启用开关开 ∧ 项目已启用」的 server（API：组合矩阵断言）。
5. 快照形态与桥 `createMcpAdapter({config})` 的 config schema 对齐（集成：快照直接传入桥工厂不报错——fixture 校验）。
6. bearer token 全链路：auth=bearer 建 server 带 token → DB 中只有密文（token_enc，无明文 token）→ `effectiveConfig` 快照含解密后 `bearerToken` → API/列表响应不回显 token 明文（API + 单元）。auth=bearer 缺 token → 字段错误（E2 文案含 token）。
7. 工具探测（BUG-013 新增）：stdio fixture server 落库后 `probeTools` 返回其 `tools/list`（名称+描述，API 集成）；http fixture（bearer）同（API 集成）；command 不存在 / 端口不通 → 业务错误含「连接失败」（API）；MCP 页行内「工具」按钮开弹窗列出名称+描述（E2E）。

## REQ-AGENT-085 MCP 桥装配与工具链路（B5）

- 优先级 P0 / 必须 / cross-module / worker + pi-mcp-adapter + mcpService / plugin-management / mcp-server / 集成
- 接口契约：worker 内联装配 `createMcpAdapter({ config: mcpService.effectiveConfig(...) })`，排在 gotgenes 之后；桥 lazy 连接

验收标准：
1. 全链路：fixture stdio server（本地 node 脚本）配置入库+项目启用 → 新会话工具面含桥工具 → 经 fauxProvider 驱动 agent 调用 → fixture server 收到调用、结果回流对话事件（集成）。
2. 快照隔离：在 `~/.config/mcp/mcp.json` 等用户级位置放置散落配置 → 会话不出现其中的 server（集成：HOME 隔离 fixture）。
3. 配置变更（改库）后新会话生效、进行中会话不变（集成）。
4. 远程 server（http/bearer）：本地 HTTP fixture server 全链路调用成功（集成）；OAuth 链路见 REFLECT 人工验收备注。

## REQ-AGENT-086 MCP 权限 broker 接线（B6 核心）

- 优先级 P0 / 必须 / cross-module / permissionBridge + gotgenes + 授权桥 / plugin-management / mcp-server / 集成
- 接口契约：broker `tool-approval-request` claim 内调 gotgenes `checkPermission("mcp", "<server>:<tool>")`；映射 allow→`allow_once`、deny→`deny`、ask→确认挂起队列；一期不返回 `allow_for_session`

验收标准：
1. 配置 allow 的 `server:tool` → 调用直放，无确认卡，fixture server 收到调用（集成）。
2. 未配置（默认 ask）→ 弹确认卡；人确认 → server 收到调用；人拒绝 → server 未收到 + reason 回 agent（集成）。
3. 配置 deny → 不弹卡不执行，deny reason 回 agent（集成）。
4. strict 模式：即使配置 allow 也弹卡（集成：模式对照）。
5. auto 模式：ask 先过模型 link（allow/deny/defer 三路径），defer 才弹卡（集成：FAUX provider 三判定）。
6. claim 无人响应/异常 → fail-closed，工具不执行（集成：模拟桥 headless 边界）。
7. 每次裁决落 permission review log（集成：log 行断言含 serverName/tool/verdict）。

## REQ-AGENT-087 mcp 权限规则族可视化（B6 配置面）

- 优先级 P1 / 必须 / cross-module / policyRules.js + permissionConfigService + 权限配置 UI / plugin-management / mcp-server / 集成 + E2E
- 接口契约：规则表新增 `mcp` 族，pattern = `server:tool` glob，裁决 allow/ask/deny，默认 ask；部署 JSON 由规则表生成（ADR-020 单一真源）
- UX 参照：`ux/permission-mcp-group.html`（已定稿）：族分组 `perm-family-mcp`、规则行 `perm-rule-row`、三态切换 `perm-rule-verdict`、项目覆盖高亮
- **默认层 + 选择器注记（BUG-014 req-gap 就地补全 2026-08-16，人拍板：默认层存 workstation DB、项目页保留为覆盖、下拉选择为主）**：
  - 新增**用户级默认层**：workstation DB 表 `mcp_permission_defaults`（pattern TEXT 主键 = `server:tool` glob、verdict ∈ allow/ask/deny）；HTTP 面 `GET /api/mcp/permission-defaults` → `{ rules: { [pattern]: verdict } }`（插入序）、`PUT /api/mcp/permission-defaults` body 同构**全量替换**（非法 verdict / pattern 不含 `:` → 4xx）。`permission-defaults` 保留为路由字面量，不得作为 server 名（create 拒绝）。
  - **运行时合并**：worker 启动部署全局策略时，把默认层 merge 进部署 JSON 的 `permission.mcp`——出厂 `"*": "ask"` 保持首位，用户 pattern 追加在后（gotgenes 同层 last-match-wins，具体 pattern 必须后于 `*` 才生效）；项目策略文件仍是更高层（覆盖语义不变）。DB 读失败 → 落静态源拷贝（不阻断会话）。默认层变更 = 新会话生效（对齐 REQ-AGENT-085 标准 3）。
  - **视图层合并**：`getPermissionView` 的 `global` 先合并默认层再组规则行——项目页 mcp 族行 `global` 值 = 用户默认（无默认则出厂 ask），`projectOverridden` 高亮对照用户默认。
  - **录入选择器**（两页同构）：添加规则 = server 下拉（已配置清单，GET /api/mcp）→ 选中后经 probeTools 拉该 server 工具下拉（含 `*` 全部工具项）→ 裁决三态 → 生成 `server:tool` 规则；保留手填 glob 高级入口。testid 契约：`mcp-perm-defaults`（MCP 页默认权限区）/`mcp-perm-row` / `mcp-perm-verdict` / `mcp-perm-server-select` / `mcp-perm-tool-select` / `mcp-perm-add-submit`；项目页族内复用 `perm-rule-*` 前缀。
  - IA：默认层编辑归属 MCP 页（`#/mcp` 默认权限区，UX 参照 `ux/mcp-page.html`）；项目权限页 mcp 族保留，语义 = 项目覆盖默认层。
  - IA 修正（BUG-015 req-gap 就地补全 2026-08-16，人确认）：`#/workspace` 项目列表页底部「权限配置 · MCP 工具」区块**移除**——门 1（2026-08-13）签核的「权限配置入口沿用 #/workspace」锚点废止；该区块绑死 `projects[0]` 语义怪，且 BUG-014 后成冗余第三入口。项目覆盖编辑唯一入口 = 项目详情「权限配置」页签（`PermissionConfigTab` 内 `McpPermissionGroup`）；默认层在 MCP 页。E2E 锚点同步重锚项目详情页签（断言语义不变）。

验收标准：
1. 规则表 mcp 族进部署 JSON，gotgenes 按 `server:tool` glob 匹配（集成：`checkPermission("mcp", ...)` 对照矩阵）。
2. 权限配置页新增 mcp 分组：规则行 allow/ask/deny 切换、项目覆盖高亮（与既有族同构）（E2E：分组可见 + 切换持久）。
3. 未匹配任何规则的 MCP 调用 = 默认 ask（集成）。
4. （BUG-014 AC8，API）默认层 CRUD：GET 空 → `{}`；PUT `{ rules }` → GET 回读同 map；非法 verdict / pattern 缺 `:` / server 名撞保留字 `permission-defaults` → 4xx。
5. （BUG-014 AC9，单元+集成）运行时合并：默认层 pattern 出现在 worker 部署的 config.json `permission.mcp` 且 `"*"` 条目保持首位；`getPermissionView` 的 mcp 族行 `global` = 默认层值、项目文件显式规则仍标 `projectOverridden`。
6. （BUG-014 AC10，E2E）MCP 页默认权限区：server 下拉选已配置 server → 工具下拉列出 probeTools 结果（含 `*`）→ 添加后规则行出现且刷新持久；项目页 mcp 族添加区同为选择器录入。

## REQ-AGENT-088 飞书通道同工同权（B7）

- 优先级 P1 / 必须 / cross-module / worker + 通道路径 / plugin-management / mcp-server / 集成
- 接口契约：飞书会话与 UI 会话共用 worker 装配与权限链（无分叉代码路径）

验收标准：
1. 飞书触发的会话工具面含已启用插件/MCP 工具（集成：通道入口会话工具面断言）。
2. 飞书会话的 MCP 调用同过 broker→gotgenes→飞书确认卡链路（集成：ask 场景飞书卡片出现，确认后执行）。

## REQ-AGENT-089 故障隔离（B8）

- 优先级 P0 / 必须 / cross-module / worker 装配 + mcpService / plugin-management / extension / 集成
- 接口契约：单插件加载失败 → 诊断 + 错误态标记，会话与其他插件正常；单 MCP server 连接失败 → 其工具不注册，会话与其他 server 正常

验收标准：
1. 坏插件 fixture（加载即抛错）存在时：会话创建成功、其他插件工具可用、错误态经清单/notification 可见（集成；依赖 spike 验证点①）。
2. 坏 server fixture（command 不存在）配置启用时：会话创建成功、其他 server 工具可用、该 server 标错误态（集成）。
3. 桥自身加载失败 → 会话仍可用（无 MCP 工具）+ 错误可见（集成）。

## REQ-AGENT-090 插件/MCP CLI 命令族（测试 seam + agent 自用）

- 优先级 P1 / 应该 / intra-module / CLI（ADR-001 共享服务层） / command-interface / cli / CLI 测试
- 接口契约：`opc-workstation plugin add|remove|list|enable|disable`、`opc-workstation mcp add|list|enable|disable`；输入/输出/退出码与 HTTP API 一致

验收标准：
1. 各子命令映射到对应服务 API，输出为结构化 JSON（CLI 测试：stdout 解析断言）。
2. 业务错误退出码非零 + stderr 含错误码（CLI 测试）。
3. enable/disable 与 UI 操作结果一致（CLI 测试：状态对照）。

## REQ-AGENT-091 对话手动停止（BUG-010 req-gap 就地补全 2026-08-15，人拍板「当作本 story bug 修」）

- 优先级 P0 / 必须 / cross-module / Composer UI + HTTP + agentService + worker / agent-dialogue / conversation-space / 集成+E2E
- 背景：「对话无法手动停止」——pi SDK `AgentSession.abort()` 存在但 worker/HTTP/UI/REQ 四层全链路未接。本 REQ 补 U 形链路（UI 停止键 → HTTP → IPC → SDK abort）。
- 接口契约：
  - HTTP：`POST /api/agent/sessions/:spaceKey/stop` → 202 受理（对齐 messages 受理语义）；会话 idle/不存在/已淘汰 → 202 no-op（不报错）
  - IPC：`{ type:"stop-session", sessionKey }`（fire-and-forget 无回执；停止结果经既有 SSE 事件流收尾：SDK abort → 中断消息 stopReason=aborted → text_end → UI streaming 复位）
  - worker：`stop-session` → `lifecycle.get(sessionKey)?.agentSession.abort()`；未知/已淘汰 key → 静默 no-op + log（不发 session-error——停止非用户错误）
  - UI（UX 参照 ux/composer-stop.html）：Composer 流式中（busy）发送键位变「停止」键 `data-testid="stop-button"`；idle 态无停止键（恢复原发送键）
- 语义边界（v1）：已生成文本保留在气泡（中断消息照常落盘呈现，不加「已停止」标记——观感决策）；挂起的确认卡不随停止撤销（用户仍可手动决定）；停止中断当前生成+工具循环，不删历史、不换代 sessionRef

验收标准：
1. 流式中停止 → 生成中断且已生成文本保留在气泡；输入框恢复可用（集成：FAUX 可编程延迟响应 + stop → 事件流收尾 + 气泡文本断言）。
2. idle 态/不存在会话 stop → 202 no-op 不报错（API）。
3. worker 收到未知 key 的 stop-session → 静默 no-op（无 session-error 事件；集成）。
4. UI：流式中停止键可见可点、idle 态发送键复原（E2E 结构断言）；点击停止后流式收尾、可立即发送下一条并正常回复（E2E：FAUX 驱动）。
5. 停止后会话不损坏：再 prompt 正常回复（集成：stop 后紧跟 prompt，回声正常）。

---

## REFLECT 人工验收备注（不进 REQ 断言）

- OAuth 授权流程体验：授权 URL 呈现形态、回调完成的用户感知（一期无本地 OAuth fixture，人工走一遍真实 OAuth server）。
- 插件页/MCP 表单的视觉观感（对齐技能页形态）。

## 覆盖矩阵

| REQ | 稳定块 | capability | entity | seam | 测试类型 |
|---|---|---|---|---|---|
| REQ-AGENT-078 | B9 | plugin-management | extension | 既有全量套件 | 单元+集成+E2E |
| REQ-AGENT-079 | B1 | plugin-management | extension | extensionService API | 集成+单元 |
| REQ-AGENT-080 | B1/B3 | plugin-management | extension | extensionService API | 集成 |
| REQ-AGENT-081 | B2 | plugin-management | extension | extensionService API + resolve | 集成 |
| REQ-AGENT-082 | B1/B2/B8 | plugin-management | extension | worker 装配 | 集成 |
| REQ-AGENT-083 | B3 | plugin-management | extension | 管理区页面 | E2E |
| REQ-AGENT-084 | B4 | plugin-management | mcp-server | mcpService API | 集成+单元 |
| REQ-AGENT-085 | B5 | plugin-management | mcp-server | 桥全链路 | 集成 |
| REQ-AGENT-086 | B6 | plugin-management | mcp-server | broker 接线 | 集成 |
| REQ-AGENT-087 | B6 | plugin-management | mcp-server | 规则表 + 权限页 | 集成+E2E |
| REQ-AGENT-088 | B7 | plugin-management | mcp-server | 通道会话 | 集成 |
| REQ-AGENT-089 | B8 | plugin-management | extension | 故障 fixture | 集成 |
| REQ-AGENT-090 | （CLI seam） | command-interface | cli | CLI | CLI 测试 |
| REQ-AGENT-091 | （BUG-010 补全） | agent-dialogue | conversation-space | HTTP + worker IPC + Composer | 集成+E2E |

预期测试文件路径：`tests/capabilities/plugin-management/extension/2026-08-12-pi-mcp-plugin/{api,cli,e2e}/`、`tests/capabilities/plugin-management/mcp-server/2026-08-12-pi-mcp-plugin/{api,e2e}/`（REQ-AGENT-090 归 `tests/capabilities/command-interface/cli/2026-08-12-pi-mcp-plugin/cli/`；REQ-AGENT-091 归 `tests/capabilities/agent-dialogue/conversation-space/2026-08-12-pi-mcp-plugin/{api,e2e}/`）。
