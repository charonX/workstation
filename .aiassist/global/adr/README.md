# 架构决策记录（ADR）

> 本目录由 `/to-prd`、`/tech-design` 和 `/reflect` 维护。
> 每个文件记录一个影响较大的架构/设计决策。
> 仅当决策满足以下条件时才写 ADR：难逆转、不说明会令人困惑、有真实取舍。

---

## 索引

| 编号 | 标题 | 状态 | 日期 | 相关 REQ |
|------|------|------|------|----------|
| ADR-001 | CLI 与前端通过本地 HTTP API 共享服务层 | 已接受 | 2026-07-08 | REQ-001 ~ REQ-025 |
| ADR-002 | 前端验收采用 Playwright Electron E2E + feel-signoff | 已接受 | 2026-07-09 | REQ-FLOW-002~005、REQ-SKILL-002、REQ-I18N-001~002、REQ-DASH-001、REQ-WORKSPACE-003~006、REQ-SKILL-003 |
| ADR-003 | Skill Repo 作为一级实体 | 已修订（ADR-011） | 2026-07-16 | REQ-SKILL-001~004 |
| ADR-004 | Project 与 Skill 通过文件系统软连接关联 | 已修订（ADR-011） | 2026-07-16 | REQ-WORKSPACE-006、REQ-SKILL-004 |
| ADR-005 | Claude Agent 节点采用 Claude Agent SDK 并复用本机凭证 | 已接受 | 2026-07-17 | REQ-FLOW-020、REQ-FLOW-026、REQ-FLOW-028 |
| ADR-006 | 单 server 运行时与统一本地存储 | 已接受 | 2026-07-19 | 待结晶（2026-07-19-media-production-line） |
| ADR-007 | 飞书通道采用官方 SDK WSClient 与独立 channelManager | 已接受 | 2026-07-19 | REQ-CHANNEL-001 ~ REQ-CHANNEL-005 |
| ADR-008 | 子流程内联同步执行 + services 注入模式 | 已接受 | 2026-07-23 | REQ-FLOW-032 ~ REQ-FLOW-040、REQ-FLOW-046 |
| ADR-009 | 模块惰性初始化，禁止顶层读 env/磁盘 | 已接受 | 2026-07-24 | BUG-007/009 教训（2026-07-19-media-production-line） |
| ADR-010 | 统一节点输出模型与节点类型注册表 | 已接受 | 2026-07-27 | REQ-FLOW-042、REQ-FLOW-043、REQ-FLOW-047 |
| ADR-011 | Agent skill 分发由 workstation 自持，第三方库仅作 registry 数据源 | 已接受 | 2026-07-29 | 待结晶（2026-07-29-multi-agent-skills） |
| ADR-012 | macOS 分发走未签名 + 公开 GitHub Release + 手动重装 + 轻量检查更新 | 已接受 | 2026-08-02 | REQ-DIST-001 ~ REQ-DIST-004 |
| ADR-013 | 内置 agent 运行时采用 PI，与 flow 节点 Claude Agent SDK 双运行时并存 | 已接受 | 2026-08-02 | REQ-AGENT-003、REQ-AGENT-006 |
| ADR-014 | 内置 agent 运行时采用"SDK 独立子进程"形态（偏离官方进程内推荐，换取崩溃隔离） | 已接受 | 2026-08-03 | REQ-AGENT-005、REQ-AGENT-009 |
| ADR-015 | 跨进程看门狗的心跳控制面必须带外处理，任何入站消息均计为存活证据 | 已接受 | 2026-08-05 | REQ-AGENT-005（BUG-008） |
| ADR-016 | UI 多会话采用"空间 = 会话"模型，/reset 等效新开会话 | 已修订（ADR-037，飞书条款） | 2026-08-06 | 待结晶（2026-08-02-ui-copilot S2） |
| ADR-017 | agent 权限层采用 gotgenes 权限扩展 + 授权桥，策略文件全局/项目两级 | 已接受 | 2026-08-06 | 待结晶（2026-08-02-ui-copilot S8） |
| ADR-018 | 双区信息架构——会话区默认落地 + 管理区旧壳原样保留 | 已接受 | 2026-08-06 | 待结晶（2026-08-02-ui-copilot S1） |
| ADR-019 | 维持单进程——PI agent 运行时暂不拆分（会话隔离缓建，附重估触发条件） | 已接受 | 2026-08-08 | REQ-AGENT-045（2026-08-07-pi-agent-consolidation） |
| ADR-020 | 权限出厂策略单一真源化——代码规则表为真源，部署 JSON 为生成产物（修订 ADR-017「文件=契约」） | 已接受 | 2026-08-08 | REQ-AGENT-041（2026-08-07-pi-agent-consolidation） |
| ADR-021 | 对话渲染安全边界——LLM 输出 HTML 全转义（零 raw 白名单）+ 图片主进程白名单 + blob URL 访问机制 + mermaid securityLevel strict | 已接受 | 2026-08-10 | REQ-AGENT-047、REQ-AGENT-049、REQ-AGENT-051（2026-08-08-pi-agent-ux-enrichment） |
| ADR-022 | 项目级权限配置 = 字段级覆盖语义——项目文件为最小覆盖集（未定义继承全局），取消覆盖=删除字段，保存即生效（gotgenes mtime 实证） | 已接受 | 2026-08-10 | REQ-AGENT-041 语义延伸（2026-08-10-pi-permission-config-ui） |
| ADR-023 | agent 权限模式化——authorizerChain 模型 link + 模式门控（三档 strict/standard/auto；envelope 强制从严；模式不改 .pi） | 已接受 | 2026-08-12 | REQ-AGENT-070~077（2026-08-11-pi-agent-modes） |
| ADR-024 | PI 插件机制全量复用官方包管理——worker 从封闭装配转官方发现链路 | 已接受 | 2026-08-12 | REQ-AGENT-078~083、089（2026-08-16 验收） |
| ADR-025 | MCP 桥内置内联 + DB 快照注入 + broker 权限接线 | 已接受 | 2026-08-12 | REQ-AGENT-084~088（2026-08-16 验收） |
| ADR-026 | 会话级模型配置持久化 + provider-change 热更新——agent_sessions 加 provider/model 列（SQLite 为真相），切换走最小集热更新 IPC 不换代（历史保留），水合/懒恢复按行重装 | 已接受 | 2026-08-13 | 待结晶（2026-08-12-conversation-toolbar-ext B3/B4） |
| ADR-027 | 供应商探针协议族感知派生——pi-ai 目录 model.api + baseUrl 单一真源（providerProbe 同源 test-connection/动态拉取）；google key-in-URL 人签边界；无 baseUrl → E-TEST-UNSUPPORTED 不阻塞保存 | 已接受 | 2026-08-14 | REQ-AGENT-103、REQ-AGENT-104（2026-08-12-conversation-toolbar-ext BUG-001/002） |
| ADR-028 | 执行运行器 ExecutionRunner——一次执行的唯一入口：submit/runOnce/reset 三接口；描述符参数化（debug 全链路零落库）；reset 有界等待单一失效机制；schedule 直调去 eventBus 一跳；子执行走 runOnce（日志归子行、事件补父子字段）；test seam 迁入 runner。补充：写入原语全收/队列接口私有化/skip 反应归 schedule 路径/子写点 generation 守卫；v2 撤除 250ms 观察窗（generation 快照提前到 submit 捕获，signoff v2 重签） | 已接受 | 2026-08-16 | —（improve-codebase-architecture 独立触发；2026-08-16-deepen-execution-runner 实现验收 2026-08-17） |
| ADR-029 | 回合事件管线模块化 turnEventPipeline——工厂模块 + 会话状态注册表统一清理（reset 清队列）+ 计数 beginTurn 清时机 + 256KB 截断单真源取强（agentService 3 调用点 import）；worker 保持 spawn-only 零导出 | 已接受 | 2026-08-17 | —（improve-codebase-architecture 候选 #2；2026-08-16-deepen-turn-event-pipeline） |
| ADR-030 | 会话领域收编 sessionDomain（纯函数）+ sessionSseRegistry（per-instance 工厂实例三方法，模块级全局 Map 消亡）——server.js 依赖方向回正、路由瘦成纯转发仅 re-export projectMessagesFromJsonl、方向回正静态 seam 可验、行为字节级不变 | 已接受 | 2026-08-17 | —（improve-codebase-architecture 候选 #4；2026-08-16-deepen-session-domain） |
| ADR-031 | 技能 job 可观测性：waitForJob 默认无超时（timeoutMs=0 轮询至真实终态，消除 30s 假失败）+ spawn 流式进度 log（--progress）+ 真卡死由可见进度+手动关闭兜底 | 已接受 | 2026-08-18 | BUG-001（2026-08-18-skill-update-diagnostics；REQ-SKILL-023） |
| ADR-032 | 权限裁决器 PermissionAdjudicator 领域模块化——Per-Instance 工厂 + 内存 Promise 注册表即时唤醒（消除 20ms 轮询与全局 Map）+ 纯函数 Fail-Closed + 四大安全不变量结构化强制（唯一执行者零 execute / 单一评估 / 单一询问） | 已接受 | 2026-08-18 | —（improve-codebase-architecture 候选 #3；2026-08-16-deepen-permission-adjudication） |
| ADR-033 | DB 连接 per-path 缓存——getDb 单槽改 Map<path,Database>（同句柄可缓存/多路径并存/透明替换 55 调用零改动）；closeDb() 关全部+定向；resetDb = 该路径 full reset（固定列表+动态清遗留表）；:memory: 缓存但 closeDb 清 | 已接受 | 2026-08-18 | —（improve-codebase-architecture 候选 #5；2026-08-16-deepen-db-per-path-cache） |
| ADR-034 | 通道发送能力统一收拢与单一在线检查属主——废除 `_channelManager` 伪变量与动态 import；收拢到 `services.channelSender`（对齐 ADR-008）；在线检查在 `channelManager.dispatchToAdapter` 统一收口（消除离线静默穿透）；单一测试接缝 `setTestChannelSender` + 边界适配（消除运行时 duck-typing 嗅探与无用空接缝） | 已接受 | 2026-08-19 | REQ-FLOW-054~057（improve-codebase-architecture 候选 #6；2026-08-16-deepen-channel-sender-seam） |
| ADR-035 | 独立服务容器 ServiceContainer 与 Server 纯传输化——8 个核心服务惰性单例工厂、跨服务接线（imRouter/eventBus 订阅）、日志清理定时调度与统一生命周期管理收归独立容器 `src/services/serviceContainer.js`；`src/http/server.js` 瘦身为纯 HTTP 传输与路由分发（≤250 行），挂载 `server.services` 作为唯一正规 DI seam，并挂载已弃用的 `_opcXxx` 兼容代理层平滑过渡既有测试 | 已接受 | 2026-08-19 | REQ-WORKSPACE-017~019（improve-codebase-architecture 候选 #7；2026-08-16-deepen-service-container） |
| ADR-036 | 统一 HTTP 响应助手与生产静默 Mock 清除——彻底删除 `agentAdapter.js`，缺 provider 显式报 `E-AGENT-NO-PROVIDER` 错误（杜绝伪造假成功）；提炼 `src/http/responders.js` 统一 5 路由响应助手与错误映射（解耦 `plugins->mcp` 反向依赖，透传 `existing/invalidAgents/issues`）；Cron 描述助手归位至 `schedulerService`；删除 `flowService` 废弃 UI 助手 | 已接受 | 2026-08-19 | REQ-FLOW-058~059、REQ-WORKSPACE-020、REQ-SCHEDULE-011（improve-codebase-architecture 候选 #8；2026-08-16-deepen-shallow-residue-sweep） |
| ADR-037 | 飞书 /reset 从「单行世代制」改为「归档 + 新行」——归档键 `feishu:<chatId>:gen<N>` 保留历史可只读回看；空世代不归档；世代编号延续防碰撞；写面守护扩至全 feishu 前缀（含活跃行 mode/provider）；修订 ADR-016 飞书条款 | 已接受 | 2026-08-19 | REQ-AGENT-123~126（2026-08-19-feishu-reset-history-archive） |
| ADR-038 | 会话轨迹采用全量自足 Sidecar JSONL——`<safeKey>[.N].traj.jsonl` 与主 JSONL 并存世代对齐；行内全量自足不 join PI 内部格式；单调 seq 键 + API 层 `traj_<seq>` 投影；256KB/载体截断同标 shrinkToolCarrier；单点同源双写（落盘行=trajectory-record SSE 行）保 live/重放单一记录模型 | 已接受 | 2026-08-23 | —（2026-08-22-tool-call-review） |
| ADR-039 | 内置浏览器面板——WebContentsView 主进程托管 + 人机共享单实例 + 渲染进程持布局真相；协议白名单双闸；persist:browser 分区；共驾不加锁、停止控制手动导航即解除；本期砍 click/type（CDP 方案留档）。2026-08-30 增补决策 9-11：截图落盘 browser-shots 跨会话续号（POST）、Cookie 导出端点访问控制（Host/Origin 校验 + 无 ACAO）、headless fetch 直连风险显式接受；source 由通道决定（HTTP=agent / IPC=user） | 已接受 | 2026-08-26 | REQ-BROWSER-001~006（2026-08-24-embedded-browser） |
