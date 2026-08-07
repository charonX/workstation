# BUILD 进度 — 2026-08-02-ui-copilot

> phase: BUILD（门 1 已签核，2026-08-06）
> 模式：子代理调度（implementer default）
> 里程碑：M1 会话中心骨架（REQ-AGENT-026~030）→ M2 项目空间增强（031~033，spike H3/H4/H5 前置）→ M3 飞书只读（034，随 M1 列表/只读能力部分交付）

## 切片计划

| Slice | 内容 | REQ | 测试文件 | 依赖 |
|---|---|---|---|---|
| 1 | 空间=会话数据层：spaceKey 语法 + title 列 + reset=新行语义 + 会话创建端点 | 027 | sessionSpace.test.js, sessionReset.test.js | — |
| 2 | 会话列表与历史：分组列表（join 项目/孤儿/agent_space_meta）+ 分页历史 | 029 | sessionList.test.js, feishuReadonly.test.js | 1 |
| 3 | 消息发送 + SSE 流式：POST messages（错误映射）+ GET events（SSE 契约） | 028 | sessionMessage.test.js, sessionEvents.test.js | 1 |
| 4 | 内联确认卡桥：UI 空间高危 → 挂起队列 + SSE confirmation-pending + 渲染确认卡 | 030 | uiConfirmation.test.js, assistantConfirm.test.cjs | 2,3 |
| 5 | 双区渲染层：默认路由 /assistant + 会话列表/对话窗 UI + 管理区 nav-notifications + 种子 seam×2 + E2E 全绿 | 026 | assistantNav/Chat/Sessions/Feishu.test.cjs | 1-4 |

## Slice 记录

（各 slice 完成后追加：`Slice N: complete (<base7>..<head7>, tests green, PRD alignment passed)` + refactor 行）

- Slice 1: complete (52171f1..425705d, 业务测试 9/10 绿 + 既有回归全绿；1 红 = 业务测试自身前置断言缺陷，见「已知偏差」) + refactor: 无（本切片改动面小，route 纯函数导出即最终形态）— 2026-08-06
- Slice 2: complete (425705d..9fc8c83, 业务测试 7/7 绿 + 回归 18/19) + refactor: 97429ef（数据层聚合重构 2 文件，重构后 19/19 绿，无回滚）— 2026-08-06
- PRD 对齐 Slice 1+2: ALIGNED（实现零缺失；T-1~T-3 test-gap 候选 + Slice 5 前置 2 项已登记）— 2026-08-06
- Slice 3: complete (97429ef..8edd068, 业务测试 12/12 绿 + 回归 25/26 仅已知 T-1) + refactor: b560d21（SSE 工厂提取，重构后 24/24 绿，无回滚）— 2026-08-06
- PRD 对齐 Slice 3: ALIGNED（错误优先级链/SSE 契约/256KB 单位实证；O-1~O-3 → T-4~T-6 登记）— 2026-08-06
- Slice 4: complete (b560d21..fc9b223, 业务测试 6/6 绿 + 回归全绿) + PRD 对齐: ALIGNED（分流逐字符等价/幂等构造性/SSE 过滤/回投语义/飞书回归 16/16；G-1→T-7；U-1/U-2 归 Slice 5）+ refactor: 无（改动面小，eventBus 发布点即最终形态）— 2026-08-06
- Slice 2: complete (51add70..c7f5acb, 业务测试 7/7 绿 + Slice 1 两套件/builtin-agent sessionStore+sessionRestore 回归全绿（仅已知 sessionSpace 用例 4 fixture 红）+ 单元 seam 自测 5/5 绿后自删) + refactor: 无（分页窗口抽为导出纯函数 paginateMessages 即最终形态，与 Slice 1 投影纯函数同型）— 2026-08-06
- Slice 3: complete (97429ef.., 业务测试 12/12 绿（sessionMessage 7 + sessionEvents 5）+ 回归 25/26（仅已知 sessionSpace 用例 4 fixture 红）+ builtin-agent api 33/33 全绿 + lint 干净) + refactor: 无（SSE 挂起订阅/轮次边界宣告即最终形态，改动面收敛于 routes 单文件 + server.js context 1 行）— 2026-08-06
- Slice 4: complete (8edd068.., 业务测试 6/6 绿（uiConfirmation：3 红 3 绿基线 → 全绿）+ 回归：Slice 1-3 六套件全绿（sessionSpace 仅已知 T-1 fixture 红）+ builtin-agent confirmation/sessionStore/sessionRestore 16/16 绿 + lint 干净；M2 五套件（permissionPolicy/authorizerBridge/skillInjection/toolSurface/workerAssembly）仍红 = seam 未就绪（M2 模块未实现，本切片范围外）) + refactor: 无（eventBus 发布/订阅分流即最终形态——测试 seam 直接 svc.submit 与生产 confirm-request 同构，发布点收敛于 confirmationService.submit 单点）— 2026-08-06
- PRD 对齐 Slice 4: ALIGNED（S5 后端全链：空间前缀分流/裁决 11 字段/裁决 8 回投语义/幂等与解耦回归；「卡片留历史」渲染层语义随 Slice 5 + GET confirmations 全量对齐）— 2026-08-06
- Slice 5: complete (fc9b223.., 业务 E2E 5 套件 21/21 全绿 + M1 API 7 套件 34/35（仅已知 T-1）+ builtin-agent confirmation/sessionStore/sessionRestore 16/16 回归绿 + lint 干净 + vite build 过) + PRD 对齐: ALIGNED（双区壳/S3 流式渲染/S4 列表/030 确认卡渲染/034 只读呈现全链；实现偏差 3 项见「已知偏差」）+ refactor: 无（渲染层组件即最终形态；后端小改收敛于 wiring 单点）— 2026-08-06
- Slice 6: complete (09d014b.., 业务测试 15/15 绿（skillInjection 6 + workerAssembly 5 + toolSurface 4）+ 回归：M1 API 39/39 绿（7 套件）+ builtin-agent conversation-space 33/33 + confirmation 7/7 + lint 干净（新增零告警）+ 单元 seam 自测 3/3 绿后自删) + PRD 对齐: ALIGNED（S6/S7 全链：skillPaths 按空间装配/available_skills 隔离/FS 工具面分级硬边界/cwd 边界 fail-closed；孤儿回落 default 不挂 FS 工具——fail-closed 语义；授权放行链随 Slice 7）+ refactor: 无（装配点收敛于 agentService.buildConfigMessage 单点 + toolAdapter.createSessionToolSurface 单面，即最终形态）— 2026-08-06
- Slice 7: complete (c8b4e20.., 业务测试 14/14 绿（permissionPolicy 8 + authorizerBridge 6）+ 回归：ui-copilot conversation-space API 69/69 全绿（M1 7 套件 + Slice 6 3 套件 + 本切片 2 套件）+ builtin-agent conversation-space 33/33 + confirmation 7/7 + lint 干净 + 单元 seam 自测 3/3 绿后自删) + PRD 对齐: ALIGNED（S8 全链：gotgenes 装配/两级策略文件/授权桥 ask→挂起队列→决议回传/user_bash 同策略/H4 隔离/无 UI 配置面；偏差 4 项见「已知偏差」——forge extraResource 打包 + 未声明依赖 + 顶层 surface 映射形态 + 决议超时兜底）+ refactor: 无（装配点收敛于 worker createSessionEntry 单点 + permissionPolicy/permissionBridge 两 public seam + server.js 接线单点，即最终形态）— 2026-08-07
- Slice 9 (M3): complete（本切片 commit 见 git log；业务测试 7/7 绿（feishuReadonly 2 + sessionList 5）+ 回归 126/126 全绿（ui-copilot API 全量 + builtin-agent channel api 全量 + imRouting 全量）+ E2E assistantFeishu 5/5 绿 + lint 干净 + 单元 seam 自测 5/5 绿 + 生产路径冒烟 1/1 绿（自写自删）) + PRD 对齐: ALIGNED（REQ-AGENT-034 收尾：AC1/AC2/AC4 已绿确认；AC3 生产链路缺口（通道建句柄后 SSE 挂起订阅漏挂）补齐；裁决 10 候选 A 生产写入路径落地——通道侧 chat 名回填 agent_space_meta）+ refactor: 无（写入点收敛于 imRouter recordSpaceMeta 单点 + sessionStore.upsertSpaceMeta 单方法，即最终形态）— 2026-08-07

