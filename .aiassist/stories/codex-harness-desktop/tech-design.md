# Technical Design: OPC Workstation Desktop App

> story: `codex-harness-desktop`  
> attempt: 3  
> 上一 attempt 归档原因：实现缺少前端界面，无法通过 feel-signoff。问题在技术方案层未把 Electron + React 前端 seams 纳入必须交付物。见 `.aiassist/stories/codex-harness-desktop/archive/attempt-2/reason.md`。

---

## 1. 目标与范围

本技术方案承接 PRD 稳定块，把用户语言翻译为系统语言：

- 定义 **CLI seams**、**HTTP API seams**、**前端 IPC/HTTP seams**。
- 明确前端渲染层架构：Electron 主进程、preload、React 渲染进程、路由、数据层、主题/国际化。
- 明确每个 REQ 的验收测试类型（CLI / HTTP API / 服务单元 / feel-signoff）。
- 保持 attempt-2 已实现的后端服务层、HTTP API、CLI 不变，在其上叠加前端层。

## 2. 关键约束

- 技术栈：Electron + React + TypeScript + TailwindCSS + React Flow。
- 内部单用户桌面应用，不追求多实例并发。
- CLI 必须是**独立可运行**的入口，不能强制启动 GUI。
- 前端与 CLI 共享同一 service 层契约（本地 HTTP API）。
- 前端验收以 **feel-signoff** 为主，**不引入浏览器 E2E**。
- 构建工具：Electron Forge + Vite（与现有 `package.json` 一致）。

