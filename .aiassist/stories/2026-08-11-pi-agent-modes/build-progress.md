# Build Progress — 2026-08-11-pi-agent-modes

> 阶段：BUILD（门 1 已签核，signoff.md 2026-08-12，人授权直接开发）
> REQ：REQ-AGENT-070~077（requirements v1，hash 3e5839b7）
> 测试契约：3 文件（api 2 + e2e 1），ASSERTIONS-SIGNED: true，实现者只读

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-070/072/077 | modeService 模式服务（主进程）：三档会话级状态 + 全局 lastMode（settings agent.lastMode 持久化，首次 auto / 非法回落 standard）+ 模式不改 .pi 持久配置 | — | done |
| 2 | REQ-AGENT-073/074/075/076 | auto-judge link（worker 评估链）：authorizerChain 模型判断（allow/deny/defer + reason）+ envelope excluded 面 + 熔断计数 + review log | 1 | done |
| 3 | 主进程接线 | 会话模式 ↔ worker 评估链 seam 接线（S1 服务暴露给评估链读取）；具体形态父代理确认 | 1, 2 | done |
| 4 | REQ-AGENT-071 | renderer 对话区模式切换工具栏（三档下拉 + 可扩展槽位） | 1, 2 | done |
| 5 | REQ-AGENT-071 E2E | E2E 接线跑绿 + 全量回归（单测 + 既有 E2E 水位不退） | 3, 4 | done |

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

### Slice 3：worker 接线（commit 见下）

- 实现面（PRD→代码 追溯见下）：
  - **模式状态与传播（REQ-AGENT-070 集成面）**：`src/services/agentService.js` 注入模式服务（`options.modeService` 可注入单例，缺省内部 `createModeService()`——测试零接线可用）；`buildConfigMessage` 携带 `mode`（modeService.getMode(spaceKey)——显式会话值/lastMode，首次默认 auto）；新增 service 方法 `setSessionMode(spaceKey, mode)`（模式服务双写 + IPC `mode-change` 下发 worker，S4 renderer 入口；非法模式 E-MODE-INVALID）与 `getSessionMode(spaceKey)`（S4 取位）。worker 侧 `sessionModes` Map（session-config 注入初始模式 + mode-change 热更新 + 熔断降级同步置 standard；随淘汰/reset 清理——模式是会话级状态，懒恢复经 session-config 重注入）；`getSessionMode` 缺省 auto（对齐 REQ-AGENT-072 标准 3 首次默认）。切换生效于下一个评估（PRD §6.2）。
  - **strict 全确认（REQ-AGENT-070 标准 1）**：`createPermissionBridgeFactory` 扩展（mode 参数缺省 = 现状行为零变化）——tool_call pre-gate 按 **gate 等价查询**（`svc.checkPermission(surface, value).state`，PermissionQuery = 链 link 同源 seam）分类：gotgenes 会 ask/deny 的交 gotgenes 单卡/拦截（单一评估原则：不双 ask）；gotgenes 会 allow 的（含热路径盲区重定向/管道——BUG-002 同源覆盖）→ pre-gate 弹卡（授权桥挂起确认）。strict 分支 return 提前，BUG-002 bash pre-gate 不重复执行。user_bash（主进程侧，http/server.js onPermissionAsk）strict 下也全确认（覆盖评估器 allow 类）。**已知边界（concern）**：path 规则 ask（如 `path."*.env"`）与 external_directory 操作在 strict 下可能双卡（pre-gate 卡 + gotgenes 链/终端卡）——strict = 全确认语义下可接受，S4/REFLECT 复核。
  - **链序接线（REQ-AGENT-073 标准 5）**：`agent-policy/pi-permission-config.json` authorizerChain → `["auto-judge", "opc-bridge"]`（worker 启动 deployGlobalPolicy 幂等覆盖）。**动态链可行性实证**：gotgenes `getAuthorizerChain` 每次 ask live 读 configStore 内存快照（authorizer-selection.ts resolveConfiguredLinks，ADR 0007 §4），但 configStore 为扩展工厂私有闭包、`PermissionsService` 接口无链/配置变更 API；唯一变更路径 = 写盘 + refresh/save，违反 REQ-AGENT-077（模式不改 .pi 持久配置，modeService.test.js 字节比对）且全局配置跨会话共享 → **实现面 = worker 侧模式门控**：auto-judge 注册时包一层门控（非 auto → 立即 `{kind:"defer"}`，不调 decide/不写 review log/不动熔断计数）——净效果 = 标准/严格档链 = 现状 `["opc-bridge"]`（auto-judge 不参与），auto 档链 = `["auto-judge", "opc-bridge"]`。未注册名 gotgenes 跳过（invariant 2：more prompting, never less）——注册失败 fail-safe。
  - **auto-judge 接线（REQ-AGENT-073 默认 decide 接真实模型）**：`createSessionEntry` 每会话创建 auto-judge link 实例（熔断计数会话级，对齐 permissionBridge H4）——`decide = createSessionDecide(runtime, modelObj, sessionKey, sessionCwd)`：FAUX 注入口 `OPC_FAUX_JUDGE_RESULT`（可编程判定，单判定/判定数组，FAUX 专属零生产影响；未注入 → 显式 defer 不调 FAUX 回声模型）→ 真实路径 `runtime.complete(modelObj, {systemPrompt: 判断 prompt, messages: [user: 判断上下文]}, {maxTokens:200, timeoutMs:4500})`（复用会话 provider/key 运行时，resolveModel 已注入）→ `parseVerdict`（容忍围栏/杂文本提取 JSON；非法 → `{kind:"defer",reason:"model-unresolved"}`）；模型失败/超时 → throw（S2 映射 call-failed/timeout defer，fail-safe）；deny-first prompt（不确定一律 defer）。
  - **熔断降级（REQ-AGENT-075）**：link `onTripped`（阈值可注入 env `OPC_AGENT_JUDGE_DENY_THRESHOLD`，缺省 5）→ worker 侧会话模式同步置 standard（下一评估即生效）+ IPC `mode-tripped`（reason = 「auto 暂停：模型频繁拒绝，已回标准模式」）→ 主进程模式服务 `setMode(spaceKey, "standard")`（会话 + lastMode 双写）+ 会话句柄 `session-event {type:"mode-degraded", mode:"standard", reason}`（用户可见提示数据面，呈现形态归 S4）。