## PRD → 代码 可追溯性表

（由各 slice 子代理写入）

### Slice 9（REQ-AGENT-034 飞书会话只读收尾——通道侧 chat 名写入）

> 范围（M3 剩余面）：`agent_space_meta(spaceKey, displayName)` 的**通道侧写入**——飞书消息到达时以 chat 名回填侧表（signoff 裁决 10 候选 A 的生产路径；此前仅测试直插造数，生产列表显示名 fallback spaceKey）。
> 关键设计：① **写入点 = imRouter.messageHandler（recordSpaceMeta 单点）**——消息去重后异步 fire-and-forget（不 await：REQ-CHANNEL-002 3 秒回调语义与消息路由不受网络查询影响；内部全量兜底不抛出）；spaceKey = `feishu:<chatId>`（与 agentRouter 会话分发同源）；② **chat 名来源**——入站消息事件（`im.message.receive_v1`）不含 chat_name，经通道会话信息查询 `GET /open-apis/im/v1/chats/:chatId` → `data.name`（adapter.fetchChatName，新增）；**非生产形态 appId（测试 fixture，同 WSClient 判定）→ 直接 null**：避免测试环境对真实飞书开放平台发起无谓请求（imRouting AC6 等走 mock/真网络的回归面由此免扰）；任何失败（网络/权限/无 name）→ null → 跳过写入并记录（列表 fallback spaceKey，裁决 10）；③ **sessionStore.upsertSpaceMeta**——幂等 upsert（`ON CONFLICT(spaceKey) DO UPDATE`：同 chat 重复消息/改名 → 覆盖新值不增行）；SQLite 写失败按 E-SESSION-PERSIST 降级（显示名缺失 → fallback，不阻断路由）；④ **resolveChatName 三级解析**——注入 fetchChatName（测试 seam）→ channelManager.fetchChatName（生产，channelManager 新增 dispatch 透传同 send/reply 形态）→ channelAdapter.fetchChatName；⑤ **AC3 生产链路缺口补齐**——渲染层对任一选中会话（含飞书只读）都开 SSE；UI 先于消息打开 events 连接时订阅进入挂起注册表（pendingSseSubs），此前仅 UI 发送路径（handlePostMessage）建句柄后补挂接，**飞书入站消息路径（imRouter createSession）漏挂 → 新消息 SSE 增量不达 UI**——server.js onSessionCreated 补 `attachPendingSseSubs(spaceKey, svc)`（异步补挂接幂等，无挂起订阅时 no-op）；lastActiveAt 更新由 getOrCreate 既有语义保证（每条消息刷活跃时间）。

| REQ-AGENT-034 验收标准 | 意图（PRD §4 S9/§6.2/§7.1/§8 + signoff 裁决） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. 飞书会话选中 → 历史气泡只读、无输入区、只读标注 | S9 只读视图（右栏历史渲染 + 无输入区 +「飞书会话 · 请到飞书继续对话」标注） | 既有（Slice 2/5：JSONL 投影 + 渲染层 readonly 态） | `.../e2e/assistantFeishu.test.cjs` AC1 | 已绿（本切片回归确认，零改动） |
| 2. `POST .../messages` 到 `feishu:*` → 403 `E-SESSION-READONLY` | 后端兜底（裁决 1/2：只读是空间属性先于 409） | 既有（Slice 1/3：handlePostMessage feishu 分支） | `.../api/feishuReadonly.test.js` 用例 1 | 已绿（本切片回归确认，零改动） |
| 3. 飞书侧新消息到达 → UI 列表 lastActiveAt 更新可见；选中会话 SSE 增量呈现 | F2（列表轮询 lastActiveAt / SSE 增量）+ S9 只读回看 | **本切片补齐**：`src/http/server.js`（onSessionCreated → attachPendingSseSubs 挂接通道建句柄的挂起 SSE 订阅）；lastActiveAt = getOrCreate 既有 | E2E 可见性面（assistantFeishu AC3 既有）+ 本切片生产冒烟（自写自删） | 生产链路缺口补齐（挂起订阅漏挂）；E2E 面已绿 |
| 4. UI 侧不产生任何向飞书通道的发送调用（无消息桥） | PRD §10.2/§12（无消息桥硬约束） | 零新增发送调用（本切片只加写入，通道发送面未动） | `.../api/feishuReadonly.test.js` 用例 2（静态代码审查 + fetch spy 集成断言） | 已绿（本切片回归确认，零改动） |
| （裁决 10 候选 A 生产面）飞书列表显示名 = 通道元数据 chat 名 | 裁决 10：agent_space_meta 侧表；REQ-AGENT-029 标准 5 生产路径 | `src/services/channels/imRouter.js`（recordSpaceMeta 写入点）、`src/services/sessionStore.js`（upsertSpaceMeta）、`src/services/channels/feishuChannelAdapter.js`（fetchChatName）、`src/services/channelManager.js`（fetchChatName 透传）、`src/http/server.js`（sessionStore 注入） | 本切片生产冒烟（自写自删：消息到达 → 落库 → 列表 displayName=真实 chat 名）；`.../api/sessionList.test.js` 用例 5（直插 seam，既有） | 本切片落实（COVERED） |

> 支撑性实现：① **单元 seam 自测 5/5 绿后自删**（upsertSpaceMeta 幂等 upsert/多 key 独立；imRouter 写入/无 store no-op/chat 名缺失跳过/查询抛出不产生未处理 rejection）；② **生产路径冒烟 1/1 绿后自删**——startServer 全栈 + mock 飞书开放平台（token/会话信息/消息发送）+ 生产格式 appId（`cli_`+16hex 过 WSClient 判定闸门）→ simulateReceiveForTests → `[imRouter] spaceMeta 已写入 spaceKey=feishu:oc_s9_prod displayName=冒烟测试群` → `GET /api/agent/sessions` feishu 组 displayName = 真实 chat 名（非 spaceKey fallback）。冒烟测试须以 `--test-force-exit` 运行（mock 域无 WS 升级 → WSClient autoReconnect 定时器常驻事件循环，真实生产连得上不构成问题）。③ **测试顺序坑（登记）**：`startServer` 测试 reset 模式会 `settingsService.resetSettings()` 清空凭据——凭据/域必须在 startServer 之后保存再手动 `channelManager.restart("feishu")`（imRouting AC6 同型顺序，冒烟测试按此实现）。④ **可观测性**——recordSpaceMeta 写入/跳过均有诊断日志（`[imRouter] spaceMeta 已写入/chat 名获取失败…跳过`）；fetchChatName 失败带 code 记录。**偏差：无**——通道发送面零改动（无消息桥保持）；既有 034 相关套件零改动全绿；dev 库 channel_messages 去重行（recordInboundMessage 走默认库）在本切片测试后被清理。

### Slice 6（REQ-AGENT-031 项目空间 SKILL.md 注入 + REQ-AGENT-032 FS/脚本工具面）

