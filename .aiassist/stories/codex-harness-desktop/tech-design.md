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
- 前端验收采用 **Playwright Electron E2E + feel-signoff**：
  - E2E 覆盖 5 条关键用户路径，用 HTTP API seeding 准备数据；
  - feel-signoff 覆盖纯视觉/审美判断，依据 `ux/` HTML 原型验收。
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
├── e2e/                             # Playwright Electron E2E
│   ├── fixtures/                    # 应用启动、数据 seed、状态清理
│   │   ├── electronApp.js
│   │   └── seed.js
│   ├── specs/                       # 5 条关键路径
│   │   ├── onboarding.spec.js
│   │   ├── flowRun.spec.js
│   │   ├── skillInstall.spec.js
│   │   ├── themeLanguage.spec.js
│   │   └── dashboard.spec.js
│   └── playwright.config.js
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
├── main/
│   └── main.js                      # 主进程：启动 HTTP server、创建窗口、调度器
├── preload/
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

## 10. E2E 测试设计

### 10.1 工具与 harness

- **框架**：`@playwright/test`。
- **运行方式**：Playwright 的 `electron.launch()` 直接启动 Electron 应用（harness 选项 X）。
- **启动入口**：`src/main/main.js`（Electron Forge 已配置）。
- **渲染进程访问**：通过 preload 暴露 `window.opc.apiBaseUrl`，E2E 与真实用户一样用原生 `fetch` 访问本地 HTTP API。
- **数据准备**：`test.beforeEach` 通过 `src/http/server.js` 的 HTTP 接口 seed 基础数据（harness 选项 B），UI 只验证目标交互。
- **状态清理**：每个测试使用独立的应用数据目录（`userData` 临时目录），测试结束后删除，避免互相污染。

### 10.2 E2E 目录结构

```
src/e2e/
├── fixtures/
│   ├── electronApp.js       # 启动/关闭 Electron 应用，返回 ElectronApp + firstWindow
│   └── seed.js              # HTTP API seed helper：createProject、createFlow、installSkill 等
├── helpers/
│   └── locators.js          # 共享 selector / data-testid 常量
├── specs/
│   ├── onboarding.spec.js   # Settings → Add Project → Configure Skills
│   ├── flowRun.spec.js      # Create Flow → Edit Nodes → Run → View Execution
│   ├── skillInstall.spec.js # Install Skill → View Detail
│   ├── themeLanguage.spec.js # Theme / Language 切换 DOM 效果
│   └── dashboard.spec.js    # Dashboard 指标渲染
└── playwright.config.js     # projects、retries、trace、screenshot、artifact
```

### 10.3 5 条 E2E 路径

| 路径 | 覆盖 REQ-ID | 数据准备（API seed） | UI 断言 |
|---|---|---|---|
| **Onboarding** | REQ-WORKSPACE-003、006、007；REQ-I18N-001、002 | 无（从零开始） | Settings 保存 workspaceRoot / skillRepoPath；Add Project 弹层创建项目；Project Detail 配置 skills；密度切换生效 |
| **Flow Run** | REQ-FLOW-002~005；REQ-SCHEDULE-001、003 | 创建 project | New Flow 弹层创建 flow；Flow Editor 渲染节点面板与画布；Run 创建 execution；Executions Tab 显示执行历史与详情 |
| **Skill Install** | REQ-SKILL-002、003 | 无 | Install Skill 弹层安装 skill；Skills 列表出现新 skill；Skill Detail 展示 Overview / Parameters / Examples / README |
| **Theme & Language** | REQ-I18N-001、002 | 无 | 切换 theme 后 `document.documentElement.dataset.theme` 变化；切换 language 后 `<html lang>` 与文案变化 |
| **Dashboard** | REQ-DASH-001 | seed project、flow、execution | Dashboard 显示 projectCount、activeScheduleCount、recentRunCount、successRate；最近执行列表可见 |

### 10.4 locator 策略

- 优先使用语义 locator：`getByRole`、`getByLabel`、`getByText`。
- 自定义组件或语义不足时，使用 `data-testid`，统一在 `helpers/locators.js` 管理。
- 避免裸 CSS selector 和基于文本内容的脆弱断言。

### 10.5 CI 集成

`.github/workflows/contract-gate.yml` 已更新：

- `npx playwright install --with-deps chromium` 安装浏览器二进制。
- `npm run test:e2e` 执行 E2E。
- 失败时上传 `playwright-report/` 作为 artifact。

### 10.6 与 feel-signoff 的分工

- **E2E 负责**：结构、行为、数据流、状态切换、关键用户路径可走完。
- **feel-signoff 负责**：颜色、间距、字体、动效、排版、整体视觉气质、平台特定偏差。

---

## 11. 构建配置

使用 Electron Forge + Vite：

- `forge.config.js`（或 `package.json` 中 `@electron-forge/plugin-vite` 配置）指定：
  - `main` 入口：`src/main/main.js`
  - `preload` 入口：`src/preload/preload.js`
  - `renderer` 入口：`src/renderer/index.html`
- Vite 配置：`vite.renderer.config.js`、`vite.preload.config.js`、`vite.main.config.js`。
- 开发命令：`npm start`（electron-forge start）。
- 打包命令：`npm run package` / `npm run make`。

## 12. Seams 与测试策略