- 测试：**集成 harness（临时，不进契约不提交，/tmp/slice3-harness.test.js）10/10 绿**（真实 worker + 真实 gotgenes + FAUX + OPC_FAUX_JUDGE_RESULT 可编程 decide + 可编程确认决议）：standard read/bash 直放无卡；strict read（配置 allow）弹卡 + 拒绝拦截；auto allow 直执行（write 真实落盘）+ review log 记录；auto deny 拦截 + reason 回 agent；auto defer 落 opc-bridge 确认卡（链序）；判定失败 defer 弹卡；熔断降级 standard + 提示（N=2 注入，REQ-AGENT-075 标准 1/2）；allow 重置不触发（标准 3）；strict→setSessionMode(standard) 热更新下一评估生效；standard 下 auto-judge 门控（配置 ask 仍 opc-bridge 卡 + 零 review log）+ 熔断后手动切回 auto 恢复（标准 4）。
- 回归：13 用例（modeService 6 + autoJudgeLink 7）全绿（见下）；worker 相关回归（workerServerDiscovery / agentProcess 等）见下。
- lint：`npx oxlint src/agent/worker.js src/services/agentService.js src/http/server.js` 0 警告。

#### PRD→代码 可追溯性表（Slice 3）

| PRD 块 / REQ | 验收标准 | 实现 | 验证 | 状态 |
|---|---|---|---|---|
| B1 / REQ-AGENT-070 三档模式（集成面） | 标准 1 strict 全确认（含配置 allow 的 read/ls）；标准 2 standard 按配置；标准 3 auto 模型代问（allow 直执行/deny 拦截/defer 弹卡；配置 allow 直放不过模型）；标准 4 会话级 | worker `sessionModes` + 模式门控 + strict pre-gate（checkPermission 分类）；standard = 现状（无接线变化）；auto = 链 + decide；会话级 = 随 session-config/mode-change/淘汰清理 | 集成 harness（strict 弹卡含 read / standard 直放 / auto 三判定路径 / 热更新） | COVERED（本切片交付集成面；E2E 呈现属 S4/S5） |
| B4 / REQ-AGENT-073 auto 引擎（接线面） | 标准 1 allow 直执行；标准 2 deny + teaching reason；标准 3 失败/超时 defer；标准 5 链序 defer 落 opc-bridge 确认卡 | 全局策略链序 `["auto-judge","opc-bridge"]` + registerAuthorizer("auto-judge") + 默认 decide 接真实模型（runtime.complete + parseVerdict） | harness（allow 直执行+review log / deny 拦截+reason / defer 落卡 / 判定失败 defer） | COVERED（标准 4 provider 未配置属 S2 契约面，已由 autoJudgeLink.test.js 覆盖） |
| B5 / REQ-AGENT-074 envelope 从严（接线面） | envelope 对本 link 的强制在 registerAuthorizer 后生效 | 零实现（resolveConfiguredLinks 对每个已注册 link 包 encloseInDelegationEnvelope） | S2 实证用例（envelope 语义）+ 本切片接线后生效 | COVERED（实证；运行期强制由 gotgenes 承担） |
| B6 / REQ-AGENT-075 熔断（动作面） | 标准 1 连续 deny N → 降级 standard（可注入）；标准 2 提示可见；标准 3 allow 重置；标准 4 手动切回恢复 | onTripped → worker 会话模式置 standard + mode-tripped IPC → 主进程模式服务降级 + mode-degraded 事件（提示数据面）；阈值 env 注入 | harness（N=2 降级 + lastMode 双写 + mode-degraded 事件 / allow 重置不触发 / 切回 auto 恢复） | COVERED（提示呈现形态归 S4） |
| B7 / REQ-AGENT-076 auto 可观测（接线面） | 每次判断写 review log（含 surface/latencyMs） | link 默认 reviewLogPath 对齐 gotgenes review log（<agentHome>/extensions/...）；模式门控下非 auto 不写（仅 auto 决策留痕） | harness（auto allow 后 review log 含 allow 记录 / standard 零记录） | COVERED |
| B8 / REQ-AGENT-077 模式不改持久配置（接线面） | 切换模式不改 .pi 配置；auto 放行不落持久配置 | 动态链改内存不可行（configStore 不暴露）→ 模式门控实现（不写任何 .pi 文件；唯一配置变更 = agent-policy 链序一次静态更新，非模式切换触发） | modeService.test.js（切换前后字节一致） | COVERED |