> 范围：per-session 项目空间装配——session-config 扩展字段（cwd / skillPaths / permissionProfile，tech-design IPC 契约节）+ worker 按 spaceKey 前缀装配 + FS/脚本工具面（按 permissionProfile 挂载）。
> 关键设计：① **装配点收敛于 agentService.buildConfigMessage 单点**——按 spaceKey 前缀解析：`ui:project:<pid>:` → project（cwd = 项目目录 realpath（裁决 18 归一化）、skillPaths = 项目关联 skills 技能库绝对路径、permissionProfile = "project"）；其余（`ui:copilot:*`/`feishu:*`）→ default（cwd = 现状默认、skillPaths = []、permissionProfile = "default"）。孤儿会话/项目无 localPath → **fail-closed 回落 default**（cwd 无从解析时 FS 工具不得指向非项目目录）；② **项目关联 skills 读取 API = `skillService.listLinkedSkillPaths(projectId)`**——以工作站关联记录（.linked-skills）为真相（link 意图：磁盘链接可能未分发（agent 目录缺失/注册表漂移）或手动删除，记录仍在；与 listProjectSkills 磁盘扫描视图互补），resolveSkillTargetDir 逐条解析为技能库绝对路径（`<技能库>/<slug>/skills/<name>/`），陈旧项（skill 已从库移除）跳过，技能库未配置 → []；③ **worker 按 session-config 装配 per-session DefaultResourceLoader**（H5 已证多 loader 共存隔离）：会话 cwd + additionalSkillPaths（仅非空注入，通用空间零变更）+ createAgentSession 会话 cwd；permissionProfile="project" → 工具面 = CLI + read/write/bash；④ **createSessionToolSurface（toolAdapter public seam）**：default = CLI 基线（createToolSurface 等价对象，一件不多一件不少——工具面分级硬边界，PRD §10.2）；project = CLI + read/write/bash（小写命名，裁决 6）；**cwd 边界判定接口**（realpath 归一化，裁决 18）：cwd 外写/执行 fail-closed 为工具错误 `E-AGENT-BOUNDARY`（无副作用），read 可读 cwd 内文件（标准 3 集成）；授权放行链（cwd 外 ask → approve）随 Slice 7 gotgenes；⑤ **skillAssembly.js（public seam）**：`listAvailableSkills({ skillPaths })` 读取各 skillPath 下 SKILL.md frontmatter → `[{ name, description }]`（等价 PI 渐进披露段输入，E6 缺 name/description 与 E10 不可读跳过语义与 skillService 一致）。

| REQ-AGENT-031 验收标准 | 意图（PRD §4 S6/§10.1） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. `ui:project:<pid>:*` 会话 skillPaths = 项目关联 skills 技能库绝对路径列表；通用/飞书 = 空数组 | S6 项目空间对话自动注入该项目关联 Skills 的 SKILL.md（技能库绝对路径，H2 生效方式） | `src/services/agentService.js`（resolveSpaceAssembly/buildConfigMessage）、`src/services/skillService.js`（listLinkedSkillPaths 新增） | `.../api/skillInjection.test.js` 用例 1/2/3 | COVERED |
| 2. worker 按 skillPaths 装配 additionalSkillPaths（fake worker 捕获 session-config 断言） | S6 装配（H5：多 loader 共存已证） | `src/agent/worker.js`（createSessionEntry：per-session DefaultResourceLoader 会话 cwd + additionalSkillPaths 非空注入） | `.../api/skillInjection.test.js` 用例 1（fake capture）+ `.../api/workerAssembly.test.js` | COVERED |
| 3. 项目空间 available_skills 段含项目 skills 的 name/description（渐进披露）；agent 可经 read 读到 SKILL.md 全文 | S6 prompt 级能力注入（同 Claude Code 加载方式，H2） | `src/agent/skillAssembly.js`（listAvailableSkills public seam——worker 内 PI 生成段 fake worker 观测不到，等价 seam 断言输入） | `.../api/skillInjection.test.js` 用例 4 | COVERED |
| 4. 通用空间 available_skills 不含任何项目 skills（空间隔离） | S6/PRD §10.2 空间隔离；H5 隔离已证 | `src/agent/skillAssembly.js`（listAvailableSkills([]) → []）+ `src/agent/worker.js`（noSkills: true 默认发现隔离，零注入） | `.../api/skillInjection.test.js` 用例 5 | COVERED |
| 5. 项目关联变更后新建会话生效（已建会话热更新不断言——降级决策） | S6 标准 5 降级：变更后新会话为准 | `src/services/skillService.js`（listLinkedSkillPaths 每次实时读关联记录） | `.../api/skillInjection.test.js` 用例 6 | COVERED |

| REQ-AGENT-032 验收标准 | 意图（PRD §4 S7/§10.2） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. `permissionProfile="project"` 会话挂载 read/write/bash 且 cwd = 项目目录绝对路径（fake worker 断言） | S7 项目目录内读文件/跑脚本工具；IPC 契约 cwd/permissionProfile | `src/services/agentService.js`（resolveSpaceAssembly）、`src/agent/worker.js`（permissionProfile → 工具面 profile） | `.../api/workerAssembly.test.js` 用例 1 | COVERED |
| 2. `permissionProfile="default"`（通用/飞书）不出现 FS/bash 工具（分级硬边界；fake worker 断言工具清单） | S7 工具面按空间分级硬边界（通用空间维持 CLI-only，PRD §10.2/§13） | `src/agent/toolAdapter.js`（createSessionToolSurface：default = CLI 基线等价）、`src/services/agentService.js`（default 装配下发） | `.../api/workerAssembly.test.js` 用例 2/3 + `.../api/toolSurface.test.js` 用例 1（显式数组比较） | COVERED |
| 3. 项目空间 agent 可在 cwd 内读文件（read 返回项目文件内容） | S7 读文件工具（S6+S7 操作流：读类直接放行） | `src/agent/toolAdapter.js`（executeFsTool read：cwd 内 → 内容；cwd 外 → 边界拦截） | `.../api/workerAssembly.test.js` 用例 5（集成）+ `.../api/toolSurface.test.js` 用例 2 | COVERED |
| 4. cwd 外路径写/执行 → 权限层拦截（与 REQ-AGENT-033 附录 A 联动断言） | PRD §8 FS 工具越界（目录外写/执行 → 权限层拒绝，agent 转述）+ 附录 A cwd 外 → ask（无授权 fail-closed） | `src/agent/toolAdapter.js`（cwd 边界判定接口：resolveInsideCwd realpath 归一化 / commandViolatesCwd 绝对路径抽取；拦截 = E-AGENT-BOUNDARY 工具错误，无副作用） | `.../api/toolSurface.test.js` 用例 3/4 | COVERED |

> 支撑性实现：① **resolveSpaceAssembly fail-closed**——孤儿会话/项目无 localPath → 回落 default（permissionProfile="default" + 空 skillPaths），FS 工具不指向非项目目录；② **组合面事件桥**——project 面 onEvent 统一转发 CLI 与 FS 工具事件（worker tool_execution_error 转发不因组合面丢失，CLI 侧 confirm-request 错误路径回归绿）；③ **可观测性**（tech-design 可观测性节）——worker session-config 完成日志含 profile/skills 计数（spaceKey→cwd/skills/profile 装配留痕）；④ 单元 seam 自测 3/3 绿后自删（边界判定：cwd 外读/写/bash 拦截 + symlink 逃逸 realpath 拦截 + cwd 内写建目录；listAvailableSkills frontmatter 变体/E6/E10 跳过；listLinkedSkillPaths 记录驱动/陈旧项跳过/未配置 → []）。**偏差：无**——default 面 = createToolSurface 等价（M1 行为零变化：M1 API 39/39 + builtin-agent conversation-space 33/33 + confirmation 7/7 回归全绿）；gotgenes 装配（permissionProfile 字段已下发，工厂注入）随 Slice 7（REQ-AGENT-033）。

### Slice 7（REQ-AGENT-033 高危权限策略：gotgenes + 授权桥）

