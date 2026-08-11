# Build Progress — 2026-08-11-pi-agent-modes

> 阶段：BUILD（门 1 已签核，signoff.md 2026-08-12，人授权直接开发）
> REQ：REQ-AGENT-070~077（requirements v1，hash 3e5839b7）
> 测试契约：3 文件（api 2 + e2e 1），ASSERTIONS-SIGNED: true，实现者只读

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-070/072/077 | modeService 模式服务（主进程）：三档会话级状态 + 全局 lastMode（settings agent.lastMode 持久化，首次 auto / 非法回落 standard）+ 模式不改 .pi 持久配置 | — | done |
| 2 | REQ-AGENT-073/074/075/076 | auto-judge link（worker 评估链）：authorizerChain 模型判断（allow/deny/defer + reason）+ envelope excluded 面 + 熔断计数 + review log | 1 | done |
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

### Slice 2：auto-judge link（commit 见下）

- 实现：`src/agent/autoJudgeLink.js`（新）——`createAutoJudgeLink({ decide, denyThreshold = 5, onTripped, reviewLogPath, decideTimeoutMs = 5000 })` → `{ authorize }`（gotgenes link 契约 `authorize(details, query, log)`，authorizer.ts 实证）：
  - **decide 注入缝**：decide 异步 `(details) => { kind, reason? }`；默认实现 `defaultDecide`（S2 骨架）读 settings agent provider 配置（`<configDir>/settings.json` agent.provider，configDir = OPC_WORKSTATION_CONFIG_DIR / ~/.opc-workstation）——未配置 → throw（link 映射 call-failed defer，REQ-AGENT-073 标准 4）；已配置 → S3 接线前 fail-safe 显式 defer（decide-deferred，不静默放行）；
  - **判定映射**（fail-safe，deny-first）：allow → `{kind:"allow"}`（重置熔断计数）；deny → `{kind:"deny", reason}`；defer/模型失败（decide throw → call-failed）/超时（decideTimeoutMs 兜底 → timeout）/回复不可解析（kind 非 allow/deny/defer → model-unresolved）→ `{kind:"defer"}`；deferReason 枚举（model-unresolved/timeout/call-failed/decide-deferred），非枚举 reason 回落 decide-deferred；
  - **熔断**（REQ-AGENT-075）：实例级 denyStreak（每会话独立实例，对齐 permissionBridge H4）——deny +1、allow 清零、`denyStreak === denyThreshold` 首次跨阈触发 `onTripped()`（继续 deny 不重复触发，allow 重置后重新计数；降级 standard 动作属 S3 接模式服务）；
  - **review log**（REQ-AGENT-076）：每次判断 JSONL 追加写 `{requestId, surface, toolName, input?, verdict, reason?, deferReason?, latencyMs, ts}`（ts = ISO，对齐 gotgenes logging.ts 形态）；requestId 缺失生成；surface 双形态（accessIntent.surface 优先回退 surface）；input 双形态（details.input / command/path/target）；写失败 try/catch 警告不致命（E4）。
- 测试：`node --test tests/capabilities/agent-dialogue/conversation-space/2026-08-11-pi-agent-modes/api/autoJudgeLink.test.js` → **7/7 绿**（REQ-073 4 例 allow/deny+reason/defer/provider 缺失 + REQ-074 envelope 实证 1 例（jiti 加载 gotgenes 源码，不依赖本实现）+ REQ-075 熔断 1 例 + REQ-076 review log 1 例）。自建临时 harness 9/9 绿（不进契约不提交，已删）：熔断只触发一次 + allow 重置、超时 → defer、不可解析 verdict → defer、deferReason 枚举/回落、deny 无 reason、默认 decide 双态（无 provider / 有 provider）、log 字段形态、写失败不致命、gotgenes 原生 details 双形态。
- lint：`npx oxlint src/agent/autoJudgeLink.js` 0 警告（query/log 契约参数按 oxlint 约定下划线前缀）。
- refactor：无（新文件单职责，无重构面）。

