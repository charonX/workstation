# 签核记录 — 2026-08-16-deepen-session-domain

## Assertion（门 1，2026-08-17）

### 检查清单

- [x] PRD §14 无 GAP 悬空（全 PASS；§5 移动块两块已在 tech-design 解决；签核期就地补
      §2 过期表述 + §6.3 空 providers 锚点行，见升级点结果）
- [x] 每个 REQ-ID 都有对应测试（REQ-AGENT-112~117 → 6 个测试文件全覆盖）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`（v1-hash:370f51eb）、
      `CAPABILITY-TRACE`、`ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、
      `ASSERTIONS-SIGNED`（6 文件头部机械核验）
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致
      （agent-dialogue/conversation-space，conversation-space (session-domain) 行已登记）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（grep 0 命中）
- [x] 预期值来源清晰：每条 expected 值 trace 到 prd.md §6.3/§7.1/§10.4 锚点
      （锚点全部取自现行代码快照——本 story 为字节级行为保持，非代码输出反抄）
- [x] 无快照当判定依据（全部字面值断言）
- [x] 边界/错误 case 已覆盖（limit 0/-3/2.5/NaN/非数字归一化、before 游标三态、
      行 NULL 列/条目已删/无 providers 三回落、非字符串输入安全、附件 10/11 与
      10MB/10MB+1 双边界、短路顺序、实例隔离、attachPending 幂等矩阵、
      detach 三触发+幂等、挂起集自移除）

### expected 值交叉验证（EXPECTED-TRACE ↔ prd.md 锚点）

| 断言组 | 锚点来源 | 值一致 |
|---|---|---|
| 默认组合 {provider:"moonshotai", model:"kimi-k3", apiKey:"sk-moonshot", identity:""}；行值优先/NULL/条目已删三态 | §6.3 块1 + REQ-112 AC1/AC2（resolveSessionModelConfig 现行语义实证） | ✅ |
| 空 providers 回落 {provider:"deepseek", model:"", apiKey:undefined, identity:""} | §6.3 块1 新增锚点行（签核就地补，值实证自 resolveSessionModelConfig 空短路 + entryApiKey(undefined)→undefined） | ✅ |
| golden 行投影 {messageId:"m1", role:"user", createdAt:"2026-08-01T10:00:00Z", text:"你好"}；toolResult/空文本剔除；[图片: tiny.png]/[图片]；缺文件→[]/坏行跳过 | §6.3 块2 row 1-4 | ✅ |
| limit 0/-3/2.5/NaN/"abc"/undefined → 100；before 在列/不在列/空串三态；升序保持 | §6.3 块2 row 5-7（signoff 裁决 5 语义） | ✅ |
| uiGroupPrefixFor 三组映射；projectIdOf + 非字符串安全；newUiSpaceKeyFor 前缀+UUID/非 ui→undefined | §6.3 块3 row 1-5（ADR-016 语法） | ✅ |
| gitStateForSpace none 路径（非项目空间/项目已删） | §6.3 块6 + REQ-AGENT-058 既有契约（正分支由 sessionEvents 承载） | ✅ |
| 注册表实例隔离/attachPending 幂等矩阵/帧序列 golden（text_start 边界宣告与重置、confirmation-pending 过滤且 sessionKey 不出帧、15s ": keep-alive"）/detach 自清理 | §10.4 注册表三方法契约 + §6.3 块4（REQ-AGENT-028 标准 5 语义） | ✅ |
| E-ATTACH-TYPE/COUNT/SIZE/PATH 四规则字面值；10 个/10MB 边界合法；短路顺序类型先于数量 | §6.3 块5 row 1-4 + §7.1 + REQ-116 AC1 | ✅ |
| 方向断言（新模块不 import routes/；server.js 不反向 import 领域函数 + 正向 import sessionDomain）；re-export 1 名兼容面；行数 ≤350 | §10.2 模块关系图 + REQ-117 AC1/AC2/AC5（~300 目标 + 注释余量推导） | ✅ |

### 升级点结果

