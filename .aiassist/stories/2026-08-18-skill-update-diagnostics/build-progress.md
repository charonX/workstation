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
