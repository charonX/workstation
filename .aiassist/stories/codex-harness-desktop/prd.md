# Codex Harness Desktop App

## 1. Problem Statement

作为个人开发者/内容创作者，我需要每天处理大量重复性信息工作流：抓取热点新闻、分析平台榜单异常值、筛选 TikTok 红人、更新网站内容等。

当前方案的问题是：
- **纯 codex/agent 执行太慢**：无法实现稳定量产，跑一次任务可能要数小时。
- **n8n 等流程工具已死/不够灵活**：无法直接调用 codex 的 computer-use、生图等原生能力。
- **手动操作 desktop agent 需要人守着**：Codex 桌面端仍需要人在电脑前控制和观察。
- **多个 skills 散落各处**：没有统一入口把它们 GUI 化并串联成可复用流程。

需要一个桌面 harness 应用：把"需要人类判断"的环节交给 agent/codex 节点，把"流程化步骤"交给应用稳定执行，并能远程通过手机命令 + 可视化 dashboard 查看进度。

## 2. Solution

开发一个内部自用的桌面应用 **Codex Harness Desktop App**，核心定位是：

> 个人自动化 harness：把 Claude Code skills GUI 化，把 codex/computer-use 接入流程节点，通过 n8n 式节点编排实现可定时触发、可远程观察的自动化工作流。

核心架构：
- **桌面应用壳**：Tauri + React + TypeScript + TailwindCSS + React Flow
- **项目模型**：Workspace 包含多个项目；项目是本地目录或 git 仓库
- **Skill 管理**：集中式 skill 仓库，通过软链接加载到项目
- **Agent 适配层**：前期支持 Claude Code（Agent SDK）和 Codex（OpenAI app-server）
- **流程引擎**：n8n 式节点拖拽编排，支持定时触发、流程间调用
- **数据层**：流程配置/项目元数据存在应用数据目录；执行日志存在 SQLite

## 3. User Stories

1. **作为用户，我可以在 workspace 中创建/导入项目**，这样不同工作流可以隔离管理。
2. **作为用户，我可以把 skill 仓库中的 skill 软链接到项目中**，这样 Claude Code 可以直接使用这些 skill。
3. **作为用户，我可以在可视化编辑器中拖拽节点设计流程**，这样不必写代码就能编排自动化任务。
4. **作为用户，我可以在流程中放入 codex/agent 节点**，让 agent 在特定环节做人类式判断。
5. **作为用户，我可以设置流程定时触发**，让任务自动执行。
6. **作为用户，我可以在应用中查看执行日志和结果**，知道任务跑到哪一步、结果在哪里。
7. **作为用户，我可以让一个流程调用另一个流程**，这样可复用的子流程可以被多个主流程使用。

## 4. Stable Blocks（已稳定，可结晶为 REQ）

以下部分在访谈中已经明确，可以进入下一阶段的 REQ 结晶：

1. **技术栈**：Tauri + React + TypeScript + TailwindCSS + React Flow
2. **应用类型**：手动打开的桌面工具，单用户内部使用
3. **项目模型**：
   - 存在 Workspace 概念
   - 项目是 Workspace 下的一个目录
   - 项目可以是本地目录或 git 仓库（git 仓库自动 clone 到 Workspace）
4. **Skill 管理**：
   - 使用集中式 skill 仓库
   - 通过软链接方式把 skill 加载到项目的 `.claude/skills/`
   - Skill 格式为 Claude Code 标准格式（SKILL.md + 可选脚本）
5. **Agent 适配（前期）**：
   - Claude Code：通过 Claude Agent SDK 调用
   - Codex：通过 OpenAI app-server 方式接入
6. **Codex 的角色**：流程中的一个节点
7. **流程编辑器形态**：n8n 式节点拖拽
8. **定时触发**：流程可以配置定时执行
9. **数据存储**：
   - 流程配置/项目元数据：应用数据目录（文件系统）
   - 执行日志：SQLite
10. **Out of Scope（明确不做）**：
    - AI 画布
    - 移动端应用
    - 商业化/多租户

## 5. Moving Blocks（还在动，暂不入 REQ）

以下部分尚未完全确定，需要在后续阶段继续细化：

