# PI Agent 模式化（Modes: strict / standard / auto）

> 状态：探索期
> 故事 ID：`2026-08-11-pi-agent-modes`
> 最后更新：2026-08-11
> 输入：`interview-notes.md`（5 轮访谈 + 2 项调研实证，方向 A）

---

## 1. 问题陈述

PI agent 的权限只有「全人工确认」和「全放行（yoloMode）」两极：对话密集时编辑文件/跑命令逐个弹确认卡太频繁、打断工作流；切 yoloMode 又全放行、危险操作无判断。**缺少运行时模式档位**——想要「少弹卡但不放弃安全」的中间态：文件编辑类自动批准（标准模式按配置即可表达）、常规操作由模型判断自动批准（auto 模式）。

## 2. 解决方案

在对话区增加**模式切换**（会话级三档 + 全局默认记录），auto 档通过 gotgenes authorizerChain 挂**自实现模型判断 link** 实现：

- **三档模式**：`strict`（所有操作都确认，含配置 allow 的）/ `standard`（按项目权限配置执行——现状）/ `auto`（standard 基础上，配置 ask 的由模型判断）；
- **会话级切换**：对话区工具栏模式控件（可扩展容器，未来模型选择/附件同区）；
- **全局默认**：settings 记录 lastMode（上次选的模式），新会话初始 = 上次选的；首次 = auto；
- **auto 引擎**：模型判断 link（接用户配置的 provider）——判安全直接执行、判危险 deny（带原因回给 agent）、不确定 defer 弹卡（deny-first）；连续拒绝 N 次熔断降级回 standard；
- **安全边界**：external_directory/path 系统级从严（gotgenes envelope 强制：模型对这两面 allow 降级 defer，放行必人工）；模式不改持久配置（运行时档位）。

## 3. 用户故事

1. 作为**本机用户**，我想要在对话区切换模式（strict/standard/auto），以便对话密集时少弹卡、敏感时不放松。
2. 作为**本机用户**，我想要 auto 模式下常规操作（项目内 bash/写文件）由模型判断后直接执行，以便不打断工作流。
3. 作为**本机用户**，我想要危险操作（高危命令/项目外访问）即使 auto 下也拦截或弹卡，以便不因模型放水而漏危险。
4. 作为**本机用户**，我想要模型判断不了时回人工确认，以便 auto 不确定的操作不静默放行。
5. 作为**本机用户**，我想要模型频繁拒绝时自动降级回 standard 并提示，以便不被模型卡死。
6. 作为**维护者**，我想要全局记住上次选择的模式，以便新会话延续我的偏好。
7. 作为**维护者**，我想要 auto 的每次判断有记录（review log），以便「静默全 defer/全放行」可查。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| B1 | **三档模式**：strict（全确认）/ standard（按配置）/ auto（模型代问），会话级生效 | 访谈 Q5/Q8 人拍板；strict/standard 边界清晰（全问 vs 按配置） |
| B2 | **对话区模式切换控件**：会话级切换入口，三档；控件所在容器按「可扩展工具栏」设计（未来模型选择/附件同区） | 访谈 Q9/Q11 人拍板；对话区是未来工作台配置区 |
| B3 | **全局 lastMode**：settings 记录上次选择的模式，新会话初始 = lastMode；首次默认 auto | 访谈 Q7/Q12 人拍板；记录在 settings（持久化） |
| B4 | **auto 引擎 = authorizerChain 模型 link**：接用户配置的 provider；判安全 allow / 判危险 deny / 不确定 defer；deny 带 teaching reason 回 agent | 访谈 Q10 人拍板 + 调研实证（delegation-envelope/authorizer-chain） |
| B5 | **external_directory/path 系统级从严**：模型对这两面 allow 被 envelope 强制降级 defer；deny 有效 | 调研实证（delegation-envelope.ts：DELEGATION_EXCLUDED_SURFACES）；不是自觉约定是系统强制 |
| B6 | **熔断**：模型连续拒绝 N 次（初值 5，可调）→ auto 自动降级回 standard + 提示；用户手动切回 | 访谈 Q13 人拍板；Claude Code 用 3/20 阈值，我们取更轻 |
| B7 | **auto 可观测**：每次模型判断写 review log（verdict/deferReason/latency），对接既有 permission review log | 调研实证（authorizerChain log 注入）；「静默全 defer」可查 |
| B8 | **模式不改持久配置**：模式是运行时档位，退出即回配置原状（.pi 文件不动） | 访谈 Q4 人拍板；配置是契约、mode 是工作状态 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| M1 | classifyAllShell 语义开关（所有 shell 命令都过模型 vs 默认窄 allow 直放） | Claude Code 有 `autoMode.classifyAllShell`；我们默认行为（窄 allow 直放）够不够、开关要不要做——tech-design 定 |
| M2 | autoJudgeModel 独立配置项（判断模型 ≠ 对话模型的覆盖位） | 访谈倾向复用对话 provider + 留扩展位；独立项是否本期做 |
| M3 | 熔断阈值精确值（5 次？） | 需实测调优；Claude Code 用 3 连续/20 累计 |
| M4 | 对话区工具栏其他配置项（模型选择/附件添加） | 用户未来计划，非本期；本期只做模式切换 + 可扩展容器 |

