# OPC Workstation Desktop

> Story: `codex-harness-desktop` — 把需要人类判断的环节交给 agent/codex 节点，把流程化步骤交给应用稳定执行，实现可定时触发、可远程观察的自动化工作流。

OPC Workstation Desktop 是一个基于 **Electron + React** 的本地桌面应用，提供工作流编排、任务执行、Skill 管理、项目管理和仪表盘观测能力。

## 功能概览

- **Workspace / Projects**：本地项目与 Git 项目创建、列表筛选、详情管理。
- **Flows**：可视化 Flow 编辑器（基于 React Flow），支持节点拖拽、属性编辑、导入/导出。
- **Tasks / Executions**：手动触发任务、查看执行历史、日志、变量与输出。
- **Schedules**：基于 cron 表达式的定时调度。
- **Skills**：支持 npm、Claude Plugin 与本地文件三种来源安装，并在项目详情中关联 Skills。
- **Dashboard**：关键指标卡片、最近执行记录、快捷项目链接。
- **Settings**：工作区根目录、Skill 仓库路径、主题、语言、密度偏好。
- **CLI**：独立的命令行入口 `src/cli/opc-workstation.js`，支持与桌面端共享同一本地 HTTP API。

## 技术栈

- **桌面壳**：Electron + Electron Forge + Vite
- **前端**：React 19 + React Router DOM + i18next + React Flow
- **后端**：Node.js 原生 HTTP 服务器（内嵌于主进程）
- **持久化**：JSON 文件（settings）+ SQLite（项目/流程/任务/执行/日志）
- **自动化测试**：Node.js 原生 `node --test`（API/CLI）+ Playwright Electron（E2E）
- **原生依赖**：`better-sqlite3`（需要按目标运行时重建）

## 环境准备

需要 Node.js 22+ 和 npm。

```bash
npm install
```

`better-sqlite3` 需要为当前 Node/Electron 版本重建二进制。测试脚本会自动处理；手动操作时：

```bash
# 为单元测试 / CLI 运行重建（Node 运行时）
npm run rebuild:node

# 为 Electron 运行 / E2E 测试重建
npm run rebuild:electron
```

## 启动应用

### 开发模式

```bash
npm start
```

Electron Forge 会启动 Vite 开发服务器，并打开 Electron 主窗口。主进程会自动启动本地 HTTP API，渲染进程通过 preload 脚本发现 API 地址。

### 本地 HTTP API（主进程内）

应用启动后，主进程会在一个随机端口启动 HTTP 服务，并将地址写入 `app.getPath('userData')/server.json`，同时注册到 `~/.opc-workstation/server.json` 供 CLI 发现。无需手动启动。

### CLI

```bash
# 查看帮助
node src/cli/opc-workstation.js --help

# 示例：设置工作区根目录
node src/cli/opc-workstation.js settings set workspaceRoot /path/to/workspace

# 示例：列出项目
node src/cli/opc-workstation.js projects list
```

CLI 会优先复用已运行的桌面 HTTP 服务；若未找到，会启动一个独立的无头服务，并在父进程退出后自动关闭。

## 测试

```bash
# 运行全部测试（单元 + E2E）
npm test

# 仅运行单元测试（API + CLI）
npm run test:unit

# 仅运行 E2E 测试
npm run test:e2e
```

当前测试覆盖：

- 单元测试：61 个，覆盖 HTTP API、CLI、FlowEngine。
- E2E 测试：21 个 Playwright Electron 用例，覆盖主题/语言/密度、Dashboard、Flow 编辑与执行、Skill 安装、Project 配置等关键路径。

## 构建与打包

```bash
# 打包当前平台
npm run package

# 制作安装包（DMG / ZIP / Squirrel 等，取决于平台）
npm run make
```

构建产物输出到 `out/` 目录。

## 项目目录说明

```
.
├── src/
│   ├── cli/              # 命令行入口与命令实现
│   │   ├── opc-workstation.js   # CLI 入口
│   │   ├── server.js            # 服务发现 / 无头服务生命周期
│   │   ├── headless-server.js   # 无头服务进程
│   │   └── commands/            # 各子命令实现
│   ├── flowEngine/       # 流程执行引擎（纯函数）
│   │   └── executors/    # 各类节点执行器
│   ├── http/             # 本地 HTTP API 与路由
│   │   └── routes/
│   ├── main/             # Electron 主进程
│   │   └── main.js
│   ├── preload/          # Electron preload 脚本
│   ├── renderer/         # Electron 渲染进程（React 应用）
│   │   ├── api/          # 前端 API 调用封装
│   │   ├── components/   # React 组件（按领域分子目录）
│   │   ├── hooks/        # 自定义 Hooks
│   │   ├── i18n/         # 国际化配置
│   │   └── pages/        # 页面组件
│   └── services/         # 业务服务（settings/project/flow/task/skill/schedule）
├── tests/
│   └── capabilities/     # 按 capability / entity / story 组织的契约测试
│       └── .../codex-harness-desktop/
│           ├── api/      # API 单元测试
│           ├── cli/      # CLI 单元测试
│           └── e2e/      # Playwright Electron E2E 测试
├── .aiassist/
│   ├── stories/codex-harness-desktop/   # 当前 story 的设计与契约产物
│   │   ├── prd.md
│   │   ├── requirements.md
│   │   ├── tech-design.md
│   │   ├── ux/           # HTML 高保真原型与预览页
│   │   ├── qa-report.md
│   │   └── workflow-state.yaml
│   └── global/           # 项目级设计系统、CONTEXT、ADR
├── playwright.config.cjs # Playwright 配置
├── forge.config.js       # Electron Forge 配置
├── vite.*.config.js      # Vite 配置（main / preload / renderer）
└── README.md
```

## 注意事项

- 数据隔离：Electron 运行时，`OPC_WORKSTATION_CONFIG_DIR` 与 `DB_PATH` 会被指向 `app.getPath('userData')`，避免与全局 CLI 配置冲突。
- 测试隔离：E2E 测试会为每个用例创建独立的临时 `userData` 目录，并写入独立的 `server.json`。
- 生成的测试产物（`test-results/`、`playwright-report/`、`coverage/`）已加入 `.gitignore`，无需提交。

## 工作流状态

当前 story 处于 **FEEL-SIGNOFF** 阶段，QA 已全部通过，等待观感验收。

## 相关命令速查

| 命令 | 说明 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run rebuild:node` | 为 Node 重建 better-sqlite3 |
| `npm run rebuild:electron` | 为 Electron 重建 better-sqlite3 |
| `npm start` | 开发模式启动 Electron |
| `npm test` | 运行全部测试 |
| `npm run test:unit` | 运行 API/CLI 单元测试 |
| `npm run test:e2e` | 运行 Playwright Electron E2E |
| `npm run package` | 打包 Electron 应用 |
| `npm run make` | 制作安装包 |
| `node src/cli/opc-workstation.js --help` | 查看 CLI 帮助 |
