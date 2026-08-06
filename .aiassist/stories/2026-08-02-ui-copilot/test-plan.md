# 测试计划 — 2026-08-02-ui-copilot

> 生成阶段：TEST（/test-author）
> 日期：2026-08-06
> 输入：requirements v1（hash 8432c0cf）+ tech-design v1 + ux/assistant.html（approved）
> 组织：`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/`

## REQ ↔ 测试映射

| REQ | seam | 测试类型 | 文件 | 用例数 | 原型映射 |
|---|---|---|---|---|---|
| REQ-AGENT-026 双区信息架构 | Playwright Electron | E2E | `e2e/assistantNav.test.cjs` | 5 | ✅ 左导五要素/管理区八条目/返回对话 |
| REQ-AGENT-027 空间=会话 | HTTP API + sessionStore | 单元+集成 | `api/sessionSpace.test.js`、`api/sessionReset.test.js` | 10 | — |
| REQ-AGENT-027 AC4 E2E 面 | Playwright Electron | E2E | `e2e/assistantSessions.test.cjs`（/reset→新会话） | 1 | ✅ 项目行＋/新对话空态 |
| REQ-AGENT-028 对话收发+SSE | HTTP API + SSE(FAUX) + E2E | 集成+E2E | `api/sessionMessage.test.js`（7）、`api/sessionEvents.test.js`（5）、`e2e/assistantChat.test.cjs`（2） | 14 | ✅ 流式渲染/按钮置灰 |
| REQ-AGENT-029 分组列表与回看 | HTTP API + E2E | 集成+E2E | `api/sessionList.test.js`（5）、`e2e/assistantSessions.test.cjs` | 5 | ✅ 分组/active/展开收起 |
| REQ-AGENT-030 内联确认卡 | HTTP API + SSE + 确认端点 | 集成+E2E | `api/uiConfirmation.test.js`（6）、`e2e/assistantConfirm.test.cjs`（4） | 10 | ✅ 确认卡渲染/已处理态 |
| REQ-AGENT-031 SKILL.md 注入 | fake worker session-config | 集成 | `api/skillInjection.test.js` | 6 | — |
| REQ-AGENT-032 FS/脚本工具面 | fake worker session-config | 集成 | `api/workerAssembly.test.js`（5）、`api/toolSurface.test.js`（4） | 9 | — |
| REQ-AGENT-033 权限策略 | 策略评估 + 授权桥全链 + E2E | 单元+集成+E2E | `api/permissionPolicy.test.js`（8）、`api/authorizerBridge.test.js`（6）、`e2e/assistantFeishu.test.cjs`（标准 6：无权限 tab） | 15 | ✅ 确认卡交互（联动） |
| REQ-AGENT-034 飞书只读 | HTTP API + E2E | 集成+E2E | `api/feishuReadonly.test.js`（2）、`e2e/assistantFeishu.test.cjs` | 7 | ✅ 只读视图/无输入区/孤儿 |

**合计**：17 文件 / 85 用例（api 12 文件 64 例 + e2e 5 文件 21 例）

## 回溯检查

- [x] 每个 REQ ≥1 自动化测试（上表全覆盖，含 E2E 面与错误路径）
- [x] 无「人工(仅视觉)」REQ——9 条 REQ 全部有结构/行为自动化验证
- [x] 每文件头部 REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE / TEST-AUTHOR / ASSERTIONS-SIGNED: false
- [x] 预期值占位 `TODO: HUMAN ASSERTION` 待签（见下节）

## 待签核决策（门 1 签核项）

### 断言占位（人签 expected 值）
| 类别 | 占位内容 | 位置 |
|---|---|---|
| 错误码文案 | E-SESSION-CREATE / E-SESSION-NOT-FOUND / E-SESSION-READONLY 文案与优先级（403 先于 409） | sessionMessage/sessionSpace/sessionReset |
| 响应形态 | `GET .../messages` 历史封套 = `{messages:[...]}` vs 裸数组；messageId 游标语义 | sessionMessage/sessionEvents/E2E |
| title 截断 | 40 字无省略号（截断行为是否加 …） | sessionSpace |
| 分页语义 | `?limit&before` 窗口 = 最新 N 条升序；默认 100 | sessionList |
| 工具清单 | FS 工具确切命名（read/write/bash vs 其他）与 CLI 工具面全集 | toolSurface |
| 权限 reason 文案 | 授权桥 deny 回喂 agent 的工具错误文案 | authorizerBridge |
| /reset 触发 | composer 发 "/reset" vs 专门 UI 按钮 | assistantSessions |
| 确认文案 | approve/reject 回投措辞、「已处理」标注措辞（×3） | assistantConfirm |
| feishu reset | HTTP reset 到 feishu:* 返回 403 vs 200（择一） | sessionReset |
| chat 名元数据 | feishu 组显示名注入 seam（候选 `agent_space_meta` 侧表） | sessionList |

### 实现契约（implementer 必须遵守，签核时确认）
| 契约 | 说明 |
|---|---|
| testid/属性集 | 五套 E2E 文件头「实现约定」块：screen-assistant/screen-admin/data-session-group/data-add-project/data-confirm-card/data-message-role/data-streaming 等 |
| `nav-notifications` testid | 管理区左导现缺「通知」条目（仅 7 条），REQ-026 AC2 要八条目——补该条目 |
| 种子 seam ×2 | `window.opc.__seedAgentConfirmations`（直写挂起行）、`window.opc.__seedAgentSessions`（造飞书/孤儿会话）——仿 `opc-seed-notifications` 先例 |
| 新模块 public seam | `src/http/routes/agentSessions.js`、`src/services/permissionPolicy.js`、`src/services/permissionBridge.js`、`src/agent/skillAssembly.js`、`toolAdapter.createSessionToolSurface`——测试以动态导入断言 |
| session-config 扩展 | `cwd`/`skillPaths`/`permissionProfile` 三字段按空间下发 |

## spike 前置（signoff 检查项）

H3（gotgenes 嵌入 config 发现）/ H4（单进程多会话隔离）/ H5（多 loader 共存）——M2 REQ（031/032/033）签核后、BUILD M2 前 spike；失败按 ADR-017 回退预案（自实现 tool_call 钩子），REQ 语义不变。

## REFLECT 人工验收备注（纯审美，不进 REQ）

- 流式渲染体感（逐字顺滑度、长回复）
- 确认卡/气泡/空态/引导态观感（含暗色主题）
- 会话区/管理区往返体验与导航直觉性
- en-US 下新界面元素译文观感（照 builtin-agent 签核裁决 2 惯例：实现按 i18n 直译，英文观感留 REFLECT）

## 备注

- 回归基线的种子：sessionReset 的 feishu 世代制例、uiConfirmation 的队列级回归例（解耦/幂等/共存）当前即绿——设计使然（标准 5 类「既有语义回归」），非误报。
- builtin-agent 既有套件（REQ-AGENT-001~025）不受本 story 影响；管理区左导补「通知」条目是唯一触碰既有 UI 的点，其既有 E2E 需回归确认（settingsTabs 等三套件导航适配先例同型）。