#### PRD→代码 可追溯性表（Slice 2）

| PRD 块 / REQ | 验收标准 | 实现（src/agent/autoJudgeLink.js） | 测试（autoJudgeLink.test.js） | 状态 |
|---|---|---|---|---|
| B4 / REQ-AGENT-073 auto 引擎 | 标准 1 判安全 allow 直执行；标准 2 deny + teaching reason；标准 3 判断不了/模型失败/超时 → defer；标准 4 provider 未配置 → defer | decide 注入缝 + 判定映射（allow / deny+reason / defer fail-safe 全分支）；默认 decide 骨架读 settings agent.provider（未配置 throw → call-failed defer） | 标准 1-4 用例（4/4 绿） | COVERED（S2 验收面 = link 判定本身；链序 `["auto-judge","opc-bridge"]` 与落确认卡属 S3 接线集成） |
| B5 / REQ-AGENT-074 envelope 从严 | 标准 1 excluded 面 allow 降级 defer；标准 2 deny 有效 | 零实现（gotgenes delegation-envelope.ts 系统强制，DELEGATION_EXCLUDED_SURFACES = {external_directory, path}） | envelope 实证用例（jiti 加载 gotgenes 源码直接验证，不依赖本实现） | COVERED（实证；envelope 对本 link 的强制在 S3 registerAuthorizer 后生效） |
| B6 / REQ-AGENT-075 熔断 | 标准 1 连续 deny 达 N 降级；标准 3 allow 重置计数 | 实例级 denyStreak + denyThreshold 注入（默认 5）+ 跨阈首次 onTripped() 回调（allow 清零） | 熔断用例（denyThreshold=2 注入 → 2 次 deny 触发 1 次） | COVERED（S2 = 熔断回调触发；降级 standard + 提示属 S3 接模式服务） |
| B7 / REQ-AGENT-076 auto 可观测 | 标准 1 每次判断一条记录；标准 2 defer 含 deferReason；标准 3 surface + latencyMs | reviewLogPath 注入（默认对齐 gotgenes permission review log 路径）+ JSONL 追加写 {requestId, surface, toolName, input?, verdict, reason?, deferReason?, latencyMs, ts}；写失败 try/catch 警告 | review log 用例（verdict=defer + latencyMs 存在） | COVERED |

- 状态口径同 Slice 1。REQ-AGENT-073 标准 5（链序 defer 落回 opc-bridge 确认卡）与 REQ-AGENT-075 标准 2/4（降级提示、手动切回）依赖 S3 接线（worker 内 registerAuthorizer + 模式服务联动），S3 记录。

#### Slice 2 concern（无测试契约冲突，供 S3 接线参考）

1. **decide 的 defer 通信**：decide 契约 `{kind, reason?}`——defer 场景 reason 若为枚举值（model-unresolved 等）会被 log 原样采用，其余一律 decide-deferred（白名单归一）。S3 默认 decide 内部不可解析模型回复时返回 `{kind:"defer", reason:"model-unresolved"}` 即可对齐日志枚举。
2. **gotgenes 注入的 AuthorizerLog（authorize 第三参）本切片未使用**：B7「对接既有 permission review log」通过 reviewLogPath 默认指向同一文件（`<agentHome>/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`）实现；若 S3 需要 gotgenes 原生 review 落点（按 requestId 关联 gate 条目），可在接线时额外调 `log.review("auto_judge.decision", ...)`（本链路已保留该 seam）。
3. **超时兜底 timer 为 unref**（不 hold 进程，对齐 worker 既有模式）；worker 事件循环常驻（IPC），decide 悬挂时 5s 后仍会如期触发 defer。
4. **熔断回调语义**：跨阈首次触发后继续 deny 不重复回调（REQ-AGENT-075 标准 1 断言一次触发）；allow 重置后重新计数。S3 降级后用户手动切回 auto 时若需清零计数，可重建 link 实例或注入 onTripped 侧处理。
