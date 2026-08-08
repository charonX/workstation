# Requirements — PI Agent 集成整理与优化（Consolidation）

> 故事 ID：`2026-08-07-pi-agent-consolidation`
> 版本：v1
> 最后更新：2026-08-08
> 来源：`prd.md` v0.3（B1-B12）+ `tech-design.md` v0.3（接口契约 1-5、判别表）
> 移动块 M1（冷恢复延迟阈值）留在 PRD，QA 阶段实测消化为观测断言，不在本文件。
> UX 检查结论：本 story 无新 UX 原型；B8/B9 验证既有内联确认卡的行为链（结构/行为可自动化 → Playwright E2E），无 `人工(仅视觉)` 项。

---

## REQ-AGENT-035 会话 idle 淘汰与透明懒恢复（B1）

- 优先级 P0 / 必须 / cross-module / sessionLifecycle, worker, agentService / agent-dialogue / conversation-space / 单元+集成
- 接口契约：tech-design 接口 1（sessionLifecycle）、接口 2（session-evicted）、接口 3（evicted tombstone 判别）

验收标准：
1. 会话任意活动（prompt 开始 / 流式事件 / 工具事件）刷新 `lastActiveAt`；sweep（时钟注入 60s 周期语义）对 `lastActiveAt` 超 1h 且非流式/队列中的会话执行淘汰：`dispose` + 清理辅助 Map ×3（toolContexts/sessionQueues/lastReplies）+ 记入 tombstone 集合 + 发 `session-evicted`。
2. `keySecrets` 不随单会话淘汰清理（keyRef 级共享缓存；淘汰后 `redact()` 遍历的 key 集合不变）。
3. 流式中/队列中会话豁免淘汰；流结束后重新进入可淘汰集合（活跃时间以流事件刷新为准）。
4. 主进程收 `session-evicted` → 丢 `sessions` 句柄、store 行保留、主进程 `keySecrets` 保留；重复通知 no-op（幂等）。
5. 被淘汰会话下次交互：主进程经 getOrCreate 重发 `session-config`（同 sessionRef，世代不变）→ worker `SessionManager.open` 恢复上下文续聊（恢复内容与非淘汰路径一致）。
6. 竞态兜底：worker 对 tombstoned key 的 prompt 回 `session-error {code:"evicted"}`，主进程重发 config + 重投该 prompt 一次成功；对非 tombstoned 未知 key 回既有 `E-AGENT-NO-SESSION` 且主进程不重投（孤儿会话、/reset 旧世代不复活）。
7. `confirmAcks`/`permissionDecisions` 不随淘汰强制清理（随 30s/10min 既有超时兜底自然释放）。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/sessionIdleEviction.test.js`（时钟/回调注入 + Map 状态断言 + fake worker IPC）

## REQ-AGENT-036 sessions LRU 上限 50（B2）

- 优先级 P1 / 必须 / intra-module / sessionLifecycle / agent-dialogue / conversation-space / 单元

验收标准：
1. 注册表满 50 且新会话到达时，淘汰最久 `lastActiveAt` 未活动的非流式会话（淘汰副作用同 REQ-AGENT-035 标准 1）。
2. 候选全部处于流式/队列豁免时，新会话照常创建（上限让位）并打 E5 诊断日志；豁免会话流结束后回归淘汰集合。
3. 稳态下注册表尺寸恒 ≤50（让位情形除外）；同组冷却（REQ-AGENT-037）不改变其他会话的 `lastActiveAt` 排序依据。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/sessionLruCap.test.js`（stub entry + 时钟注入）

## REQ-AGENT-037 同组单活（B3）

- 优先级 P0 / 必须 / cross-module / sessionLifecycle, worker / agent-dialogue / conversation-space / 单元+集成
- 接口契约：`groupOf(spaceKey)` 纯函数（spaceKey 文档化语法，ADR-016）

