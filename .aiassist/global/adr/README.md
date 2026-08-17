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
| ADR-016 | UI 多会话采用"空间 = 会话"模型，/reset 等效新开会话 | 已接受 | 2026-08-06 | 待结晶（2026-08-02-ui-copilot S2） |
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
