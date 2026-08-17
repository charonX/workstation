# Build Progress — 2026-08-16-deepen-session-domain

> BUILD 开始：2026-08-17（门 1 v2 重签后）
> 契约：requirements v2（hash 77f0f186）+ signoff.md Assertion v2 + prd.md v0.3 §10 + ADR-030
> 硬约束：既有测试文件零改动全绿；逐字节搬运不重写；commit 纪律（[build] 不含测试文件）

## 切片计划

| Slice | REQ | 内容 | 测试载体 | 依赖 |
|---|---|---|---|---|
| 1 | REQ-AGENT-112/113/114/116 | 新建 `src/services/sessionDomain.js`：buildSessionConfig+DEFAULT_PROVIDER、key 解析三函数+PROJECT_PREFIX_RE、projectMessagesFromJsonl/partText/normalizeLimit/paginateMessages、attachmentsError+三常量、gitStateForSpace（§10.2 领域函数域，只读 I/O） | sessionDomainConfig/Projection/Keys/Attachments.test.js（直测 seam） | 无 |
| 2 | REQ-AGENT-115 | 新建 `src/services/sessionSseRegistry.js`：createSseSubscriptionRegistry() 工厂 → createSubscription/registerPending/attachPending 三方法（实例私有挂起 Map，模块级全局消亡） | sessionSseRegistry.test.js（直测 seam） | 无 |
| 3 | REQ-AGENT-117（+112 AC4/115 AC5-AC6 集成半） | 路由瘦身 ~928→~600（删已搬函数，仅 re-export projectMessagesFromJsonl）；server.js import 改向 + registry 实例持有（_opcSseRegistry 惰性工厂同型）+ context 袋 getSseRegistry；路由 handlePostMessage/handleGetEvents 经 context 袋消费 | dependencyDirection.test.js + 既有测试全量回归 | Slice 1+2 |

## 基线

- BUILD 前全量单测基线（2026-08-17，`npm run test:unit`）：958 tests / 924 pass / 34 fail
  = 本 story 33 seam-gate RED + 兄弟 story 2026-08-16-deepen-turn-event-pipeline 1 RED
  （REQ-AGENT-110 AC6 inMemory 截断单真源，其 BUILD 进行中，非本 story 范围）。
  本 story BUILD 期间停机条件：34 fail → 1 fail（仅余兄弟 story 那 1 条）。

## Slice 进度

### Slice 1（2026-08-17，REQ-AGENT-112/113/114/116）—— sessionDomain.js 领域函数域新建

新建 `src/services/sessionDomain.js`（唯一新文件，未动路由/server.js——旧副本删除在 Slice 3）。
10 个函数全部逐字节剪切（`cmp` 比对函数体 IDENTICAL ×10），注释随迁；常量
DEFAULT_PROVIDER/PROJECT_PREFIX_RE/IMAGE_MIME_TYPES/MAX_ATTACHMENTS/MAX_ATTACHMENT_BYTES
随迁（模块内私有，无测试/Slice 3 导出需求）。import 适配：`./pathUtils.js`、
`./gitBranch.js`、`./settingsService.js`、`../db.js` + node 内置。

测试：4 直测文件 RED（seam 未就绪门，0 pass）→ 建模块后 GREEN（23 pass / 0 fail；
v2 较计划 22 用例多 1 = signoff v2 新增 gitState 正分支直测）。回归：
imageAttachment.test.js 7/7 绿（REQ-116 AC4 载体，本切片只新增文件，无连带破坏）。

#### PRD → 代码可追溯性