验收标准：
1. `groupOf` 语料断言：`feishu:<chatId>` → 组=自身；`ui:copilot:<sid>` → 组=copilot；`ui:project:<pid>:<sid>` → 组=pid；畸形 key → 组=自身（无-op，不抛错）。
2. key K 有活动到达（session-config/prompt）→ 组内其他非流式 key 按 REQ-AGENT-035 标准 1 淘汰；**通用空间（copilot 组）与项目组同一规则，无特殊逻辑**（2026-08-08 人裁决）。
3. 组内其他 key 流式中 → 标记延迟淘汰，流结束立即执行（不等 TTL）。
4. 跨组不互汰：项目 A 会话活动不影响项目 B / copilot / 飞书会话的热度。
5. 被淘汰会话切回发消息 → 透明懒恢复（REQ-AGENT-035 标准 5），同时反向冷却组内另一会话。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/sessionGroupCooling.test.js`

## REQ-AGENT-038 水合窗口规则化（B12）

- 优先级 P0 / 必须 / cross-module / agentService, sessionStore / agent-dialogue / conversation-space / 单元+集成
- 接口契约：`store.list()` → 按 JSONL mtime ≤ TTL(1h) 窗口过滤后水合（对齐 REQ-AGENT-005 标准 3「各活跃空间」原意，REQ 文本不变）

验收标准：
1. 启动水合仅覆盖 JSONL mtime ≤ 1h 的 store 行；mtime > 1h 的行不下发 session-config（stub store + 构造文件 mtime 断言）。
2. 崩溃重启水合与启动同一条规则（集成：构造新/旧行，kill 子进程重启后断言仅窗口内行收到 session-config）。
3. 未水合的历史行首次交互走透明懒恢复（REQ-AGENT-035 标准 5）。
4. 既有恢复回归（`sessionRestore.test.js`、`agentProcess.test.js`）不修改且全绿（其用例活跃 <1h，按新规则照常恢复）。
5. 水合过滤打诊断日志（候选行数 / 窗口内行数）。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/hydrationWindow.test.js`

## REQ-AGENT-039 会话生命周期模块抽取（B4）

- 优先级 P0 / 必须 / intra-module / worker, sessionLifecycle / agent-dialogue / conversation-space / 单元+回归

验收标准：
1. `sessionLifecycle` 模块提供 tech-design 接口 1 全部方法（`register/touch/evictGroupPeers/sweep/remove/get/has/size` + `onEvict` 回调注入）；worker 经该模块存取会话，不再直接操作 sessions Map。
2. 时钟与 `onEvict` 回调可注入（测试 seam）；模块无自身副作用（dispose/通知经回调由 worker 执行）。
3. 行为保持：除 REQ-AGENT-035/036/037/038 新语义外，worker 可观察行为不变——全仓既有 618 单测 + 148 E2E 不修改且全绿。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/sessionLifecycleModule.test.js` + 全仓回归

## REQ-AGENT-040 主进程日志有界与心跳降噪（B5）

- 优先级 P1 / 必须 / intra-module / agentService / agent-dialogue / conversation-space / 单元

验收标准：
1. `logs[]` 恒 ≤1000 条，超限覆盖最旧（注入 1000+N 行断言：长度 1000、保留最新尾部）。
2. ping/pong 心跳收发不逐条入 `logs[]`（`logSend`/接收侧对心跳类型过滤）；业务消息与 stderr 照常记录。
3. 看门狗心跳语义不变：2s ping/pong 收发、存活判定（ADR-015 任何入站计存活）行为不变——既有心跳测试不修改且全绿。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/agentLogsRing.test.js`

## REQ-AGENT-041 权限出厂策略单一真源与生成配平（B6）

- 优先级 P0 / 必须 / cross-module / policyRules, permissionPolicy, gen-agent-policy 脚本 / agent-dialogue / conversation-space / 单元+集成
- 接口契约：tech-design 接口 4（生成器 CLI）、接口 5（规则表）

