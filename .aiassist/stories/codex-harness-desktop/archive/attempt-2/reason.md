# Archive Reason: codex-harness-desktop attempt-2

## 归档时间

2026-07-08

## 根因诊断

错误假设活在**技术方案层**。

 attempt-2 的技术方案（`tech-design.md`）只规划了后端服务、HTTP API 与 CLI seams，未把 **Electron + React 前端实现** 纳入必须交付的 seams 范围，也未为前端观感/交互（feel-signoff）制定可执行的验收策略。结果 BUILD 阶段实现了后端与 CLI，但缺少前端界面，无法通过 `/signoff --stage=feel`。

- 初衷（痛点）仍然成立：用户需要可定时触发、可远程观察的自动化工作流桌面应用。
- 不是 REQ 漏写：REQ-FLOW-003~005、REQ-I18N-001 已明确要求前端行为。
- 不是测试契约错：feel-signoff 本就应该依据 HTML UX 原型验收产品界面。
- 是技术方案在“前端如何落地”上留白，导致实现阶段默认跳过了前端。

## 推翻理由

1. 技术方案必须显式回答：Electron 主进程/渲染进程结构、React 路由、TanStack Query、与后端 HTTP API 的集成方式、主题切换的 DOM/Settings 联动。
2. 必须决定前端验收策略：继续走 feel-signoff（无浏览器 E2E）还是引入最小可执行的渲染层测试 seams。
3. 现有后端/CLI 代码（commit `158da4d`）不是错误，是有效的，可在新 attempt 中复用；但需要补充前端层。

## 下次该避开什么

- 技术方案不能只列“技术栈”，必须列出每个 layer 的交付物与验收方式。
- 对于 Electron + React 项目，要把“渲染进程最小壳”作为 BUILD 前置条件，而不是 feel-signoff 前的可选步骤。
- feel-signoff 之前，至少要有可启动的 renderer 入口和关键页面骨架。

## 相关 commit

- `[build] implement HTTP API, CLI, and FlowEngine seams for codex-harness-desktop` (`158da4d`)
- `[bootstrap] advance workflow-state to QA after BUILD green` (`5ef3f2a`)

## 保留产物

- 后端服务层（`src/services/*`、`src/db.js`、`src/flowEngine/*`）
- HTTP API（`src/http/*`）
- CLI（`src/cli/*`）
- 已签核业务测试（`tests/capabilities/**/*.test.js`）

## 重做方向

1. 重写/扩展 `tech-design.md`，加入 Electron 主进程 + React 渲染进程详细设计。
2. 同步更新 PRD/REQ（如需新增/调整前端相关 REQ）。
3. 决定前端测试策略（feel-signoff only，或补充渲染层 public API 测试）。
4. 重新进入 CRYSTALLIZE → TEST → ASSERTION-SIGNOFF → BUILD。
5. BUILD 阶段先搭 Electron + React 最小壳，再补页面组件。
