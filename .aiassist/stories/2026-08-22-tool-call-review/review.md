# Review 报告 — 会话轨迹账本（Trajectory Ledger） / prd,tech,req,test,code

> 故事 ID：`2026-08-22-tool-call-review`
> 审查层：`prd,tech,req,test,code`（全链审查）+ performance 条件派发
> 模式：`panel`（并行 specialist 复审，第 2 轮）
> 日期：2026-08-23
>
> **第 2 轮说明**：第 1 轮报告声称「全链 PASS、3 CRITICAL + 4 IMPORTANT 已全部修复闭环、1069 单元绿、轨迹套件 18/18 绿」。本轮对签核基线 `f679538` 之后的全部改动（含未提交工作区）做独立复核。结论：**单元/API 腿的修复真实有效；但 E2E 腿当前静态可证必然失败，「已通过回归验证」的声称不成立；另发现 2 个此前漏检的实现级 CRITICAL。**

---

## 审查摘要

- **总体结果**：FAIL
- **阻塞项数量**：5（CRITICAL）
- **警告项数量**：8（IMPORTANT）
- **建议项数量**：10+（SUGGESTION，择要列出）
- **自动化测试实测**：单元 18/18 绿（recorder 7 + api 5 + model 6）；E2E 未运行——静态分析证明 6 用例全部在播种阶段失败（见 C1/C2）

## 分层发现（panel 模式复审）

| 层 | 子代理 | 严重 (CRITICAL) | 重要 (IMPORTANT) | 建议 (SUGGESTION) | 结论 |
|---|---|---|---|---|---|
| prd | prd-reviewer | 0 | 1 | 4 | WARN |
| tech | tech-reviewer | 1 | 3 | 3 | WARN |
| req | req-reviewer | 0 | 4 | 3 | WARN |
| test | test-engineer | 2 | 4 | 3 | FAIL |
| code | code-reviewer | 3 | 4 | 6 | FAIL |
| performance | performance-auditor | 0 | 3 | 6 | WARN |

---

## 阻塞项（CRITICAL，修复或显性裁决前不得进入 REFLECT）

### C1 [test/code] E2E 播种契约失配 —— 全部 6 个 E2E 用例必死在 Arrange
- 位置：`tests/.../e2e/trajectoryView.test.cjs:53-62`
- 问题：`createSession()` 以 `POST {spaceKey}` 调 `/api/agent/sessions`，但 `handleCreateSession`（src/http/routes/agentSessions.js:205）只接受 `spaceKind:"general"|"project"`，缺省返回 400 E-SESSION-CREATE → `expect(res.ok).toBe(true)` 必败。即使补上 spaceKind，服务端也忽略调用方 spaceKey、改生成 `ui:copilot:<randomUUID>`，后续 `[data-session-item='<固定key>']` 定位器永不可见。
- 影响：第 1 轮 review.md 声称「E2E 已修复并通过回归验证」不成立；其「轨迹测试套件 18/18 绿」恰好等于 node --test 单元用例数（7+6+5），E2E 结果无任何证据覆盖。
- 建议：改用 `POST {spaceKind:"general"}` 并从响应取真实 spaceKey 推导 safeKey 再写 sidecar；修复后必须真实跑通 E2E 并把证据回填 review.md。
- 阻塞：是

### C2 [test] `conversation-tab` testid 在产品中不存在
- 位置：`trajectoryView.test.cjs:16,100` ↔ `src/renderer/components/assistant/ChatView.jsx:63-70`
- 问题：「对话」按钮无任何 data-testid（UX 原型中该 tab 也只有 `id=tab-chat`），V1 反向切换断言永远超时。同族问题：REQ-129 引用的 `view-tabs` 容器 testid 实现中也未落。
- 建议：产品侧为「对话」按钮补 `data-testid="conversation-tab"`、tabs 容器补 `view-tabs`（[build] commit）；或定位器改 `getByRole("button", { name: "对话" })`。
- 阻塞：是

### C3 [code/tech] worker 重启后 seq 从 0 重撞（父代理已实证复现）
- 位置：`src/agent/trajectoryRecorder.js:87-99`
- 问题：seq 计数器只在进程内存（sessionStates Map）。watchdog 重启→重水合后同一 sessionRef 继续追加时，新行 seq 与既有行重复。实测复现：同一 sidecar 出现两对 seq 1,2。破坏 D3/ADR-038「单调 seq」决策；renderer 按 seq 幂等原位覆盖会把历史行改写成无关新行，游标分页窗口错乱。PRD §10.6 明确预判该风险并给出缓解（惰性恢复从尾行读 maxSeq），实现与测试双双缺失。
- 建议：recorder 首写前按当前世代 sidecar 尾行恢复 seq 基线；§11.1 补对应单元 seam。
- 阻塞：是