#### Slice 3 concern（供 S4/S5 与 REFLECT 参考）

1. **strict 双卡边界**：path 规则 ask（如 `path."*.env"`）与 external_directory 操作在 strict 下 = pre-gate 卡 + gotgenes 链/终端卡两次确认（pre-gate 按工具面 allow 弹卡、批准后 gotgenes 复合门仍 ask）。strict = 「所有操作都确认」语义下可接受；如需单卡，后续可让 pre-gate 对 gotgenes 可见 ask 的操作整体接管（需绕过复合门，成本高，本期不做）。
2. **动态链不可行（实证结论）**：gotgenes `getAuthorizerChain` 每次 ask live 读 configStore 内存快照，但 configStore 为扩展私有、PermissionsService 无变更 API；写盘 + refresh 违反 REQ-AGENT-077 且跨会话污染 → 模式门控为唯一不违反契约的动态装配面。链在配置中恒为 `["auto-judge","opc-bridge"]`，非 auto 档 auto-judge 纯 defer 零副作用（不调 decide、不写日志、不动计数）——行为等价链 `["opc-bridge"]`。
3. **FAUX decide 不调回声模型**：FAUX 未注入 OPC_FAUX_JUDGE_RESULT 时 decide 返回显式 defer（decide-deferred）——避免 consume 模型响应队列（decide 在工具调用链内执行，与 agent 主循环共用同一 faux 队列）且回声非 verdict。
4. **review log 门控语义**：standard/strict 下 auto-judge 零日志（门控在 decide 之前）——B7「每次判断写日志」仅指 auto 模式实际发生的判断（与 PRD B7「auto 可观测」一致）。
5. **多会话 globalThis 服务槽**（S7 既有语义延续）：`getPermissionsService()` 读 globalThis 单槽，多项目会话并发时槽被最后 session_start 的实例占用——S3 未改此形态（opc-bridge 注册同源）；harness 单会话验证通过，多会话并发留 H4 spike 既有结论。

### Slice 4：renderer 模式工具栏（commit 472093c 后追加，见下）

