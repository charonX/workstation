# Interview Notes — codex-harness-desktop

## 核心问题

做一个内部自用的桌面 harness 应用（类似 NGSPilot），把 codex agent 能力通过 app-server 接入桌面端，并把多个 Claude Code skills GUI 化，实现 n8n 式的可视化流程编排。让用户可以在桌面应用里设计、定时触发并执行自动化流程，把需要人类判断的环节交给 codex/agent 节点，流程化步骤由应用本身执行。

## 用户画像

- 用户：开发者本人（单一用户，内部工具）
- 场景：日常需要抓取热点新闻、分析 TikTok/亚马逊榜单、自动更新网站等重复性工作流
- 目标：提高效率，不必自己守在电脑前做重复判断和操作
- 价值取向：不追求商业化，不追求"活下来"，只看能否真正提升个人效率

## 关键边界

1. **技术栈**：Tauri（Rust 后端）+ React + TypeScript + TailwindCSS + React Flow（流程编辑器）
2. **核心功能边界**：
   - 项目级 skill 管理（集中 skill 仓库 + 软链接加载到项目）
   - 通过 app-server 方式控制 Codex，使用 computer-use 等原生能力
   - 通过 Claude Agent SDK 调用 Claude Code
   - n8n 式节点拖拽流程编排
   - 定时触发流程执行
   - 流程间可互相调用（子流程）
3. **不做**：
   - AI 画布（后续再做）
   - 移动端版本（直接用 Codex 移动端即可，未来可能接飞书）
4. **数据存储**：
   - 流程配置、项目元数据：应用自己的数据目录（文件系统）
   - 执行日志：SQLite
5. **项目模型**：
   - 一个 workspace 包含多个项目
   - 项目是本地目录或 git 仓库
   - git 仓库自动 clone 到 workspace
6. **运行形态**：手动打开的桌面工具，非后台常驻服务
7. **成本**：Codex 可被国产模型替代，成本敏感

## 隐含假设

1. 用户已经有一个集中式的 skill 仓库，且 skill 是 Claude Code 标准格式（`SKILL.md` + 可选脚本）。
2. Codex app-server 可以稳定地在桌面应用内启动并接收连接。
3. Claude Code 可以通过 Claude Agent SDK 被外部程序调用。
4. 流程节点可以较容易地扩展，架构优先于具体节点实现。
5. 结果是流程的一部分，由最后一个节点决定存储位置。

## 矛盾/风险

1. **Tauri 的学习曲线**：如果用户不熟悉 Rust，Tauri 后端开发可能有门槛。
2. **Codex app-server 的稳定性**：OpenAI app-server 方式是否适合长期无人值守运行尚未验证。
3. **Claude Code vs Codex 的边界**：两者能力有重叠，用户需要明确什么场景用哪个 agent。
4. **过度工程风险**：作为一个内部工具，容易在架构上投入过多而延迟 first wedge 的可用性。
5. **软链接 skill 的维护**：项目级 skill 加载需要处理软链接失效、版本同步等问题。

## 最窄 first wedge

**热点新闻抓取流程**：
- 定时触发（如每天一次）
- 访问指定新闻源
- 由 codex/agent 节点判断哪些新闻有价值
- 输出结果到指定位置（文件或后续节点）
- 在应用中展示执行日志和结果

这个 first wedge 能验证：项目模型、skill 加载、定时触发、agent 节点调用、流程执行、日志存储、结果展示。

## 待确认问题

- [ ] skill 仓库的物理位置如何配置？
- [ ] workspace 的默认路径在哪里？
- [ ] 流程配置文件的格式是 JSON 还是 YAML？
- [ ] 是否需要用户认证或 API key 管理界面？（当前认为不需要）
- [ ] 第一个 codex 节点具体做什么？（热点新闻抓取中的判断逻辑）
