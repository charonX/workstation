# Technical Design: OPC Workstation Desktop App

> story: `codex-harness-desktop`  
> attempt: 2  
> 上一 attempt 归档原因：实现缺少前端、CLI 及对应测试 seams，问题在技术方案层。见 `.aiassist/stories/codex-harness-desktop/archive/attempt-1/reason.md`。

---

## 1. 目标与范围

本技术方案承接 PRD 稳定块，把用户语言翻译为系统语言：

- 定义 **CLI seams**、**HTTP API seams**、**前端 IPC/HTTP seams**。
- 明确每个 REQ 的验收测试类型（CLI / HTTP API / 服务单元 / 浏览器 E2E / feel-signoff）。
- 保持后端服务层不变，只做目录结构和解耦调整。

## 2. 关键约束

- 技术栈：Electron + React + TypeScript + TailwindCSS + React Flow。
- 内部单用户桌面应用，不追求多实例并发。
- CLI 必须是**独立可运行**的入口，不能强制启动 GUI。
- 前端与 CLI 共享同一 service 层契约。
- 前端验收以 **feel-signoff** 为主，**不引入浏览器 E2E**（先选 C）。

## 3. 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│  Product Surface                                              │
│  ├─ CLI (`opc-workstation <entity> <action>`)                │
│  └─ React Renderer (Dashboard / Workspace / Flows / Tasks)   │
├─────────────────────────────────────────────────────────────┤
│  Transport Layer                                              │
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
│   └── commands/
│       ├── project.js
│       ├── flow.js
│       ├── schedule.js
│       ├── task.js
│       ├── skill.js
│       └── settings.js
├── services/                        # 与 Electron 解耦的纯 Node.js 服务层
│   ├── projectService.js
│   ├── skillService.js
│   ├── flowService.js
│   ├── taskService.js
│   ├── scheduleService.js
│   ├── settingsService.js
│   └── logService.js
├── http/
│   ├── server.js                    # HTTP server 启动器
│   └── routes/
│       ├── projects.js
│       ├── flows.js
│       ├── schedules.js
│       ├── executions.js
│       ├── skills.js
│       └── settings.js
├── electron/
│   └── main.js                      # 启动 HTTP server，加载 renderer
├── preload/
│   └── preload.js                   # 暴露 `window.opc.fetch` 或 base URL
├── renderer/                        # React + TanStack Query
│   ├── App.jsx
│   ├── main.jsx
│   ├── pages/
│   └── components/
├── flowEngine/
│   ├── flowEngine.js
│   └── executors/
└── db.js                            # SQLite 连接与迁移
```

## 5. HTTP API 契约

### 5.1 基础

- 协议：HTTP/1.1
- 绑定：`127.0.0.1`，动态端口
- 无认证（MVP）
- 请求/响应体：JSON
- 错误响应：标准 HTTP 状态码 + JSON body `{error, message}`

### 5.2 资源端点

| Entity | Endpoints | 对应 REQ |
|---|---|---|
| projects | `GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`, `PATCH /api/projects/:id`, `DELETE /api/projects/:id` | REQ-WORKSPACE-003~006 |
| skills | `GET /api/skills`, `POST /api/skills/install`, `GET /api/skills/:id` | REQ-SKILL-001~003 |
| flows | `GET /api/flows`, `POST /api/flows`, `GET /api/flows/:id`, `PATCH /api/flows/:id`, `DELETE /api/flows/:id`, `POST /api/flows/:id/import`, `GET /api/flows/:id/export` | REQ-FLOW-001~006 |
| schedules | `GET /api/schedules`, `POST /api/schedules`, `PATCH /api/schedules/:id`, `DELETE /api/schedules/:id` | REQ-SCHEDULE-002 |
| executions | `GET /api/executions`, `POST /api/executions` (run task), `GET /api/executions/:id` | REQ-SCHEDULE-001, REQ-SCHEDULE-003, REQ-DASH-001 |
| settings | `GET /api/settings`, `PATCH /api/settings` | REQ-WORKSPACE-001~002, REQ-WORKSPACE-007, REQ-I18N-001~002 |

### 5.3 错误契约

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Project name is required"
}
```

- `400` 业务校验错误
- `404` 资源不存在
- `422` 语义错误（如非法 cron）
- `500` 系统错误

## 6. CLI 设计

### 6.1 入口

- 文件：`src/cli/opc-workstation.js`
- `package.json` 注册 `bin`：`"opc-workstation": "./src/cli/opc-workstation.js"`
- 未检测到 server 时自动启动 headless server，执行完命令后可选 `--keep-server`。

### 6.2 命令模式

统一为：

```
opc-workstation <entity> <action> [flags]
```

示例：

