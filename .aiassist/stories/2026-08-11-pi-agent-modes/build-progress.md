# Build Progress — 2026-08-11-pi-agent-modes

> 阶段：BUILD（门 1 已签核，signoff.md 2026-08-12，人授权直接开发）
> REQ：REQ-AGENT-070~077（requirements v1，hash 3e5839b7）
> 测试契约：3 文件（api 2 + e2e 1），ASSERTIONS-SIGNED: true，实现者只读

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-070/072/077 | modeService 模式服务（主进程）：三档会话级状态 + 全局 lastMode（settings agent.lastMode 持久化，首次 auto / 非法回落 standard）+ 模式不改 .pi 持久配置 | — | done |
| 2 | REQ-AGENT-073/074/075/076 | auto-judge link（worker 评估链）：authorizerChain 模型判断（allow/deny/defer + reason）+ envelope excluded 面 + 熔断计数 + review log | 1 | pending |
| 3 | 主进程接线 | 会话模式 ↔ worker 评估链 seam 接线（S1 服务暴露给评估链读取）；具体形态父代理确认 | 1, 2 | pending |
| 4 | REQ-AGENT-071 | renderer 对话区模式切换工具栏（三档下拉 + 可扩展槽位） | 1, 2 | pending |
| 5 | REQ-AGENT-071 E2E | E2E 接线跑绿 + 全量回归（单测 + 既有 E2E 水位不退） | 3, 4 | pending |

## 关键 seam 契约速记（供子代理简报引用）

- 模式服务：`src/services/modeService.js`（新，本切片）——导出 `createModeService({ settingsService }?)`（测试无参调用）→ `{ getMode(spaceKey), setMode(spaceKey, mode), getLastMode(), setLastMode(mode) }`；`AGENT_MODES = ["strict","standard","auto"]`。
- lastMode schema 键：`settings.json → agent.lastMode`（modeService.test.js 手改用例实证：写 `{agent:{lastMode:"bogus"}}` 后 getMode → standard）。
- **读盘语义（关键）**：settingsService 有内存缓存（BUG-009 后 ensureLoaded 定格），`getLastMode` 每次从 settings.json 新鲜读盘（不经 loadSettings 缓存）——手改文件（REQ-AGENT-072 标准 4）立即可感知；写入经 `settingsService.saveSettings` 合并写盘（保留 agent 下 provider/apiKey 密文/identity/configured，不可被 lastMode 写覆盖）。
- 配置目录：`settingsService.configDir()`（OPC_WORKSTATION_CONFIG_DIR 注入 / 默认 ~/.opc-workstation）。
- REQ-AGENT-077：模式切换只动会话状态 + settings lastMode；绝不触碰 `<projectDir>/.pi/extensions/pi-permission-system/config.json`。
- worker link（S2，预告）：link 注册名 `auto-judge`，链序 `["auto-judge", "opc-bridge"]`；输出 `{kind:"allow"|"deny"|"defer", reason?}`；surface ∈ {external_directory, path} 由 gotgenes envelope 强制降级。

## Slice 记录

（每个 slice 完成后追加：实现 commit、测试结果、PRD→代码 可追溯性表、refactor 结果）

### Slice 1：modeService 模式服务（commit a8f58e0）

- 实现：`src/services/modeService.js`（新）——`createModeService()`（测试 seam：无参调用，`{settingsService}` 可选注入，默认引 settingsService）：
  - `getMode(spaceKey)`：会话显式切过 → 会话值；未切过 → `getLastMode()`（会话状态 Map 按 spaceKey 隔离，切会话/重开不保留——REQ-AGENT-070 标准 4 机制）；
  - `setMode(spaceKey, mode)`：写会话状态 + `setLastMode(mode)`（一次调用双写，REQ-AGENT-072 标准 1）；
  - `getLastMode()`：settings.json `agent.lastMode` **新鲜读盘**（绕过 settingsService 内存缓存——手改文件立即可感知，标准 4）；无记录 → `"auto"`（首次默认，标准 3）；非法值 → `"standard"`（回落，标准 4）；文件缺失/坏 JSON → `"auto"`；
  - `setLastMode(mode)`：新鲜读盘保留既有 settings（agent 下 provider/apiKey 密文/identity/configured 字段不被覆盖）→ `saveSettings({agent: {...agent, lastMode}})`；
  - REQ-AGENT-077：本模块不写任何 `.pi` 路径，只碰 settings.json。
