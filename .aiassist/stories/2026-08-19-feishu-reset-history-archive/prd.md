# 飞书 /reset 历史会话归档与回看

> 状态：探索期
> 故事 ID：`2026-08-19-feishu-reset-history-archive`
> 最后更新：2026-08-19

---

## 1. 问题陈述

用户在飞书中发送 `/reset` 后，之前的对话历史在 UI 会话列表中**彻底消失、不可回看**：飞书空间是「单行世代制」（`feishu:<chatId>` 一行原地换代），reset 后列表仍只有一条目，点开后消息为空——旧世代 JSONL 留在磁盘上却没有任何入口可达。对比 UI 空间，`/reset` 会保留旧会话条目供回看；用户对飞书会话有同样的预期：reset 应把当前对话**归档为一条可读的历史条目**，然后开启新会话。

一句话痛点：**飞书 /reset 后历史对话在 UI 中不可见、不可回看**。

## 2. 解决方案

把飞书 `/reset` 从「单行原地换代」改为「**归档 + 新行**」：reset 时把当前 `agent_sessions` 行改名为归档键（`feishu:<chatId>:gen<N>`，保留其 title / sessionRef / lastActiveAt），并新建 `feishu:<chatId>` 活跃行。列表天然多出历史条目；归档条目沿用现有消息投影即可只读回看，写面（发消息/再 reset）沿用 `feishu:` 前缀 403 只读守护。

## 3. 用户故事

1. 作为飞书通道用户，我想要 `/reset` 后旧对话以历史条目留在 UI 列表中，以便我随时回看 reset 前的对话内容。
2. 作为飞书通道用户，我想要 reset 后列表出现一条干净的新会话条目，以便新对话不与历史混淆（title 重置为「新对话」语义）。
3. 作为系统维护者，我想要归档条目保持只读（不可发消息、不可再 reset），以便飞书通道的单向写入语义不被破坏。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | 飞书 /reset 归档语义：旧行改名归档 + 新建活跃行 + 回执文案不变 | 用户已在路由诊断中拍板期望行为；`store.reset()` 唯一调用方 = 飞书命令路径，爆炸半径封闭 |
| 2 | 归档条目列表可见：feishu 组按 lastActiveAt 倒序展示归档条目（含标题与 chat 名 fallback） | 现有 listSessions 前缀分组天然覆盖，仅需 displayName fallback 微调 |
| 3 | 归档条目只读回看：GET messages 返回历史；POST messages / reset → 403 E-SESSION-READONLY | 现有 `feishu:` 前缀只读守护与消息投影零改动覆盖 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| 1 | 升级前残留的孤儿世代文件（旧 gen JSONL 无对应行）是否回填为归档条目 | 价值/成本未定；默认不做（见 §12），若用户需要再结晶 |

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 飞书 chat（chatId=`oc_123`）内已有若干对话（当前世代 gen2，title=首条用户消息截断） | 列表飞书组 1 条：`feishu:oc_123` | §6.3-1 |
| 2 | 飞书内发送 `/reset` | 回执文案不变「已重置当前对话空间会话，可以开始新对话了」；旧行改名为 `feishu:oc_123:gen2`（title/sessionRef/lastActiveAt 保留）；新建 `feishu:oc_123` 行（title=NULL，sessionRef=gen3 新 JSONL） | §6.3-2 |
| 3 | 打开 UI 会话列表 | 飞书组 2 条，按 lastActiveAt 倒序：`feishu:oc_123`（新，标题空→UI 显示「新对话」）在上，`feishu:oc_123:gen2`（原标题）在下 | §6.3-3 |
| 4 | 点击归档条目 | 只读展示 gen2 的历史消息（既有消息投影） | §6.3-4 |
| 5 | 新会话继续对话后再 `/reset` | 再次归档：`feishu:oc_123:gen3` 出现，活跃行换 gen4；列表 3 条 | §6.3-5 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 当前世代无消息（消息投影为空）时 /reset | **不产生归档条目**：退回既有原地换代语义（行不变、sessionRef 换代）；列表条数不变 | 无错误（正常分支），§8-4 |
| 从未对话过的 chat 发 /reset（无行） | 维持现行为：无归档、无新建，回执文案不变 | 无错误（现行为不变） |
| 对归档条目发消息 / 再 reset（HTTP 面） | 403 `E-SESSION-READONLY`（`feishu:` 前缀守护覆盖归档键） | §8-1 |
| 归档事务写库失败 | 整体回退为既有原地换代 + stderr 诊断，回执不变 | §8-2 `E-SESSION-PERSIST` 降级 |
| 归档条目 JSONL 文件缺失 | GET messages 返回 200 空数组，不 500、不阻断列表 | §8-3 |