- 实现面（PRD→代码 追溯见下）：
  - **ModeToolbar 组件（REQ-AGENT-071）**：`src/renderer/components/assistant/ModeToolbar.jsx`（新，受控组件 `{mode, onModeChange, degradedReason}`）——composer 下方工具栏，无独立背景/边框（直接贴输入区下方，Codex 式底部工具条，UX 原型对齐）：`[data-testid='mode-toolbar']` 容器（`模式` label + 三档下拉 + spacer + 未来槽位 + 提示行）；`[data-testid='mode-select']` 下拉 + `[data-testid='mode-trigger']` 触发按钮（当前档文案 + 色点：strict 红 `--ch-error` / standard 蓝 `--ch-info` / auto 绿 `--ch-accent` + 旋转 chevron）；`[data-mode='strict'|'standard'|'auto']` 档位（m-name 色点+档名 + m-desc 描述：严格=所有操作都需确认/标准=按项目权限配置执行/自动=模型判断后自动执行）；`[data-testid='toolbar-slot-model'|'toolbar-slot-attach']` 未来槽位（灰显占位 dashed 边框 + cursor:not-allowed，M4 留白）；提示行「模式仅影响当前会话」。交互：点触发展开/收起（stopPropagation）、外部点击收起（document click + contains 判定）、选档高亮（active 类随 props.mode）+ 触发按钮更新；菜单向上展开（bottom: calc(100% + 4px)——工具栏贴底，E2E 点击可见）。**auto 切换无额外提示**（无 toast/banner 渲染，REQ-AGENT-071 标准 5）。
  - **ChatView 接线**：`</Composer>` 后插入 `<ModeToolbar mode onModeChange degradedReason />`——渲染顺序契约 MessageList→StatusBar→Composer→ModeToolbar 不破坏（E2E 断言 composer.y+h ≤ toolbar.y+1；`.assistant-chat` flex column，DOM 序 = 视觉序）。
  - **HTTP 模式端点（调用形态——S3 未暴露，本切片补）**：`src/http/routes/agentSessions.js` 增 `GET /api/agent/sessions/:key/mode` → `{mode}`（当前会话模式，未显式切过 = lastMode）与 `PUT /api/agent/sessions/:key/mode` `{mode}` → `{mode}`（会话级切换 + settings lastMode 持久化；非法值 → 400 E-MODE-INVALID）。**惰性纪律（ADR-009）**：优先 `peekAgentService`（既有实例 → agentService.getSessionMode/setSessionMode，有实例时下发 mode-change IPC）；未创建 → 模式服务单例（server.js `_opcModeServiceFactory` 挂 server 引用，与 agentService 注入同一 createModeService 实例）——模式读写不 spawn agent 子进程（冒烟实证 server._opcAgentService 恒 null）。modeService.setMode 无返回值 → 路由 wrapper 归一化回读（PUT 响应恒携带生效值，与 setSessionMode 返回形态一致）。
  - **renderer API**：`src/renderer/api/agentSessions.js` 增 `getSessionMode(spaceKey)` / `setSessionMode(spaceKey, mode)`（client.js get/put 封装）。
  - **Assistant 数据流**：`src/renderer/pages/Assistant.jsx` —— 状态 `sessionMode`（默认 auto，对齐服务端首次默认）+ `modeNotice`（熔断提示）+ `sessionModeRef`（切换回退读当前值）；选中会话 effect 内**取位**（getSessionMode，切会话复位默认 + 清提示后重新取位——模式为会话级状态）；**切换** `handleModeChange`（乐观更新 + PUT + 失败回退上一档 + 响应落地前切会话不误应用（selectedKeyRef 比对）；手动切换清降级提示，REQ-AGENT-075 标准 4 恢复）；**SSE `mode-degraded` 分支**（S3 数据面 → 模式置 standard + 「auto 暂停」提示呈现）。
  - **熔断降级呈现（REQ-AGENT-075 标准 2 呈现面）**：degradedReason 非空 → 工具栏行内 `[data-testid='mode-toolbar-degraded']` 提示（替换常规 hint，非 toast/banner——与 E2E「auto 切换无额外提示」的 `mode-toast/mode-banner` 选择器不冲突，且仅熔断事件触发、非切换触发）。
- 测试：
  - **组件自验 harness**（`.agent-home/slice4-harness/`，gitignored 不进契约）：vite dev server + playwright chromium 驱动 **23/23 绿**——工具栏渲染（容器/提示文案/触发按钮文案+色点）/ 三档展开可见 + 描述文案 + 当前档高亮 / 切 auto（onModeChange 记录 + 触发按钮文案/色点更新 + 菜单收起 + 再展开高亮跟随）/ 外部点击收起 / 槽位可见 + not-allowed / auto 切换无 mode-toast/banner / 降级提示出现与清除 / ChatView 装配纵向顺序（composer.y+h ≤ toolbar.y+1）+ DOM 顺序 + 工具栏无独立背景/边框 / 切 strict 色点。
  - **HTTP 端点冒烟**（/tmp，临时不进契约）**8/8 绿**：首次无记录 → auto（REQ-AGENT-072 标准 3）/ PUT strict → 200 {mode:strict} / 同会话 GET → strict / 新会话 GET → lastMode strict（标准 2）/ settings.json agent.lastMode 持久化（标准 1）/ 非法值 → 400 E-MODE-INVALID / 未触发 agentService 惰性创建 / lastMode 更新。
  - **回归**：story api 13/13（modeService 6 + autoJudgeLink 7）+ 会话 REST 路由 33/33（sessionMessage/Events/List/Reset/Space）全绿。
  - **构建**：`npx vite build --config vite.renderer.config.js` ✓（2505 模块）+ `--config vite.main.config.js` ✓（771 模块）。
  - lint：`npx oxlint` 改动文件 0 新警告（server.js 2 条警告为既有代码，非本切片引入）。