| PRD 锚点 | 内容 | 实现位置（sessionDomain.js） | 测试 | 状态 |
|---|---|---|---|---|
| §6.1 步骤 2 | GET messages：JSONL 投影 + 分页窗口 | projectMessagesFromJsonl / partText / normalizeLimit / paginateMessages | sessionDomainProjection AC1-AC6 | COVERED |
| §6.1 步骤 3 | POST messages：config 装配 + 附件校验（挂接编排属 Slice 2/3） | buildSessionConfig / attachmentsError | sessionDomainConfig AC1/AC1b/AC2；sessionDomainAttachments AC1-AC3 | COVERED |
| §6.1 步骤 4 | SSE session-git 首帧数据源（帧推送编排属 Slice 2/3） | gitStateForSpace | sessionDomainKeys AC4（none 三态 + branch/detached 正分支直测） | COVERED |
| §6.1 步骤 6 | server.js 确认回调回投建句柄 | buildSessionConfig（装配逻辑） | 集成半由 assistantConfirm 承载，server.js 改向在 Slice 3 | PARTIAL（本切片仅建函数，接线改向属 Slice 3 计划内） |
| §6.2 附件四规则 400 | E-ATTACH-TYPE/COUNT/SIZE/PATH 字面值 | attachmentsError | sessionDomainAttachments AC1（含 10 个/10MB 双边界） | COVERED |
| §6.2 JSONL 缺失/坏行 | 文件缺失 → []；单行损坏跳过；非 message 行跳过 | projectMessagesFromJsonl | sessionDomainProjection AC4 | COVERED |
| §6.2 分页 limit 非法 | 0/负/NaN/非整数 → 默认 100 | normalizeLimit | sessionDomainProjection AC5 | COVERED |
| §6.3 块1（2 锚点行） | 无参 → 默认组合；空 providers → {deepseek,"",undefined,""}；行值优先/NULL/条目已删三态 | buildSessionConfig + DEFAULT_PROVIDER | sessionDomainConfig AC1/AC1b/AC2 ×3 | COVERED |
| §6.3 块2（7 锚点行） | golden 投影/toolResult 与空文本剔除/[图片: name]/降级/limit 归一化/before 游标三态 | projectMessagesFromJsonl/partText/normalizeLimit/paginateMessages | sessionDomainProjection AC1-AC6 | COVERED |
| §6.3 块3（5 锚点行） | uiGroupPrefixFor 三组映射/projectIdOf + 非字符串安全/newUiSpaceKeyFor 前缀+UUID/非 ui → undefined | uiGroupPrefixFor/projectIdOf/newUiSpaceKeyFor + PROJECT_PREFIX_RE | sessionDomainKeys AC1-AC3 | COVERED |
| §6.3 块5（4 锚点行） | 附件四规则 golden 字面值 + §7.1 短路顺序（类型先于数量） | attachmentsError + 三常量 | sessionDomainAttachments AC1-AC3 | COVERED |
| §6.3 块6（domain 半边） | 依赖方向：domain 不得 import routes/ | 本模块 import 面 = node 内置 + services/* + ../db.js（零 routes/） | dependencyDirection AC1 静态断言在 Slice 3 跑（含 server.js/registry 断言，本切片不跑该文件） | COVERED（domain 半边；server.js 半边属 Slice 3） |
| §10.4 domain 领域函数组契约 | 签名语义逐字节一致；只读 I/O（JSONL/DB/settings）；幂等 | 10 导出函数全量 | 4 直测文件 23 用例全绿 | COVERED |

REQ 验收映射：REQ-AGENT-112 AC1/AC1b/AC2/AC3 机验字段断言 COVERED（AC4 集成半 → Slice 3）；
REQ-AGENT-113 AC1-AC7 COVERED；REQ-AGENT-114 AC1-AC4 COVERED（含 v2 正分支直测）；
REQ-AGENT-116 AC1-AC3 COVERED + AC4 HTTP 面回归 imageAttachment 7/7 绿。

**Slice 1: complete（1490292，tests green 24/24，PRD alignment ALIGNED）**
- PRD 对齐子代理缺口 1（REQ-114 AC4 none 四成因缺 localPath 空/DB 异常 2 断言）→
  test-gap 就地补测（人拍板）：5c07a07 [test] 补测 + a74e917 [test] signoff v2 追加补签。
- Slice 1: refactor pass done（NO_CHANGES_NEEDED——逐字节搬迁 slice 无安全重构面；
  3 项观察性/鸭子类型/注释归属问题留 /review --cover=code）
- concern 备查：1490292 被 pre-commit hook 卷入兄弟 story（turn-event-pipeline）signoff.md
  的并行改动 13 行（非本 slice 产生；不重写历史，留人裁决）。

### Slice 2（2026-08-17，REQ-AGENT-115）—— sessionSseRegistry.js per-instance 注册表新建

新建 `src/services/sessionSseRegistry.js`（唯一新文件，未动路由/server.js——路由内
旧副本 pendingSseSubs/attachPendingSseSubs/peekSession/createSseSubscription 保留，
Slice 3 才删除并接线）。`createSseSubscriptionRegistry()` 工厂 → 实例三方法
`createSubscription`/`registerPending`/`attachPending`；挂起 Map 移入工厂闭包
（实例私有，模块级全局消亡——ADR-030 决策 7 显式授权的唯一有意内部变更）。
`createSubscription` = 现 `createSseSubscription` 逐字节搬迁，唯二差异（ADR-030
授权）：①函数名改 createSubscription；②detach 内引用的 `pendingSseSubs` 重绑到
闭包实例 Map。`registerPending` = handleGetEvents 无句柄 else 分支挂起登记逻辑收编
（Set 去重天然）；`attachPending` = 现 `attachPendingSseSubs` + `peekSession` 逐字节
搬迁（svc 未接线/无 getSession/句柄未创建 → null → no-op，幂等）。import 适配：
`./eventBus.js`（subscribe/unsubscribe 语义随迁）；handleGetEvents 头注释中
createSubscription 行为相关部分（事件转发/轮次边界/心跳/断开清理）随迁至模块头。

测试：sessionSseRegistry.test.js RED（seam 未就绪门，0 pass）→ 建模块后 GREEN
（7/7：AC1 实例隔离 ×1 / AC2 no-op 矩阵 ×2 / AC3 生命周期 ×3 / AC4 detach 自清理 ×1）。
回归：Slice 1 四直测文件 24/24 仍绿（本切片只新增文件，无连带破坏）。

#### PRD → 代码可追溯性

| PRD 锚点 | 内容 | 实现位置（sessionSseRegistry.js） | 测试 | 状态 |
|---|---|---|---|---|
| §6.1 步骤 3（SSE 半边） | POST messages 建句柄后挂起 SSE 订阅补挂接 | attachPending（挂起→挂接语义） | sessionSseRegistry AC2 挂起集保留/补挂接；HTTP 编排半由 Slice 3 + 既有 sessionMessage 承载 | PARTIAL（本切片仅建实例方法，handlePostMessage 消费接线属 Slice 3 计划内） |
| §6.1 步骤 4（SSE 半边） | GET events：事件转发/15s 心跳/无句柄挂起登记 | createSubscription（转发/心跳）+ registerPending（挂起登记） | sessionSseRegistry AC3 帧序列/过滤/心跳三用例；admission 编排（404/writeHead/首帧）属路由，Slice 3 消费 | PARTIAL（订阅生命周期 COVERED；HTTP admission 编排接线属 Slice 3） |
| §6.2 SSE 连接死亡 | res write 抛错 → detach 自清理，服务不崩 | createSubscription detach + writeFrame catch | sessionSseRegistry AC4（写失败/close/error 三触发 + 幂等 + 挂起集自移除 + 监听摘除） | COVERED |
| §6.2 events 先于首条消息 | 挂起登记，句柄创建后补挂接 | registerPending + attachPending | sessionSseRegistry AC1/AC2（隔离/no-op 矩阵/补挂接）；全链路集成由既有 sessionEvents 承载（Slice 3 接线后） | PARTIAL（实例语义 COVERED；HTTP 全链路属 Slice 3） |
| §6.3 块4 锚点 | 挂起→挂接，事件自下一轮回流起持续收流；无挂起时 attach 为 no-op | attachPending（peekSession 既有句柄，ADR-009 不惰性创建） | sessionSseRegistry AC1/AC2 | COVERED |
| §10.4 工厂契约 | createSseSubscriptionRegistry() → 三方法；实例私有挂起 Map（副作用）；非幂等（测试隔离来源） | 工厂 + 闭包 pendingSseSubs | sessionSseRegistry AC1（实例隔离直接证据） | COVERED |
| §10.4 createSubscription 契约 | sub {pushFrame, attach, detach}；15s 心跳；confirmation-pending 按 spaceKey 过滤且 sessionKey 不出帧；close/error/写失败 → 自 detach 不上播 | createSubscription 全量逐字节搬迁 | sessionSseRegistry AC3 ×3 / AC4 | COVERED |
| §10.4 registerPending 契约 | Set 去重；detach 自移除 | registerPending | sessionSseRegistry AC4（挂起集自移除后 attachPending 不再捞到） | COVERED |
| §10.4 attachPending 契约 | 有挂起且 getSession 返回既有句柄 → 逐个 attach 并清该 key；否则 no-op；幂等 | attachPending + peekSession | sessionSseRegistry AC2 ×2（三态矩阵 + svc undefined 安全） | COVERED |
| §6.3 块6（registry 半边） | 依赖方向：registry 不得 import routes/ | 本模块 import 面 = 仅 ./eventBus.js | dependencyDirection AC1 静态断言在 Slice 3 跑（本切片不跑该文件） | COVERED（registry 半边；静态断言执行属 Slice 3） |

REQ 验收映射：REQ-AGENT-115 AC1/AC2/AC3/AC4 COVERED（单元直测 7/7）；
AC5/AC6（三处驱动点接线 + 挂起→挂接 HTTP 全链路）→ Slice 3（既有
sessionEvents/assistantConfirm 零改动回归即证）。

**Slice 2: complete**
