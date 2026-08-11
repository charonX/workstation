# Requirements — PI Agent 模式化（Modes: strict / standard / auto）

> 故事 ID：`2026-08-11-pi-agent-modes`
> 版本：v1
> 最后更新：2026-08-11
> 来源：`prd.md` v0.1（B1-B8 + §10 技术方案内嵌）
> UX 参照：`ux/mode-toolbar.html`（已 approved）
> 移动块 M1（classifyAllShell 开关）/M2（autoJudgeModel 独立项）/M3（熔断阈值精确值）/M4（工具栏其他配置项）留 PRD，不入 REQ。
> 技术事实（§10/§13）：gotgenes envelope 强制（模型对 external_directory/path 的 allow 降级 defer、deny 有效）；surface 由 gate 决定；链序 `["auto-judge", "opc-bridge"]`。

---

## REQ-AGENT-070 三档模式（B1）

- 优先级 P0 / 必须 / cross-module / 模式服务 + worker 评估链 / agent-dialogue / conversation-space / 集成
- 接口契约：模式服务 `getMode(spaceKey) → "strict"|"standard"|"auto"`；`setMode(spaceKey, mode)`；模式为会话级状态
- UX 参照：`ux/mode-toolbar.html`（三档下拉）

验收标准：
1. strict 模式下所有操作都确认——包括配置 allow 的（read/ls/查询类）也弹卡（集成：切 strict 后 read 工具触发确认）。
2. standard 模式按项目权限配置执行（allow 直放、ask 弹卡）——与现状行为一致（集成：切回 standard 后 read 直放）。
3. auto 模式下配置 ask 的操作过模型判断（allow 直执行 / deny 拦截 / defer 弹卡）；配置 allow 的直放不过模型（集成：三种判定路径）。
4. 模式为会话级：切会话/重开回到全局默认（lastMode），不保留上个会话的模式（集成/API）。

## REQ-AGENT-071 对话区模式切换工具栏（B2）

- 优先级 P0 / 必须 / intra-module / 对话区底部工具栏 / agent-dialogue / conversation-space / 浏览器 E2E + 组件
- 接口契约：`[data-testid='mode-toolbar']` 容器 + `[data-testid='mode-select']` 下拉 + `[data-mode='strict'|'standard'|'auto']` 档位；可扩展槽位 `[data-testid='toolbar-slot-*']`
- UX 参照：`ux/mode-toolbar.html`（composer 下方工具栏，三档下拉）

验收标准：
1. 工具栏位于 composer 下方（E2E：DOM 纵向顺序 barBox.y ≥ composerBox.y；既有 MessageList→StatusBar→Composer 契约不被破坏）。
2. 三档下拉存在：触发按钮显示当前模式 + 色点；展开显示三档（严格/标准/自动）各带描述（E2E：展开后三档可见）。
3. 选择档位 → 触发按钮更新（文案 + 色点）+ 档位高亮（E2E：切换后触发按钮文案变化）。
4. 未来扩展槽位（模型/附件）灰显占位存在（E2E：`toolbar-slot-model`/`toolbar-slot-attach` 可见）。
5. auto 切换无额外提示（切换即生效）（E2E：切 auto 无 toast/banner）。

## REQ-AGENT-072 全局 lastMode（B3）

- 优先级 P0 / 必须 / cross-module / 模式服务 + settings / agent-dialogue / conversation-space / API
- 接口契约：`getLastMode() → mode`；`setLastMode(mode)`（settings 持久化）；新会话初始模式 = lastMode；首次默认 auto
- UX 参照：`ux/mode-toolbar.html`（「模式仅影响当前会话」提示）

验收标准：
1. 设置会话模式 → settings 记录 lastMode（API：setMode 后 lastMode 更新）。
2. 新会话初始模式 = lastMode（API：新 spaceKey getMode = lastMode）。
3. 首次（无 lastMode 记录）→ 默认 auto（API：空 settings 下 getMode = auto）。
4. lastMode 非法值（settings 被手改）→ 回落 standard（API：非法值 getMode = standard）。

## REQ-AGENT-073 auto 引擎 = authorizerChain 模型 link（B4）