## 6. 用户操作流（Operation Flows）

### F1 模式切换（B1/B2/B3）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 对话区工具栏点模式控件 | 显示三档（strict/standard/auto），当前档高亮 | E2E：控件存在 + 当前档标记 |
| 2 | 切到 strict | 会话内所有操作开始确认（含配置 allow 的 read/ls） | E2E/集成：切后 read 也弹卡 |
| 3 | 切到 standard | 回到按配置执行（allow 直放、ask 弹卡） | E2E：切回后 read 直放 |
| 4 | 切到 auto | 会话内配置 ask 的操作开始过模型判断 | E2E：切换成功 + 状态显示 |
| 5 | 新开会话 | 初始模式 = 全局 lastMode（上次选的）；首次 = auto | API/E2E：新会话初始模式断言 |

### F2 auto 模式判断（B4/B5）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | auto 下 agent 执行项目内 bash（如 `npm test`，配置 ask 外） | 配置 allow 直放（不过模型）；配置 ask 的 → 模型判断 | 集成：判断链路走通（allow 直接执行） |
| 2 | 模型判安全（如常见构建命令） | 直接执行，不弹卡 | 集成：allow 后命令执行、无确认卡 |
| 3 | 模型判危险（如高危清单外但模型识别风险） | deny + teaching reason 回 agent，命令不执行 | 集成：deny 后不执行 + 原因可见 |
| 4 | 模型不确定 | defer → 弹确认卡（现状确认卡） | 集成：defer 后确认卡出现 |
| 5 | agent 访问项目外（`cat ~/.ssh/x`） | surface=external_directory → 模型 allow 被降级 defer → 弹卡；模型 deny 有效 | 集成：项目外 auto 下仍弹卡（envelope 实证） |

### F3 熔断降级（B6）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | auto 下模型连续拒绝 N 次（如 5） | auto 自动降级回 standard + 提示「auto 暂停：模型频繁拒绝，已回标准模式」 | 集成：N 次 deny 后模式变 standard + 提示 |
| 2 | 用户手动切回 auto | 恢复正常 | E2E：切换成功 |

### F4 auto 可观测（B7）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | auto 下若干判断发生 | 每次判断写 review log（verdict/reason/latency） | API/集成：日志含决策记录 |

### 6.2 操作分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| auto 下 provider 未配置/不可用 | 模型判断失败 → defer 弹卡 + 提示「auto 不可用」；或降级 standard | E1 |
| 模型调用超时 | defer 弹卡（fail-safe） | E2 |
| 熔断触发 | 降级 standard + 提示 | E3 |
| 模式切换时 worker 正在运行 | 切换生效于下一个评估（当前操作不受影响） | 无 |
| strict 下配置 allow 的操作 | 仍确认（strict = 全确认） | 无 |

## 7. 表单与输入验证

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| 模式切换控件 | 三档枚举，无自由输入 | 无 | — |
| lastMode 持久化 | settings 合法值（strict/standard/auto） | 非法值回落 standard | E1 |

