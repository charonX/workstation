# Test Plan — 2026-08-16-deepen-session-domain

> 版本：v2（requirements-v2.hash=77f0f186）
> 生成：2026-08-17 /test-author（自动链，无升级点）；2026-08-17 review FAIL 修复轮修订（v2）
> 目录：`tests/capabilities/agent-dialogue/conversation-space/2026-08-16-deepen-session-domain/api/`
> 运行器：node:test（`npm run test:unit` 发现 `*/api/*.test.js`）

## REQ → 测试映射

| REQ | 测试文件 | seam | 类型 | 覆盖 |
|---|---|---|---|---|
| REQ-AGENT-112 config 装配搬迁 | `sessionDomainConfig.test.js` | `sessionDomain.buildSessionConfig` | 单元 | AC1 默认组合（无参/无行）+ AC1 空 providers golden（`{provider:"deepseek", model:"", apiKey:undefined, identity:""}`）；AC2 行值优先三态（有效行/NULL 列/条目已删）；AC3 apiKey 明文 fixture 注入语义（diff 审读挪 REFLECT）。AC4 集成半（server.js 确认回调改向）由既有 assistantConfirm E2E 承载 |
| REQ-AGENT-113 投影/分页搬迁 | `sessionDomainProjection.test.js` | `sessionDomain.projectMessagesFromJsonl` / `paginateMessages` | 单元 | AC1 golden 行；AC2 工具不落历史 + 空文本行剔除（user/assistant 均生效，v2 补）；AC3 图片标记；AC4 降级（缺文件/坏行/非 message 行）；AC5 limit 归一化（0/-3/2.5/NaN/"abc"/undefined → 100）；AC6 before 游标（在列/不在列/空串）。AC7 直测 seam 成立即本文件存在且全绿 |
| REQ-AGENT-114 key 解析 + gitState | `sessionDomainKeys.test.js` | `sessionDomain.uiGroupPrefixFor` / `projectIdOf` / `newUiSpaceKeyFor` / `gitStateForSpace` | 单元 | AC1 三组映射；AC2 pid 提取 + 非字符串输入；AC3 前缀+UUID/非 ui→undefined；AC4 **四态全直测**：none 路径（非项目空间/项目已删）+ **正分支直测**（DB_PATH 临时库 seed projects 行 + 真实临时 git 仓 → `{state:"branch", branch}` / detached——v2 修订：review 实证既有测试对 session-git 首帧零断言，v1「sessionEvents 承载」声明失实，signoff 已认领更正） |
| REQ-AGENT-115 SSE 注册表 per-instance | `sessionSseRegistry.test.js` | `sessionSseRegistry.createSseSubscriptionRegistry()` 实例三方法 | 单元 | AC1 实例隔离；AC2 attachPending no-op 矩阵（无挂起/无句柄保留/有句柄消费/幂等/未接线安全）；AC3 生命周期（原样转发/text_start 边界宣告与重置/15s 心跳/confirmation-pending 过滤且 sessionKey 不出帧）；AC4 detach 自清理（close/**error**/写失败三触发 + 幂等 + 挂起集自移除 + 监听摘除——v2 补 error 分支，close/error 是两个独立注册点）。AC5/AC6（三处驱动点接线、挂起→挂接全链路）由既有 sessionEvents/assistantConfirm 测试承载 |
| REQ-AGENT-116 附件规则搬迁 | `sessionDomainAttachments.test.js` | `sessionDomain.attachmentsError` | 单元 | AC1 四规则字面值（E-ATTACH-TYPE/COUNT/SIZE/PATH + 10 个/10MB 边界）；AC2 合法→undefined + 字段类型异常；AC3 短路顺序（类型先于数量）。AC4 HTTP 面由既有 **imageAttachment** 测试承载（v2 更正：E-ATTACH-* HTTP 断言实测在 imageAttachment.test.js:188-222，v1 误写 sessionMessage） |
| REQ-AGENT-117 依赖方向回正 + 瘦身 | `dependencyDirection.test.js` | 源码静态断言 + 路由动态 import | 静态 + 集成 | AC1 方向断言（新模块不 import routes/；server.js 不从路由 import 领域函数 + 正向 import sessionDomain/**sessionSseRegistry**——v2 加固：全量 matchAll 替代 exec 首匹配、specifier 不硬编码 "./"）；AC2 兼容面（文件存在 + re-export + 两 handler）；AC5 行数 **≤650**（v2 修订：review 算术复核搬走 ~300-330 行后留存 ~600，v1 ~300/≤350 不可行，人拍板重定；行数口径对齐 wc -l 末尾换行不多计）。AC3 无消息桥由既有 feishuReadonly 承载；AC4 行为不变由既有测试**全量零改动全绿**承载（v2 改全量表述） |

## 既有测试承载矩阵（零改动硬约束的验收载体）

| 既有测试 | 承载的本 story AC |
|---|---|
| sessionEvents.test.js | REQ-115 AC5/AC6（挂起→挂接全链路、SSE 帧序列不变） |
| assistantConfirm.test.cjs（E2E） | REQ-112 AC4（确认回调回投：buildSessionConfig + attachPending 接线）；REQ-115 AC5（server.js 两处驱动点直调实例） |
| imageAttachment.test.js | REQ-116 AC4（附件 400 错误封套 HTTP 面，:188-222） |
| sessionMessage.test.js | REQ-115 AC5（handlePostMessage 经 context 袋 attachPending） |
| historyToolFilter.test.js | REQ-117 AC2（re-export 契约直调） |
| feishuReadonly.test.js | REQ-117 AC3（无消息桥静态断言） |
| 既有测试全量（含 sessionSpace/sessionList/sessionReset/uiConfirmation/cardStream/richRender/sessionStop 等） | REQ-117 AC4（行为字节级不变回归面——全量表述，不再枚举清单） |

## 签核待确认点（交 /signoff 收敛）

> v1 三点已全部收敛（见 signoff.md Assertion 节）；v2 无新待确认点。

1. ~~REQ-112 AC1b 无 providers 期望值~~ → v1 signoff 已就地补 §6.3 锚点行确认。
2. ~~REQ-114 AC4 正分支不新增直测~~ → **v1 签核前提被 review 证伪**（既有测试零 session-git 断言）；v2 改直测承载，人已拍板（2026-08-17）。
3. ~~REQ-117 AC5 行数上限 350~~ → **review 算术复核证伪**（留存 ~600）；v2 重定 ≤650，人已拍板（2026-08-17）。

## 人工验收（REFLECT）

- 无 UI/审美项。diff 审读（逐字节搬运纪律 + REQ-112 AC3 装配路径无持久化写）在 REFLECT 人工确认。

## 初始状态

- v2 状态：6 文件 34 用例，33 RED（seam 未就绪：sessionDomain.js / sessionSseRegistry.js 未实现；路由 928 行 > 650）+ 1 双向不变量绿（AC2 路由文件存在 + re-export）。
- 无 `TODO: HUMAN ASSERTION` 占位（全部 expected 可从 PRD 锚点机械推导）。