- 优先级 P0 / 必须 / cross-module / auto-judge link（worker）+ 用户 provider / agent-dialogue / conversation-space / 集成
- 接口契约：link 注册名 `auto-judge`，链序 `["auto-judge", "opc-bridge"]`；link 输出 `{kind: "allow"|"deny"|"defer", reason?}`；接用户配置的 provider（settings agent provider/apiKey）
- 技术前提：gotgenes authorizerChain 官方扩展点；deny 短路确认卡（authorizer-chain.ts 实证）

验收标准：
1. auto 模式 + surface=bash（纯项目内）且配置 ask → link 调模型：判安全 allow → 命令直接执行、无确认卡（集成：FAUX provider 返回 allow 场景）。
2. 判危险 deny → 命令不执行 + teaching reason 回 agent（集成：deny 后无执行 + 原因可见）。
3. 判断不了/模型失败/超时 → defer → 弹确认卡（集成：defer 后确认卡出现）。
4. provider 未配置 → auto 不可用：判断失败 → defer 弹卡 + 提示「auto 不可用」（集成：无 provider 场景）。
5. 链序生效：defer 落回 opc-bridge 确认卡（既有机制）（集成：defer 后确认卡 = 现状卡）。

## REQ-AGENT-074 external_directory/path 系统级从严（B5）

- 优先级 P0 / 必须 / cross-module / gotgenes envelope（零改动）/ agent-dialogue / conversation-space / 集成
- 接口契约：无新增接口——验证 gotgenes `delegation-envelope.ts` 强制语义（模型对 excluded 面 allow 降级 defer、deny 有效）
- 技术前提：envelope 实证（DELEGATION_EXCLUDED_SURFACES = {external_directory, path}）

验收标准：
1. auto 模式 + 项目外访问（如 `cat ~/.ssh/x`，surface=external_directory）→ 模型 link 即使判 allow 也被 envelope 降级 defer → 弹确认卡（集成：项目外 auto 下仍弹卡）。
2. 项目外访问模型判 deny → 有效拦截（集成：deny 后不执行）。
3. 显式 path 规则命中（如 `path."*.env"` ask）→ 同 excluded 面，模型 allow 降级 defer（集成）。

## REQ-AGENT-075 熔断（B6）

- 优先级 P0 / 必须 / cross-module / auto-judge link + 模式服务 / agent-dialogue / conversation-space / 集成
- 接口契约：link 连续 deny 计数（初值 5，可注入）；计数 ≥ N → 模式服务降级 standard + 提示
- UX 参照：`ux/mode-toolbar.html`（无独立提示设计，降级提示由系统 toast/状态呈现）

验收标准：
1. 连续 deny 计数达到 N（可注入缩短）→ 会话模式自动降级 standard（集成：注入 N=2，2 次 deny 后 getMode = standard）。
2. 降级后提示可见（「auto 暂停：模型频繁拒绝，已回标准模式」）（集成/E2E：提示出现）。
3. allow 重置连续计数（集成：allow 后计数清零，再 deny 重新计数）。
4. 用户手动切回 auto → 恢复正常（集成：setMode auto 后可用）。

## REQ-AGENT-076 auto 可观测（B7）

- 优先级 P0 / 必须 / cross-module / auto-judge link review log / agent-dialogue / conversation-space / API
- 接口契约：link 每次决策写 review log（requestId/surface/verdict/deferReason/latencyMs），对接既有 permission review log

验收标准：
1. 每次模型判断写一条决策记录（verdict = allow/deny/defer）（API：日志含对应条目）。
2. defer 记录含 deferReason（model-unresolved/timeout/call-failed 等）（API：defer 条目有 reason）。
3. 记录含 surface 与 latencyMs（API：字段存在）。

## REQ-AGENT-077 模式不改持久配置（B8）

- 优先级 P0 / 必须 / cross-module / 模式服务 + worker / agent-dialogue / conversation-space / 集成
- 接口契约：模式是运行时档位——切换模式不改 `.pi` 配置文件；退出模式即回配置原状

验收标准：
1. 切换模式（任意档）→ `.pi/extensions/pi-permission-system/config.json` 内容不变（集成：切换前后文件字节一致）。
2. auto 模式的判断结果不落持久配置（allow 只是运行时放行，不写回配置）（集成：auto 放行后文件不变）。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-08-11 | 初版结晶：B1-B8 → REQ-AGENT-070~077；M1-M4 留 PRD；§10/§13 技术事实入 REQ | AI + 人 |