- 测试：`node --test tests/capabilities/agent-dialogue/conversation-space/2026-08-11-pi-agent-modes/api/modeService.test.js` → **5/6 绿，1 红**（红为测试契约冲突，见下「Slice 1 裁决/concern」——实现按 PRD §10.4 + REQ-AGENT-072 契约执行，不为绿改语义）。自建临时 harness 11/11 绿（不进契约不提交）：agent 字段保留、会话隔离、非法回落、首次默认、.pi 不变。
- 回归：`tests/capabilities/workspace-management/settings/codex-harness-desktop/api/settings.test.js` → **7/7 绿**（settingsService 零改动，零回归）。
- refactor：无（新文件单职责，无重构面）。

#### Slice 1 concern（测试契约与需求契约冲突，未改测试——交父代理 / 人裁决）

**REQ-AGENT-070 标准 4 用例断言与 REQ-AGENT-072 标准 1+2 自相矛盾**（modeService.test.js:89-96）：

```js
await modeService.setMode("ui:copilot:a", "strict");
const fresh = modeService.getMode("ui:copilot:b");
assert.notEqual(fresh, "strict");   // ← 红
```

- 按 REQ-AGENT-072 标准 1：`setMode` 必须把 `"strict"` 写入 lastMode；按标准 2 + PRD §10.4（无显式切过 → lastMode）：新 spaceKey 初始 = lastMode = `"strict"` → 该断言必然失败。
- 用例自身注释即自相矛盾：「新会话…→ 回到 lastMode（非上个会话的 strict）」——「回到 lastMode」与「非 strict」在 lastMode=strict 时不可同时成立。
- 唯一能绿该用例的实现是「strict 不写 lastMode」（会话级不落全局）——直接违反 REQ-AGENT-072 标准 1 与 B3（settings 记录上次选择的模式），属「为绿而硬凑」，已排除。
- 建议裁决：断言改为 `assert.equal(fresh, "strict")`（b 无会话记录 → 初始 = lastMode = strict；会话隔离的机制面是「b 无会话条目、a 的会话条目不泄漏为会话值」，而非「lastMode 不含 strict」）；或测试作者明确标准 1 仅覆盖 auto 档（需改 requirements）。**本轮不改测试**，实现按契约（5/6 绿）交 QA 水位。

#### PRD→代码 可追溯性表（Slice 1）

| PRD 块 / REQ | 验收标准 | 实现（src/services/modeService.js） | 测试（modeService.test.js） | 状态 |
|---|---|---|---|---|
| B1 / REQ-AGENT-070 三档模式 | 服务契约 getMode(spaceKey)/setMode(spaceKey, mode) 三档会话级 | `getMode`/`setMode`（会话 Map 按 spaceKey；未切过 → lastMode） | 标准 4 用例 | COVERED（标准 4 用例断言与 072 冲突，红——见 concern；标准 1-3 行为面属 S2 worker 集成） |
| B3 / REQ-AGENT-072 全局 lastMode | 标准 1 setMode→lastMode 记录；标准 2 新会话=lastMode；标准 3 首次=auto；标准 4 非法→standard | `setLastMode`（saveSettings 合并写盘，保留 agent 字段）/ `getLastMode`（新鲜读盘：无记录→auto、非法→standard） | 标准 1-4 用例（4/4 绿） | COVERED |
| B8 / REQ-AGENT-077 模式不改持久配置 | 标准 1 切换任意档 → .pi 文件字节不变 | 模块不写任何 .pi 路径（只动 settings.json） | 标准 1 用例（1/1 绿） | COVERED |

- 状态口径：COVERED = 实现 + 业务测试均绿；PARTIAL = 实现完成但该 REQ 行为面未全覆盖；GAP = 未实现。
- 说明：REQ-AGENT-070 标准 1-3（strict 全确认/standard 按配置/auto 代问的**评估行为**）依赖 worker 评估链（S2 auto-judge link + 既有 opc-bridge）验证，本切片仅交付模式服务的状态/持久化契约；REQ-AGENT-072/077 本切片全量覆盖。
