# 签核记录 — 2026-08-18-skill-update-diagnostics

## Assertion（门 1，2026-08-18）

### 检查清单

- [x] PRD §14 无 GAP 悬空（B1/B2/B3 全就地补；移动块在 §5；范围外在 §12——local 更新能力/历史 log/install log 展示）
- [x] 每个 REQ-ID 都有对应测试（REQ-SKILL-020/021/022 → api 1 文件 + e2e 1 文件）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`（v1-hash:7885a24c）、
      `CAPABILITY-TRACE`、`ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、
      `ASSERTIONS-SIGNED`（2 文件头部机械核验）
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致
      （skill-management/skill，能力地图行已追加 2026-08-18 测试路径与 REQ-020~022）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（grep 0 命中）
- [x] 预期值来源清晰：每条 expected 值 trace 到 prd.md §6.3/§10.2/§10.4/§10.5 锚点
      （锚点全部取自快照实证——0.24.0/1.1.0/null/7 位短哈希/成功 log null/失败 stderr）
- [x] 无快照当判定依据（全部字面值断言）
- [x] 边界/错误 case 已覆盖（version 四态含损坏 JSON 回落、更新成败两态 log、
      log 仅失败展示互斥、E10 不阻断扫描）

### expected 值交叉验证（EXPECTED-TRACE ↔ prd.md 锚点）

| 断言组 | 锚点来源 | 值一致 |
|---|---|---|
| git 源 version = 0.24.0 / local 源 version = 1.1.0 | §6.3（实证 charonX-workflow/mattpocock-skills） | ✅ |
| 无 version 字段 → git 短哈希（7 位）/ local null | §6.3（实证 baoyu-skills → null + git fallback 语义） | ✅ |
| 无/坏 package.json → 回落 fallback，扫描不失败 | §6.3 + §7（E10 语义） | ✅ |
| 成功 job log = null（'log' 键在）/ 失败 job log = git stderr 原文 | §6.3 + §10.4 契约（job +log: string\|null） | ✅ |
| 失败 log 非翻译文案（≠ error.message） | §10.4（log = git 输出原文） | ✅ |
| UI 组头版本展示 / null → "—" | §10.2 SkillTable 增量 | ✅ |
| 成功行内提示（非 toast）+ 失败 log 区块 | §10.5 D3 + §10.2 Skills 增量 | ✅ |

### 升级点结果

| 升级点 | 内容 | 处置 |
|---|---|---|
| REQ-021 AC3（waitForJob err.log）无独立业务测试 | err.log 是 renderer 内部传播细节，业务可观察面 = E2E 失败面板展示 | 不设独立断言；E2E AC4（log 面板可见）间接覆盖，实现者单测兜底。非升级 |
| E2E 无法在本阶段运行（需 Electron rebuild） | Playwright+Electron 是项目既定 UI seam（skillLibrary.test.cjs 先例），QA 阶段 /qa-runner 跑 | 记录：E2E 3 例在 QA 门执行，API 6 例已 RED 实证 |
| version 解析安全 | 读 package.json + git rev-parse（只读），无新信任边界 | 无 |

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-SKILL-020 | api/skillUpdateDiagnostics.test.js（AC1-AC4）+ e2e/skillUpdateDiagnostics.test.cjs（AC5） | skill-management/skill |
| REQ-SKILL-021 | api/skillUpdateDiagnostics.test.js（AC1/AC2）+ e2e/skillUpdateDiagnostics.test.cjs（AC4/AC5） | skill-management/skill |
| REQ-SKILL-022 | e2e/skillUpdateDiagnostics.test.cjs（AC1/AC2） | skill-management/skill |

既有测试承载（零改动硬约束验收面）：skillLibrary.test.js（REQ-SKILL-016 更新路径）、
skillLibrary.test.cjs（E2E）——新增 version/log 字段纯 additive，不得破坏既有断言。

### 签核状态

签核时 API 6 断言全 RED（seam 未就绪门：version/log 字段未实现），E2E 3 例待 QA
执行。无升级点遗留。signer = **AI**。人工验收留在 REFLECT：UI 形态复核（版本 meta
展示、成功/失败反馈卡片的可读性），无纯审美断言进测试。
