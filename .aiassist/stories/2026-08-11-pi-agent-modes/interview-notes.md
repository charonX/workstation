# 访谈笔记 — 2026-08-11-pi-agent-modes

> 日期：2026-08-11
> 方式：对抗式需求访谈（/demand-insight，0.19 轮询 frontier 模式），5 轮 + research 2 项
> 输入：用户原始诉求（权限两极缺中间态）+ research（pi-auto-mode-authorizer-chain.md + external_directory 语义实证 + Claude Code auto 对照）

## 核心问题

PI agent 的权限只有「全人工确认」和「全放行（yoloMode）」两极：编辑文件/跑命令逐个弹确认卡太频繁，全放行又不放心。需要中间态模式（edit mode 文件编辑自动批准 + auto mode 模型判断自动批准），对齐 Claude Code 的 acceptEdits/auto。

访谈演进：用户澄清「edit mode 按配置走」= 与现状（standard）同义，最终收敛为**三档模式**（strict / standard / auto），edit mode 概念并入 standard。

## 用户画像

- 本机单用户工作台（OPC Workstation），用户即开发者本人。
- 对话密集时想少弹卡、又不放弃安全（担心危险操作漏网 + 项目外访问）。
- 未来计划在对话区扩展更多配置（模型选择、附件添加）——模式切换是「对话区工作台工具栏」的第一块。

## 关键边界（5 轮确认）

1. **三档模式**：strict（所有操作都确认，含配置 allow 的）/ standard（按项目权限配置执行，现状行为）/ auto（standard 基础上，配置 ask 的由模型判断）。
2. **切换粒度**：会话级 + 对话区入口（可扩展工具栏容器，未来模型/附件同区）。
3. **全局默认**：记录 lastMode（settings 存全局最后选择的模式），新会话初始 = 上次选的；首次 = auto。
4. **auto 判断不了 → 回人工确认**（deny-first：模型只 deny 明确危险、不确定 defer 弹卡）。
5. **auto 熔断**：模型连续拒绝 N 次（如 5 次）→ auto 自动降级回 standard + 提示，用户手动切回。
6. **auto 判断模型 = 用户配置的 provider**（非硬编码 deepseek；复用对话 agent 配置，独立覆盖项留扩展位）。
7. **判断对象**：只代问「配置 ask 的」——配置 allow 的（read/ls/查询类）直放不过模型；strict 下全确认模型也不代问。对齐 Claude Code `classifyAllShell` 语义讨论（默认窄 allow 直放；是否提供「所有 shell 过模型」开关待 tech-design 定）。
8. **external_directory/path 自动从严**（调研实证）：模型对这两面 allow 被 envelope 强制降级 defer——放行必人工；deny 有效（可自动拦截项目外危险操作）。
9. **模式不改持久配置**：运行时档位，退出即回配置原状（配置是契约，mode 是工作状态）。

## 调研实证（research 2 项）

### A. external_directory 的 auto 语义（gotgenes 源码实证）
- `authority/delegation-envelope.ts`：`DELEGATION_EXCLUDED_SURFACES = {external_directory, path}`——link 对这两面的 **allow 一律降级 defer**（`encloseInDelegationEnvelope` 唯一篡改分支）；**deny 原样通过**（可拦截）。
- `authority/authorizer-chain.ts decideFromVerdict`：deny → 完整决策（`denied_with_reason`），**terminal 确认卡不被调用**（不弹卡）；teaching reason 经 `denial-messages.ts` 回给 agent。
- surface 由 gate 决定（非工具名）：越界命令/工具 → surface=`external_directory`（模型不能 allow）；纯 bash（无外部路径/无 path 规则）→ surface=`bash`（模型可 allow）；项目内工具 ask → 工具名（模型可 allow）。
- 官方 `pi-permission-model-judge`（未装，GitHub 实证）：deny-first 参考实现——只 deny 笔误、永不 allow、fail-safe by construction（模型缺失/超时/不确定 → defer）。

