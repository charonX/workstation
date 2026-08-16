# 测试计划 — PI 插件管理与 MCP 支持（2026-08-12-pi-mcp-plugin）

> 版本：v1
> 最后更新：2026-08-13
> 输入：`requirements.md` v1（hash `080af1f4…`）、`tech-design.md` v1 seams、`ux/*.html`（已定稿）
> 状态：骨架已生成，断言待门 1 签核（全部文件 `ASSERTIONS-SIGNED: false`）

## 目录与 seam 总览

| REQ | seam | 测试文件 | 类型 |
|---|---|---|---|
| REQ-AGENT-078 | 既有全量套件（agent-dialogue 356+ 用例即回归网） | —— 无新增测试文件 | 单元+集成+E2E（存量） |
| REQ-AGENT-079/080/081 | extensionService API（临时 agentDir + fixture 包） | `extension/.../api/extensionService.test.js` | 集成+单元 |
| REQ-AGENT-082/089 | worker 装配缝（`src/agent/sessionAssembly.js`，BUILD 暴露） | `extension/.../api/workerAssembly.test.js` | 集成 |
| REQ-AGENT-083 | 管理区页面（ux/plugins-page.html testid 契约） | `extension/.../e2e/pluginsPage.test.cjs` | E2E |
| REQ-AGENT-084 | mcpService API（测试库） | `mcp-server/.../api/mcpService.test.js` | 集成+单元 |
| REQ-AGENT-084（UI） | MCP 表单（ux/plugins-page.html testid 契约） | `extension/.../e2e/pluginsPage.test.cjs`（同文件 describe） | E2E |
| REQ-AGENT-085 | fixture stdio server 全链路（调用日志断言点） | `mcp-server/.../api/mcpBridge.test.js` | 集成 |
| REQ-AGENT-086 | broker→授权桥 link（`src/agent/mcpBrokerLink.js`，BUILD 产物） | `mcp-server/.../api/mcpPermissionBroker.test.js` | 集成 |
| REQ-AGENT-087 | policyRules.js + gen-agent-policy --check + gotgenes 对照矩阵 | `mcp-server/.../api/policyRulesMcp.test.js` | 集成 |
| REQ-AGENT-087（UI） | 权限配置页 mcp 分组（ux/permission-mcp-group.html testid 契约） | `mcp-server/.../e2e/permissionMcpGroup.test.cjs` | E2E |
| REQ-AGENT-088 | 飞书通道入口会话（通道 mock） | `mcp-server/.../api/channelParity.test.js` | 集成 |
| REQ-AGENT-090 | CLI 真实命令（execFileSync） | `command-interface/cli/.../cli/pluginMcpCli.test.js` | CLI 测试 |

测试根目录：`tests/capabilities/plugin-management/{extension,mcp-server}/2026-08-12-pi-mcp-plugin/`、`tests/capabilities/command-interface/cli/2026-08-12-pi-mcp-plugin/`。

## 来自 HTML 原型的映射（强制提取）

| 原型 | 提取的可验证项 | 落到 |
|---|---|---|
| ux/plugins-page.html | 页面容器/添加按钮/弹窗/来源输入/安全告知条/行/错误行/项目启用切换 存在性；添加成功/失败流；切换持久；MCP 表单类型切换与 URL 校验 | pluginsPage.test.cjs（REQ-083/084） |
| ux/permission-mcp-group.html | mcp 族分组存在；规则行三态切换持久；新增 server:tool 规则 | permissionMcpGroup.test.cjs（REQ-087） |
| ux/oauth-present.html | 授权卡/通知条存在性与状态流转 | 见下「人工验收」——OAuth 链路一期无本地 fixture，仅结构项可由 BUILD 时组件测试补 |

## 断言待签核点（门 1 重点）

1. **extensionService 工厂签名与 PluginRow 字段命名**（名称/来源/版本/scope/错误态）——多个 TODO: HUMAN ASSERTION。
2. **项目启用落盘形态**：`.pi/settings.json` 的 `+`/`-` 模式字段名与停用语义（写 `-` vs 剔除）。
3. **worker 装配缝形态**：`sessionAssembly.js` 是否作为新可测缝暴露（BUILD 前与 spike ①② 一起定）。
4. **mcp 出厂规则集**：policyRules golden 中 mcp 族的具体规则（默认 ask 姿态下的出厂条目）。
5. **CLI 参数形态**：`plugin enable --project`、`mcp add --type stdio --command` 的参数风格。
6. **缺包报错文案**：「请到插件页重装」指引的具体措辞。

## 人工验收（REFLECT，仅限无法自动化项）

- OAuth 授权流程体验（真实 OAuth server 走一遍；ux/oauth-present.html 为呈现参照）——一期无本地 OAuth fixture，tech-design 已记。
- 插件页/MCP 表单/权限分组的视觉观感（颜色/间距/密度，纯审美）。

## 回溯检查

- 13 条 REQ 全部有自动化测试锚点；REQ-078 依 crystallize 分类（全量回归），无新增文件属合法。
- 骨架已验证可运行：全部失败原因 = 预期 RED（`seam 未就绪` / CLI 命令不存在 / golden 未含 mcp 族），无语法/导入崩溃。
