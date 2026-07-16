# 归档原因 — attempt-1

## 根因诊断

- **错误假设活在技术方案层**。
- 初衷（把需要人类判断的环节交给 agent/codex 节点，流程化步骤交给应用稳定执行）仍然成立，因此不归档 UX/问题陈述，只归档承诺层产物与实现代码。

## 具体问题

当前实现仅覆盖了后端服务层 seams（Project/Flow/Task/Skill/Settings/FlowEngine 等），但以下关键部分缺失或未在设计中明确定义：

1. **前端功能实现缺位**：
   - 没有定义 Electron 渲染进程与主进程之间的 seams。
   - React 组件、页面路由、状态管理未作为实现目标写入技术方案。
   - HTML UX 原型（`ux/`）尚未翻译为可运行前端代码。

2. **CLI 功能缺位**：
   - 没有为 OPC Workstation 设计 CLI seam（例如 `opc-workstation project create`、`opc-workstation task run` 等）。
   - 技术方案未说明哪些行为优先走 CLI、哪些走渲染进程 UI。

3. **测试逻辑不完整**：
   - 现有测试集中在 API/服务层函数调用，缺少前端交互与 CLI 调用的验收测试。
   - `tech-design.md` 中的 seams 声明未覆盖浏览器 E2E / CLI 测试类型，导致 `/test-author` 没有生成对应测试骨架。

## 下次该避开什么

- 技术方案必须显式列出 **CLI seams**、**渲染进程 UI seams**、**主进程 IPC seams**，并标注每个 REQ 的测试类型。
- 在 `/tech-design` 阶段就要确认：哪些功能优先/必须 CLI 化，哪些必须通过浏览器/E2E 验证。
- 不要先实现后端服务再补前端/CLI；应按端到端用户路径定义 seams，再分层实现。
- 下次进入 `/test-author` 时，确保业务测试覆盖 CLI 与前端交互，而不仅是服务函数。

## 仍有效的决策

- 技术栈不变：Electron + React + TypeScript + TailwindCSS + React Flow。
- 持久化策略不变：settings 用 JSON；项目/流程/任务/执行/日志用 SQLite。
- FlowEngine 作为纯函数执行引擎的边界不变。
- 设计系统 `global` 与 UX 原型 `ux/` 不归档，继续作为下一 attempt 的输入。