| 升级点 | 内容 | 处置 |
|---|---|---|
| test-plan 待确认 1：REQ-112 AC1b 空 providers 边界值 | expected {provider:"deepseek", model:"", apiKey:undefined} 在 prd.md 无字面值锚点 | 就地补：实证现行代码（resolveSessionModelConfig 空 providers 短路 → provider:"" → DEFAULT_PROVIDER="deepseek" 回落；entryApiKey(undefined)→undefined），§6.3 块1 新增锚点行。字节级保持 story 的 expected = 现行行为，可机械推导，无需人拍值 |
| test-plan 待确认 2：REQ-114 AC4 正分支不新增直测 | gitState branch/detached 正路径由既有 sessionEvents 集成断言承载 | tech-design 已人授权「以 seam 最简为准」（REQ-114 AC4 原文），非升级点，记录备查 |
| test-plan 待确认 3：REQ-117 AC5 行数上限 350 | prd.md 仅有 ~300 目标，350 为余量推导值 | 锚定 REQ-117 AC5 原文（「评审目标 ~300，上限含注释余量」——结晶产物即契约，技术方案四问已经人逐题拍板）。比目标宽松的方向，AI 自决并在此显式登记 |
| PRD §2 过期表述 | 「保留 4 个旧导出名的 re-export」与 tech-design 事实核查（实际仅 1 名）矛盾 | 就地补 §2 为「仅 re-export projectMessagesFromJsonl」（§4 块6/§6.3/§11.1 此前已同步，§2 漏改） |
| 初衷漂移 | intention（领域逻辑住路由层/依赖方向倒置/seam 泄漏）↔ PRD §1 ↔ REQ-112~117 集合一致 | 无漂移 |
| 跨模块契约歧义 | §10.4 注册表三方法 + domain 纯函数组 + context 袋扩展均可从锚点确认（tech-design 四问逐题人拍板） | 无 |
| 安全边界 | 无新信任边界；apiKey 明文不落盘语义不动（REQ-112 AC3 显式断言装配路径无持久化写）；测试用 tmpdir + env 隔离 | 无 |

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-AGENT-112 | api/sessionDomainConfig.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-113 | api/sessionDomainProjection.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-114 | api/sessionDomainKeys.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-115 | api/sessionSseRegistry.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-116 | api/sessionDomainAttachments.test.js | agent-dialogue/conversation-space |
| REQ-AGENT-117 | api/dependencyDirection.test.js | agent-dialogue/conversation-space |

既有测试承载（零改动硬约束验收面）：sessionEvents（REQ-114 AC4 正分支 /
REQ-115 AC5/AC6）、assistantConfirm E2E（REQ-112 AC4）、sessionMessage +
imageAttachment（REQ-116 AC4 / REQ-115 AC5）、historyToolFilter（REQ-117 AC2
直调）、feishuReadonly（REQ-117 AC3）、sessionSpace/sessionList/sessionReset/
uiConfirmation/cardStream/richRender（REQ-117 AC4 回归面）。

### 签核状态

签核时 33 断言 32 RED（seam 未就绪门：sessionDomain.js/sessionSseRegistry.js
未实现；路由 928 行 > 350）；唯一现状即绿的是 dependencyDirection AC2
「路由兼容面」——该断言是双向不变量（搬迁前后都必须成立），非误绿。
signer = **AI**（无升级点遗留——三待确认项两项可机械推导已就地补锚点、
一项既有授权）。人工验收留在 REFLECT：diff 审读（逐字节搬运纪律），无纯审美项。

---

## Assertion v2（门 1 重签，2026-08-17，review FAIL 修复轮后）

### 前提更正（签核责任认领）

v1 签核两处失实由 /review 实证并被本签核认领更正：

1. **「REQ-114 AC4 正分支由既有 sessionEvents 的 session-git 首帧断言承载」失实**：
   全仓 grep `session-git` 在既有测试零命中（review.md 复核证据节）——sessionEvents
   全部用例只过滤断言 text_* 帧。v1 升级点结果第 2 行「tech-design 已授权 seam 最简」
   的结论基于此失实前提，该授权无效。v2 处置：正分支改由 sessionDomainKeys.test.js
   直测承载（DB_PATH 临时库 seed projects 行 + 真实临时 git 仓，断言
   `{state:"branch", branch}` / `{state:"detached"}`），**人拍板 2026-08-17**。
2. **「REQ-117 AC5 行数 ≤350」算术不可行**：review 复核——现文件 928 行，按 §10.2
   清单搬走 ~300-330 行后留存 ~600，≤350 距目标差 200+ 行，BUILD 必红。v2 处置：
   三处同源重定 ≤650（prd.md §10.2 + REQ-117 AC5 + dependencyDirection.test.js
   AC5），**人拍板 2026-08-17**。

