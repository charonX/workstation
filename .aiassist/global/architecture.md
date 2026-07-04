# Architecture Decision Records (ADR)

本文件记录项目关键架构决策。

## 模板

### 决策标题

- **状态**: 提议 / 已接受 / 已废弃
- **背景**: 为什么需要做这个决策
- **方案**: 选择了什么
- **替代方案**: 考虑过哪些，为什么没选
- **影响**: 对项目结构和后续开发的影响

## ADR-001: 桌面应用壳选择 Electron

- **状态**: 已接受
- **背景**: PRD 最初指定 Tauri + React + TypeScript。在 `/tac-tech-design` 阶段回顾时发现，核心服务层已用 Node.js 实现，且 Agent 节点需要进程内调用 Agent SDK / Codex app-server，Tauri 的 Rust 后端会引入不必要的桥接复杂度。
- **方案**: 采用 Electron 作为桌面应用壳。主进程即 Node.js 引擎进程，可直接复用现有服务层；渲染进程使用 React + TypeScript + TailwindCSS + React Flow。
- **替代方案**:
  - Tauri：更轻量，但需要把核心逻辑用 Rust 重写或在 Rust 与 Node.js 之间做 IPC 桥接，增加 Agent 调用的摩擦。
  - 纯 Node.js CLI + 浏览器：缺少桌面壳的窗口管理、系统托盘、自动启动等能力。
- **影响**:
  - 现有 `src/` 服务层可继续演进，最终运行在 Electron main process 中。
  - 文件系统、SQLite、子进程管理都在 Node.js 主进程内完成，无需跨语言桥接。
  - 包体积和内存占用高于 Tauri，但作为内部工具可接受。
  - 需要为 Electron 主进程写集成测试（使用 spectron 替代方案或 playwright-electron）。