### C4 [code] running 行从未产出 —— L2 锚点在生产链路不可达
- 位置：`src/agent/trajectoryRecorder.js:195`（worker.js 接线只调 onToolEnd/onToolError）
- 问题：`onToolStart` 只登记内存 Map 不写行。§10.3 设计是「start 建 running 行，end/error 按 toolCallId 回填」。后果：(a) 接口 1 的 `status:"running"` 枚举与 L2 锚点（running 行显示起始标记、无时长文本）不可达——账本在工具完成前什么都不显示；(b) trajectoryModel 的原位更新路径实际只有单测合成数据在喂。
- 建议：onToolStart 写入并下发 running 行（无 durationMs/output），end/error 按 seq 回填。
- 阻塞：是

### C5 [tech/test/code] 稳定块 6/7 语义静默降级 + 对应断言被改写迁就实现
- 位置：`TimelineOverview.jsx:68-127`、`TrajectoryView.jsx:31-54`、`Ledger.jsx:94-110`、`trajectoryView.test.cjs:200-249`
- 问题：(a) Timeline 只有「点击色块过滤 + 右键清除」，稳定块 6 承诺的滚轮缩放时间域、拖拽区间选区、右键平移、hover 500ms 钟表时间全部缺失（UX 原型有完整实现可对照）；(b) TL2 的 E2E 断言被改成「点色块→banner 显隐」，不再断言锚点核心「账本只剩区间内记录」；(c) 虚拟滚动只有窗口渲染（VS1 可达）：打开不定位于尾部、无上滑暂停跟随/回底恢复（VS2 无任何 E2E）、顶触加载上一页零接线——`prependTrajectoryRecords`/`hasMore` 是死代码，TrajectoryView 固定 limit=200 且丢弃 hasMore/meta.skipped。
- 建议：补齐接线与交互，或由人拍板降级并正式修订稳定块 6/7 与 TL2/VS2 锚点后再审。
- 阻塞：是

---

## 警告项（IMPORTANT，REFLECT 前应处理）

### W1 [prd] 工具「错误」（isError=true）呈现路径无锚点无覆盖
- US1 承诺回看「哪个工具错了」，但 §6.2 把出错混入中断语义；§6.3 无 error 变体锚点；E2E 夹具全是 isError:false；单元层也无 onToolError 用例（实现在 trajectoryRecorder.js:252 已存在）。
- 建议：§6.2 补「工具执行报错」分支 + 最小锚点；补 status:error 单测。

### W2 [code] J1 跳转落在未注册路由上
- `Inspector.jsx:71` navigate(`/executions/${id}`)，但 App.jsx 只有 `/executions` 无 `/executions/:id`（既有深链先例是 Notifications.jsx:116 的 `/executions?highlight=<id>`）。内层 Routes 匹配不到 → 页面空白；E2E 只正则断言 URL 变化所以假绿。
- 建议：改跳 `?highlight=` 深链，或补 `/executions/:id` 路由；同步加强断言。

### W3 [tech/code] 截断双实现漂移，违背「单真源」原则
- D2/ADR-038 声称「shrinkToolCarrier 同标零新代码」，实际新写了第二套截断：按 UTF-16 字符 slice（非序列化字节收紧）、兜底允许终态超限 +4096、CJK 密集载体盘上可达 ~3×256KB；且对 text 载体的截断超出接口 1 登记面（未声明的契约扩展）。
- 建议：复用/导出 turnEventPipeline 收紧原语，或把偏差作为已接受决策写回 §10.5 与 ADR-038。

### W4 [perf] 读取端每请求全量读文件+全量 parse，主进程同步冻结
- `readTrajectoryRecords` 每次 GET 全文件 readFileSync + 逐行 JSON.parse + sort：20MB sidecar 估算单请求 100–200ms 主进程冻结（期间所有 SSE/HTTP 停摆）；每次翻页都重复全量。「游标分页防全量加载」的 §10.7 主张在读取侧不成立。
- 建议：尾部字节窗读取或增量缓存投影；翻页接线（C5）后此项优先级上升。