### v2 变更集（requirements v1 → v2，hash 370f51eb → 77f0f186）

| 变更 | 内容 | 溯源 |
|---|---|---|
| REQ-112 AC1 措辞修正 | 「provider 非空回落」→「provider 为空 → 回落 DEFAULT_PROVIDER」+ 空 providers golden 四字段落 AC | req-review IMPORTANT |
| REQ-112 AC3 | 代码审查（无持久化写）挪 REFLECT 人工确认，AC 只留可机验字段断言 | req-review SUGGESTION |
| REQ-113 | 契约补 normalizeLimit 导出；AC2 补空文本行剔除（user/assistant 均生效） | req-review SUGGESTION ×2 |
| REQ-114 | 契约删幻影字段 `worktree?`（readGitBranch 从不返回）；AC4 正分支改直测 | req-review IMPORTANT + test C1（人拍板） |
| REQ-116 AC4 | 回归载体更正 sessionMessage → imageAttachment.test.js:188-222 | req-review IMPORTANT |
| REQ-117 AC4 | 回归清单枚举改「既有测试全量零改动全绿」（v1 清单含不消费 HTTP 面的 cardStream 且漏真实消费方） | req-review SUGGESTION |
| REQ-117 AC5 | 行数 ≤350 → ≤650（目标 ~600） | tech C1（人拍板） |
| 测试加固 | gitState 正分支直测（新增 1 用例）；AC4 补 res error 分支（close/error 两个独立注册点）；AC2 投影补空文本 user/assistant 行；依赖方向静态断言加固（matchAll 全量匹配 + specifier 不硬编码 + registry 正向断言）；行数口径对齐 wc -l；env 保存/恢复 + closeDb | test-review SUGGESTION 批 |

### v2 自检

- [x] 6 REQ 全覆盖不变；34 断言（+1 gitState 正分支）33 RED + 1 双向不变量绿
      （实测 `node --test`：全部 RED 均为 seam 未就绪门，非语法/装配错误）
- [x] 6 文件 REQ-VERSION 全部更新为 v2-hash:77f0f186（机械核验）
- [x] v2 新增 expected 值 trace：gitState 正分支 `{state:"branch"/"detached"}` →
      §6.3 块6 + REQ-AGENT-058 既有契约 + readGitBranch 现行返回形状（gitBranch.js
      实证：branch/detached/none 三态，无 worktree）；空文本剔除 → REQ-113 AC2 +
      现行代码 agentSessions.js:187 `if (text.trim() === "") continue;`（user/
      assistant 均生效，实证）；≤650 → REQ-117 AC5 v2（人拍板锚点）
- [x] 无 `TODO: HUMAN ASSERTION`；无快照；边界覆盖扩大（error 触发、空文本双角色）
- [x] capability/entity 不变；business-capabilities.md 行同步修订（≤350 → ≤650）

### 签核状态（v2）

signer = **AI**（两项阻塞修复均已经人拍板的方向机械落地，无新升级点）。
BUILD 解锁条件恢复：34 断言契约锁定，既有测试零改动硬约束不变。

---

## Assertion v2 追加补签（2026-08-17，BUILD Slice 1 期 test-gap 就地补测）

- **触发**：Slice 1 PRD 对齐子代理发现缺口——REQ-114 AC4 的 none 四成因枚举
  （非项目空间/项目已删/localPath 空/DB 异常）直测只钉了前两个；人拍板
  「就地补测 + signoff 追加重签」。
- **补测内容**（sessionDomainKeys.test.js +1 用例 2 断言）：localPath 空串 →
  `{state:"none"}`；DB 异常（DB_PATH 指向目录，getDb 必抛）→ catch → `{state:"none"}`。
- **expected trace**：两断言 expected 均机械推导自 REQ-114 AC4 原文枚举（规格锚点
  已含四成因，无需新锚点）；触发方式确定性（目录建库必抛 SQLITE_CANTOPEN）。
- **自检**：REQ-VERSION 不变（requirements.md 零改动，hash 仍为 77f0f186）；
  补测后 sessionDomainKeys 7/7 绿；本 story 用例总数 34 → 35。
- signer = **AI**（无升级点）。

