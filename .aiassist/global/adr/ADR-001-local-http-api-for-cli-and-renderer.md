# ADR-001: CLI 与前端通过本地 HTTP API 共享服务层

- **状态**: 已接受
- **日期**: 2026-07-08
- **相关 story**: codex-harness-desktop
- **相关 REQ**: REQ-001 ~ REQ-025

## 背景

OPC Workstation 需要同时提供：

1. 桌面 GUI（Electron + React）。
2. 命令行入口，供自动化脚本和远程触发使用。
3. 一套统一的服务层契约，避免 CLI、GUI、测试各自实现 seams。

上一 attempt 的问题在于只实现了后端服务函数，没有定义 CLI 和前端 seams，导致缺少对应测试与实现内容。

## 决策

采用 **本地 HTTP API** 作为 CLI 与前端的统一 transport layer：

- Electron main 进程启动一个绑定 `127.0.0.1` 动态端口的 HTTP server。
- 所有 core services 通过 RESTful 资源端点暴露。
- CLI 作为 HTTP 客户端；未检测到 server 时自动启动 headless server。
- React renderer 通过 `fetch` 调用本地 API。
- MVP 无认证；未来若需远程访问，再升级到 token 认证。

## 替代方案

1. **CLI 直接调用 services**：实现简单，但 CLI 与前端走不同路径，容易 drift，且难以处理并发写。
2. **IPC-only**：前端通过 Electron IPC 调用 main，CLI 作为 IPC 客户端。要求 app 已运行，CLI 无法独立使用。
3. **本地 HTTP + 前端仍走 IPC**：前端使用 IPC，CLI 使用 HTTP。需要维护两套 transport，增加复杂度。

## 影响

- 目录结构调整：`src/services/` 与 Electron 解耦；`src/cli/`、`src/http/` 成为一级目录。
- 测试策略统一：CLI/HTTP 测试覆盖大部分 REQ；前端以 feel-signoff 为主。
- 并发风险降低：所有写操作通过 server 串行化，SQLite WAL 处理并发读。
- 未来扩展性好：远程手机命令可在同一 HTTP API 上加认证实现。

## 相关文件

- `.aiassist/stories/codex-harness-desktop/tech-design.md`
- `.aiassist/global/CONTEXT.md`
- `src/services/*`
- `src/http/*`
- `src/cli/*`
