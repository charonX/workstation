# ADR-023: agent 权限模式化——authorizerChain 模型 link + 模式门控（三档 strict/standard/auto）

- **状态**: 已接受
- **日期**: 2026-08-12
- **相关 story**: 2026-08-11-pi-agent-modes
- **相关 REQ**: REQ-AGENT-070~077（三档模式/auto link/envelope 从严/熔断）

## 背景

PI agent 权限只有「全人工确认」和「全放行（yoloMode）」两极。用户需要中间态：edit 类自动批准（standard 按配置即可表达）+ 常规操作由模型判断自动批准（auto）。对齐 Claude Code 的 acceptEdits/auto。

调研实证：gotgenes authorizerChain 是官方扩展点（link 审 ask → allow/deny/defer），官方 `pi-permission-model-judge` 是 deny-first 参考实现；但「运行时切换链」有架构约束需显式决策。

## 决策

1. **三档模式**（会话级 + 全局 lastMode）：`strict`（全确认，含配置 allow 的）/ `standard`（按项目权限配置执行，现状）/ `auto`（standard 基础上配置 ask 的由模型判断）。模式是运行时档位，**不改持久配置**（.pi 文件不动，REQ-AGENT-077）。
2. **auto 引擎 = authorizerChain 模型 link**：自实现 `auto-judge` link（接用户配置的 provider），链序 `["auto-judge", "opc-bridge"]`；deny 短路确认卡、defer 落回 opc-bridge 卡。**零 gotgenes 引擎改动**。
3. **模式门控替代动态链**：gotgenes authorizerChain 是配置数组整体替换（configStore 私有闭包，无运行时变更 API）——改配置违反「模式不改 .pi」；实现 = worker 侧模式门控（非 auto 档 auto-judge 立即 defer 零副作用：不调 decide/不写日志/不动计数）。净效果 = 标准/严格档链现状、auto 档加 link。
4. **安全边界（deny-first + envelope 强制）**：模型对 external_directory/path 的 allow 被 gotgenes envelope 系统级降级 defer（放行必人工，deny 有效）；模型判断不了/失败/超时 → defer 弹卡；熔断（连续 deny N 次降级回 standard）；每次判断写 review log。
5. **无会话切模式 = 落盘全局 lastMode**（BUG-001 修正）：无会话时「模式」就是全局默认，切换即改 lastMode；新会话初始 = lastMode（首次 auto）。

## 后果

- 权限从「全确认/yolo 两极」到三档；auto 下常规操作不弹卡（模型代问），危险/项目外仍拦截。
- 模式门控引入「门控窗口」（非 auto 档 link 仍注册但立即 defer）——零副作用，可观测面干净（review log 只在 auto 档写）。
- strict 全确认在 path/external_directory 规则下可能双卡（pre-gate 卡 + gotgenes 卡）——全确认语义下可接受。
- 未来模型升级（换 provider/判断 prompt）只改 link 内部，不动链机制。

## 替代方案

- **A. yoloMode 当 auto**：全放行无判断，不满足「模型判断自动批准」初衷。否。
- **B. 运行时改 authorizerChain 配置**（写盘 + refresh）：违反「模式不改 .pi」且全局配置跨会话共享。否（门控替代）。
- **C. fork pi-permission-suite（四模式）**：社区 fork 非官方 + codex 外部模型依赖。否。

## 相关文件

- 决策来源：`.aiassist/stories/2026-08-11-pi-agent-modes/interview-notes.md`（5 轮访谈 + 2 项调研）+ `prd.md` §10
- 实证：`node_modules/@gotgenes/pi-permission-system/src/authority/{delegation-envelope,authorizer-chain,authorizer-selection}.ts`
- 延伸：ADR-022（项目级权限字段级覆盖）——模式在其上叠加运行时档位；ADR-017（授权桥）——opc-bridge 仍为 defer 落点