```bash
opc-workstation project create --name "Hot News" --local-path ~/workspace/hot-news
opc-workstation project list
opc-workstation flow create --name "Fetch" --project-id p1
opc-workstation flow import --file flow.json --project-id p1
opc-workstation flow export --id f1 --file flow.json
opc-workstation schedule create --project-id p1 --flow-id f1 --cron "0 8 * * *"
opc-workstation schedule toggle --id s1
opc-workstation task run --project-id p1 --flow-id f1
opc-workstation execution list
opc-workstation execution get --id e1
opc-workstation skill install --source npm --identifier some-skill
opc-workstation settings get
opc-workstation settings set --language zh-CN
```

### 6.3 输出与退出码

- 默认输出 JSON。
- 全局 `--pretty` 美化 JSON。
- 退出码：`0` 成功，`1` 业务错误，`2` 系统错误。

## 7. Electron 主进程

- 启动 HTTP server。
- 启动 renderer 窗口。
- 运行 ScheduleService（调度器只在 GUI/headless server 生命周期内运行）。
- 关闭时停止 server。

## 8. 前端

- 路由：React Router。
- 数据层：TanStack Query，以 `/api/*` 为 data source。
- 组件：按 PRD §6.4 页面结构实现。
- 与 Electron 通信：通过 preload 注入 `window.opc.apiBaseUrl`；页面用原生 `fetch`。

## 9. Seams 与测试策略

| REQ-ID | 主要 seam | 测试类型 | 说明 |
|---|---|---|---|
| REQ-WORKSPACE-001~002, REQ-WORKSPACE-007, REQ-I18N-002 | `opc-workstation settings` / `PATCH /api/settings` | CLI + HTTP API | 持久化、校验、默认值 |
| REQ-WORKSPACE-003~006 | `opc-workstation project` / `/api/projects` | CLI + HTTP API | CRUD、搜索、skill 关联 |
| REQ-FLOW-001~006 | `opc-workstation flow` / `/api/flows` | CLI + HTTP API | CRUD、导入导出 |
| REQ-SCHEDULE-001, REQ-SCHEDULE-003 | `opc-workstation task run` / `POST /api/executions` | CLI + HTTP API | 执行触发、历史、详情 |
| REQ-SCHEDULE-002 | `opc-workstation schedule` / `/api/schedules` | CLI + HTTP API | cron、启用停用 |
| REQ-SKILL-001~003 | `opc-workstation skill` / `/api/skills` | CLI + HTTP API | 列表、详情、多源安装 |
| REQ-I18N-001 | React 主题切换 | feel-signoff | 视觉与交互 |
| REQ-FLOW-007~010 | `flowEngine.run` | 服务单元测试 | 纯函数执行逻辑 |
| REQ-DASH-001 | Dashboard 聚合 | CLI + HTTP API | 指标与最近执行 |
| REQ-CLI-001 | `opc-workstation --help` / 子命令 | CLI | CLI 入口与 headless server 生命周期 |

> 注：先不引入浏览器 E2E；前端观感与交互通过 `/signoff --stage=feel` 依据 `ux/` HTML 原型验收。

## 10. 失败与风险

| 风险 | 缓解 |
|---|---|
| CLI 与 GUI 同时写 SQLite | 统一走 HTTP server，server 串行化写请求；SQLite WAL 模式 |
| 动态端口导致 CLI 找不到 server | 应用数据目录写入 `server.json`（`{port, pid}`）；CLI 自动发现或启动 |
| 无认证导致本地其他进程可调用 | MVP 绑定 `127.0.0.1`；未来需要远程时升级到 token 认证 |
| Flow JSON 格式与未来 YAML 需求冲突 | JSON 作为标准格式，YAML 作为未来 import 可选项 |
| 服务层从 Electron 解耦的成本 | 把现有 `src/*Service.js` 移到 `src/services/`，移除 Electron 导入依赖 |

## 11. 对 PRD 的反向同步

- 在 PRD §4 增加 **“CLI 入口”** 稳定块：OPC Workstation 提供 `opc-workstation` CLI，支持项目/流程/任务/Schedule/Skill/Settings 的命令式操作。
- 在 PRD §4 增加 **“本地 HTTP API”** 稳定块：CLI 与 GUI 共享 localhost REST API，动态端口，MVP 无认证。
- 把 PRD §5 “流程配置格式：JSON vs YAML” 升级为稳定块：MVP 使用 JSON。

## 12. 下一步

1. 反向更新 PRD 稳定块（已完成）。
2. 更新 `CONTEXT.md` 中 CLI/HTTP API 术语定义（已完成）。
3. 进入 `/test-author`，按 CLI / HTTP API seams 生成测试骨架。