### 6.3 预期值锚点（Expected-Value Anchors）

| # | 输入 | 预期输出/结果 | 依据 |
|---|---|---|---|
| 1 | 行前状态：`agent_sessions` 含 `feishu:oc_123`（sessionRef=`…/feishu_oc_123.2.jsonl`，title=`你好帮我查一下…`） | 列表 feishu 组 = 1 条，spaceKey=`feishu:oc_123`，title 原值 | 现有 listSessions 行为（回归基线） |
| 2 | 上述状态 + `store.reset("feishu:oc_123")` | 两行：①`feishu:oc_123:gen2`（sessionRef=`…/feishu_oc_123.2.jsonl`，title 原值，lastActiveAt 原值）；②`feishu:oc_123`（sessionRef=`…/feishu_oc_123.3.jsonl` 且文件已 touch，title=`NULL`，createdAt=此刻，**lastActiveAt=此刻（=createdAt）**）；`feishu:oc_123` 原行不再存在 | 用户拍板期望（归档 + 新行）；世代编号延续防文件碰撞；lastActiveAt 锚定（v0.2，review 发现：排序锚点依赖此值） |
| 3 | 锚点 2 之后 GET `/api/agent/sessions` | `feishu` 组 2 条：`[0].spaceKey="feishu:oc_123"`（title=null）、`[1].spaceKey="feishu:oc_123:gen2"`（title=原值）；按 lastActiveAt 倒序 | 现有排序契约（裁决 17） |
| 4 | GET `/api/agent/sessions/feishu%3Aoc_123%3Agen2/messages` | 200 `{messages:[…gen2 全部历史…]}`（messageId/role/createdAt 与重置前一致） | 现有 JSONL 投影（裁决 3） |
| 5 | 连续两次 reset（第二次前 gen3 有消息） | 出现 `feishu:oc_123:gen3`；活跃行 sessionRef=`…/feishu_oc_123.4.jsonl`；feishu 组 3 条 | 归档可重复、键不碰撞 |
| 6 | 空世代（活跃行投影 messages=[]）+ `store.reset("feishu:oc_123")` | 无 `…:gen…` 归档行；行数不变；sessionRef 换代（现行为） | 空世代不归档（§6.2 分支） |
| 7 | POST `/api/agent/sessions/feishu%3Aoc_123%3Agen2/messages` 或 `/reset`（provider/mode 写端点同理） | 403，响应体封套 `{ error: "E-SESSION-READONLY", message: … }`（sendError 既有封套；v0.2 修订：字段名 `code`→`error`，与实现及既有 feishuReadonly 测试一致，人确认 2026-08-19） | 裁决 9 只读守护扩展覆盖归档键 |
| 8 | reset 回执 | 文本恒为 `已重置当前对话空间会话，可以开始新对话了` | REQ-AGENT-022 现行为不变 |

## 7. 表单与输入验证（Form / Input Validation）

本 story 无新用户输入。`/reset` 无参校验（非法参数 → `E-CMD-INVALID`）为既有行为，语义不变，不重测。

## 8. 错误状态与失败响应（Error States / Failure Responses）