> 范围（M2 收官）：permissionProfile="project" 会话装配 gotgenes 工厂（每会话独立 loader ⇒ 独立实例，H4/H5 隔离前提）+ 授权桥（ask → 既有确认挂起队列 → SSE/飞书分流）+ 策略文件两级（全局应用资源 agent-policy/ 只读默认 + 项目目录约定文件可选）。
> 关键设计：① **装配锚点 = PI_CODING_AGENT_DIR**（spike H3 唯一定位锚点）：主进程 spawn worker 注入 = agentHome（不设落真实 ~/.pi/agent，污染用户主目录）；全局策略由 worker 启动时自 `agent-policy/pi-permission-config.json`（应用资源）**幂等部署**到 `<agentHome>/extensions/pi-permission-system/config.json`（gotgenes `getAgentDir()` 读 env，spike 实证与 createAgentSession agentDir option 无关）；② **注入点 = DefaultResourceLoader extensionFactories**（保留 noExtensions: true——内联工厂不受其影响，文件系统发现保持关闭）；gotgenes 工厂经 jiti 加载包 `src/index.ts` 默认导出（包 exports "." 指向 service.ts 不含工厂；pi.extensions 元数据指明入口），service.ts 的 `getPermissionsService()` 经 Symbol.for 槽位跨模块隔离可用；③ **授权桥**：第二内联扩展 `permissions:ready` 时 `registerAuthorizer("opc-bridge")`（ready 保证服务已发布；注册本身不授权——全局策略 `authorizerChain: ["opc-bridge"]` 显式 opt-in）；ask → IPC `permission-ask` → 主进程桥（confirmationService.submit 建挂起行，riskLevel="permission" + notifyOnSettle=false——决议只回传 allow/deny，操作由 worker 侧 gate 放行后经工具调用路径执行，避免主进程代执行双重执行/重复回投）→ 人工 approve/reject（既有端点）→ `permission-decision` 回传；**排除面（external_directory/path/未知）桥直接 defer** → 终端 LocalUserAuthorizer → uiContext.select（bindExtensions mode rpc 注入，hasUI=注入即 true）→ 同一确认队列（裁决 14：cwd 外放行无法经桥自动批准，gotgenes 有界委托固有权衡）；④ **策略文件两级**：全局 = 附录 A 逐项表达（读类 allow/写类 ask/bash 破坏性 ask 其余 allow/CLI 高危 ask 查询直跑 allow/`"*"` ask 兜底/external_directory ask）；项目 = `<cwd>/.pi/extensions/pi-permission-system/config.json`（用户手写可选，项目覆盖全局）；⑤ **permissionPolicy.js 评估层（public seam）**：附录 A 分类（内建默认）+ 项目文件显式规则命中优先（> 全局 > 分类）——H4 隔离按会话上下文独立加载（globalThis 单槽不参与本层评估）；CLI 分类复用 toolAdapter TOOL_DEFS riskLevel 单一真源（裁决 15：query/dispatch → allow）；⑥ **单一闸门**：gotgenes 装配成功时工具面自身 confirm 拦截停用（CLI 高危由策略闸门拦截，避免双重 ask）+ cwd 边界硬拦截停用（boundaryAuthorized——gotgenes external_directory ask → 人工批准后放行；未装配/装配失败回退保持既有 fail-closed，fail-safe）；⑦ **user_bash（! bash）**：worker 扩展订阅 `user_bash` 事件 → IPC（tool="user_bash"）→ 主进程 `bridge.evaluateUserBash`（permissionPolicy 评估器分类：allow 直放 / ask 挂起行）→ deny 回错误 BashResult 阻止执行（标准 4，不经 tool_call 路径）；⑧ **部署/打包偏差**：forge.config.js 无 extraResource——agent-policy/ 未进 asar（生产打包需补 extraResource + 资源路径解析，超出本切片范围，见「已知偏差」）。

| REQ-AGENT-033 验收标准 | 意图（PRD §4 S8/§6.2/§8 + signoff 裁决 13/14/15） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. 全局策略文件随应用分发（应用资源，只读默认）；项目目录约定策略文件存在时加载 | S8 策略文件驱动（全局一份随应用分发 + 项目目录一份，不按会话编程）；H3 config 发现 | `agent-policy/pi-permission-config.json`（应用资源）、`src/agent/worker.js`（deployGlobalPolicy 幂等部署 + GOTGENES_GLOBAL_CONFIG_PATH）、`src/services/permissionPolicy.js`（GLOBAL_POLICY_PATH + PROJECT_POLICY_REL_PATH + loadPermissionRules 两级） | `.../api/permissionPolicy.test.js` 用例 1（全局文件存在/非空/路径含 agent-policy） | COVERED |
| 2. 附录 A 分类逐项断言：读类 → allow；写/编辑/删除 → ask；bash 破坏性 → ask；bash 非破坏 → allow；CLI 高危 → ask | 附录 A 清单（读/写/bash 破坏性/CLI 高危）；裁决 13（无 deny 全 ask 人工）/15（task list/run allow） | `src/services/permissionPolicy.js`（createPolicyEvaluator：READ_TOOLS/WRITE_TOOLS/BASH_DESTRUCTIVE_PATTERNS + getToolDefinition riskLevel 复用 + 文件规则命中） | `.../api/permissionPolicy.test.js` 用例 2/3/4/5/6/7/8 | COVERED |
| 3. ask → 授权桥创建挂起确认行（含操作描述 + 来源 spaceKey）→ approve → allow 且操作执行；reject → deny 且 agent 收到可转述工具错误 | S8 ask 桥接既有确认挂起队列（tech-design F3 授权桥契约：输出 allow/deny，决议人工）；裁决 11（confirmation-pending 字段） | `src/services/permissionBridge.js`（createPermissionBridge：authorize submit + 轮询决议）、`src/services/confirmationService.js`（notifyOnSettle 附加标记，既有语义零变化）、`src/services/agentService.js`（permission-ask/permission-decision IPC）、`src/http/server.js`（onPermissionAsk 接线）、`src/agent/worker.js`（requestPermissionDecision + 桥扩展 + uiContext） | `.../api/authorizerBridge.test.js` 用例 1/2（approve → allow + 执行；reject → deny + reason，不执行） | COVERED |
| 4. 用户 `!` bash（user_bash 事件）走同一策略评估与拦截（不经 tool_call） | tech-design 安全节「! bash 走 user_bash 事件需同策略拦截（research 标记）」 | `src/services/permissionBridge.js`（evaluateUserBash：createPolicyEvaluator 分类 allow 直放/ask 挂起行）、`src/services/permissionPolicy.js`（bash 分类复用）、`src/agent/worker.js`（user_bash 事件 → IPC） | `.../api/authorizerBridge.test.js` 用例 3/4（破坏性 → ask + 挂起行；非破坏 → allow 无挂起行） | COVERED |
| 5. 双会话并发 ask 策略隔离（H4）：A 空间项目策略不影响 B 空间评估结果 | H4 单进程多会话隔离（globalThis 单槽不串扰）；每会话独立 loader/实例 | `src/services/permissionPolicy.js`（createPolicyEvaluator 每实例独立加载项目/全局文件；globalThis 不参与） | `.../api/authorizerBridge.test.js` 用例 5（A 项目策略 cat * → ask；B 不受影响 allow） | COVERED |
| 6. 无权限 UI 配置面：设置页无权限相关 tab/区（E2E 断言） | S8 不做 UI 配置（PRD §12 范围外） | 本切片无 UI 改动（策略 = 分发资源 + 项目目录手写文件） | e2e 套件（assistantNav/Settings，Slice 5 已绿覆盖） | COVERED（e2e 既有断言） |