## 3. 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│  Product Surface                                              │
│  ├─ CLI (`opc-workstation <entity> <action>`)                │
│  └─ React Renderer (Dashboard / Workspace / Flows / Tasks)   │
├─────────────────────────────────────────────────────────────┤
│  Transport Layer                                              │
│  ├─ Electron Preload (`window.opc.apiBaseUrl`)               │
│  └─ Local HTTP Server (REST, 127.0.0.1, dynamic port)        │
├─────────────────────────────────────────────────────────────┤
│  Core Services (`src/services/`)                              │
│  ├─ projectService                                            │
│  ├─ skillService                                              │
│  ├─ flowService                                               │
│  ├─ taskService                                               │
│  ├─ scheduleService                                           │
│  ├─ settingsService                                           │
│  └─ logService                                                │
├─────────────────────────────────────────────────────────────┤
│  Engine (`src/flowEngine/`)                                   │
│  ├─ flowEngine.js (pure function)                             │
│  └─ executors/ (condition/forEach/while/agent)                │
├─────────────────────────────────────────────────────────────┤
│  Persistence                                                  │
│  ├─ SQLite (projects, flows, skills, schedules, executions)  │
│  └─ JSON files (settings)                                     │
└─────────────────────────────────────────────────────────────┘
```

## 4. 目录结构

```
src/
├── cli/
│   ├── opc-workstation.js          # CLI 入口
│   ├── server.js                   # headless server 启动/发现
│   ├── headless-server.js          # 后台 server 进程
│   └── commands/
│       ├── project.js
│       ├── flow.js
│       ├── schedule.js
│       ├── task.js
│       ├── skill.js
│       ├── settings.js
│       └── dashboard.js
├── services/                        # 与 Electron 解耦的纯 Node.js 服务层
│   ├── projectService.js
│   ├── skillService.js
│   ├── flowService.js
│   ├── taskService.js
│   ├── scheduleService.js
│   ├── settingsService.js
│   └── eventBus.js
├── http/
│   ├── server.js                    # HTTP server 启动器
│   └── routes/
│       ├── projects.js
│       ├── flows.js
│       ├── schedules.js
│       ├── executions.js
│       ├── skills.js
│       ├── settings.js
│       └── dashboard.js
├── electron/
│   ├── main.js                      # 主进程：启动 HTTP server、创建窗口、调度器
│   └── preload.js                   # preload 脚本：暴露 apiBaseUrl
├── renderer/                        # React + TanStack Query
│   ├── main.jsx                     # 渲染入口
│   ├── App.jsx                      # 路由壳
│   ├── api/
│   │   ├── client.js                # fetch 封装 + baseUrl
│   │   ├── projects.js              # project API hooks
│   │   ├── flows.js                 # flow API hooks
│   │   ├── schedules.js             # schedule API hooks
│   │   ├── executions.js            # execution API hooks
│   │   ├── skills.js                # skill API hooks
│   │   ├── settings.js              # settings API hooks
│   │   └── dashboard.js             # dashboard API hooks
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Workspace.jsx
│   │   ├── Flows.jsx
│   │   ├── FlowEditor.jsx
│   │   ├── Tasks.jsx
│   │   ├── Skills.jsx
│   │   └── Settings.jsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx
│   │   │   ├── TopBar.jsx
│   │   │   └── PageLayout.jsx
│   │   ├── project/
│   │   │   ├── ProjectCard.jsx
│   │   │   ├── ProjectFormModal.jsx
│   │   │   └── ProjectDetailModal.jsx
│   │   ├── flow/
│   │   │   ├── FlowCard.jsx
│   │   │   ├── FlowFormModal.jsx
│   │   │   ├── NodePalette.jsx
│   │   │   └── FlowCanvas.jsx
│   │   ├── task/
│   │   │   ├── TaskList.jsx
│   │   │   ├── ExecutionList.jsx
│   │   │   ├── ExecutionDetail.jsx
│   │   │   └── NewTaskModal.jsx
│   │   ├── skill/
│   │   │   ├── SkillTable.jsx
│   │   │   ├── SkillDetailModal.jsx
│   │   │   └── InstallSkillModal.jsx
│   │   └── settings/
│   │       ├── SettingsForm.jsx
│   │       └── ThemeToggle.jsx
│   ├── hooks/
│   │   ├── useSettings.js           # 主题/语言/密度联动 settings API
│   │   └── useTheme.js              # DOM data-theme 同步
│   ├── i18n/
│   │   ├── index.js                 # i18n 初始化
│   │   ├── en-US.json               # 英文文案
│   │   └── zh-CN.json               # 中文文案
│   └── index.html                   # Vite 入口 HTML
├── flowEngine/
│   ├── flowEngine.js
│   └── executors/
└── db.js                            # SQLite 连接与迁移
```

## 5. HTTP API 契约

与 attempt-2 保持一致，详见 §5。前端通过同一 `/api/*` 端点访问。

## 6. CLI 设计

与 attempt-2 保持一致，详见 §6。

## 7. Electron 主进程

### 7.1 职责

- 调用 `src/http/server.js` 启动 HTTP server（`reset: false`，不重置数据）。
- 通过 `src/cli/server.js` 的 `discoverServer` 避免与已有 headless/CLI server 端口冲突；如无则启动新 server。
- 创建 BrowserWindow，加载 Vite dev server URL（开发）或 `dist/renderer/index.html`（打包）。
- 在窗口关闭时停止由本进程启动的 HTTP server。
- 运行 ScheduleService 调度器（与 headless server 等价）。

### 7.2 窗口配置

- 默认尺寸：1280x800，最小 1024x768。
- `webPreferences`：
  - `preload: path.join(__dirname, 'preload.js')`
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`

## 8. Preload 契约

preload 只暴露渲染进程访问后端所需的最小接口：

```js
window.opc = {
  apiBaseUrl: string   // 例如 "http://127.0.0.1:12345"
};
```

渲染进程使用原生 `fetch(`${window.opc.apiBaseUrl}/api/...`)` 发起请求。不暴露 Node API、不暴露 ipcRenderer 全量接口。

## 9. 前端设计

### 9.1 路由

使用 React Router（HashRouter，避免打包后 file:// 路由问题）：

| 路径 | 页面 | 对应 UX 原型 |
|---|---|---|
| `/` | Dashboard 或 Workspace（按变体） | `dashboard-overview.html` / `workspace-home.html` |
| `/workspace` | Workspace / Projects | `workspace-home.html` / `workspace.html` |
| `/flows` | Flows 列表 | `flows.html` |
| `/flows/:id` | Flow Editor | `flow-editor.html` |
| `/tasks` | Tasks + Executions | `tasks.html` |
| `/skills` | Skills 管理 | `skills.html` |
| `/settings` | Settings | `settings.html` |

### 9.2 数据层

使用 **TanStack Query**（`@tanstack/react-query`）：

- 每个实体对应一组 hook：`useProjects`、`useFlows`、`useSchedules`、`useExecutions`、`useSkills`、`useSettings`、`useDashboard`。
- mutation：`useCreateProject`、`useUpdateSettings`、`useRunTask`、`useToggleSchedule` 等。
- 查询 key 按 capability/entity 组织，便于失效刷新。
- 默认 `staleTime: 5000`，关键 mutation 成功后手动 `queryClient.invalidateQueries`。

### 9.3 主题与国际化

**主题**：
- Settings API 持久化 `theme: "dark" | "light"`。
- `useTheme` hook 监听 settings，设置 `document.documentElement.dataset.theme`。
- Tailwind 使用 `dark:` 变体；CSS tokens 通过 `data-theme` 属性切换。

**语言**：
- Settings API 持久化 `language: "en-US" | "zh-CN"`。
- `react-i18next` 初始化时读取 `window.opc` 无语言信息，渲染后通过 `useSettings` 切换。
- 文案文件：`renderer/i18n/en-US.json`、`renderer/i18n/zh-CN.json`。

**密度**：
- Settings API 持久化 `density: "compact" | "comfortable"`。
- 通过 `data-density` 属性控制组件间距 token。

### 9.4 关键页面结构

按 PRD §6.4 与 `ux/*.html` 对齐：

- **Dashboard**：指标卡片网格、最近执行列表、快捷项目入口。
- **Workspace**：项目卡片网格、搜索栏、Add Project 按钮、Project Detail Modal（含 Configure Skills）。
- **Flows**：流程卡片列表、New Flow 弹层。
- **Flow Editor**：左侧 Node Palette、中间 React Flow 画布、右侧 Properties 面板、顶部 Run/Schedule/Zoom 工具栏。
- **Tasks**：左侧 Tasks/Executions Tab、右侧 Execution Detail（Logs/Variables/Output）。
- **Skills**：表格列表、Install Skill 弹层、Skill Detail Modal（Overview/Parameters/Examples/README）。
- **Settings**：Workspace Root、Skill Repo Path、Theme、Language、Density 表单。

### 9.5 与 UX 原型的偏差记录

实现时尽量对齐 `.aiassist/stories/codex-harness-desktop/ux/*.html`。已知可能偏差：
- React Flow 默认节点样式与原型手绘节点存在差异，需用自定义节点覆盖。
- 动效（弹层出现、画布平移）按平台能力简化，以功能正确优先。

## 10. 构建配置

使用 Electron Forge + Vite：

- `forge.config.js`（或 `package.json` 中 `@electron-forge/plugin-vite` 配置）指定：
  - `main` 入口：`src/electron/main.js`
  - `preload` 入口：`src/electron/preload.js`
  - `renderer` 入口：`src/renderer/index.html`
- Vite 配置：`vite.renderer.config.js`、`vite.preload.config.js`、`vite.main.config.js`。
- 开发命令：`npm start`（electron-forge start）。
- 打包命令：`npm run package` / `npm run make`。

## 11. Seams 与测试策略

| REQ-ID | 主要 seam | 测试类型 | 说明 |
|---|---|---|---|
| REQ-WORKSPACE-001~002, REQ-WORKSPACE-007, REQ-I18N-002 | `opc-workstation settings` / `PATCH /api/settings` | CLI + HTTP API | 持久化、校验、默认值 |
| REQ-WORKSPACE-003~006 | `opc-workstation project` / `/api/projects` | CLI + HTTP API | CRUD、搜索、skill 关联 |
| REQ-FLOW-001~006 | `opc-workstation flow` / `/api/flows` | CLI + HTTP API | CRUD、导入导出 |
| REQ-SCHEDULE-001, REQ-SCHEDULE-003 | `opc-workstation task run` / `POST /api/executions` | CLI + HTTP API | 执行触发、历史、详情 |
| REQ-SCHEDULE-002 | `opc-workstation schedule` / `/api/schedules` | CLI + HTTP API | cron、启用停用 |
| REQ-SKILL-001~003 | `opc-workstation skill` / `/api/skills` | CLI + HTTP API | 列表、详情、多源安装 |
| REQ-I18N-001 | React 主题切换 | feel-signoff | 视觉与交互；settings API 主题持久化已由 HTTP 测试覆盖 |
| REQ-FLOW-003~005 | Flow Editor 画布与交互 | feel-signoff | 依据 `flow-editor.html` 验收 |
| REQ-FLOW-007~010 | `flowEngine.run` | 服务单元测试 | 纯函数执行逻辑 |
| REQ-DASH-001 | Dashboard 聚合 | CLI + HTTP API | 指标与最近执行 |
| REQ-CLI-001 | `opc-workstation --help` / 子命令 | CLI | CLI 入口与 headless server 生命周期 |

> 注：不引入浏览器 E2E；前端观感与交互通过 `/signoff --stage=feel` 依据 `ux/` HTML 原型验收。

## 12. 失败与风险

| 风险 | 缓解 |
|---|---|
| CLI 与 GUI 同时写 SQLite | 统一走 HTTP server，server 串行化写请求；SQLite WAL 模式 |
| 动态端口导致 CLI 找不到 server | 应用数据目录写入 `server.json`；CLI/Electron 自动发现或启动 |
| 无认证导致本地其他进程可调用 | MVP 绑定 `127.0.0.1`；未来需要远程时升级到 token 认证 |
| React Flow 与原型视觉差异 | 自定义节点/边样式，feel-signoff 时记录偏差 |
| Electron 打包体积大 | 仅内部使用，暂不优化；未来按需启用 ASAR、代码分割 |
| 前端状态与服务端不同步 | TanStack Query 主动失效 + mutation 后刷新 |

## 13. 对 PRD/REQ 的反向同步

- PRD 已包含 Electron + React 技术栈、前端页面结构、主题/国际化等稳定块，无需新增。
- 技术方案明确：前端不引入浏览器 E2E，以 feel-signoff 验收；如未来需要可执行前端 seams，再讨论是否增加 renderer 层 public API 测试。
- 建议 `CONTEXT.md` 补充术语：`preload`、`apiBaseUrl`、`TanStack Query`、`React Router`、`HashRouter`。

## 14. 下一步

1. 若本技术方案通过，进入 `/crystallize` 确认 REQ 是否需要新增/调整（预计无需新增 REQ，前端行为由现有 feel-signoff 项覆盖）。
2. 进入 `/test-author`：确认现有 61 个测试无需变更；如需补充 renderer 启动测试，再生成。
3. 进入 `/signoff --stage=assertion` 批量签核。
4. 进入 `/implementer` BUILD：先搭 Electron + React 最小壳，再按页面实现组件。
