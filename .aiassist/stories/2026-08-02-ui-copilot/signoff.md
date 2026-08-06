# 断言签核记录 — 2026-08-02-ui-copilot

> 门 1：ASSERTION-SIGNOFF
> 日期：2026-08-06
> 方式：人签核（用户确认「签核」，默认接受推荐值，见「断言裁决」）

## 签核范围

- **REQ**：REQ-AGENT-026~034（9 条，requirements v1，hash `8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012`）
- **测试**：17 文件 85 用例（api 12 文件 64 例 + e2e 5 文件 21 例），`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/`
- **UX 参照**：`ux/assistant.html`（approved）
- **实现契约**：见 `test-plan.md`「实现契约」节（testid 集 / nav-notifications 补条目 / 种子 seam ×2 / 新模块 public seam 5 处）

## 断言裁决（人拍板）

| # | 裁决项 | 签核值 |
|---|---|---|
| 1 | 错误码 | `E-SESSION-CREATE`（无效 projectId）、`E-SESSION-NOT-FOUND`（spaceKey 不存在，GET/POST 同契约）、`E-SESSION-READONLY`（feishu 写） |
| 2 | 错误优先级 | **403 E-SESSION-READONLY 先于 409 E-AGENT-CONFIG**（只读是空间属性，与 agent 配置无关） |
| 3 | 历史响应封套 | `{ messages: [...] }`，条目含 `messageId/role/createdAt`；messageId = 非空字符串（不强制 UUID） |
| 4 | title 截断 | `slice(0, 40)` 无省略号 |
| 5 | 分页 | 默认取最新 limit 条、数组时间升序；`before` 游标 = messageId；默认 limit=100；≤100 全量断言足够，101+ 重测试不补 |
| 6 | FS 工具命名 | `read / write / bash`（小写）；default 空间 = CLI 基线等式（以 REQ-AGENT-012/013 签核基线为准） |
| 7 | /reset 触发 | composer 发 `/reset` 斜杠命令（无专门按钮） |
| 8 | 确认文案 | approve 回投「执行结果」语义、reject 回投 confirmationService 既有注入 `操作已取消`；「已处理」措辞不作字面契约（观感入 REFLECT） |
| 9 | feishu HTTP reset | **403 E-SESSION-READONLY**（与写消息同原则） |
| 10 | feishu chat 名 seam | 候选 A：`agent_space_meta(spaceKey, displayName)` 侧表 |
| 11 | SSE 事件契约 | `text_start/text_delta/text_end` 子序列严格有序 + 拼接一致；允许辅助事件（心跳帧）交错；`confirmation-pending` 字段 = `confirmId/operation/description` |
| 12 | 输入上限 | 300KB 明确越界 → 400；精确边界值不额外断言（enforceSizeLimit 既有回归覆盖）；空文本 400 不强制 code |
| 13 | 权限策略文件 | gotgenes 约定格式（`<cwd>/.pi/extensions/pi-permission-system/config.json` 路径随 H3 spike 确认）；全局策略应用资源只读默认 |
| 14 | 只读工具 cwd 外路径 | **首版 = ask**（gotgenes external_directory 默认语义） |
| 15 | CLI 查询/直跑类（task list/run） | **默认 allow**（附录 A 补记） |
| 16 | 孤儿组 projectName | `null`（不回填 pid） |
| 17 | 会话条目字段集 | `title/lastActiveAt/sessionRef` 最小集 |
| 18 | cwd 归一化 | realpath 归一化比较 |
| 19 | 错误用户文案措辞 | 不作字面契约（i18n 直译，英文观感入 REFLECT——照 builtin-agent 签核裁决 2 惯例） |
| 20 | E2E SSE 即时追加 | 归集成套件覆盖，E2E 不强制（通道侧注入 seam 成本高） |

## 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`
- [x] PRD 第 6-8 节已覆盖（§6.2 分支表 + §7 验证规则 + §8 错误状态）
- [x] 每个 REQ-ID 都有对应测试（9/9，回溯检查见 test-plan.md）
- [x] 每个测试文件有 REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE
- [x] capability/entity 与 business-capabilities.md 一致（agent-dialogue / conversation-space）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（全部替换为 signoff 标记）
- [x] 预期值来源 = 人签核裁决（上表），非代码输出
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖（403/409/404/400、孤儿/只读/未配置/流式中断/断线重连/幂等/并发隔离）
- [x] signoff.md 已创建，随 `[test] assertion-signoff` commit 提交

## spike 前置（M2 BUILD 前，非门 1 阻塞）

| # | 假设 | 涉及 REQ | 验证方式 | 失败预案 |
|---|---|---|---|---|
| H3 | gotgenes 嵌入 config 发现正常 | REQ-AGENT-033 | spike：嵌入装配 → 两级策略生效 | ADR-017 回退自实现 tool_call 钩子 |
| H4 | gotgenes 单进程多会话隔离 | REQ-AGENT-033 | spike：双会话并发 ask 隔离 | 同上 |
| H5 | 多 AgentSession 多 loader 共存 | REQ-AGENT-031/032 | spike：双空间装配独立 | 同上 |

## 备注

- 回归基线种子：sessionReset feishu 世代制例、uiConfirmation 队列级回归例（解耦/幂等/共存）当前即绿——设计使然（既有语义回归）。
- 管理区补「通知」条目（nav-notifications）是唯一触碰既有 UI 的点，builtin-agent 既有 E2E 需回归确认。
