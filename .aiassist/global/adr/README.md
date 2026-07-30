# 架构决策记录（ADR）

> 本目录由 `/tech-design` 和 `/reflect` 维护。
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