验收标准：
1. `policyRules` 规则表为出厂规则唯一声明源（每条 `{ pattern, decision, hotPathVisible, family }`）；评估器与生成器共同消费——评估器不再硬编码 bash 模式清单。
2. `node scripts/gen-agent-policy.mjs` 默认模式覆写 `agent-policy/pi-permission-config.json`：内容 = 规则表 `hotPathVisible:true` 族 + 静态模板字段；`hotPathVisible:false`（重定向/管道不可见族）不出现在产物。
3. `--check` 模式：生成结果与检入文件一致 exit 0；漂移 exit 1 并输出 diff 摘要（构造漂移用例断言两者）。
4. 评估行为保持：规则表化后评估器对既有语料裁决不变——`permissionPolicy` 既有测试不修改且全绿。
5. 项目级覆盖机制不变：`<projectDir>/.pi/...` 加载、优先级（项目 > 全局 > 附录 A）、fail-closed 信任门语义保持。
6. `adr/ADR-020-*.md` 存在：记录代码规则表为真源的决策，并注明对 ADR-017「文件=契约」表述的修订关系；`adr/README.md` 索引含 ADR-020 条目（文档断言）。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/policyCodegen.test.js`（CLI seam 真实文件 diff）

## REQ-AGENT-042 一令一卡语料矩阵（B7）

- 优先级 P0 / 必须 / intra-module / permissionPolicy / agent-dialogue / conversation-space / 单元
- 接口契约：tech-design 数据流 6 命中组合归属判别表

验收标准：
1. 判别表语料断言：仅不可见族（`echo hi > out.txt`）→ pre-gate `ask`；仅可见族（`rm -rf x`）→ pre-gate 放行；双命中（`rm -rf * > /dev/null`、`echo hi > ../out.txt`）→ pre-gate 放行（gotgenes 优先单卡）；wrapper 载荷（`bash -c`/`eval`）→ pre-gate 跳过。
2. 变种覆盖：`2>`、`>>`、管道 `|sh`/`|bash` 组合、URL 含 `//` 防误判、wrapper 叠加重定向。
3. 信任门（2026-08-08 req-gap 就地补全，人裁决）：当前架构**无 untrusted 通道**——`createPolicyEvaluator` 无 `projectTrusted` 参数、worker permissionProfile 仅 project/default、项目空间全 trusted（H3 的 projectTrusted 为 gotgenes 内部选项，从未设置 false）。标准改为：**若未来引入 untrusted 项目通道，评估器须对齐 gotgenes H3 fail-closed 语义**（untrusted 时项目文件范围被剔除）；当前 trusted 面行为与 gotgenes 一致由既有 permissionPolicy.test.js 覆盖。此裁决记入 tech-design 风险表。
4. 每条 ask 语料断言"同一命令恰一个 ask 来源"（0 双卡）。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/permissionCorpus.test.js`

## REQ-AGENT-043 T-7 UI confirm 生产全链（B8）

- 优先级 P1 / 必须 / cross-module / renderer, agentService, worker / agent-dialogue / confirmation / E2E（Playwright）

验收标准：
1. UI 空间发起 worker confirm 级工具调用 → IPC `confirm-request` → UI 内联确认卡渲染 → 批准 submit → 工具执行 → 结果回投对话窗（真实 Electron 生产链，非直桥 seam）。
2. 拒绝路径：拒绝 → 工具不执行 → 对话窗可见拒绝回执。
3. 全链恰好一张确认卡（REQ-AGENT-042 契约在 E2E 层的对应断言）。

- seam/测试：`tests/capabilities/agent-dialogue/confirmation/2026-08-07-pi-agent-consolidation/e2e/confirmChainUi.test.cjs`

## REQ-AGENT-044 T-9 bash pre-gate→授权桥生产全链（B9）

- 优先级 P1 / 必须 / cross-module / renderer, agentService, worker, permissionPolicy / agent-dialogue / confirmation / E2E（Playwright）

验收标准：
1. bash 命中不可见族命令（如 `echo e2e > <tmp>/out.txt`）→ pre-gate 预拦截 → 授权桥挂起 → UI 确认卡批准 → 命令真实执行（副作用可见：目标文件产生且内容正确）。
2. 批准前命令不执行（无副作用）；批准后恰执行一次（唯一执行者，ADR-017）。
3. 双命中语料（`echo hi > ../out.txt` 相对重定向出 cwd）E2E 恰一卡。

- seam/测试：`tests/capabilities/agent-dialogue/confirmation/2026-08-07-pi-agent-consolidation/e2e/confirmChainBash.test.cjs`

## REQ-AGENT-045 ADR-019 维持单进程决策记录（B10）

- 优先级 P1 / 应该 / intra-module / docs / agent-dialogue / conversation-space / 单元（文档断言）+ REFLECT 人工评审

验收标准：
1. `adr/ADR-019-*.md` 存在且含：维持单进程决策、①落地后全量重启恢复可接受的理由、**重估触发条件**（真实崩溃发生 / 空间间隔离需求出现）、与 REQ-AGENT-005 / ADR-014 / ADR-015 的不变关系声明。
2. `adr/README.md` 索引含 ADR-019 条目。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/docAssets.test.js`（文档结构断言）

## REQ-AGENT-046 术语归位（B11）

- 优先级 P1 / 应该 / intra-module / docs / agent-dialogue / conversation-space / 单元（文档断言）+ REFLECT 人工评审

验收标准：
1. `CONTEXT.md` 含 agent 三义条目：PI 对话 agent（交互会话）/ flow 的 agent 节点（SDK 一次性执行）/ Agent Registry 外部 agent CLI（skill 安装兼容层）。
2. `CONTEXT.md` 含本会话生命周期新术语：淘汰 / 懒恢复 / 水合窗口 / 同组单活 / `session-evicted` / `evicted`。
3. 文档术语与代码/IPC 实际命名一致（断言关键字面量，防文档-代码漂移）。

- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/docAssets.test.js`（与 REQ-AGENT-045 同 seam）

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-08-08 | 初版结晶：B1-B12 → REQ-AGENT-035~046（M1 留 PRD，QA 消化） | AI + 人 |
