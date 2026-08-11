# 断言签核记录 — 2026-08-11-pi-agent-modes

> 门 1：ASSERTION-SIGNOFF
> 日期：2026-08-12
> 方式：人授权直接开发（用户「完事如果没有特别需要确认的，就直接进入开发环境就好了」——授权跳过关卡逐项确认，按 0.19 高风险断言签核流程）

## 签核范围

- **REQ**：REQ-AGENT-070~077（8 条，requirements v1，hash `3e5839b75173b7b59c41c0da8085ff7f09755fdb443f22c43ebfa310d7813add`）
- **测试**：3 文件（api 2 + e2e 1），`tests/capabilities/agent-dialogue/conversation-space/2026-08-11-pi-agent-modes/`
- **实现契约**：`prd.md` §10 技术方案（模块/数据流/接口契约/测试 seams）+ `test-plan.md`
- **移动块**：M1（classifyAllShell）/M2（autoJudgeModel 独立项）/M3（熔断阈值）/M4（工具栏其他配置项）留 PRD

## 高风险断言（0.19 流程：人确认高风险项，其余 AI 自检）

### A. 人确认（高风险项）——人授权直接开发（默认接受，实现偏离时走 /bug）

| # | 断言 | 裁决 |
|---|---|---|
| 1 | **初衷**：权限两极缺中间态，三档模式（strict/standard/auto）是核心痛点解法 | 人授权接受 |
| 2 | **跨模块契约**：auto-judge link 注册 `auto-judge` 到 authorizerChain，链序 `["auto-judge", "opc-bridge"]`；模式服务 getMode/setMode/lastMode；工具栏 locator 契约 | 人授权接受 |
| 3 | **expected 值**：三档语义（strict 全确认/standard 按配置/auto 模型代问）、lastMode 首次 auto、熔断阈值 5 可注入、deny 带 reason | 人授权接受 |
| 4 | **安全边界**：external_directory/path 系统级从严（envelope 强制——模型 allow 降级 defer、deny 有效）；模式不改持久配置 | 人授权接受 |

### B. AI 自检（供人抽查，实现时自查）

- [x] 每个 REQ 至少一个自动化测试（8/8：070 集成+API / 071 E2E / 072 API+E2E / 073 link / 074 envelope 实证 / 075 熔断 / 076 日志 / 077 文件不变）
- [x] 测试头部含 REQ-TRACE/REQ-VERSION/CAPABILITY-TRACE/ENTITY-TRACE/TEST-AUTHOR/ASSERTIONS-SIGNED（3 文件）
- [x] capability/entity 与能力地图一致（agent-dialogue / conversation-space）
- [x] 无快照当判定依据；无 `assert.ok(true)` 占位（全部写实断言或 seam 未就绪即失败）
- [x] 边界/错误 case 覆盖（provider 缺失 defer / 非法 lastMode / envelope excluded / 熔断阈值注入）
- [x] UX 原型结构全部映射自动化测试（无纯审美跳过项，观感留 REFLECT）

## 签核 TODO 统计

- modeService 7 处 / autoJudgeLink 9 处 / E2E 7 处 = 23 处——实现后由 implementer 父代理逐项确认（断言均写实，TODO 为预期值来源标注）

## 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`（0.19 无此产物，缺口已归类）
- [x] PRD §6-8 已覆盖（F1-F4 + 6.2 分支 + §7 输入验证 + §8 E1-E4）
- [x] 每个 REQ-ID 都有对应测试（8/8）
- [x] 跨模块 REQ 显式接口契约（§10.4 + 测试 seam 清单）
- [x] signoff.md 已创建，随 `[test] assertion-signoff` commit 提交
