# 技术方案 — PI Agent 集成整理与优化（Consolidation）

> 故事 ID：`2026-08-07-pi-agent-consolidation`
> 版本：`v1`
> 最后更新：2026-08-08
> 输入：`prd.md`（B1-B12 + M1）、`interview-notes.md`（D1-D7）、`handoff.md`、spike-m2-gotgenes（H3/H4）

---

## 设计目标

把 PI agent 会话生命周期与权限出厂策略各自收敛到单一所有者：会话侧"JSONL 是真相、内存按需"（TTL/LRU/同组单活淘汰 + 透明懒恢复 + 水合窗口化，全部长在 worker 新生命周期模块内）；权限侧"代码规则表是唯一真源、部署 JSON 是生成产物"（生成器 + 配平测试锁死漂移），顺带收日志无界与术语三义。

## 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `sessionLifecycle`（worker 内） | 会话注册表（现 worker `sessions` Map）+ 活跃时间戳 + 淘汰调度（TTL 1h / LRU 50 / 同组单活三触发，60s sweep）+ 流式/队列豁免 + dispose 编排（辅助 Map ×3 同步清理：toolContexts/sessionQueues/lastReplies）+ 淘汰 tombstone 集合（接口 3 判别依据）+ `session-evicted` 通知 | 是 |
| `worker.js` | 委托 sessionLifecycle；保留工具执行 / IPC / 流式转发 / 权限桥（行为保持） | 否（改） |
| `agentService.js` | `logs[]` 环形 1000 + ping/pong 日志降噪；`session-evicted` 处理（丢句柄）；水合窗口过滤（mtime ≤ TTL）；`evicted` 重投 | 否（改） |
| `policyRules`（规则表模块） | 出厂权限规则的声明式数据（每条带热路径可见族标记），评估器与生成器共同消费——**唯一真源** | 是 |
| `permissionPolicy.js` | 评估器改为消费规则表（行为保持）；pre-gate 不可见族逻辑不变 | 否（改） |
| `gen-agent-policy` 仓内脚本 | 规则表 + 静态模板 → golden `agent-policy/pi-permission-config.json`（仅可见族）；`--check` 模式供配平 | 是 |
| 文档面 | ADR-019（维持单进程）、ADR-020（权限单一真源化）、CONTEXT.md 术语归位（agent 三义 + 会话生命周期新术语：淘汰/懒恢复/水合窗口/同组单活/`session-evicted`/`evicted`） | 是 |

### 模块关系图

```
                        主进程 agentService.js
  sessions 句柄 Map ── session-evicted ─┐        logs[] ring(1000)
  store(agent_sessions SQLite,真相)      │        ping/pong 降噪
  水合: rows where JSONL.mtime ≤ 1h ─────┤
        │ stdio JSONL IPC                │ evicted 重投: config+prompt
        ▼                                │
  worker.js ──委托──▶ sessionLifecycle ◀─┘
    工具执行/IPC/流式     sessions Map + lastActiveAt
                        sweep(60s): TTL 1h / LRU 50 / 同组单活
                        豁免: 流式·队列中 → 延迟淘汰
                        dispose → 辅助Map×3 清理 → session-evicted
                        恢复: session-config → SessionManager.open(JSONL)

  policyRules(规则表,唯一真源)
     ├──▶ permissionPolicy 评估器(pre-gate / user_bash / 项目覆盖加载)
     └──▶ gen-agent-policy ─▶ golden JSON(仅可见族) ─启动部署─▶ gotgenes
              ▲                        ▲
              └── 配平测试: --check diff 一致（漂移即红）
```

## 数据流