> 支撑性实现：① **全局策略文件逐条对应附录 A**——`"*": "ask"` 兜底 + read/ls/grep/find allow + write/edit/create/delete ask + bash 面 `"*": "allow"` + 破坏性模式 ask（rm/rmdir/sudo/kill/pkill/chmod/chown/dd/mkfs/mv/git push --force/npm|pnpm -g/yarn global/`>` 重定向/curl|sh 管道）+ 全量 CLI 工具面规则（confirm → ask；query/dispatch → allow）+ `path: {"*": "allow"}`（跨切面闸门显式放开，external_directory 保持 ask——most-restrictive-wins 不放松边界）+ `authorizerChain: ["opc-bridge"]`；② **授权桥行与既有确认行同表共存**（riskLevel "permission" 标记；ui:* 空间 SSE confirmation-pending 分流复用 confirmationService.submit，飞书卡片路径零变化）；③ **H4 运行时形态**：每会话独立 gotgenes 实例（extensionFactories 每 loader 一份）+ 每实例 AuthorizerRegistry（permissions:ready 时槽位 = 本实例刚发布服务，注册落本实例）+ 桥扩展 sessionKey 闭包（ask 路由本空间）；④ **gotgenes 固有 multi-gate**（spike H4.4）：一次工具调用可触发多 surface 闸门（如 cwd 外写 = write 面 + external_directory 面）→ 多次 ask（逐面确认），属 gotgenes 设计语义非缺陷；⑤ 单元 seam 自测 3/3 绿后自删（评估器：CLI riskLevel 映射/文件规则 last-match 覆盖/双形态 config 解析；桥：行描述含操作 + 决议轮询；确认服务：notifyOnSettle 不注入）。**偏差**：① forge.config.js 无 extraResource——agent-policy/ 未入 asar 打包（生产打包需补 extraResource 与资源路径解析，dev/test 路径正常）；② jiti/gotgenes 为未声明依赖（npm i --no-save，spike 同法）——生产打包依赖 asar 内传递依赖可达（jiti 为 pi-coding-agent 依赖；gotgenes 已装 node_modules，vite.worker.config.js 已 external jiti）；③ gotgenes 运行时对「顶层 surface 映射」形态项目文件按 schema 拒绝（H4 签核测试 fixture 形态；评估层兼容双形态，用户项目文件请按统一配置形态 `{ "permission": {...} }` 书写）；④ 10 分钟决议超时兜底（挂起行保留可稍后处理——超时后行仅作记录）。


### Slice 5（REQ-AGENT-026 双区 + 028/029/030/034 渲染层 E2E 面）

> 范围：双区渲染层（默认落地 /assistant + 管理区旧壳 + nav-notifications + back-to-chat）+ 会话区 UI（会话列表/对话窗/流式/确认卡/只读/未配置态）+ 种子 seam ×2 + E2E 全绿。
> 关键设计：① 默认落地 = 启动 URL 直接带 `#/assistant`（main.js loadURL/loadFile hash），不引入 "/" 重定向路由——管理区左导仪表盘指向 "/"（Dashboard）保持可达（REQ-026 AC3 意图）；② SSE 客户端 = EventSource 封装，断线重连后先 GET messages 全量对齐再续流（F2），发送前等待「连接建立 + 对齐完成」（AC5：EventSource 重试退避 ~3s，断线窗口内发送会丢流式事件）；③ 流式渲染 = delta 累积缓冲 + rAF 节流 flush（FAUX 高速流下主线程不饱和）+ 流式光标 settle（短流可感知）；④ U-1：GET /api/agent/confirmations 扩展返回 `{ pending, confirmations }` 全量 + status，页面重载后已处理卡按 status 重建；⑤ 确认回调回投的会话句柄缺失（种子/稍后处理场景）→ server 接线按空间建句柄 + 挂接挂起 SSE 订阅（assistantConfirm「重启后仍可确认」）；⑥ 应用重启保端口（registry 既有端口优先复用，EADDRINUSE 回退随机）——E2E 重启场景 baseUrl 稳定。

| E2E 用例（测试文件） | REQ / 原型元素 | 实现文件 | 状态 |
|---|---|---|---|
| assistantNav AC1~AC5（双区壳/⚙进出/返回对话/直接访问旧路由） | REQ-AGENT-026 AC1~5 + ux/assistant.html screen-chat/screen-admin | `src/renderer/App.jsx`（双区路由）、`pages/Assistant.jsx`、`components/layout/Sidebar.jsx`（nav-notifications + back-to-chat-button）、`main.js`（启动 #/assistant） | COVERED |
| assistantChat AC4（发送→用户气泡即时→流式增量→完成恢复发送） | REQ-AGENT-028 标准 4 + 原型 messages/composer | `pages/Assistant.jsx`（乐观用户气泡 + SSE text_start/delta/end + rAF 节流）、`components/assistant/Composer.jsx`（流式中置灰） | COVERED |
| assistantChat AC5（SSE 断线重连→重连后全量对齐再续流） | REQ-AGENT-028 标准 5 / tech-design F2 | `api/agentSessions.js`（subscribeSessionEvents）、`pages/Assistant.jsx`（onOpen 对齐 + 发送前等待对齐） | COVERED |
| assistantSessions（点会话历史/active 态/项目展开收起/行内＋/新对话空态//reset 新会话） | REQ-AGENT-029 标准 6 + REQ-AGENT-027 标准 4 + 原型 session-item/nav-project/empty-state | `components/assistant/SessionList.jsx`、`pages/Assistant.jsx`（handleReset/新对话归属/auto-select 最近活跃） | COVERED |
| assistantConfirm AC2~AC4（确认卡渲染/确认/拒绝/稍后处理/已处理态） | REQ-AGENT-030 标准 2/3/4 + 原型 confirm-card | `components/assistant/MessageList.jsx`（data-confirm-card/data-state）、`pages/Assistant.jsx`（approve/reject → 既有端点）、`confirmationService.listAll()` + `agentConfirmations.js` GET 全量（U-1）、`server.js` notifyResult 接线（句柄缺失建句柄 + 挂接订阅）、`main.js`/`preload.js` `__seedAgentConfirmations` | COVERED |
| assistantFeishu（只读视图/无输入区/新消息可见/孤儿 deleted 态/无权限 tab/未配置引导） | REQ-AGENT-034 标准 1/3 + REQ-AGENT-029 标准 2 + REQ-AGENT-033 标准 6 + REQ-AGENT-028 标准 3（UI 面）+ §8 错误态 | `components/assistant/Composer.jsx`（composer-readonly/readonly-reason）、`SessionList.jsx`（.deleted 划线 + 无＋）、`pages/Assistant.jsx`（spaceOf 空间语义/未配置引导态/去配置）、`main.js`/`preload.js` `__seedAgentSessions` | COVERED |

> 支撑性实现（渲染层 E2E 全绿所需的后端小改，均收敛于既有接线点）：① 重启保端口（`server.js` preferredPort + EADDRINUSE 回退随机、`main.js` 读 registry 既有端口）——assistantConfirm AC3 重启场景 baseUrl 稳定；② 确认回调回投句柄保障（`server.js` notifyResult：会话句柄缺失 → buildSessionConfig 同源建句柄 + attachPendingSseSubs 无条件挂接）——种子/稍后处理场景结果流式回投可达；③ `agentService` worker 入口回退（Electron 源码布局下 agent-worker.js bundle 不存在 → 回退 src/agent/worker.js，vite.worker.config.js「dev/测试直接跑源码入口」意图落地）——E2E FAUX 流式可跑；④ `SessionList`/`ChatView` 等组件 testid 契约逐一对齐五套 E2E 文件头「实现约定」块。