### W5 [req] REQ 层四处契约弱化/悬空
- (a) REQ-130 AC1 把 L1「恰渲染 4 行」弱化为「完整渲染所有行」，丢失精确计数信号；(b) REQ-132 AC2 标题含「滚轮缩放」但正文无缩放断言；(c) 稳定块 7「顶触加载上一页」未结晶进任何 AC（PRD §6.1 步骤 7 还错引 VS1/VS2 为其锚点）；(d) VS1 的 ≤50 上界推导算术（36px 行高×视口+overscan）无处记载，不可机械复现（机制合法——锚点授权 harness 定值且门 1 签核——但推导应补记一行算术）。

### W6 [test] E2E 头注声明 L2/S1/VS2 但无用例；REQ-129-AC3（飞书归档/孤儿会话）零自动化
- test-plan.md 矩阵声称覆盖，实际缺口。S1 live 并入仅有 reducer 纯函数腿，FAUX 真回合 E2E 佐证未落地。

### W7 [code] assistant_span 时间戳投影错位
- span 的 ts 写于 message_end（结束时刻），Timeline 以它为段起点投影 TTFT/decode → 两段画进「未来」，与真实早于它的工具段错位重叠，违反稳定块 6「按真实 start/duration 投影」。TL1 只查段存在性故未拦截。
- 建议：span 记录增加起点时刻（首个 delta 记点），Timeline 用起点投影。

### W8 [code] live 门控形同虚设
- Assistant 下发的是 `ev.record`（裸行对象无 sessionKey）→ TrajectoryView 的 includes 门控短路为「全收」；即便有 key，子串启发也会串会话（`s12` 命中 `s1`）。切换会话瞬间的残留事件污染新视图。
- 建议：父层按当前 spaceKey 精确过滤后再下发。

---

## 通过项（正面确认）

- **痛点锚定 / 稳定块划分 / 术语一致**（prd）：无初衷漂移；移动块悬置恰当。
- **接口 2 分页 golden values 实证吻合**（tech/code）：A1 尾窗 `[seq4,seq5]`、A2 `before=traj_4→[seq2,seq3]`、坏行 skipped=1、非法 before 忽略、缺文件 200 空态——父代理独立探针全部命中。
- **EXPECTED-TRACE 诚实性**（test）：抽查字面值（project_list/durationMs:42300/ttft 830/decode 2140/usage 三元组/≤50）与 PRD §10.4 golden 高度吻合，无自证痕迹；J1 示例值差异（ex123 vs ex_2041）判定为非偏差。
- **签核后测试改动审计**（test）：三个文件的改动零删除、零放宽、纯新增断言（R1 零污染用例、AC6 sendCalled 双写断言、截断徽章断言均为合法补强）——「实现者对测试只读」契约未被破坏，改动性质是补强而非作弊。
- **ADR 冲突核查**（tech/code）：sessionDomain 扩展合规 ADR-030；registry 零改动哑管道成立；Inspector/Ledger 渲染原始 tool IO 无 dangerouslySetInnerHTML/href 注入面，ADR-021 安全边界不破；写失败日志走 redact()。
- **commit 纪律**：git log 核验通过——[test]/[build] 提交分离干净，build 提交未触碰 tests/。

## 流程提示（不计发现）

1. 工作区现有 src/renderer ×4 + 业务测试 ×3 未提交混放——后续提交必须拆分：实现修复走 `[build]`、测试修复走 `[test]`，不得同 commit。
2. `.claude/settings.json` 改动（enabledMcpjsonServers/defaultMode）与本 story 无关，勿混入 story commit。
3. 第 1 轮 review.md 已保留为 `review-round1.md` 供比对；本轮结论以本文件为准。

---

## 结论

- [ ] 可进入下一阶段
- [x] **需修复阻塞项后重审**
- [ ] 建议回流到 PRD / TECH-DESIGN（若人选择接受 C5 降级，则回流修订 PRD 稳定块 6/7 与 TL2/VS2 锚点）

**建议动作顺序**：
1. 人先裁决 C5：补齐 Timeline 交互与虚拟滚动跟随/翻页（工作量可控，UX 原型已有参照实现），还是接受降级并修订 PRD 锚点。
2. `[bugfix]`/`[build]` 修 C2（ChatView 补 testid）、C3（seq 惰性恢复）、C4（running 行落地）、W2/W7/W8。
3. `[test]` 修 C1（E2E 播种改 POST spaceKind + 动态 spaceKey），并真实跑通 E2E 全套，证据回填。
4. 修复后 `/qa-runner` 重跑 → 建议再做一轮轻量复审（--cover=test,code）确认闭环。

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：

**理由**：

**下一步动作**：
