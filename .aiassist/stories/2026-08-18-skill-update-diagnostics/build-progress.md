# Build Progress — 2026-08-18-skill-update-diagnostics

> BUILD 开始：2026-08-18（门 1 通过，signer=AI）
> 契约：requirements v1（hash 7885a24c）+ signoff.md + prd.md §10（simple）+ 既有技能测试零改动硬约束
> 硬约束：既有测试文件零改动全绿；commit 纪律（[build] 不含测试文件）；E2E 待 QA 跑（本环境不跑 Electron E2E）

## 切片计划

| Slice | REQ | 内容 | 测试载体 | 依赖 |
|---|---|---|---|---|
| 1 | REQ-SKILL-020/021 API 半 | skillService：scanSourceDir 组对象加 version（package.json.version → git rev-parse --short HEAD → null）；createJob 加 log:null；runUpdateJob 失败捕获 git 输出（原始未 trim）写 job.log，成功保持 null；getJob 透出 log；renderer api/skills waitForJob 失败抛错带 err.log | skillUpdateDiagnostics.test.js API 6 例（RED→GREEN） | 无 |
| 2 | REQ-SKILL-020 AC5 / 021 AC4-5 / 022 | SkillTable 组头 version（repo-version testid，null→"—"）；Skills.jsx 成功提示（update-success）+ 失败 log 区块（update-log-panel）；i18n | E2E skillUpdateDiagnostics.test.cjs（QA 跑）+ API 回归 | Slice 1 |

## 基线

- 全量单测基线（2026-08-18，`npm run test:unit`）：971 tests / 965 pass / 6 fail
  = 本 story 6 seam-gate RED（REQ-SKILL-020/021 API）+ 其余全绿（含主 story 964 + 新加的 1 测试）。
  本 story BUILD 停机条件：6 fail → 0 fail（仅本 story seam 测试转绿，其余零回归）。

## Slice 进度

### Slice 1（后端，REQ-SKILL-020/021 API 半）— DONE

| 契约 | 实现位置 | 测试 | 状态 |
|---|---|---|---|
| REQ-020 AC1 git 源 package.json 有 version → version = 该值 | `src/services/skillService.js` `readSourceVersion`（读 `sourceDir/package.json` `.version`，`typeof === "string" && !== ""`）→ `scanSourceDir` 组对象 `version` | `api/skillUpdateDiagnostics.test.js` AC1（0.24.0） | COVERED |
| REQ-020 AC2 local 源 package.json 有 version → version = 该值 | 同上（package.json 优先于 sourceType） | AC2（1.1.0） | COVERED |
| REQ-020 AC3 无 version 字段 → git 短哈希 / local null | `readSourceVersion` 回落：git → `execFileSync("git",["rev-parse","--short","HEAD"])`（同步，cwd=sourceDir，trim）；local → null | AC3（7 位短哈希 / null） | COVERED |
| REQ-020 AC4 无/坏 package.json → 回落 fallback，不阻断扫描 | `readSourceVersion` 外层 try/catch（ENOENT/JSON.parse 异常不抛，回落）；`listSkillGroups` E10 兜底保持 | AC4（git 无 pkg 短哈希 / local 坏 JSON null，均仍被扫描到） | COVERED |
| REQ-021 AC1 成功 job.log = null / 失败 log = git 输出原文 | `createJob` 加 `log:null`；`runUpdateJob` 失败路径 `job.log = [err.stdout, err.stderr].filter(Boolean).join("\n") || gitErrorMessage(err)`（原始未 trim，与 `error.message`=trim 后 stderr 天然不等）；成功不写 log | AC1（成功 log===null + 'log' 键在）；AC2（失败 log 含 /local changes/i 且 !== error.message） | COVERED |
| REQ-021 AC2 GET /api/skills/jobs/:jobId 终态返回 log | `getJob` 返回 `{id, status, error, log: job.log ?? null}`；`routes/skills.js` 直透 `getJob` 对象（无字段白名单） | AC1/AC2 经 waitForJob 轮询断言 | COVERED |
| REQ-021 AC3 waitForJob 失败抛错带 err.log | `src/renderer/api/skills.js` `waitForJob` error 分支 `err.log = job.log ?? null` 后抛 | signoff 记录：无独立 API 断言（renderer 内部传播细节），实现者代码审查 + E2E AC4（QA 门）兜底 | COVERED（代码审查 + E2E AC4，QA 门） |