| REQ-AGENT-027 验收标准 | 意图（PRD §2/§7.1/§10.1） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. `POST /api/agent/sessions {spaceKind:"general"}` → 200 `{spaceKey}` 匹配 `^ui:copilot:.+`，建行 + JSONL 占位 | S2 空间=会话 + F4 新对话归属（顶部新对话 = 通用空间） | `src/http/routes/agentSessions.js`（handleCreateSession/createUiRow）、`src/services/sessionStore.js`（getOrCreate 既有） | `.../api/sessionSpace.test.js` 用例 1 | COVERED |
| 2. `{spaceKind:"project", projectId}` → `^ui:project:<pid>:.+`；无效 projectId → 400 `E-SESSION-CREATE` 且不建行 | S2 空间 key 语法 `ui:project:<pid>:<sid>` + 项目行内＋ | `src/http/routes/agentSessions.js`（projectExists 校验 projects 表 + handleCreateSession） | `.../api/sessionSpace.test.js` 用例 2/3 | COVERED |
| 3. 首条用户消息后 `title` = 截断 ≤40 字（slice(0,40) 无省略号）；后续消息不更新 | S1 会话标题 = 首条消息截断（拍板默认值）+ F1.4 title 首次写入 | `src/http/routes/agentSessions.js`（handlePostMessage 202 受理后 setTitleIfEmpty）、`src/services/sessionStore.js`（setTitleIfEmpty：WHERE title IS NULL 原子首条即定） | `.../api/sessionSpace.test.js` 用例 4 | PARTIAL（实现经 e2e 手工验证绿：截断/不更新/无省略号均符合；签核测试自身前置断言缺陷 `firstText.length > 40` 与 fixture 36 字矛盾，需 test-author 修正 fixture，见「已知偏差」） |
| 4. `POST .../reset`（UI 空间）→ 新 spaceKey 同分组新行；旧行保留、历史可读、可继续发送 | S2 UI 空间 /reset = 新建会话并切换（F4，不触发世代机制） | `src/http/routes/agentSessions.js`（handleReset/newUiSpaceKeyFor/uiGroupPrefixFor）、`src/services/sessionStore.js`（getOrCreate 新行） | `.../api/sessionReset.test.js` 用例 1/2/3 | COVERED |
| 5. `feishu:*` /reset 世代制不变（既有语义回归） | 7.1 飞书空间 /reset 维持世代制；signoff 裁决 9：feishu HTTP reset → 403 E-SESSION-READONLY | `src/services/sessionStore.js`（reset 既有，未动）、`src/http/routes/agentSessions.js`（handleReset feishu 分支 403） | `.../api/sessionReset.test.js` 用例 4/5 | COVERED |
| 6. 表迁移：既有 `feishu:*` 行无损，`title` 列 NULL 兼容 | 持久化复用 agent_sessions 表，不引入新存储（§10.1） | `src/db.js`（initSchema title 列 + migrateSchema ALTER TABLE 补列） | `.../api/sessionSpace.test.js` 用例 5 | COVERED |

> 支撑性实现（本切片内为测试 seam 所需的最小形态，完整契约随 REQ-AGENT-028/029）：`POST/GET .../messages`（202 `{messageId}`、JSONL 投影 `{messages:[...]}`，signoff 裁决 3/12）、`GET /api/agent/sessions`（最小分组 general/projects/feishu，裁决 17 字段集）；路由接线 `src/http/server.js`（resource="agent" subPath[0]="sessions" → handleAgentSessions，惰性工厂 `_opcSessionStoreFactory`/`_opcAgentServiceFactory`）。

### Slice 2（REQ-AGENT-029 分组会话列表与历史回看）

| REQ-AGENT-029 验收标准 | 意图（PRD §4 S4/§6.2/§7.1） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. `GET /api/agent/sessions` → `{ general, projects: [{projectId, projectName, orphan, sessions}], feishu }`；项目名 join `projects` 表 | S4 分组列表（左栏通用/项目/飞书分组）+ F5 按 key 前缀分组、join projects 取名 | `src/http/routes/agentSessions.js`（listSessions 完整分组 + loadProjectNameMap 项目名 map）、`src/services/sessionStore.js`（list 既有） | `.../api/sessionList.test.js` 用例 1 | COVERED |
| 2. projectId 不存在 → `orphan: true`；前端划线且只读（发送 409 由 REQ-AGENT-028 兜底） | 7.1 孤儿会话（项目删除保留可回看）+ CONTEXT.md 孤儿会话；signoff 裁决 16（孤儿 projectName = null 不回填 pid） | `src/http/routes/agentSessions.js`（listSessions orphan 判定：projectNames.has(pid) 缺失 → orphan:true + projectName:null） | `.../api/sessionList.test.js` 用例 2（划线呈现/发送 409 属前端 Slice 5 与 REQ-028） | COVERED |
| 3. 各组内会话按 `lastActiveAt` 倒序 | F5 列表按 lastActiveAt 倒序（恢复最近活跃会话） | `src/http/routes/agentSessions.js`（listSessions byActiveDesc 各组排序，既有） | `.../api/sessionList.test.js` 用例 3 | COVERED |
| 4. `GET .../messages?limit&before` 按时间序返回；分页参数生效；默认 limit=100 | tech-design 性能节 JSONL 历史投影分页；signoff 裁决 5（默认最新 limit 条、数组时间升序、before = messageId） | `src/http/routes/agentSessions.js`（handleGetMessages + parsePaginationQuery + 导出纯函数 paginateMessages） | `.../api/sessionList.test.js` 用例 4 | COVERED |
| 5. 飞书会话出现在 `feishu` 组，显示名取通道元数据 chat 名 | S9 飞书会话进列表（M3 列表能力随本切片交付）；signoff 裁决 10 候选 A（agent_space_meta 侧表，表/行缺失 fallback spaceKey 或空） | `src/db.js`（initSchema/migrateSchema/resetDb 建 agent_space_meta 表）、`src/services/sessionStore.js`（listSpaceMeta 只读方法）、`src/http/routes/agentSessions.js`（listSessions displayName join） | `.../api/sessionList.test.js` 用例 5（通道侧写入在 M3，测试经 better-sqlite3 直插） | COVERED |
| 6. E2E：点会话 → 右栏完整历史；左栏 active 态；项目分组展开/收起 | S1 左栏交互 | 前端 Slice 5（assistantSessions.test.cjs） | 本切片不涉及 | DEFERRED（Slice 5） |

> 支撑性实现：`feishu:*` 发送 → 403 `E-SESSION-READONLY` 与「无消息桥」为 Slice 1 既有行为，本切片经 `feishuReadonly.test.js` 全链路回归确认（含静态代码审查断言：routes 模块无 sendCard/channelManager/cardRenderer 引用）。孤儿/只读发送拦截的 409/403 完整错误映射随 REQ-AGENT-028（Slice 3）。

### Slice 3（REQ-AGENT-028 对话收发与 SSE 流式渲染）

| REQ-AGENT-028 验收标准 | 意图（PRD §4 S3/§7/§8/§10.1 + signoff 裁决） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. `POST .../messages {text}` 合法 → 202 `{messageId}`；trim 后空 → 400；超 enforceSizeLimit 上限 → 400 | S3 消息发送（F1 输入校验）+ PRD §7 唯一输入面验证规则 + 裁决 12（300KB 明确越界 → 400，精确边界不额外断言） | `src/http/routes/agentSessions.js`（handlePostMessage + messageTextError；MAX_MESSAGE_CHARS = 256KB 字符，与 enforceSizeLimit 同单位） | `.../api/sessionMessage.test.js` 用例 1/2/3 | COVERED |
| 2. `GET .../events`（SSE）推送 session-event 序列（FAUX 下 text_start/text_delta×N/text_end 有序 + 拼接一致）；含 confirmation-pending 事件类型 | S3 流式渲染（F2）+ D4 流式 = SSE + 裁决 11（子序列严格有序 + 拼接一致；允许辅助事件交错） | `src/http/routes/agentSessions.js`（handleGetEvents：会话句柄 session-event 原样转发 + 轮次边界 text_start 宣告 + 15s 心跳注释帧）、`src/http/server.js`（context 增 peekAgentService 同步窥探） | `.../api/sessionEvents.test.js` 用例 2（confirmation-pending 结构断言属 REQ-AGENT-030 uiConfirmation，本切片接通「事件流经 SSE 转发」通道） | COVERED |
| 3. 错误映射：agent 未配置 → 409 E-AGENT-CONFIG；孤儿 → 409 E-SESSION-ORPHAN；feishu:* → 403 E-SESSION-READONLY；spaceKey 不存在 → 404 | PRD §8 错误状态表 + 裁决 1/2（403 只读先于 409）+ PRD §7.1/CONTEXT.md 孤儿会话（项目已删除不可发送） | `src/http/routes/agentSessions.js`（handlePostMessage 校验顺序：400 → 404 → 403 → 孤儿 409 → 未配置 409；isOrphanSpace 复用 projectIdOf/projectExists） | `.../api/sessionMessage.test.js` 用例 4/5/6/7 | COVERED |
| 4. E2E：用户气泡即时出现；agent 气泡流式增量；完成后按钮恢复；流式中按钮置灰 | S3 操作流 + 7.1 双击防护 | 前端 Slice 5（assistantChat.test.cjs） | 本切片不涉及 | DEFERRED（Slice 5） |
| 5. SSE 断线重连：重连后先 `GET .../messages` 全量对齐再续流（E2E 断言历史完整） | F2 断线语义（SSE 只推增量，不做事件回溯） | 端点侧语义本切片交付：断线不崩、后续消息仍受理、重连可再建（handleGetEvents detach 清理 + 挂起订阅再挂接）；渲染层全量对齐在 Slice 5 | `.../api/sessionEvents.test.js` 用例 4/5（端点侧）；E2E 在 `.../e2e/assistantChat.test.cjs` | PARTIAL（端点侧绿；渲染层部分属 Slice 5） |
| 6. 单事件 >256KB 截断契约沿用（既有回归不断言新行为，跑通即可） | 裁决 12 + enforceSizeLimit 既有回归（agentDialogue「单条 IPC 消息 ≤ 256KB」） | `src/services/agentService.js` enforceSizeLimit（既有，未动）；SSE 层不二次截断（非文本事件如 confirmation-pending 无 content/delta 载体，二次截断会丢字段） | `.../api/sessionEvents.test.js` 用例 3 | COVERED |

