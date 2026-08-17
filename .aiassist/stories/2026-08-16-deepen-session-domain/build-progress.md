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