| # | 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|---|
| 1 | 归档条目写操作 | POST messages / reset / provider / mode 到 `feishu:<chatId>:gen<N>` | 403 `E-SESSION-READONLY` | 飞书组条目只读（现 UI 行为） | 无 |
| 2 | 归档写库失败 | SQLite 归档事务（改名+插新行）失败 | stderr `E-SESSION-PERSIST` 诊断 | 回执文案不变 | 回退为原地换代（现行为），不产生半成品归档行 |
| 3 | 归档 JSONL 缺失 | 归档条目 sessionRef 文件被删 | 无错误码 | GET messages → 200 `{messages:[]}` | 不 500、不重建、不阻断列表 |
| 4 | 空世代 reset | 活跃行消息投影为空 | 无错误码 | 列表条数不变 | 原地换代（现行为） |
| 5 | reset 与入站消息并发 | 同一 chat reset 与新消息交错 | 无新错误码 | 消息路由以归档事务完成后的行为准 | 归档事务（改名+插入）单事务原子完成；v0.2 豁免注记：归档事务同步执行无 await（code review 实证无交错窗口），并发时序不单独自动化测试，豁免记于 signoff |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **simple** |
| 判断理由 | 改动集中 2 个模块（sessionStore reset 语义 + listSessions displayName fallback）；agentRouter / agentService / renderer 零改动；无新外部依赖；分支少（空世代/无行/写失败三条）；跨模块契约仅 1 个（归档键形） |

## 10. 技术方案（Implementation Decisions）

### 10.1 设计目标

- 飞书 `/reset` 从「单行原地世代制」升级为「归档 + 新行」，让历史对话在 UI 列表中可见、可只读回看，且不动路由、渲染与只读守护的任何既有接线。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| sessionStore | `reset(feishu:*)` 语义改为：归档事务（旧行改名 `…:gen<N>` + 新活跃行，单事务）+ onReset 通知（活跃键 + 新 sessionRef，形态不变）；空世代/无行分支保持现行为 | 否（改） |
| agentSessions 路由（HTTP） | listSessions：归档键 displayName fallback——按 `feishu:<chatId>` 主键查 spaceMeta；其余零改动（前缀分组/排序/只读守护天然覆盖归档键） | 否（微调） |
| agentRouter | 不变（`store.reset(spaceKeyFor(chatId))` 调用形态不变，回执不变） | 否 |
| agentService / worker | 不变（onReset 监听收到的仍是活跃键 + 新 sessionRef；懒恢复按行重装） | 否 |
| renderer SessionList | 不变（归档条目作为 feishu 组普通只读条目渲染） | 否 |

#### 模块关系图

```
[飞书 /reset]
   │
   ▼
[agentRouter.handleCommand] ──store.reset("feishu:<chatId>")──> [sessionStore]
   │                                                              │ 归档事务：旧行改名 …:gen<N> + 新活跃行（单事务）
   │                                                              │ onReset 通知（活跃键, 新 sessionRef）
   │                                                              ▼
   │                                                        [agentService] 清活跃空间上下文（既有接线）
   ▼
回执文案不变
[UI GET /api/agent/sessions] ──> [listSessions] feishu 组含归档条目（displayName fallback 主键查 spaceMeta）
[UI GET …/feishu:<chatId>:gen<N>/messages] ──> 既有 JSONL 投影 → 历史只读
```

### 10.3 数据流

1. **触发**：飞书入站 `/reset` → agentRouter 命令直通 → `store.reset("feishu:<chatId>")`。
2. **分支判定**：无行 → 现行为返回；活跃行消息投影为空 → 原地换代（现行为）。
3. **核心处理**（单事务）：从旧 sessionRef 解析世代号 N → 旧行 `UPDATE spaceKey = feishu:<chatId>:gen<N>`（title/sessionRef/lastActiveAt/createdAt 保留）→ `INSERT feishu:<chatId>` 新行（sessionRef=世代 N+1 新 JSONL 并 touch，title=NULL，provider/model=NULL 回落默认组合，createdAt=lastActiveAt=此刻）。
4. **副作用**：onReset 监听者（agentService）收到 `(feishu:<chatId>, {sessionRef: 新})` → 清活跃空间上下文 + IPC reset-session（既有接线零改动）。
5. **输出**：回执文案不变；UI 列表下次拉取即见归档条目 + 新条目。

### 10.4 接口契约

#### 契约 1：归档 spaceKey 键形

| 项目 | 说明 |
|---|---|
| 定义方 | sessionStore.reset（唯一产生方） |
| 消费方 | listSessions（分组/displayName fallback）、消息投影与只读守护（`feishu:` 前缀判定）、sessionLifecycle.groupOf（归档键 = 自身组，天然不参评同组单活） |
| 键形 | `feishu:<chatId>:gen<N>`，N = 被归档世代的世代号（从旧 sessionRef 解析），同一 chat 多次归档天然唯一 |
| 逆解析 | chatId = 去掉 `:gen<N>` 后缀（spaceMeta fallback 用） |

