# 需求 — 2026-08-18-skill-update-diagnostics

> 契约锚点：prd.md §6.3 预期值锚点（快照实证）+ §10.4 接口契约 + §7 验证规则。
> 承接 2026-07-29-multi-agent-skills 技能功能；REQ-ID 延续域内编号（REQ-SKILL-020+）。

## REQ 概览

| REQ-ID | 标题 | 优先级 | 必须性 | scope | 测试类型 | capability | entity |
|---|---|---|---|---|---|---|---|
| REQ-SKILL-020 | 技能源版本号展示 | P1 | 必须 | cross-module | API+E2E | skill-management | skill |
| REQ-SKILL-021 | 更新失败 log（git 输出可查） | P1 | 必须 | cross-module | API+E2E | skill-management | skill |
| REQ-SKILL-022 | 更新成功反馈 | P1 | 应该 | cross-module | E2E | skill-management | skill |

## 稳定块 → REQ 映射

| PRD 块 | REQ |
|---|---|
| B1 版本号展示 | REQ-SKILL-020 |
| B2 更新失败 log | REQ-SKILL-021 |
| B3 更新成功反馈 | REQ-SKILL-022 |

---

## REQ-SKILL-020：技能源版本号展示

技能源（来源目录）在技能列表分组视图中展示版本号，用户可辨新旧。

- capability: `skill-management`；entity: `skill`
- scope: `cross-module`；modules: skillService → routes/skills → SkillTable/Skills (renderer)
- 测试路径：`tests/capabilities/skill-management/skill/2026-08-18-skill-update-diagnostics/api/skillUpdateDiagnostics.test.js`（API 半）+ `e2e/skillUpdateDiagnostics.test.cjs`（UI 半）

### AC1 — git 源 package.json 有 version → version 字段 = 该值

`GET /api/skills` 的组对象 `{ slug, sourceType, sourceUrl, version, skills }` 中：
git 源且根 package.json 含 `version` 字段 → `version` = 该值。
EXPECTED-TRACE：prd.md §6.3（实证 charonX-workflow → `"0.24.0"`）。

### AC2 — local 源 package.json 有 version → version = 该值

local 源且 package.json 含 `version` → `version` = 该值。
EXPECTED-TRACE：prd.md §6.3（实证 mattpocock-skills → `"1.1.0"`）。

### AC3 — package.json 无 version 字段 → fallback

源 package.json 存在但无 `version` 字段：git 源 → `git rev-parse --short HEAD` 输出
（7 位短哈希，字符串）；local 源 → `version: null`。
EXPECTED-TRACE：prd.md §6.3（实证 baoyu-skills → null；git fallback 语义）。

### AC4 — package.json 缺失/解析失败 → 回落 fallback，不阻断扫描

源根 package.json 缺失或 JSON 损坏 → 版本解析回落到 AC3 的 fallback 规则
（git 源 → `git rev-parse --short HEAD`；local 源 → `null`），该源仍正常出现在
列表中（E10 语义：单个源异常不使扫描失败）。

### AC5 — UI 技能组头展示 version

技能列表分组头 meta 展示版本号（形态：sourceType · version · sourceUrl；version
为 null → 显示 "—"）。
EXPECTED-TRACE：prd.md §10.2 SkillTable 增量 + §6.3 null → 「—」。
（E2E 载体）

**接口契约（cross-module）**：
```
GET /api/skills → [{ slug, sourceType, sourceUrl, version: string|null, skills:[{skillName,name,description}] }]
```
`version` 为新增字段，其余字段不变；来源 = 源根 package.json `version`（fallback
见 AC3/AC4）。

---

## REQ-SKILL-021：更新失败 log（git 输出可查）

更新（git pull --ff-only）失败时，用户能看到 git 实际输出（stderr 原文），而非
只有翻译文案。

- capability: `skill-management`；entity: `skill`
- scope: `cross-module`；modules: skillService（job）→ routes/skills → api/skills（waitForJob）→ Skills (renderer)
- 测试路径：`tests/capabilities/skill-management/skill/2026-08-18-skill-update-diagnostics/api/skillUpdateDiagnostics.test.js`（API 半）+ `e2e/skillUpdateDiagnostics.test.cjs`（UI 半）

### AC1 — 更新失败 job 的 log = git stderr 原文

`git pull --ff-only` 失败 → job 终态 `log` = git stderr 原文（非翻译文案）；
成功 → `log: null`。
EXPECTED-TRACE：prd.md §6.3（失败 job log:<git stderr>；成功 log:null）。

### AC2 — GET /api/skills/jobs/:jobId 终态返回 log

job 终态（success/error）`GET /api/skills/jobs/:jobId` 返回 `{id, status, error, log}`；
pending/running → `log: null`。

### AC3 — waitForJob 失败抛错对象带 log

renderer `waitForJob` 在 job error 时抛 `Error`，`err.log` = job.log（供 UI 展示）。

### AC4 — UI 更新失败展示 log 区块

技能页更新失败 → 展示失败原因 + git 输出 log 区块（可滚动可见）。
（E2E 载体）

### AC5 — 更新成功不展示 log

更新成功路径不出现 log 区块（log 仅失败展示）。
（E2E 载体）

**接口契约（cross-module）**：
```
GET /api/skills/jobs/:jobId → { id, status: "pending"|"running"|"success"|"error", error: {code,message}|null, log: string|null }
```
`log` 为新增字段；终态才有值，pending/running 为 null。失败 log = 本次 git 命令
stdout+stderr 原文（trim），成功 log = null（无输出可展示）。

---

## REQ-SKILL-022：更新成功反馈

更新成功后用户看到可见结果，不再"点了没反应"。

- capability: `skill-management`；entity: `skill`
- scope: `cross-module`；modules: useSkills → Skills (renderer)
- 测试路径：`tests/capabilities/skill-management/skill/2026-08-18-skill-update-diagnostics/e2e/skillUpdateDiagnostics.test.cjs`

### AC1 — 更新成功 → 行内成功提示

git 源点「更新」成功 → 技能页显示行内成功提示（含该源 slug；若版本有变化含新版本号）。
EXPECTED-TRACE：prd.md §10.5 D3（行内卡片形态，非 toast）。

### AC2 — 更新成功 → 组头版本刷新可见

成功提示出现的同时，技能组列表已刷新（`fetchGroups` 后版本字段为最新值）。

**接口契约**：`useSkills.updateSource` 成功解析后返回；失败抛错带 `err.log`（REQ-SKILL-021 AC3）。
