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