**样例（golden values）**：

| 场景 | 输入 | 期望输出 |
|---|---|---|
| 正常归档 | `reset("feishu:oc_123")`，旧 ref=`…/feishu_oc_123.2.jsonl` | 归档键 `feishu:oc_123:gen2`；新活跃行 ref=`…/feishu_oc_123.3.jsonl` |
| 首世代归档 | 旧 ref=`…/feishu_oc_123.jsonl`（gen1） | 归档键 `feishu:oc_123:gen1`；新行 ref=`…/feishu_oc_123.2.jsonl` |
| 异常：畸形 ref | 旧 ref 解析不出世代号 | 按 gen1 处理（`generationFromRef` 既有兜底语义） |

#### 契约 2：`store.reset(spaceKey)` 对外形态不变

| 项目 | 说明 |
|---|---|
| 调用方 | agentRouter.handleCommand（唯一） |
| 返回 | 现形态：无行 → `undefined`；有行 → info 对象（`{spaceKey: 活跃键, sessionRef: 新, reset: true, …}`） |
| 通知 | onReset 监听者收到 `(活跃键, info)`——监听者零改动 |
| 幂等性 | 否（每次调用产生一次归档，空世代除外） |

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 归档建模 | A. 归档改名 + 新行（选） / B. 单行 + 列表 API 展开世代 / C. 每会话全新 spaceKey + chat→活跃映射 | A 对齐 ADR-016「空间=会话」与 UI 空间语义；title/排序/投影/只读守护全部零改动复用；B 缺逐世代 title 载体；C 要动路由 | A 需修订 ADR-016（feishu「世代制沿用」条款）；既有 feishu 世代制回归测试语义翻转（见 §11.2） |
| 世代编号延续 | 新活跃行继续 N+1（选）/ 新行从 gen1 重启 | 文件不碰撞（同一 safeKey 基名）；worker 侧世代命名镜像零改动 | 无 |
| 空世代处理 | 不归档、原地换代（选）/ 归档空条目 | 空条目在列表中是噪声（title 空、messages 空） | 判定依赖消息投影，投影格式变化会波及——见 §10.6 |

**ADR 行动**：本决策满足 ADR 三条件且部分推翻 ADR-016 决策 1/4 的飞书条款——PRD 确认后新增 `adr/0037-feishu-reset-archive.md` 并把 ADR-016 标注为「飞书部分被 0037 修订」。

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| worker/agentService 懒恢复只认「活跃键 + 行内 sessionRef」，旧行改名不影响活跃会话 | 重置后活跃会话读到旧世代上下文 | TECH-DESIGN | 能（单元：reset 后 createSession 读新 ref） |
| `feishu:` 前缀只读守护覆盖所有写端点（messages/reset/provider/mode） | 归档条目可被写入，破坏只读契约 | PRD（补 REQ） | 能（集成：逐端点 403 断言） |
| 消息投影为空 = 空世代的判定在 PI JSONL 格式下成立（无 header-only 噪声行被算成消息） | 空世代被误归档（列表噪声）或反之 | TECH-DESIGN | 能（单元：空 JSONL / 仅元数据行两种语料） |

### 10.7 安全/性能/可观测性

- 安全：归档键仍属 `feishu:` 前缀只读域，写面 403 守护不变；chatId 来源不变（通道事件），无新信任边界。
- 性能：归档 = 1 次 UPDATE + 1 次 INSERT（单事务）；列表查询行数随归档增长（与 UI 空间同级，无索引变更）。
- 可观测性：归档事务成功/失败各一行 stderr 诊断（含 spaceKey 与世代号）；空世代分支一行诊断。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 reset 归档语义 | sessionStore（临时目录 + 临时 SQLite，既有单元 seam） | 单元 | 真实 fs/db（临时目录） |
| 1 分支：空世代/无行/写失败 | 同上 | 单元 | 真实 fs/db；写失败注入 = **DB 层失败**（删表/破坏句柄）——v0.2 修正：归档分支 touch 在 try 外，只读目录注入走不到 §8-2 降级分支 |
| 2 列表可见 + displayName fallback | HTTP 路由 agentSessions（既有集成 seam：真实 store + 临时目录） | 集成 | 真实 store；spaceMeta 直写侧表 |
| 3 只读回看 + 写守护 | 同上（GET messages 200 历史；POST messages/reset/provider/mode 403） | 集成 | 真实 store |
| 回执文案不变（锚点 8） | agentRouter（既有单元 seam，stub store） | 单元 | stub store 断言 reset 调用参数 + reply 文案 |