## 8. 错误状态与失败响应

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| E1 auto 不可用 | provider 未配置/API 失败 | 提示「auto 模式不可用，已回标准」 | 模式显示 standard + 提示 | 降级回 standard |
| E2 模型超时 | 判断调用超时 | 无（fail-safe） | defer 弹卡 | 无（确认卡兜底） |
| E3 熔断 | 连续拒绝 N 次 | 「auto 暂停：模型频繁拒绝」 | 模式变 standard + 提示 | 降级回 standard |
| E4 判断记录失败 | review log 写入失败 | 警告日志 | 无（不影响执行） | 无 |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 跨模块（worker 评估链 gotgenes link + 主进程 settings 持久化 + renderer 对话区工具栏）；模型判断链路（prompt/熔断/可观测）是新面；strict 全确认改变既有评估路径（配置 allow 也拦）；B5 依赖 gotgenes envelope 外部行为 |

## 10. 技术方案（Implementation Decisions）

> 本 story 为 complex，技术方案由 `/tech-design` 深潜产出（0.19 流程：合并进 PRD §10，无独立 tech-design.md）。

### 10.1 设计目标

在不动 gotgenes 引擎的前提下，用官方扩展点（authorizerChain link）实现「模型代问」档，叠加会话级模式开关与持久化，让权限在「全确认 / 按配置 / 模型代问」三档间切换。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| worker 评估链（gotgenes） | 权限评估 + authorizerChain 执行（零改动） | 否 |
| auto-judge link（新） | 模型判断：allow/deny/defer + teaching reason + review log + 熔断计数 | 是 |
| 模式服务（主进程） | 会话模式状态 + lastMode 持久化（settings） | 是 |
| 对话区工具栏（renderer） | 模式切换控件（三档）+ 可扩展容器 | 是 |
| 确认卡（既有） | defer 落点（现状机制复用） | 否 |

#### 模块关系图

```
[对话区工具栏] ──切模式──> [模式服务（主进程）]
     │                          │ lastMode
     ▼                          ▼
  [会话模式状态]           [settings 持久化]
     │
     ▼
[worker 评估链]
   ├─ gotgenes（零改动，含 envelope 强制）
   ├─ auto-judge link（新增）──> [用户 provider 模型]
   │     ├─ allow → 直接执行
   │     ├─ deny → 拦截 + reason 回 agent
   │     └─ defer → 确认卡（既有）
   └─ 熔断计数 → 降级 standard
```

### 10.3 数据流

1. **触发**：用户在对话区切模式 → renderer 调模式服务 → 会话模式状态更新 + settings 写 lastMode。
2. **评估**：agent 发起操作 → gotgenes gate 按序跑（path → external_directory → bash → per-tool）→ 命中 ask。
3. **auto 判断**：模式=auto 且 surface 非 excluded → auto-judge link 调模型 → allow（直接执行）/ deny（拦截+reason）/ defer（下个 link）。
4. **excluded 面**：surface ∈ {external_directory, path} → envelope 把 allow 降级 defer → 弹确认卡（deny 仍有效）。
5. **熔断**：link 连续 deny 计数 ≥ N → 模式服务降级 standard + 提示。
6. **可观测**：link 每次决策写 review log（verdict/deferReason/latency/requestId）。

### 10.4 接口契约

#### 接口：auto-judge link（worker 内，注册到 authorizerChain）

- 输入：`{ surface, toolName, input, agentName, cwd }`（gotgenes link 契约）
- 输出：`{ kind: "allow" | "deny" | "defer", reason? }`
- 行为：surface ∈ excluded（external_directory/path）→ 仍评估但 allow 会被 envelope 降级；模型调用失败/超时/不确定 → defer
- 副作用：写 review log；熔断计数（deny 时 +1，allow 时清零）

#### 接口：模式服务（主进程）

- `getMode(spaceKey) → "strict"|"standard"|"auto"`（会话模式；无显式切过 → lastMode）
- `setMode(spaceKey, mode)`（写会话状态 + settings lastMode）
- `getLastMode() → mode` / `setLastMode(mode)`（settings 持久化）

#### 接口：对话区工具栏（renderer）

- `[data-mode-switch]` 控件 + `[data-mode='strict'|'standard'|'auto']` 档位
- 未来扩展位：`[data-toolbar-slot]` 容器（模型选择/附件预留）

### 10.5 测试 seams（对齐访谈 Q7 决策）