| REQ-ID | 主要 seam | 测试类型 | 说明 |
|---|---|---|---|
| REQ-WORKSPACE-001~002, REQ-WORKSPACE-007, REQ-I18N-002 | `opc-workstation settings` / `PATCH /api/settings` | CLI + HTTP API + E2E | E2E 覆盖 Settings 表单交互与持久化 |
| REQ-WORKSPACE-003~006 | `opc-workstation project` / `/api/projects` | CLI + HTTP API + E2E | E2E 覆盖 Add Project 弹层、Project Detail、Configure Skills |
| REQ-FLOW-001~006 | `opc-workstation flow` / `/api/flows` | CLI + HTTP API + E2E | E2E 覆盖 Flows 列表、New Flow 弹层、Flow Editor 节点与运行 |
| REQ-SCHEDULE-001, REQ-SCHEDULE-003 | `opc-workstation task run` / `POST /api/executions` | CLI + HTTP API + E2E | E2E 覆盖 Run 按钮触发与 Executions 详情 |
| REQ-SCHEDULE-002 | `opc-workstation schedule` / `/api/schedules` | CLI + HTTP API | cron、启用停用由 API/CLI 覆盖 |
| REQ-SKILL-001~003 | `opc-workstation skill` / `/api/skills` | CLI + HTTP API + E2E | E2E 覆盖 Install Skill 弹层与 Skill Detail |
| REQ-I18N-001 | Theme 切换 | E2E + feel-signoff | E2E 验证 DOM `data-theme` 变化；feel-signoff 验证视觉 |
| REQ-I18N-002 | Language 切换 | CLI + HTTP API + E2E | E2E 验证 `<html lang>` 与文案切换 |
| REQ-FLOW-007~010 | `flowEngine.run` | 服务单元测试 | 纯函数执行逻辑 |
| REQ-DASH-001 | Dashboard 聚合 | CLI + HTTP API + E2E + feel-signoff | E2E 验证指标与列表渲染 |
| REQ-CLI-001 | `opc-workstation --help` / 子命令 | CLI | CLI 入口与 headless server 生命周期 |

> 注：E2E 覆盖 5 条关键用户路径；剩余结构/视觉细节通过 feel-signoff 依据 `ux/` HTML 原型验收。

## 13. 失败与风险

| 风险 | 缓解 |
|---|---|
| CLI 与 GUI 同时写 SQLite | 统一走 HTTP server，server 串行化写请求；SQLite WAL 模式 |
| 动态端口导致 CLI 找不到 server | 应用数据目录写入 `server.json`；CLI/Electron 自动发现或启动 |
| 无认证导致本地其他进程可调用 | MVP 绑定 `127.0.0.1`；未来需要远程时升级到 token 认证 |
| React Flow 与原型视觉差异 | 自定义节点/边样式，feel-signoff 时记录偏差 |
| Electron 打包体积大 | 仅内部使用，暂不优化；未来按需启用 ASAR、代码分割 |
| 前端状态与服务端不同步 | TanStack Query 主动失效 + mutation 后刷新 |
| E2E 启动 Electron 慢 / flaky | 每个测试独立 `userData` 目录；Playwright `retries: 2`；关键路径用 API seeding 减少 UI 步骤 |
| E2E 与本地开发环境冲突 | E2E 使用动态端口 + 临时 userData；不依赖默认应用数据目录 |
| Playwright 浏览器二进制在 CI 缺失 | `contract-gate.yml` 已加入 `npx playwright install --with-deps chromium` |

## 14. 对 PRD/REQ 的反向同步

- PRD 已包含 Electron + React 技术栈、前端页面结构、主题/国际化等稳定块，无需新增。
- **本次技术方案新增 Playwright Electron E2E 作为前端关键路径的验收 seam，原 `feel-signoff only` 策略被推翻**。以下 REQ 的测试类型需要在 `/crystallize` 阶段同步更新：
  - REQ-FLOW-002~005：由 feel-signoff 改为 **E2E + feel-signoff**。
  - REQ-SKILL-002：由 CLI + HTTP API + feel-signoff 改为 **CLI + HTTP API + E2E + feel-signoff**。
  - REQ-I18N-001：由 feel-signoff 改为 **E2E + feel-signoff**。
  - REQ-I18N-002：由 CLI + HTTP API 改为 **CLI + HTTP API + E2E**。
  - REQ-DASH-001：由 CLI + HTTP API 改为 **CLI + HTTP API + E2E + feel-signoff**。
  - REQ-WORKSPACE-003~006、REQ-SKILL-003：在现有 CLI + HTTP API 基础上增加 **E2E**。
- 建议 `CONTEXT.md` 补充术语：`preload`、`apiBaseUrl`、`TanStack Query`、`React Router`、`HashRouter`、Playwright E2E。

## 15. 下一步

1. 用户审查并确认本技术方案（尤其是 E2E 5 条路径、harness 选项 X、数据准备策略 B）。
2. 进入 `/crystallize`：按 §14 更新 `requirements.md` 中受影响 REQ 的测试类型。
3. 重新生成 `requirements-v1.hash`。
4. 进入 `/test-author`：为新增 E2E seams 生成 5 个 spec 文件骨架；现有 61 个 API/CLI 测试如无变化可保留。
5. 进入 `/signoff --stage=assertion` 批量签核（含新增 E2E 断言）。
6. 进入 `/implementer` BUILD：
   - 先搭 Electron + React 最小壳（`src/main/main.js`、`src/preload/preload.js`、`src/renderer/*`）；
   - 补全 5 条 E2E 路径所需的页面组件；
   - 实现 E2E fixtures 与 Playwright 配置，确保 `npm run test:e2e` 可运行。