- refactor：无（新组件 + 最小接线，无重构面）。

#### PRD→代码 可追溯性表（Slice 4）

| PRD 块 / REQ | 验收标准 | 实现 | 验证 | 状态 |
|---|---|---|---|---|
| B2 / REQ-AGENT-071 对话区模式切换工具栏 | 标准 1 工具栏位于 composer 下方（DOM 纵向顺序）；标准 2 三档下拉存在（触发按钮显示当前模式 + 色点；展开显示三档各带描述）；标准 3 选择档位 → 触发按钮更新 + 档位高亮；标准 4 未来扩展槽位灰显占位；标准 5 auto 切换无额外提示 | ModeToolbar.jsx（locator 契约 + 三档下拉 + 槽位 + hint）+ ChatView `</Composer>` 后接线 + assistant.css（token 对齐原型，无独立背景/边框） | 组件自验 23/23（含 ChatView 装配纵向顺序断言）；E2E 断言面映射见 concern 2 | COVERED（组件 + 接线面；E2E 全量跑绿归 S5） |
| B3 / REQ-AGENT-072 全局 lastMode（renderer 面） | 标准 2 新会话初始模式 = lastMode（E2E：reload 后触发按钮 = lastMode） | GET /mode 取位（未显式切过 = lastMode；无会话/未取位时默认 auto = 首次默认） | HTTP 冒烟（新会话 GET = lastMode strict）+ 组件自验（受控模式渲染）；E2E reload 断言归 S5 | COVERED（数据面；E2E reload 用例 S5 验证） |
| B6 / REQ-AGENT-075 熔断（呈现面） | 标准 2 降级后提示可见（「auto 暂停：模型频繁拒绝」） | S3 mode-degraded 事件 → modeNotice → 工具栏行内 mode-toolbar-degraded 提示（替换 hint） | 组件自验（降级提示出现/清除/hint 恢复） | COVERED（基础呈现；事件链路由 S3 集成 harness 验证） |

- 状态口径同前。REQ-AGENT-071 的 E2E 验收（5 条标准）依赖 Electron 全量接线（rebuild:electron + FAUX + SSE），归 S5 统一跑绿；本切片交付组件 + 数据流 + 端点面并以自验 harness 佐证。

#### Slice 4 concern（供 S5 与 REFLECT 参考）

1. **调用形态（HTTP，非 IPC）**：S3 的 `agentService.setSessionMode/getSessionMode` 仅主进程面；renderer 走 HTTP（与既有 agentSessions API 同形态），本切片补 `GET/PUT /api/agent/sessions/:key/mode`。peek 优先（既有实例 → 下发 mode-change IPC 生效于下一个评估）+ 单例兜底（未创建 → 直写模式服务，会话创建时经 session-config 携带，等效）。模式读写不触发 agent 子进程惰性启动（ADR-009 实证）。
2. **E2E 无会话场景退化**：modeToolbar.test.cjs 的 beforeEach 只 seed agent 配置、不建会话——全新 userDataDir 下无会话，selectedKey=null → 点击 auto 为 no-op（renderer 默认 auto = 服务端首次默认，触发按钮本就显示「自动」）→ 标准 2/3 与 072 的「切 auto」断言退化为默认值断言（恒绿但不走真实 PUT 流）。有会话时（S5 若 seed/建会话）全链路生效：点击 → PUT → lastMode 写盘 → reload 后 GET 取位。**S5 建议**：072 用例前置建会话（POST /api/agent/sessions {spaceKind:"general"}）或先切 strict 再切 auto，使切换流真实落盘。
3. **mode-degraded 提示形态**：工具栏行内提示（mode-toolbar-degraded）替换常规 hint，非独立 toast/banner——满足 E2E「auto 切换无额外提示」选择器（mode-toast/mode-banner 恒 0）且仅熔断事件触发。REFLECT 可复核观感（行内 vs 独立提示条）。
4. **strict 双卡边界（S3 concern 1 延续）**：UI 面无影响（切换即生效，E2E 只断言 UI 面）；评估面双卡语义 S3 已裁决可接受，REFLECT 复核。
5. **renderer 默认模式 = auto**：首次无会话/未取位时工具栏显示「自动」（对齐 REQ-AGENT-072 标准 3 首次默认）；lastMode=strict 的会话在取位完成前有短暂「自动」闪现（E2E 断言 auto-retry 不受影响，观感可接受）。

