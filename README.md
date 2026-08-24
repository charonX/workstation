# OPC Workstation

> **你的本地个人 AI 自动化工作台** —— 把需要 AI 思考和判断的事交给 Agent，把繁琐固定的流程交给系统自动跑。支持多模型对话、可视化工作流拖拽、定时任务调度与飞书等消息通道联动。

---

## 🌟 核心功能（人话版）

### 1. 🤖 灵活的 AI 智能对话（会话区）
- **多模型自由切换**：支持主流大模型（Claude、OpenAI、DeepSeek、Gemini 及各类兼容接口），随时无缝切换不同厂商和端点。
- **看得见的工具调用**：AI 不仅能聊天，还能读写本地文件、查阅代码、执行终端命令，执行了什么一目了然。
- **高危操作安全拦截**：遇到删除文件、修改重要配置或危险脚本时，会自动弹出授权确认卡片，必须你点头才执行，绝不擅自越界。
- **长会话智能折叠**：长对话自动按轮次折叠收起，代码高亮、Markdown 排版、公式与 Mermaid 流程图原生精美渲染。

### 2. ⚡ 可视化工作流编排（Flows）
- **像搭积木一样连线**：提供可视化画布（React Flow），自由拖拽触发器、输入变量、AI 节点、脚本执行器和输出节点。
- **复杂任务链式流转**：把“读取内容源 -> AI 翻译总结 -> 数据清洗 -> 生成报告 -> 发送到飞书”串成一条自动化流水线。

### 3. ⏰ 定时调度与自动化（Schedules & Tasks）
- **无人值守定时跑**：设置标准的 Cron 表达式（如每天早 8 点、每隔 2 小时），后台准时自动拉起对应的工作流。
- **执行日志与轨迹回溯**：每次自动执行都有完整的日志记录、中间变量和输出结果，随时回查与排错。

### 4. 📢 内容源与消息通道联动（Sources & Channels）
- **多源数据摄取**：统一管理 RSS 订阅、Git 代码仓库、本地文件监听等多种内容源。
- **飞书机器人长连对接**：内置飞书通道适配器，长连接接收群聊/私信指令，AI 处理后自动回传结果，在手机飞书上也能随时触发和查看。

### 5. 🧩 Skill 与 MCP 扩展生态
- **技能一键安装**：支持从 Git 仓库、本地文件、Claude Plugin 等多种来源安装和挂载自定义 Skill。
- **MCP 协议支持**：兼容 Model Context Protocol，即插即用各类外部 MCP Server 工具。

### 6. 🔒 本地优先，隐私第一
- **数据全在本地**：所有对话轨迹、工作流定义、项目配置均保存在本地 SQLite 数据库，不上传第三方服务器。
- **系统级密钥加密**：所有 API Key 均接入 macOS Keychain / 系统安全加密区保存，绝不明文裸露。

### 7. 💻 极客友好的 CLI 命令行工具
- **免图形界面运行**：提供独立命令行工具 `opc-workstation`，与桌面应用共享底层数据，适合脚本调用或服务器后台运行。

---

## 🚀 快速安装与使用（macOS）

### 下载与安装

1. 前往 [GitHub Releases](https://github.com/charonX/workstation/releases) 页面下载最新版本的 `.dmg` 安装镜像（如 `opc-workstation-0.2.0-arm64.dmg`）。
2. 双击打开 DMG，将 **OPC Workstation** 拖入系统的 **Applications（应用程序）** 文件夹。
3. **首次打开提示拦截处理**：
   - 首次启动若提示“无法验证开发者”，请打开 macOS **系统设置 > 隐私与安全性**（System Settings > Privacy & Security）。
   - 在页面下方的安全性区域，点击 **「仍要打开」(Open Anyway)** 即可正常启动。

---

## 🛠️ 开发者指南

### 环境要求
- Node.js 22+
- npm 11+
- [GitHub CLI (gh)](https://cli.github.com/)（仅发布新版本时需要，需先 `gh auth login`）

### 安装依赖与启动开发

```bash
# 1. 克隆代码并安装依赖
git clone https://github.com/charonX/workstation.git
cd workstation
npm install

# 2. 启动开发模式（支持热重载）
npm start
```

### 测试

```bash
# 运行全部单元测试与集成测试
npm run test:unit

# 运行 Playwright E2E 测试
npm run test:e2e
```

### 本地打包构建

```bash
# 打包桌面应用可执行文件
npm run package

# 生成 DMG 与 ZIP 完整分发安装包（产物位于 out/make 目录）
npm run make
```

### 发布新版本（自动化）

```bash
# 发布预检（dry-run，不产生任何副作用）
node src/cli/opc-workstation.js release 0.2.0 --dry-run

# 正式发布（自动 bump 版本、编译打包、git commit & push、创建 GitHub Release 并上传 dmg/zip）
node src/cli/opc-workstation.js release 0.2.0
```

---

## 📂 项目结构概览

```
.
├── src/
│   ├── main/             # Electron 主进程与系统级集成
│   ├── renderer/         # 前端 React 页面与组件
│   │   ├── pages/        # 页面（对话区、仪表盘、项目、流程、技能、设置等）
│   │   └── components/   # 可复用组件（会话流、Flow 画布、节点配置等）
│   ├── agent/            # AI Agent 运行时、工具适配与事件流调度
│   ├── flowEngine/       # 工作流执行引擎
│   ├── http/             # 本地内置 HTTP API 服务与路由
│   ├── services/         # 核心业务逻辑（会话、配置、模型、密钥等）
│   └── cli/              # 命令行工具 opc-workstation
├── out/                  # 打包构建产物目录
├── tests/                # 自动化测试用例集
└── forge.config.js       # Electron 打包分发配置
```

---

## 📄 开源协议

本项目基于 MIT 协议分发。