| 稳定块 | seam | 测试类型 | 关键断言 |
|---|---|---|---|
| B1 三档 | 模式服务 + worker 评估 | 集成 | strict 全确认（含 allow）/ standard 按配置 / auto 模型代问 |
| B2 切换控件 | renderer + E2E | E2E | 控件存在 + 切换生效 |
| B3 lastMode | 模式服务 | API | 新会话初始 = lastMode；首次 auto |
| B4 auto link | 真实 worker + FAUX provider | 集成 | allow 直执行 / deny 拦截+reason / defer 弹卡 |
| B5 excluded 从严 | 真实 gotgenes + envelope | 集成 | 项目外 auto 下 allow 降级 defer 弹卡；deny 有效 |
| B6 熔断 | link 计数 + 模式服务 | 集成 | N 次 deny 后降级 standard + 提示 |
| B7 可观测 | review log | API | 决策记录含 verdict/reason/latency |

**capability/entity**：`agent-dialogue` / `conversation-space`（权限模式属对话 agent 能力域）。

### 10.6 安全/性能/可观测性

- **安全**：external_directory/path 系统级从严（envelope 实证，非自觉）；deny-first（模型只 deny 不主动放行 excluded 面）；判断不了 defer 弹卡。
- **性能**：配置 allow 直放不过模型（短路）；仅配置 ask 的操作触发模型调用（本地 provider 毫秒~秒级）。
- **可观测**：review log 对接既有 permission review log；熔断降级有提示 + 日志。

## 11. 测试决策

- 集成测试（核心）：真实 worker + gotgenes + FAUX provider——三档行为、auto 判断链路（allow/deny/defer）、excluded 从严、熔断降级。
- API 测试：模式服务（getMode/setMode/lastMode 持久化）。
- E2E：对话区模式切换控件（存在/切换/当前档标记）；新会话初始模式。
- 组件测试：工具栏控件渲染 + 可扩展容器结构。

## 12. 范围外

1. 对话区工具栏其他配置项（模型选择/附件添加——M4，未来 story）；
2. 飞书侧模式（本 story 仅 UI 空间会话区）；
3. MCP（单独立项）；
4. gotgenes 引擎改动（零改动约束）；
5. classifyAllShell 开关（M1，tech-design 定）；
6. autoJudgeModel 独立配置项（M2，倾向留扩展位）。

## 13. 补充说明

- **envelope 强制实证**：gotgenes `authority/delegation-envelope.ts`——`DELEGATION_EXCLUDED_SURFACES = {external_directory, path}`，link 对这两面的 allow 一律降级 defer（`encloseInDelegationEnvelope` 唯一篡改分支），deny 原样通过——「模型不自动放行项目外」是系统强制不是自觉。
- **surface 决定权**：越界命令/工具 → surface=external_directory（模型不能 allow）；纯 bash（无外部路径）→ surface=bash（模型可 allow）；项目内工具 ask → 工具名（模型可 allow）。
- **链序**：`["auto-judge", "opc-bridge"]`——auto-judge 在前（deny 短路不弹卡、allow 直放），defer 落回 opc-bridge 确认卡；现有配置 authorizerChain 数组整体替换（ADR-022）即可加链。
- **模型 provider**：复用用户配置（settings agent provider/apiKey）；未配置 → auto 不可用降级 standard（E1）。
- **熔断参考**：Claude Code 连续 3 deny/累计 20 暂停；我们取连续 5 次降级回 standard（可调）。
- **来源**：访谈裁决见 `interview-notes.md`；gotgenes/Claude Code 实证见 story research 笔记。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | F1-F4 覆盖 B1-B8 全部行为面；6.2 分支表齐 |
| 输入验证 | PASS | §7 表齐（模式枚举/lastMode 合法值） |
| 错误状态 | PASS | E1-E4 含 auto 不可用/超时/熔断/记录失败 |
| 复杂度分级 | complex | §9，理由充分（跨模块 + 模型判断链路 + envelope 外部依赖） |
| 技术方案 | PASS | §10 完整（模块/数据流/接口/测试 seams）——complex 深潜完成 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-11 | 初稿（访谈 5 轮 + 调研 2 项，方向 A）；§10 技术方案按 0.19 流程内嵌 | AI + 人 |