### Slice 5：E2E 接线 + 全量回归（commit be2c1f6 / 6ed7fd9）

- **E2E 无会话退化修正（S4 concern 2 落地，commit be2c1f6）**：modeToolbar.test.cjs 切档类用例（标准 2/3、标准 5、072）前置建会话并打开（`createSession`（POST /api/agent/sessions {spaceKind:"general"}）+ `openSession`（reload → 点 `[data-session-item='<spaceKey>']`，statusBar 先例））——「点击 → PUT /mode → settings lastMode 持久化 → reload 后 GET /mode 取位」真实链路被断言。标准 2/3 与标准 5 先切 strict 再切 auto（首次默认 = auto，直接切 auto 无文案变化可断言）；072 用例切 strict 而非 auto——持久化链路失效时 reload 后回落 auto，断言可区分（旧写法 auto→auto 恒绿不能证明 lastMode 生效）。断言语义不变（signoff TODO 原位保留）。
- **跨 story 接线修正（commit 6ed7fd9）**：全量 E2E 首跑 183/184，唯一红 = 上 story 的 permissionConfig.test.cjs REQ-AGENT-065（strict mode violation）——本 story S3（472093c）起全局 authorizerChain = `["auto-judge","opc-bridge"]`（REQ-AGENT-073 链序签核契约，agent-policy/pi-permission-config.json 单一真源），上 story 用例断言过时（.chain-item 现 2 元素；保存后项目链 = 全局基底 + 新增条目）。test-gap 就地补全：filter 逐项定位基底条目 + toEqual 期望值更新为 `["auto-judge","opc-bridge","custom-gate"]`（文件 + merged 双断言，断言语义不变）。API 面（permissionConfig.test.js 整体替换、permissionMerge.test.js 显式 fixture）不受影响（override wins 语义）。
- **E2E 全量**：`npm run test:e2e`（rebuild:electron + playwright）→ **184/184 绿**（含本 story modeToolbar 5 用例 + 上 story permissionConfig 10 用例；水位较上 story 179 提升）。首跑 183/184 的 1 红经上述接线修正后复跑全绿。
- **单测全量**：`npm run test:unit`（rebuild:node）→ **739/740 绿**（本 story api 13/13：modeService 6 + autoJudgeLink 7）。1 红 = 既有 hydrationWindow.test.js flake（复跑 5 次约 50% 通过率，见 concern 6——非本 story 引入，S3/S4 均未触碰 stop/水合路径）。
- **构建**：rebuild:electron + rebuild:node 按 ABI 顺序执行，最终状态 = node ABI（单测后）。
- refactor：无（本切片零实现改动，纯测试接线 + 文档）。

#### PRD→代码 可追溯性表（Slice 5，最终版）

| PRD 块 / REQ | 验收标准 | 实现 | 验证 | 状态 |
|---|---|---|---|---|
| B2 / REQ-AGENT-071 对话区模式切换工具栏 | 标准 1 工具栏位于 composer 下方；标准 2 三档下拉（当前档 + 色点 + 描述）；标准 3 选档 → 触发按钮更新 + 高亮；标准 4 扩展槽位灰显占位；标准 5 auto 切换无额外提示 | ModeToolbar.jsx + ChatView 接线 + Assistant 数据流（S4） | **E2E 5/5 绿**（modeToolbar.test.cjs：纵向顺序 / 展开三档 + strict→auto 真实切换文案更新 / 槽位可见 / auto 切换零 toast-banner / reload 取位） | COVERED |
| B3 / REQ-AGENT-072 全局 lastMode（E2E 面） | 标准 2 新会话初始模式 = lastMode | GET/PUT /mode + modeService lastMode 持久化（S1/S3/S4） | **E2E 5/5 中 072 用例绿**：建会话 → 切 strict（PUT 落盘）→ reload → 取位 strict（链路失效时回落 auto 可区分） | COVERED |
| B4 / REQ-AGENT-073 链序契约 | 链序 `["auto-judge","opc-bridge"]` | agent-policy 全局链（S3）+ 模式门控 | 上 story permissionConfig E2E 对齐修正后全绿（链呈现在权限配置 UI 可见 + 项目链整体替换含基底） | COVERED（跨 story 呈现面确认） |