- 修改文件：`src/services/skillService.js`（`readSourceVersion` 新增 + `scanSourceDir` version + `createJob` log:null + `getJob` log + `runUpdateJob` 失败写 job.log；import `execFileSync`）、`src/renderer/api/skills.js`（`waitForJob` err.log）、`src/http/routes/skills.js`（核实直透，无改动）。
- 测试证据：`api/skillUpdateDiagnostics.test.js` 6/6 pass（RED→GREEN）；`npm run test:unit` 全量 971/971 pass / 0 fail（零回归）。

## 遗留/约束

- E2E（Playwright+Electron）本环境不跑，QA 门执行；前端 slice 以代码审查 + API 回归验证。
- version 解析与 job.log 契约见 requirements REQ-020 AC1-AC4 / REQ-021 AC1-AC2。

### Slice 2（前端，REQ-020 AC5 / 021 AC4-AC5 / 022 AC1-AC2）— DONE

| REQ-AC | 契约 | 实现位置 | 测试 | 状态 |
|---|---|---|---|---|
| REQ-020 AC5 | 技能组头 meta 展示 version（sourceType · version · sourceUrl；null → "—"） | `src/renderer/components/skill/SkillTable.jsx` `skill-repo-meta`：git/local 源在 sourceType 后加 ` · ` + `<span data-testid="repo-version">{group.version ?? "—"}</span>`（版本值原样，无前后缀；E2E toHaveText 精确匹配 "1.1.0"） | `e2e/skillUpdateDiagnostics.test.cjs` 用例 1（QA 门）；API AC1-AC4 已绿（Slice 1） | COVERED |
| REQ-021 AC4 | 更新失败 → 展示失败原因 + git 输出 log 区块（可滚动） | `src/renderer/pages/Skills.jsx` `handleUpdate` catch：`setActionError(err.message)` + `setUpdateLog(err.log ?? null)`；渲染 `updateLog` 非空时 `<pre data-testid="update-log-panel">`（等宽 pre、pre-wrap、overflow auto、maxHeight 240、背景 `--ch-surface-high`） | `e2e/skillUpdateDiagnostics.test.cjs` 用例 3（QA 门，toContainText /local changes/i）；API AC1-AC3 已绿（Slice 1：err.log 传播） | COVERED |
| REQ-021 AC5 | 更新成功不展示 log 区块 | 成功路径 `updateLog` 保持 null（handleUpdate 开头清空 + 成功不 set），`update-log-panel` 条件渲染故不出现 | `e2e/skillUpdateDiagnostics.test.cjs` 用例 2（QA 门，not.toBeVisible） | COVERED |
| REQ-022 AC1 | 更新成功 → 行内成功提示（含 slug；版本尽力而为） | `Skills.jsx` `handleUpdate` 成功后 `setActionSuccess(t("skills.updateSuccess", { slug }))`；渲染绿色卡片 `data-testid="update-success"`（`--ch-success` 色变量，对称 actionError） | `e2e/skillUpdateDiagnostics.test.cjs` 用例 2（QA 门，toBeVisible） | COVERED |
| REQ-022 AC2 | 成功提示出现同时组头版本刷新可见 | `useSkills.updateSource` 成功路径内 `fetchGroups()`（Slice 1 已有）→ 组列表刷新；`repo-version` 在刷新后仍渲染 | `e2e/skillUpdateDiagnostics.test.cjs` 用例 2（QA 门，repo-version toBeVisible） | COVERED（hook 无改动，复用既有 fetchGroups） |

- i18n：`src/renderer/i18n/zh-CN.json` / `en-US.json` skills 区补 `updateSuccess`（"已更新技能源 {{slug}}" / "Updated skill source {{slug}}"）+ `updateLogTitle`（"更新日志" / "Update Log"）；`version` 键已有复用（组头不额外用 label，直接渲染值）。
- 交互清空：`handleUpdate`/`handleInstall`/`handleConfirmDelete` 开头统一清 `actionError`/`actionSuccess`/`updateLog`（三态互斥，无残留卡片）。
- 修改文件：`src/renderer/components/skill/SkillTable.jsx`（+4）、`src/renderer/pages/Skills.jsx`（+45）、`src/renderer/i18n/zh-CN.json`（+2）、`src/renderer/i18n/en-US.json`（+2）。`useSkills.js` 未改（err.log 已随 waitForJob 抛错传播，Slice 1）。
- 测试证据：`api/skillUpdateDiagnostics.test.js` 6/6 pass；`npm run test:unit` 全量 971/971 pass / 0 fail（零回归）；i18n JSON 合法（node JSON.parse）。JSX 语法经逐文件审读核验（本环境无 JSX parser；E2E 3 例待 QA 门）。
