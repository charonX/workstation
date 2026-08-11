# Test Plan — 2026-08-11-pi-agent-modes

> 阶段：TEST（test-author 骨架生成）
> REQ：REQ-AGENT-070~077（requirements v1，hash 3e5839b7）
> 目录：`tests/capabilities/agent-dialogue/conversation-space/2026-08-11-pi-agent-modes/`

## 测试文件与 REQ 映射

| 文件 | seam 类型 | 覆盖 REQ | 关键断言（签核 TODO 标注处） |
|---|---|---|---|
| `api/modeService.test.js` | API（模式服务 + settings 持久化） | 070/072/077 | lastMode 记录/新会话初始=lastMode/首次 auto/非法值回落 standard；会话级不残留；模式切换 .pi 文件不变 |
| `api/autoJudgeLink.test.js` | 集成（真实 gotgenes envelope）+ link 单测 | 073/074/075/076 | allow 直执行/deny 拦截+reason/defer 弹卡/provider 缺失 defer；envelope 强制（excluded allow→defer、deny 有效）；熔断 N 次降级 + allow 重置；review log 决策记录 |
| `e2e/modeToolbar.test.cjs` | 浏览器 E2E（Playwright Electron） | 071/072 | 工具栏 composer 下方纵向顺序；三档下拉展开+选择更新；未来槽位存在；auto 无提示；reload 后初始=lastMode |

## HTML 原型映射（ux/mode-toolbar.html → 测试）

| 原型元素 | 测试断言 | 来源 REQ |
|---|---|---|
| mode-toolbar（composer 下方） | E2E 纵向顺序 | 071 |
| mode-select 三档下拉（含描述+色点） | E2E 展开/选择/更新 | 071 |
| 未来槽位（模型/附件灰显） | E2E 存在性 | 071 |
| auto 无提示 | E2E 无 toast/banner | 071 |
| 模式仅影响当前会话 | API 会话级不残留 | 070 |

## seam 依赖清单（实现时接线）

1. `src/services/modeService.js`（新）：createModeService/getMode/setMode/getLastMode/setLastMode——settings 持久化 lastMode；**BUILD 产物，测试动态 import RED 失败**。
2. `src/agent/autoJudgeLink.js`（新）：createAutoJudgeLink——registerAuthorizer 注册 `auto-judge`；接用户 provider；`decide` 注入缝（测试用可编程判定）；denyThreshold/onTripped/reviewLogPath 可注入。
3. 项目 `.pi` 配置 authorizerChain `["auto-judge", "opc-bridge"]`（测试 fixture 写链）。
4. envelope 实证：jiti 加载 `node_modules/@gotgenes/pi-permission-system/src/authority/delegation-envelope.ts`（REQ-AGENT-074 标准 1 不依赖实现，直接验证 gotgenes 系统强制）。
5. E2E locator 契约：`[data-testid='mode-toolbar'|'mode-select'|'mode-trigger']` / `[data-mode='strict'|'standard'|'auto']` / `[data-testid='toolbar-slot-model'|'toolbar-slot-attach']`——实现时 renderer 对齐（原型语义）。
6. E2E 既有复用：startElectronApp({extraEnv: OPC_AGENT_FAUX}) + seedAgentConfig + SCREEN_ASSISTANT/composer-input locators。

## 留给 REFLECT 人工验收（仅纯审美）

- 工具栏视觉密度/下拉配色（严格红/标准蓝/自动绿色点）——原型 approved，实现后 REFLECT 对照。
- 无其他人工项：全部 REQ 有自动化断言。

## 签核状态

- ASSERTIONS-SIGNED: false（待门 1 人确认——本次人授权直接开发，signoff 时统一确认 TODO）。
- 签核 TODO 统计：modeService 7 处 / autoJudgeLink 9 处 / E2E 7 处。

## 覆盖回溯

| REQ | 测试覆盖 | 状态 |
|---|---|---|
| 070 | API 会话级不残留 + 集成三档行为（070 标准 1-3 归 autoJudgeLink/评估集成） | ✅ |
| 071 | E2E 5 项（顺序/下拉/槽位/无提示） | ✅ |
| 072 | API 4 项 + E2E reload | ✅ |
| 073 | link 4 项（allow/deny/defer/provider 缺失） | ✅ |
| 074 | envelope 实证 3 断言（excluded allow→defer/deny 有效/bash 原样） | ✅ |
| 075 | 熔断注入阈值 + allow 重置 | ✅ |
| 076 | review log 决策记录 | ✅ |
| 077 | 模式切换 .pi 文件不变 | ✅ |