- 状态口径：本 story 8 条 REQ（070~077）自 S1~S4 均 COVERED（S1 的 070 标准 4 用例红经 f391884/127ce3f 语义修正后 13/13 绿）；S5 = E2E 验收面 + 全量回归收口，无新增实现面。
- 全量水位：E2E 184/184（上 story 179 → 本 story +5）；单测 740 用例 739/740（1 红 = 既有 hydration flake，见 concern 6）。

#### Slice 5 concern（供 QA/REFLECT 参考）

1. **跨 story 测试契约变更（已修，建议人复核）**：permissionConfig.test.cjs REQ-AGENT-065 期望值因本 story REQ-AGENT-073 链序契约变化而更新（全局链 2 条目 + 项目链含 auto-judge 基底）。断言语义不变（仍断言基底可见 + 整体替换 + 文件/merged 双落盘），但属跨 story 业务测试期望值调整——QA/REFLECT 可复核「权限配置 UI 全局链显示 auto-judge」是否符合产品预期（备选：UI 隐藏系统级 link 需另行设计，本期按链序契约直显）。
2. **072 E2E 断言强度**：reload 后「严格」断言依赖 GET /mode 取位完成（取位前短暂「自动」闪现，S4 concern 5）——Playwright 轮询容忍；若未来提速取位竞态需关注。
3. **strict 双卡边界（S3/S4 concern 延续）**：E2E 只断言 UI 面（切换即生效），评估面双卡语义留 REFLECT 复核。
4. **mode-degraded 提示形态（S4 concern 3 延续）**：行内提示（mode-toolbar-degraded）非独立 toast/banner，REFLECT 可复核观感。
5. **全量 E2E 首跑即绿 183/184（除跨 story 契约红）**：本 story 无新增实现 flake；既有 E2E 水位 184/184 复跑稳定（1.1min 全量）。
6. **hydrationWindow.test.js 既有 flake（非本 story 引入，建议父代理裁决处置）**：复跑 5 次约 50% 红，两种失败形态：(a) 标准 1「超窗行不水合」断言失败——`agentService.stop()` 为 fire-and-forget（SIGTERM 后立即返回，agentService.js:1274 原样），旧 worker 进程退出前仍可能触碰 JSONL → utimesSync 设的旧 mtime 被改写回 now → 水合误判；(b) 标准 5/标准 1 afterEach `fs.rmSync` ENOTEMPTY——旧进程句柄未释放。根因 = 测试时序（stop 后未等子进程真正退出即 utimes）与 stop() 语义的既有竞态；S3/S4 均未触碰该路径（git log 实证）。处置选项：(a) agentService.stop() 改为等待子进程退出（[build]，影响面需评估——stop 同步语义被多处消费）；(b) 测试侧 stop 后轮询 childPid 退出再 utimes（[test]）；(c) 接受并标注已知 flake。本切片未动该文件（跨 story 业务测试，交父代理/人裁决）。

### BUG-001 记录：无会话切模式落盘全局 lastMode（commit 见 [test]/[bugfix] 双提交）

- **症状**：切严格模式 → 发送对话 → 模式自动跳回「自动」。
- **根因（已复现）**：`src/renderer/pages/Assistant.jsx` `handleModeChange` 在 `selectedKey` 为 null（还没选/建会话）时 `if (!key) return` **静默丢弃切换**——服务端从未收到 PUT（lastMode 仍 auto）；随后发送首条消息 → `createSession` + `setSelectedKey` → 切会话 effect 复位默认 + GET 取位（= lastMode = auto）→ UI 回 auto。
- **分类（人裁决）**：code-defect；**裁决 A**：无会话时切模式 = 落盘全局 lastMode（无会话时「模式」就是全局默认，切换即改全局）——切 strict 持久化，发送建会话后取位 = strict。
- **修复**：
  - `src/http/routes/agentSessions.js` 增 `handleAgentLastMode`：`PUT /api/agent/mode/last { mode } → { mode }`（无会话 lastMode 设置端点；模式服务单例落盘 settings agent.lastMode，非法值 → 400 E-MODE-INVALID，与既有 PUT /mode 同契约）。
  - `src/http/server.js` 接线 `case "agent"`：`subPath[0]==="mode" && subPath[1]==="last"` → handleAgentLastMode（getModeService 上下文）。
  - `src/renderer/api/agentSessions.js` 增 `setLastMode(mode)`（PUT /api/agent/mode/last 封装）。
  - `src/renderer/pages/Assistant.jsx` `handleModeChange`：`!key` 不再 return——改走 `setLastMode(mode)`（无会话路径），保持乐观更新 + 失败回退（与有会话路径一致；有会话路径仍走 `setSessionMode`）。