### B. Claude Code auto 对照（官方文档实证）
- 分类器信任工作目录 + 配置的 remote + `autoMode.environment` 信任槽；信任边界外 = 直接 block（deny），不是 defer。
- `autoMode.classifyAllShell: true` → 所有 shell 命令都过分类器；默认窄 allow 规则（如 `Bash(npm test)`）在 auto 下仍直放不过分类器，只有通配/宽泛 allow 被挂起。
- 显式 `permissions.ask` 规则在分类器之前评估，永远强制弹卡（我们 standard 语义对齐）。
- 熔断：Claude Code 连续 3 deny / 累计 20 暂停（我们取更轻的 5 次降级回 standard）。
- gotgenes 比 Claude Code 多一层：不确定 → defer → 确认卡（第三态兜底，更保守）。

## 隐含假设

1. auto 判断模型复用对话 provider 配置（独立覆盖项留扩展位，本期不复用）。
2. 「配置 ask 的」= 高危清单命中 + 写类工具 + 项目外 + 兜底 ask——即 standard 下会弹卡的集合。
3. 模式是会话级运行时状态（worker 会话内生效），切会话/重开回到全局 lastMode。
4. 对话区工具栏本期只做模式切换，容器结构可扩展（未来模型/附件）。

## 矛盾/风险

1. **模型判断质量 = 安全边界**：auto 放行纯 bash/项目内工具 ask，模型误判会放行危险操作——缓解：external_directory/path 系统级锁死（envelope）+ 熔断 + 判断不了 defer 弹卡 + review log 可观测。
2. **延迟**：每次 ask 一次模型调用（本地 provider，毫秒~秒级）——缓解：短路（配置 allow 直放不过模型）+ 可选 classifyAllShell 语义开关。
3. **provider 配置依赖**：auto 依赖用户已配置 provider（settings 有 provider/apiKey）；未配置 → auto 不可用（降级提示）或回 standard。
4. **熔断阈值**：5 次是否合适需实测（Claude Code 用 3/20）。

## 候选方向

### 方向 A（确认）：authorizerChain 模型 link + 三档模式开关
- 适用场景：对话密集想少弹卡又不放弃安全
- 主要取舍：需自实现模型 link（判断 prompt/熔断/可观测）；零 gotgenes 改动（官方扩展点）
- 推荐度：**首选**

### 方向 B：yoloMode 当 auto
- 全放行无判断——不满足初衷。不推荐。

### 方向 C：fork pi-permission-suite
- 社区 fork 非官方 + codex 外部模型依赖。不推荐。

## 确认方向

最终确认的方向：**方向 A**

- Outcome: 对话区可切换三档模式（strict 全确认 / standard 按配置 / auto 模型代问）；auto 下常规操作由用户配置的模型判断后直接执行，危险/项目外/不确定回确认卡；熔断防卡死。
- User: 本机单用户
- Why now: 权限配置 UI 已落地，配置面完整；缺运行时模式档位（现在只有全确认 / yoloMode 两极）
- Success: 切 auto 后常规操作不弹卡直接执行；危险命令/项目外仍拦截；判断不了弹卡；连续拒绝自动降级
- Constraint: gotgenes 零改动（authorizerChain 官方扩展点）；external_directory/path 自动从严（envelope 强制）；判断模型 = 用户配置 provider；模式不改持久配置
- Out of scope: 模型选择/附件添加（对话区工具栏未来项）；飞书侧模式；MCP（单独立项）

确认理由：5 轮访谈收敛 + 2 项调研实证（envelope 强制语义 + Claude Code 对照），无摇摆项。

## 最窄的切入点

1. 对话区模式切换控件（三档，会话级，全局 lastMode 持久化）
2. 自实现模型判断 link（接用户 provider，deny-first，熔断 5 次，review log）
3. authorizerChain 加链（`["model-judge", "opc-bridge"]`）
4. 熔断降级 + 可观测（决策日志对接既有 review log）

## 待确认问题

- [ ] 熔断阈值（5 次？）实测调优
- [ ] 是否提供「classifyAllShell」语义开关（所有 shell 过模型 vs 默认窄 allow 直放）
- [ ] auto 判断模型的独立覆盖项（`autoJudgeModel`）本期做还是留扩展位
- [ ] 对话区工具栏容器形态（模式切换控件的 UI 结构，为未来模型/附件预留）
- [ ] 模式切换是否触碰既有 E2E（对话区新增控件对既有 locator 的影响）