> 支撑性实现：① **300KB 单位确认**（Slice 5 前置 UNCERTAIN 项之一落地）：enforceSizeLimit 按 `JSON.stringify(event).length` 与 256KB 比较——单位 = 字符（String.length / UTF-16 code units），既有回归同单位断言；输入上限统一为 256KB 字符（PRD §7「长度上限沿用 enforceSizeLimit」），300KB 明确越界 → 400。Slice 1-2 占位上限 300KB（`>` 判断）会让恰 300KB 输入放行（sessionMessage 超限用例当时红 + 87s 拖尾），本切片修正。② **text_start 来源**：worker 未映射 PI turn_start/turn_end（worker 仅产 text_delta/text_end），轮次边界由 SSE 层宣告（imRouter stream_start 同型先例）——每轮首个文本事件前补发 text_start，text_end 后重置。③ **SSE 连接先于首条消息打开**（用例 2/3/4/5 均如此）：挂起订阅注册表 pendingSseSubs，handlePostMessage 在 createSession 后补挂接；peekAgentService 为同步窥探（未创建 → null），打开 events 连接不启动 agent 子进程（ADR-009 保持）。

### Slice 4（REQ-AGENT-030 内联确认卡桥——后端部分）

> 范围：M1 确认桥形态 = **命令保险层分类直桥**（tech-design 里程碑切分：授权桥雏形，不含 gotgenes）。后端 = UI 空间高危 → 挂起行 + SSE confirmation-pending + approve/reject 既有端点复用 + 结果回投 agent 消息。渲染层确认卡 UI 属 Slice 5（assistantConfirm.test.cjs）。
> 关键设计：**确认卡渲染目标按 spaceKey 前缀分流**（tech-design 模块关系图 / F3 / CONTEXT.md 授权桥——一套队列、按空间前缀分流渲染）——`ui:*` 空间新建挂起行 → eventBus `confirmation-pending` 发布（confirmationService submit 内，**不依赖特定入队路径**：worker confirm-request 与测试直桥 submit 同构）→ SSE 路由按空间订阅过滤转发（裁决 11 字段 confirmId/operation/description）；`feishu:*` → 既有 sendCard 路径全链不动。approve/reject 回投走既有语义（裁决 8）：approve → 执行结果经 notify-result 注入（FAUX 回声含「执行结果已就绪」注入提示词）；reject → 不执行 + 回投「操作已取消」（confirmationService 既有注入）。挂起队列 = SQLite 真相（agent_confirmations），暂不处理稍后仍有效、重复回调幂等——既有语义回归（本套件 3 例设计使然绿）。

| REQ-AGENT-030 验收标准 | 意图（PRD §4 S5/§6.2/§8 + signoff 裁决） | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|---|
| 1. CLI 高危（既有命令保险层分类）在 UI 空间触发 → 挂起行创建 + SSE confirmation-pending（含确认 id、操作描述） | S5 内联高危确认卡（通用空间 CLI 工具面天然含删除/配置变更高危，挂起后 UI 必须能确认）+ tech-design F3.1 + 裁决 11（confirmation-pending 字段 = confirmId/operation/description） | `src/services/confirmationService.js`（submit：ui:* 空间分支 publishPending → eventBus 发布；isUiSpaceKey/buildPendingDescription 纯函数）、`src/http/routes/agentSessions.js`（createSseSubscription：subscribe confirmation-pending 按 spaceKey 过滤转发 + detach 摘除） | `.../api/uiConfirmation.test.js` 用例 1 | COVERED |
| 2. 点确认 → 调既有端点 → 执行结果以 agent 消息流式呈现；点拒绝 → agent 告知已取消 | PRD §6 S5 操作流（确认 → 操作执行结果以 agent 消息呈现；拒绝 → 中止告知）+ tech-design F3.2/3.3 + 裁决 8（approve 回投执行结果语义 / reject 回投「操作已取消」confirmationService 既有注入） | 既有端点 `src/http/routes/agentConfirmations.js` + `src/http/server.js`（approve → executeToolCommand C2 同模块执行 + notifyResult → agentService → worker notify-result 回投；reject 不执行）——本切片零改动（既有全链接线复用），确认服务语义未动 | `.../api/uiConfirmation.test.js` 用例 2/3（FAUX 回声断言「执行结果已就绪」/「操作已取消」） | COVERED |
| 3. 暂不处理：卡片留历史、稍后点击仍有效（确认与执行解耦，挂起队列 = SQLite 真相） | PRD §6.2 S5 分支（稍后处理 → 卡片留历史可后点）+ tech-design 授权桥契约幂等性 | 既有 `src/services/confirmationService.js`（agent_confirmations SQLite 持久化 + 幂等认领，未动语义） | `.../api/uiConfirmation.test.js` 用例 4（队列级；「卡片保留在历史中」渲染层由 E2E assistantConfirm.test.cjs 覆盖） | COVERED |
| 4. 已处理卡片置灰「已处理」；重复回调幂等（既有语义回归） | PRD §8（确认回调过期/重复 → 置灰「已处理」）+ REQ-AGENT-016 标准 4 既有幂等 | 既有 `src/services/confirmationService.js`（claimPending 非 pending 认领失败 → 返回当前状态不执行，未动）；「置灰」渲染层 Slice 5 | `.../api/uiConfirmation.test.js` 用例 5 | COVERED |
| 5. 飞书空间确认卡片路径回归：同一挂起队列，飞书渲染与回调不变 | S5 飞书卡片路径完全不变（一套队列一张卡；渲染目标按 spaceKey 前缀分流）+ tech-design F3.4 | `src/services/confirmationService.js`（submit 非 ui:* 空间走既有 sendCard 分支，零行为变化） | `.../api/uiConfirmation.test.js` 用例 6（跨空间共存/互不干扰）+ builtin-agent `confirmation.test.js` 全套 7/7 回归 | COVERED |

> 支撑性实现：① **空间前缀分流接线**——confirmationService 新增依赖仅 `eventBus`（服务侧发布先例：taskService execution 事件）；`ui:*` 空间跳过 sendCard（避免误向飞书通道发卡，chatchatId 语义不属于 UI 空间）；feishuReadonly 静态审查（routes 无 sendCard/channelManager/cardRenderer）继续通过。② **SSE 通道扩展**——confirmation-pending 经 eventBus 直达 SSE 订阅（不经 session 句柄），与 handle session-event 通道互不干扰（非文本事件不参与轮次边界宣告）；SSE 只推增量（发布时连接不在 → 丢失，渲染层以 GET /api/agent/confirmations 全量对齐——「卡片留历史」数据源）。③ **生产直桥路径全链复用**：worker 工具面 confirm 级 → IPC confirm-request（sessionKey = ui 空间 key）→ agentService onConfirmRequest → server.js getConfirmationService().submit → 发布 + 入队——本切片无 server.js/worker/agentService 改动（Slice 8 既有接线即 M1 直桥入队点）。④ 单元测试 /tdd 自写自删（3 例：ui:* 发布字段/feishu 不发布/重复 submit 不重复发布，红→绿→删）。