### 11.2 测试策略与先例

- 只测外部行为：reset 后**表行内容 + 文件系统状态 + HTTP 响应**，不断言内部函数调用。
- 先例：`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/` 的 sessionReset 例与 ui-copilot 的 agentSessions 路由集成测试（临时目录 + 真实 store）。
- **既有测试语义翻转**：builtin-agent 的「sessionReset feishu 世代制例」断言的是旧语义（单行原地换代）——本 story 的 test-author 需将其修订为归档语义（旧 spec 已是历史记录，测试随代码真值演进），修订点需在 signoff 阶段显式列出。

## 12. 范围外

- 升级前残留的孤儿世代 JSONL（无对应行的旧 gen 文件）回填为归档条目（移动块 1，默认不做）。
- 归档条目的删除 / 重命名 / 管理 UI。
- 归档条目「继续对话」（把历史条目恢复为活跃会话）。
- renderer 任何改动（归档条目由现有 SessionList 天然渲染）。

## 13. 补充说明

- 本 story 修订 ADR-016 的飞书条款（决策 1「feishu:<chatId> 不变，世代制沿用」与决策 4「世代机制保留给飞书 /reset」）：世代机制本身仍用于 JSONL 文件命名与 provider/key 变更重建，但 /reset 的**行语义**从「原地换代」改为「归档 + 新行」。PRD 确认后落 ADR-0037。
- UI 空间 /reset 语义（ADR-016 决策 3）不变。
- 飞书 HTTP reset → 403 E-SESSION-READONLY（裁决 9）不变——归档只由飞书通道内 `/reset` 命令触发。

### review 记录（2026-08-19 /review panel，详见 review.md）

- **写面守护实际范围** = messages / reset / mode / provider 四端点（`feishu:` 前缀 403）；POST stop 为幂等 no-op 设计，不列入只读守护（对归档键 202 no-op 无害，属既有契约非本 story 新增面）。
- **守护扩面记录**：mode/provider 的 `feishu:` 前缀守护对活跃行同样生效（此前活跃 feishu 行可 PUT provider/mode）——与飞书通道单向写入语义一致的行为扩面，无既有测试破裂；正式记录于 ADR-0037。
- **重启水合副作用（接受）**：ready 水合遍历全量行，mtime 1h 窗口内的归档行会被水合（worker 建永不交互的句柄，占 LRU 名额）——无正确性问题，本 story 接受，留 /reflect 观察点；如需收敛可在水合处过滤 `:gen\d+$` 键。
- **留人决策（/reflect 前）**：mode/provider 端点为 AC3 断言新增的 POST 别名使 `ui:*` 空间 POST 从 404 变为写操作——确认保留或将只读守护前移到方法分派之前。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | 3 个稳定块各有 happy path（§6.1），分支入 §6.2 |
| 输入验证 | PASS（N/A） | 无新用户输入，§7 已声明理由 |
| 错误状态 | PASS | §8 五行覆盖写守护/写失败/文件缺失/空世代/并发 |
| 预期值锚点 | PASS | §6.3 八条机器可验锚点，每稳定块 ≥1 条 |
| 复杂度分级 | simple | §9 理由：2 模块、无新外部依赖、1 个跨模块契约 |
| 技术方案（§10） | PASS | simple 高层完整（含契约 golden values 与 ADR 行动） |
| 覆盖接缝（§11.1） | PASS | 每稳定块 ≥1 个既有 seam，无新 seam |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-19 | 初稿 | AI + 人 |
| v0.2 | 2026-08-19 | /review 后修订：403 锚点字段名 code→error（人确认）；锚点 2/§10.3 补新行 lastActiveAt=createdAt；§8-5 并发豁免注记；§11.1 写失败注入点修正（DB 层）；§13 增补 review 记录 | AI + 人 |
