# 断言签核记录 — 2026-08-08-pi-agent-ux-enrichment

> 门 1：ASSERTION-SIGNOFF
> 日期：2026-08-09
> 方式：人签核（用户「签核，有 todo 项吗？跟我一一确认下」——6 项 TODO 逐一确认全部接受）

## 签核范围

- **REQ**：REQ-AGENT-047~055（9 条，requirements v1，hash `dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b`）
- **测试**：4 文件 16 用例（e2e 3 文件 12 例 + api 1 文件 4 例），`tests/capabilities/agent-dialogue/conversation-space/2026-08-08-pi-agent-ux-enrichment/`
- **实现契约**：`tech-design.md` v0.2（接口 1-3、数据流 1-6、review-tech 全修复）+ `test-plan.md`（seam 依赖清单）
- **移动块**：M1（长消息性能）/ M2（自动检测质量）留 PRD，实现/QA 时验证消化

## 断言裁决（人逐项确认）

| # | 裁决项 | 签核值 | 备注 |
|---|---|---|---|
| 1 | MD_FIXTURE 内容 | GFM 全元素（h1/h2/ul/table/blockquote）+ ```js + ```mermaid + $/$$ 公式 + 图片引用 + XSS 语料 + 裸路径 | 人确认接受 |
| 2 | STREAM_FIXTURE | 未闭合 `**` 用例：完成态断言无 `**` 残留 + strong/code 渲染 | 人确认接受 |
| 3 | 工具块 locator 约定 | `[data-tool-block]` / `[data-tool-header]` / `[data-tool-body]` / `[data-tool-error-badge]`（原型三态语义，实现时 renderer 对齐） | 人确认接受 |
| 4 | 实现后接线/强化 | ① startElectronApp({extraEnv}) 夹具签名实现时接线；② 图片越权占位断言实现后强化；③ interrupted 事件 E2E 弱化为 api 层覆盖 | 人确认接受 |
| 5 | 16 用例断言 | 渲染元素/XSS/事件字段全部写实断言（吸取上 story 占位教训） | 人确认接受 |
| 6 | 依赖引入 | react-markdown / remark-gfm / remark-math / rehype-katex / katex / mermaid / highlight.js 进 package.json（[build] 范畴） | 人确认接受 |

## 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`
- [x] PRD 第 6-8 节已覆盖（F1-F6 + §6.2 分支 + §7 N/A 理由 + §8 E1-E6）
- [x] 每个 REQ-ID 都有对应测试（9/9：047-051/054 → richRender、052 → toolCallBlock、053 → streamingRender、055 → workerToolEventExt）
- [x] 每个测试文件有 REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE / TEST-AUTHOR / ASSERTIONS-SIGNED
- [x] capability/entity 与 business-capabilities.md 一致（agent-dialogue / conversation-space）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（断言全部写实；2 处"实现后接线"标注为明示约定，非占位断言）
- [x] 预期值来源 = 人逐项确认（上表 6 项）
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖（XSS 语料 / 越权图片 / 语法回退 / error 终态序贯 / 高速流不冻结 / 历史无 tool 元素）
- [x] signoff.md 已创建，随 `[test] assertion-signoff` commit 提交