1. **TTL/LRU 淘汰**：LRU 修剪在新会话到达时触发（注册时注册表超 50 取最久未活动非流式会话淘汰；REQ-AGENT-036 文本为准）；sweep 仅 TTL 淘汰 + 组冷却延迟淘汰，不做 LRU 修剪——sweep 每 60s 扫注册表 → `lastActiveAt` 超 1h 且非流式/队列中 → dispose + 清理辅助 Map ×3（toolContexts/sessionQueues/lastReplies）+ 记入 tombstone 集合 → 发 `session-evicted` → 主进程丢句柄（store 行保留）。`keySecrets` **不随单会话淘汰清理**——它按 `keyRef`（`key:${provider}:${generation}`）键控、多会话共享（条目有界：provider×generation），误删会破坏存活会话的 `redact()` 脱敏与懒恢复重注入；主进程侧同样保留（接口 2），两侧一致。`confirmAcks`/`permissionDecisions`（confirmId 键控）不强制同步清理，随既有超时兜底（30s/10min）自然释放。
2. **同组单活冷却**：`session-config`/`prompt` 到达 key K → 纯函数 `groupOf(K)`（`feishu:<chatId>`→自身；`ui:copilot:*`→**copilot 组（所有通用会话全组单热）**；`ui:project:<pid>:*`→pid 组）→ 组内其他 key 立即进入淘汰（流式中标记延迟，流结束执行）→ 同数据流 1 通知链。跨组不互汰。
3. **透明懒恢复**：被淘汰/历史会话的下次交互 → 主进程 getOrCreate（store 行）→ 重发 `session-config`（同 sessionRef，世代不变）→ worker `createSessionEntry` 命中既有 JSONL → `SessionManager.open` 恢复（REQ-AGENT-005 标准 3 已证链路，零新造）。
4. **启动/崩溃重启水合（窗口规则化）**：`store.list()` → 过滤 JSONL mtime ≤ 1h → 仅水合活跃窗口行；历史行不水合，按数据流 3 懒恢复。启动与崩溃重启同一条规则。
5. **权限规则变更**：改 `policyRules` 一处 → 跑 `gen-agent-policy` → golden 检入（PR diff 可见完整部署形态）→ 配平测试 `--check` 绿 → 启动照旧幂等部署到 gotgenes 全局发现路径。忘跑生成器 → 配平红，不进部署。
6. **高危命令一令一卡（T-9 链）**：bash 命令 → pre-gate（评估器消费规则表）→ 仅当危险仅由不可见族运算符承载时预拦截 ask（唯一来源）→ 授权桥挂起 → 批准 → 执行；其余 → gotgenes gate 单评估。语料矩阵钉"同一命令恰一卡"。命中组合归属判别表（语料矩阵规格输入）：

   | 命中组合 | 归属 | 机制 |
   |---|---|---|
   | 仅不可见族（如 `echo hi > out.txt`） | pre-gate ask | 剥除运算符后评估 = allow → 危险仅由不可见运算符承载 |
   | 仅可见族（如 `rm -rf x`） | gotgenes 单评估 | pre-gate 放行 |
   | 双命中（如 `rm -rf * > /dev/null`、`echo hi > ../out.txt`） | gotgenes 优先，pre-gate 跳过 | 剥除运算符后仍 ask（可见危险存在）→ 交 gotgenes，不产生第二张卡 |
   | wrapper 载荷（`bash -c`/`eval`） | gotgenes floor 承接（#481） | pre-gate 跳过，防双 ask |

## 接口契约

### 接口 1：sessionLifecycle 模块（worker 内部）

| 项目 | 说明 |
|---|---|
| 调用方 | worker.js（session-config / prompt / reset / 事件订阅回调） |
| 被调用方 | sessionLifecycle |
| 输入 | `register(key, entry)`、`touch(key)`（活动刷新：prompt 开始/流式事件/工具事件）、`evictGroupPeers(key)`（同组单活）、`sweep(now)`（时钟注入）、`remove(key)`（/reset/重建） |
| 输出 | `get(key)` / `has(key)` / `size()`；淘汰副作用经注入回调 `onEvict(key, entry)`（worker 执行 dispose + 清理 + 通知） |
| 业务错误 | 未知 key 的 touch/evictGroupPeers → 静默 no-op（消息乱序容忍） |
| 系统错误 | dispose 失败 → 记日志继续（沿用现有 disposeSession 容错） |
| 副作用 | 淘汰时清理辅助 Map ×3（toolContexts/sessionQueues/lastReplies）+ 记入 tombstone；发 `session-evicted`。`keySecrets` 不动（keyRef 级共享缓存） |
| 幂等性 | 是（重复淘汰同 key no-op） |

### 接口 2：IPC `session-evicted`（worker → 主进程）

| 项目 | 说明 |
|---|---|
| 负载 | `{ type:"session-evicted", sessionKey }`（形态仿 `session-rebuilt`） |
| 主进程处理 | 丢 `sessions` 句柄；store 行不动；keySecrets 保留（懒恢复重注入需要） |
| 幂等性 | 是（重复通知 → 句柄已不在，no-op） |

### 接口 3：prompt 竞态兜底 `session-error {code:"evicted"}`（tombstone 判别）