- **回归测试（先红后绿，Prove-It）**：`tests/.../2026-08-11-pi-agent-modes/api/modeService.test.js` 增「BUG-001 回归：无会话切模式落盘全局 lastMode（HTTP 集成面）」——无会话 PUT 全局 lastMode=strict → 新建会话 → GET mode = strict（REQ-AGENT-071/072 trace + BUG-TRACE: BUG-001）。修复前红（PUT 404 NOT_FOUND：端点不存在，切换无落盘路径）；修复后绿。
- **回归结果**：story api **14/14**（13 既有 + 1 BUG-001 回归，无回归）+ 会话 REST 路由 33/33 绿；`npx vite build --config vite.renderer.config.js` ✓。
- **E2E**：未加用例（API/集成回归已覆盖语义——`setLastMode` 端点为 renderer 无会话路径的唯一落盘通道，E2E 无会话用例恒为默认值断言，链路由 HTTP 集成面断言；如需 E2E 断言见 S4 concern 2 的建会话前置模式）。

### BUG-002 记录：底部输入区容器化——Composer+ModeToolbar 统一 surface 背景（工具栏色带）

- **症状**：对话区底部模式工具栏（composer 下方）视觉上有一行「背景色/色带」——用户反馈「对话框下面的一行模型切换的背景色，我们不是说去掉吗？」（UX 原型 v1.1 明确：工具栏无独立背景/边框，直接贴 composer 下方）。
- **根因（人已确认）**：`.composer` 有 `background: var(--ch-surface)`（浅色 #ffffff 白块）+ `border-top`；`.mode-toolbar` 无背景 → 透出页面底 `--ch-bg`（浅色 #f7f8f7 / 暗色 #0d1117）。两者色差在视觉上形成「工具栏那行有背景色」的错觉——不是 toolbar 有背景，是**背景层级不一致**（composer 白块 vs toolbar 透底）。
- **分类（人裁决）**：code-defect；**方案**：Composer + ModeToolbar 包进统一底部容器 `.composer-area`（`background: var(--ch-surface)` + `border-top`）；composer 不再单独有背景/border-top（border-top 移到容器），toolbar 继承容器背景——视觉一体（Codex 式输入区）。
- **修复**：
  - `src/renderer/components/assistant/ChatView.jsx`：`<Composer>` + `<ModeToolbar>` 包进 `<div className="composer-area">`（渲染顺序契约不变：MessageList → StatusBar → ComposerArea(Composer → ModeToolbar)）。
  - `src/renderer/components/assistant/assistant.css`：新增 `.composer-area { border-top: 1px solid var(--ch-border); background: var(--ch-surface); }`；`.composer` 移除 `background` + `border-top`（保留 padding）；`.mode-toolbar` 保持无独立背景（继承容器）。
- **回归测试（先红后绿，Prove-It）**：自验 harness `.agent-home/bug2-harness/`（gitignored，不进入契约——浏览器 Playwright chromium 渲染真实 ChatView + 真实 tokens/assistant.css）。核心断言：composer 与 toolbar 的「有效背景」（自身上溯最近非透明背景）一致且 = surface 参照，浅色 + 暗色双跑；辅助：`.composer-area` 结构（border-top 1px + surface）、toolbar 自身无背景/边框、纵向顺序（composer.y+h ≤ toolbar.y+1 + DOM 顺序）。**修复前红**（浅色 composer=rgb(255,255,255) vs toolbar=rgb(247,248,247)；暗色 composer=rgb(22,27,34) vs toolbar=rgb(13,17,23)——正是色带根因）+ 像素级验证（PNG 解码采样左侧 padding 窄列众数色）修复前红 / 修复后绿（两主题同色）；修复后 harness **11/11 绿**。
- **回归结果**：story E2E `modeToolbar.test.cjs` **5/5 绿**（含标准 1 纵向顺序契约容器化后仍成立）+ 相关回归 `assistantChat.test.cjs` 2/2 + `statusBar.test.cjs` 4/4 绿；`npx vite build --config vite.renderer.config.js` ✓（383ms）。截图（浅/暗各一）：`.agent-home/bug2-harness/shots/bug2-light.png`、`bug2-dark.png`（像素验证两主题 toolbar 与 composer 背景同色，无色带）。
