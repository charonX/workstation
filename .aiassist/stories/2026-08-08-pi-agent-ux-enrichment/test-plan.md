# 测试计划 — 2026-08-08-pi-agent-ux-enrichment

> 阶段：TEST（骨架已生成，断言待签）
> 对应：`requirements.md` v1（REQ-AGENT-047~055）
> REQ-VERSION：`v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b`

## 总览

| REQ | 稳定块 | seam 类型 | 测试文件 | capability/entity | 状态 |
|---|---|---|---|---|---|
| REQ-AGENT-047 | B1 GFM+转义 | 浏览器 E2E | `conversation-space/.../e2e/richRender.test.cjs` | agent-dialogue/conversation-space | 骨架（2 用例） |
| REQ-AGENT-048 | B2 代码高亮 | 浏览器 E2E | `.../e2e/richRender.test.cjs` | 同上 | 骨架（并入） |
| REQ-AGENT-049 | B3 Mermaid | 浏览器 E2E | `.../e2e/richRender.test.cjs` | 同上 | 骨架（并入） |
| REQ-AGENT-050 | B4 KaTeX | 浏览器 E2E | `.../e2e/richRender.test.cjs` | 同上 | 骨架（并入） |
| REQ-AGENT-051 | B5 图片 | 浏览器 E2E | `.../e2e/richRender.test.cjs` | 同上 | 骨架（并入） |
| REQ-AGENT-052 | B6 工具折叠块 | 浏览器 E2E | `.../e2e/toolCallBlock.test.cjs` | 同上 | 骨架（3 用例） |
| REQ-AGENT-053 | B7 流式实时 | 浏览器 E2E | `.../e2e/streamingRender.test.cjs` | 同上 | 骨架（2 用例） |
| REQ-AGENT-054 | B8 历史+主题 | 浏览器 E2E | `.../e2e/richRender.test.cjs` | 同上 | 骨架（并入） |
| REQ-AGENT-055 | I-1 worker 转发扩展 | 集成（fake worker） | `.../api/workerToolEventExt.test.js` | 同上 | 骨架（4 用例） |

## 关键 seam 依赖（实现后接线）

1. **startElectronApp 夹具**（`tests/e2e/fixtures/electronApp.cjs`）：`{ extraEnv }` 支持环境变量注入（OPC_FAUX_TOOL_SEQUENCE 透传——toolCallBlock 需要；**实现时确认夹具签名**）。
2. **OPC_FAUX_TOOL_SEQUENCE 注入缝**（上 story Slice 6 产物）：驱动 FAUX 下真实工具调用（write/bash confirm 级）→ tool_execution_* 事件。toolCallBlock/workerToolEventExt 依赖。
3. **markdown seed**：composer 输入 → FAUX 回声落 JSONL → 重开会话历史对齐渲染（richRender 依赖；无需新 API）。
4. **图片 fixture**：startElectronApp 的 userDataDir 内创建 1x1 PNG（richRender 图片用例）。
5. **locator 约定**（实现时与 renderer 一致）：`[data-tool-block]`/`[data-tool-header]`/`[data-tool-body]`/`[data-tool-error-badge]`（原型 tool-block 语义；消息既有 `[data-message-role]`/`[data-testid='composer-input']` 沿用）。

## HTML 原型映射（assistant-rich.html）

- 渲染元素（h1/h2/table/ul/blockquote/pre>code/svg/katex/img）→ richRender 断言
- 工具块三态（收起/展开/错误）→ toolCallBlock 断言
- 流式中间态（stream-raw/stream-cursor）→ streamingRender 最终态断言
- 主题切换（theme-toggle → data-theme）→ richRender 主题用例

## REFLECT 人工验收项（含理由）

| 项 | 自动化 | 人工（REFLECT） | 理由 |
|---|---|---|---|
| 配色观感（高亮五色/暗色 Mermaid/错误标红醒目度） | 结构断言（类存在） | 视觉评审 | 颜色/间距为纯审美（原型已确认，实现对齐后人工验收） |
| M1 长消息性能 | E2E 流式稳定断言 | 实际长对话体验 | 移动块，QA 实测消化 |
| M2 自动检测质量 | 高亮类存在断言 | 复杂语言边缘 case 目测 | 移动块，实现时验证 |

## 运行方式（ABI 备忘）

- E2E：`npm run test:e2e`（先 `rebuild:electron`）——richRender/toolCallBlock/streamingRender + 全仓 E2E 回归。
- 集成：`npm run test:unit`（先 `rebuild:node`）——workerToolEventExt + 全仓单测回归（662 水位不退）。
- 混跑顺序错 → E-DB-UNWRITABLE（环境 ABI 问题，非产品缺陷）。

## 待签断言清单（门 1 前）

- richRender：MD_FIXTURE 内容（GFM 全元素 + XSS 语料 + mermaid + 公式 + 图片路径）；渲染元素断言（h1/table/strong/katex/svg/img）；XSS 断言（script 0 元素）；主题切换断言
- toolCallBlock：注入缝工具序列（write 成功/失败例）；折叠块三态 locator；error 终态断言
- streamingRender：STREAM_FIXTURE 内容；完成态断言（无 `**` 残留）；高速流可操作断言
- workerToolEventExt：注入缝驱动；input/output/isError 字段断言；text_delta 字段集不变断言