| 项目 | 说明 |
|---|---|
| 场景 | prompt 在 IPC 传输途中恰逢淘汰（理论窗口：消息未处理 → lastActive 未刷新）；worker 收到未知 sessionKey 的 prompt |
| 判别谓词 | **tombstone 集合**（生命周期模块本次运行亲手淘汰的 key；会话重建/重新 register 时移除）：仅 tombstoned key → 回 `session-error {code:"evicted"}`；其余未知 key → 保持既有 `E-AGENT-NO-SESSION` 不变 |
| 判别理由 | `evicted`（刚被淘汰、JSONL 在盘、可懒恢复）与"从未存在/孤儿会话//reset 旧世代"语义不同——孤儿会话 JSONL 也在盘上，按文件存在性判别会误复活（违反 ADR-016 孤儿禁止新消息、/reset 换代语义）；tombstone 只含"本运行内活着且被正常淘汰"的 key，是唯一不扩大语义的谓词 |
| 主进程处理 | 收到 `evicted` → 重发 `session-config` + **重投该 prompt 一次**（上限一次） |
| 与 REQ-AGENT-005 标准 4 的调和 | 标准 4「restarting 不缓存自动重投」针对 worker 崩溃——prompt 可能已部分执行，重投有副作用风险；`evicted` 是干净淘汰，prompt **从未入队**（worker 没见过它），零副作用，重投安全。两者语义不同，不改 REQ 文本（本契约随本 story 签核补全） |
| 幂等性 | 是（worker 侧无部分执行；重投上限一次防环） |

### 接口 4：生成器 CLI

| 项目 | 说明 |
|---|---|
| 形态 | `node scripts/gen-agent-policy.mjs [--check]`；配平测试与开发者共用同一入口 |
| 默认模式 | 从 `policyRules` 生成并覆写 `agent-policy/pi-permission-config.json` |
| `--check` | 不写文件，diff 生成结果与检入文件：一致 exit 0，漂移 exit 1 + diff 摘要 |
| 输入 | `policyRules` 规则表 + 静态模板字段（debugLog/authorizerChain/长度上限等非规则字段） |
| 输出 | golden JSON（仅热路径可见族；不可见族不出现） |

### 接口 5：规则表（policyRules）

| 项目 | 说明 |
|---|---|
| 形态 | 声明式数据模块（非逻辑）：工具默认裁决 + bash glob 模式清单 + CLI 高危分类引用 |
| 每条记录 | `{ pattern, decision: "allow"|"ask", hotPathVisible: boolean, family }`（`hotPathVisible:false` = 重定向/管道不可见族，仅评估器/pre-gate 消费） |
| 非声明化部分 | cwd 外路径启发式、strip 算法、wrapper floor（#481）留代码——本就不在 JSON 表达面 |
| 项目级覆盖 | `<projectDir>/.pi/...` 机制不动（含信任门 fail-closed 语义，对齐 gotgenes H3） |

## 测试 seams

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| B1 TTL 淘汰 + 懒恢复 | sessionLifecycle（时钟/回调注入）+ worker 消息级 | 单元 / 集成 | mock 时钟、stub AgentSession |
| B2 LRU 50 + 流式豁免 | sessionLifecycle（Map 状态断言） | 单元 | stub entry |
| B3 同组单活（含跨组并发、流式延迟） | sessionLifecycle `groupOf` + 冷却链 | 单元 / 集成 | stub |
| B4 行为保持抽取 | 全仓回归（618+148 水位不退） | 回归 | 真实 |
| B5 logs 环形 + 降噪 | agentService log 接口（行注入/长度/ping 过滤断言） | 单元 | 真实 |
| B6 单一真源 + 配平 | `gen-agent-policy --check`（CLI seam） | 单元 / 集成 | 真实文件 diff |
| B7 一令一卡 + 不可见族单家 + 信任门 | 评估器语料矩阵（双确认家族：重定向×cwd 外路径、2>/>>/管道组合、wrapper 叠加、untrusted 项目） | 单元 | 真实评估器 |
| B8 T-7 UI confirm 全链 | Playwright（worker confirm 级 → IPC confirm-request → submit） | E2E | 真实（Electron） |
| B9 T-9 pre-gate→桥→批准→执行全链 | Playwright | E2E | 真实（Electron） |
| B10/B11 ADR + 术语 | 文档评审 | manual（REFLECT） | — |
| B12 水合窗口 | agentService 水合 seam（构造 mtime 新/旧的 store 行，断言仅窗口内水合）+ 崩溃重启集成 | 单元 / 集成 | stub store/文件 |
| M1 冷恢复延迟 | QA 实测（恢复正确性 + 首条延迟分布） | 集成 / QA 观测 | 真实 |

capability/entity 落位：`agent-dialogue/conversation-space`（生命周期/策略/水合）、`agent-dialogue/confirmation`（T-7/T-9），沿用既有测试组织。