1. **具体节点列表**：用户表示"节点再说，架构搭出来节点很容易加"，但 MVP 至少需要哪些基础节点仍需设计。
2. **流程配置格式**：JSON vs YAML 未定。
3. **Workspace 默认路径**：未定。
4. **Skill 仓库位置配置方式**：未定。
5. **API key / 认证管理**：用户表示"不需要管"，但实际接入 Codex/Claude Code 仍需某种形式的配置。
6. **结果展示 UI 形态**：只知道由最后一个节点决定，但应用内如何展示未定。
7. **国产模型替代 Codex 的策略**：什么场景替代、如何配置未定。

## 6. Implementation Decisions

### 6.1 架构分层

```
┌─────────────────────────────────────┐
│  UI Layer (React + React Flow)      │
│  - Workspace/Project 管理            │
│  - 流程编辑器                         │
│  - 执行日志/结果展示                   │
├─────────────────────────────────────┤
│  Tauri Commands (Rust Bridge)       │
│  - 文件系统操作                       │
│  - 子进程管理                         │
│  - SQLite 访问                        │
├─────────────────────────────────────┤
│  Core Services                      │
│  - ProjectService                   │
│  - SkillService                     │
│  - FlowEngine                       │
│  - AgentAdapter (ClaudeCode/Codex)  │
│  - ScheduleService                  │
│  - LogService                       │
├─────────────────────────────────────┤
│  External Agents                    │
│  - Claude Code (Agent SDK)          │
│  - Codex (app-server)               │
└─────────────────────────────────────┘
```

### 6.2 关键模块

- **ProjectService**：管理 Workspace 和项目，支持本地目录和 git clone。
- **SkillService**：读取 skill 仓库，维护项目到 skill 的软链接。
- **FlowEngine**：解析流程图，按拓扑顺序执行节点，处理数据流和错误。
- **AgentAdapter**：统一抽象，底层分别调用 Claude Code Agent SDK 和 Codex app-server。
- **ScheduleService**：基于 cron 或类似机制，定时触发流程。
- **LogService**：把执行日志写入 SQLite，支持按项目/流程/执行ID 查询。

### 6.3 数据模型（初稿）

- **Workspace**：id, path, name
- **Project**：id, workspaceId, name, sourceType(local/git), sourcePath, localPath
- **Skill**：id, name, repoPath, version
- **ProjectSkill**：projectId, skillId, linkPath
- **Flow**：id, projectId, name, config（节点/边）, schedule, enabled
- **Execution**：id, flowId, startedAt, endedAt, status, logs[]

## 7. Testing Decisions

### 7.1 测试 seams

1. **FlowEngine**：输入节点配置 + 模拟节点执行器，验证执行顺序、数据传递、错误处理。
2. **AgentAdapter**：通过 mock server/SDK 验证调用协议正确性，不依赖真实 agent。
3. **ProjectService**：在临时目录中创建/删除项目，验证文件系统操作。
4. **SkillService**：验证软链接创建、读取、失效处理。
5. **ScheduleService**：用虚拟时间或短周期任务验证触发机制。

### 7.2 测试类型

- **单元测试**：核心服务逻辑（Rust/TS 均可）。
- **集成测试**：Tauri command 层 + 核心服务 + SQLite。
- **E2E 测试**：启动应用，完成"创建项目 → 设计流程 → 手动触发 → 查看日志"完整路径。
- **手动测试**：真实调用 Claude Code / Codex，验证 agent 节点行为。

## 8. Out of Scope

- AI 画布（后续开发）
- 移动端应用（直接用 Codex 移动端）
- 商业化/多租户/权限系统
- 复杂的用户认证和 API key 管理（MVP 阶段）
- 内嵌 comfyui / running hub 工作流（依赖 AI 画布）
- 飞书集成（未来可能做，但不在 MVP）

## 9. Further Notes

- 本项目是个人内部工具，优先验证"能不能提高效率"，不要过度工程化。
- First wedge 建议为"热点新闻抓取"流程，能完整验证项目、skill、流程、agent 节点、定时、日志、结果展示。
- 架构设计时要预留节点扩展接口，方便后续增加 HTTP、文件、通知、条件分支等节点。
- 成本敏感，后续需考虑 codex 节点何时可被国产模型替代。