## 已知偏差

（实现与 HTML 原型/契约的偏差显式记录）

- **Slice 1 单红测试 = 业务测试自身缺陷（非实现缺陷）**：`sessionSpace.test.js` 用例 4 前置断言 `assert.ok(firstText.length > 40)` 与 fixture「请帮我分析一下这个项目最近三次执行失败的根本原因并给出具体的改进建议清单」实际长度 36 矛盾（该 fixture 与断言均出自签核 commit c88f72c，工作树未改）。实现侧已按契约意图实现并经手工 e2e 验证：>40 字消息 → title = slice(0,40) 无省略号、第二条消息不更新。修复归属 /bug（test-gap 分类，test-author 修正 fixture 或调前置断言）——实现者按契约不得改业务测试，故留红。
- **Slice 5 会话区文案 = 中文直写（未走 i18n en-US 直译）**：五套 E2E 断言中文文案且不 PATCH language（默认 en-US 下断言「通用」「新对话」「飞书会话 · 请到飞书继续对话」「项目已删除」等）——会话区组件文案按中文原型直写（testid/文案为已签核契约）；管理区新增元素（back-to-chat）走 i18n 双语文案。en-US 下会话区译文观感入 REFLECT（照 builtin-agent 签核裁决 2 惯例；test-plan REFLECT 备注「en-US 译文观感」在会话区为留白项）。
- **Slice 5 composer 发送后不清空输入**：原型发送后清空输入；E2E 契约「流式完成后发送按钮恢复可用」要求发送文本保留（按钮可用性 = 文本非空 ∧ 非流式）——实现保留文本，重复提交由「流式中置灰 + 内核串行队列」兜底。
- **既有 E2E 初始落地断言（T-8，非实现缺陷）**：默认落地切 /assistant（REQ-AGENT-026 AC1 已签核）后，settingsTabs/topbar/themeLanguage/onboarding/dashboard/notificationCenter/flowEditor 等既有套件在启动态点击管理区左导/顶栏的用例全部红（nav-settings 等不在会话区左导）。tech-design 风险表已预警（「默认路由切换影响既有 E2E → 套件大面积红；仅初始落地断言需适配，Settings 三套件已有同型适配先例」）；适配属测试侧（[test] commit，同 95c2e0a 先例）。本切片已实测 settingsTabs 红因 = 启动落地（页面快照 = 会话区），非管理区壳改动（nav-notifications/back-to-chat 经 assistantNav AC2/AC3 验证在管理区内正常）。
- 列表端点 `{general, projects, feishu}` 为最小分组形态：项目名 join/孤儿标记/agent_space_meta/按 lastActiveAt 倒序细节随 REQ-AGENT-029（Slice 2）完整化（本切片内仅承担惰性迁移触发，迁移用例只断言 200）。
- **Slice 7 forge 资源打包未配置（REQ-AGENT-033 标准 1 的打包面）**：forge.config.js 无 extraResource——`agent-policy/` 未进 asar 打包；dev/test 路径正常（worker 按 cwd/import.meta.url 双探针定位应用资源）。生产打包需在 forge.config.js 加 `packagerConfig.extraResource: ["agent-policy/"]` 并接入资源路径解析（asar 内 app 资源定位），超出本切片范围，登记。
- **Slice 7 jiti / @gotgenes/pi-permission-system 为未声明依赖**：`npm i --no-save` 装入（spike 同法，未改 package.json/lock）——jiti 为 pi-coding-agent 传递依赖（vite.worker.config.js 已 external，运行期从 node_modules/asar 加载）；gotgenes 直接依赖其 src/*.ts 经 jiti 加载。正式化依赖声明（package.json dependencies）随发布流水线决策。
- **Slice 7 gotgenes 运行时对「顶层 surface 映射」形态项目策略文件按 schema 拒绝（strictObject）**：authorizerBridge H4 签核测试的项目策略 fixture 为顶层 `{ bash: {...} }` 形态（评估层兼容双形态：`permission` 包装 或 顶层映射）；gotgenes 运行时仅接受统一配置形态 `{ "permission": {...} }`——用户手写项目策略请按统一形态（与全局文件同构），H4 fixture 形态仅评估 seam 契约。
- **Slice 7 决议超时兜底**：授权桥决议等待 10 分钟超时 → deny（agent 收到可转述工具错误）；挂起行保留（可稍后处理，超时后行仅作记录，不再驱动决议回传）。与既有 CLI confirm「卡片留历史可后点」语义的差异：gotgenes ask 的工具调用在超时后已中止，稍后批准仅翻转行状态。

## 待 /bug 项（test-gap 候选，PRD 对齐子代理 2026-08-06 增补）

| # | 缺陷 | 建议 |
|---|---|---|
| T-1 | sessionSpace 用例 4 fixture 36 字 < 前置断言 40（已知） | test-author 加长 fixture ≥41 字 |
| T-2 | sessionList 用例 2 孤儿 projectName 弱断言（`null || string`），无法捕获裁决 16 回归 | 收紧为 `=== null` |
| T-3 | sessionReset 无 `ui:project:*` 组 reset 用例（仅 general 覆盖） | 补一条同分组前缀断言（低危） |
| T-4 | 错误优先级无判别性测试（feishu 403 / 孤儿 409 用例均已配 agent，E-AGENT-CONFIG 提前也全绿）——裁决 2 未被捕获（Slice 3 对齐 O-1） | 补两条：feishu+未配置→403；孤儿+未配置→409 E-SESSION-ORPHAN |
| T-5 | SSE 直接挂接路径（连接打开时会话已存在）无测试（仅挂起路径覆盖）（O-2） | 补一条 attach(existing) 用例（低危） |
| T-6 | `GET events` 对不存在 spaceKey 404 无测试（O-3） | 补一条（极低危） |
> O-4 信息项：用例 3 字节断言 vs enforceSizeLimit 字符口径，CJK fixture 时注意（当前 ASCII 恒绿，不动）
| T-7 | UI 空间「worker confirm 级工具 → IPC confirm-request → submit」生产全链无端到端用例（Slice 4 对齐 G-1；直桥 submit seam 覆盖，链路其余为已验收接线） | M2 workerAssembly 顺带补一条，或登记 |
> Slice 4 对齐 UNCERTAIN（Slice 5 前置）：U-1 `GET /api/agent/confirmations` 仅返回 {pending}，页面重载后已处理卡无从重建——Slice 5 决策：GET 扩展返回全量+status（倾向）；U-2 approve/reject 后无 SSE 状态事件，多端一致靠 GET 全量对齐（与 U-1 同源）
| T-8 | 既有 E2E（settingsTabs/topbar/themeLanguage/onboarding/dashboard/notificationCenter/flowEditor/skillLibrary/agentTypes/settingsChannel/versionDisplay 等 ~20 套件）启动态点击管理区导航的用例在默认落地 /assistant 后全红（tech-design 风险表已预警；已实测红因 = 启动落地，非管理区壳改动） | 测试侧适配：启动后先经 ⚙ 进管理区再走原断言（同 95c2e0a「三签名套件 tab 导航适配」先例），或显式 goto 旧路由 |

## Slice 5 前置确认项（PRD 对齐子代理 UNCERTAIN）

- 孤儿组前端标签来源：API 返回 projectName=null（裁决 16），UX 原型孤儿行显示划线项目名——前端需定显示映射（「项目已删除」占位 vs 会话标题推断），Slice 5 前确认
- ~~300KB 上限单位：实现以字符计（307200 chars），Slice 3 接 enforceSizeLimit 时确认统一（字节/字符）~~ → **已确认（Slice 3）**：enforceSizeLimit 按 `JSON.stringify(event).length`（字符）计，输入上限统一为 256KB 字符，300KB 明确越界 → 400；见 Slice 3 可追溯性表支撑性实现①