## 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 淘汰驱动归属 | A worker 自扫 ✅ / B 主进程驱动 | 状态·事件源·动作同进程（ADR-015"存活判定贴事件源"同理）；主进程仅加通知处理 | worker 多一个 60s 定时器（trivial） |
| B3 信号链 | 同组单活规则 ✅ / retireSpaceKey 显式信号 / 主进程按组推断 | 用户收敛：语义统一（切换/新建同规则）、零新 IPC/renderer 改动、分组是 key 文档化语法纯函数 | 快速翻动恢复抖动（罕见，正确性无损，接受） |
| 生成器时机 | A 手动脚本+golden+配平 ✅ / B 启动时生成 | golden 检入 = 完整部署形态 PR 可审（安全边界）；启动零新失败模式 | 忘跑生成器 → 配平红兜底 |
| 水合范围 | mtime ≤ TTL 窗口 ✅ / 全行水合保守 | 对齐 REQ-AGENT-005 标准 3"各活跃空间"原意；消除重启内存尖峰击穿 B1 上界；预期现有恢复测试不动（用例均活跃 <1h） | 若有隐藏测试钉死全行水合 → 红则 req-gap 裁决 |
| 恢复链路 | 复用看门狗水合（SessionManager.open） | 已签核已实证，零新造 | M1 延迟水位未证（QA 实测） |
| ADR 计划 | ADR-019 维持单进程（含重估触发条件）；**ADR-020 独立成文**：权限出厂策略单一真源化，文中注明覆盖关系（修订 ADR-017「文件=契约」表述为「代码规则表=真源，部署 JSON=生成产物」）（2026-08-08 人裁决：独立 ADR，非 ADR-017 补充节） | 三条件均满足（难逆转/不说明会困惑/真实取舍） | — |

## 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| M1 冷恢复延迟秒级 | TTL 1h 从"无感"变"可感知顿挫" | PRD（调 B1 TTL 参数，不动 story） | 能（QA 实测） |
| mtime ≈ 活跃集（活跃必写 JSONL） | 活跃会话被漏恢复（崩溃重启后） | TECH-DESIGN（水合规则换触发源） | 能（spike：静默会话 JSONL 写入时机） |
| 无水合测试钉死"全行恢复" | 隐藏测试红 | req-gap 裁决（/bug 流程） | 能（BUILD 首轮全量回归即知） |
| 语料矩阵覆盖双确认家族全部变种 | ④回归无牙，变种漏网 | TECH-DESIGN（语料补充，不动结构） | 能（语料先行 spike） |
| gotgenes 上游 schema 稳定 | 生成器输出与新版 schema 不符 | TECH-DESIGN（生成器跟进） | 能（/sync-refs 时检查） |
| 同组单活无误伤场景（同组确无双热需求） | 用户同组并行工作流被冷却 | PRD（B3 语义收窄/放宽） | 不能（需真实使用反馈，REFLECT 观察项） |

## 范围外与约束

- PRD §12 全六条（分进程建造 / agentService 拆分 / worker 其余部分拆分 / Claude SDK 路径 / 换权限引擎 / REQ-AGENT-005 语义变更 / 参数用户配置化）。
- 硬约束：REQ-AGENT-005（本方案对齐其"各活跃空间"原意，不变更文本）、ADR-014/015/017、业务测试只读、commit 标签纪律、ABI 互斥备忘（`rebuild:node` / `rebuild:electron`）。
- 安全：权限规则 PR diff 可审（golden 检入）；`keySecrets` 为 keyRef 级共享缓存（条目有界：provider×generation），不随单会话淘汰清理——`redact()` 日志脱敏遍历其值，完整性受保护；日志不带 secret（沿用）。
- 可观测性：沿用现有 `log()` 惯例——淘汰/恢复/水合过滤/E5 让位各打诊断行；不新造结构。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-08 | 初稿（四轮单题对抗收敛：淘汰归属/同组单活/生成器时机/水合窗口） | AI + 人 |
| v0.2 | 2026-08-08 | review-tech 修复：阻塞1 keySecrets 不随会话淘汰（keyRef 级共享，清理回归辅助 Map×3）；阻塞2 接口3 改 tombstone 判别（孤儿//reset 不误复活）+ REQ-AGENT-005 标准4 调和句；警告3/4/5 并入（命中组合归属判别表、术语归位扩围、copilot 全组单热显式声明） | AI + 人 |
| v0.3 | 2026-08-08 | review 警告1/2 人裁决落地：copilot 通用空间同规则单热、无特殊逻辑；ADR-020 独立成文（注明对 ADR-017「文件=契约」的修订关系） | AI + 人 |
