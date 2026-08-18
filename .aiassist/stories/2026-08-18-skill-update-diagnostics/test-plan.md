# 测试计划 — 2026-08-18-skill-update-diagnostics

> 载体矩阵：API 契约（test:unit 硬断言）+ E2E（Playwright+Electron，test:e2e）。
> 组件测试基建未接线（孤立 .test.jsx 无 runner），UI 行为走 E2E。

## REQ → 测试映射

| REQ | AC | seam | 测试方法/断言 | 载体文件 |
|---|---|---|---|---|
| REQ-SKILL-020 | AC1 | API | git 源 + package.json version → group.version = 该值（0.24.0） | api/skillUpdateDiagnostics.test.js |
| REQ-SKILL-020 | AC2 | API | local 源 + version → 该值（1.1.0） | 同上 |
| REQ-SKILL-020 | AC3 | API | 无 version 字段 → git 源 = rev-parse --short HEAD（7 位）/ local = null | 同上 |
| REQ-SKILL-020 | AC4 | API | 无 package.json → git 回落短哈希 / local null；损坏 JSON 不阻断扫描（E10） | 同上 |
| REQ-SKILL-020 | AC5 | E2E | 技能组头展示版本号（local 源 1.1.0 可见）；null → "—" | e2e/skillUpdateDiagnostics.test.cjs |
| REQ-SKILL-021 | AC1 | API | 更新成功 → job.log = null（'log' 键在） | api 同上 |
| REQ-SKILL-021 | AC2 | API | 更新失败（本地改动 → ff-only 拒绝）→ job.log = git stderr 原文（含 /local changes/i，非翻译文案） | api 同上 |
| REQ-SKILL-021 | AC3 | （实现者单测） | waitForJob 抛错带 err.log —— E2E 失败面板可见间接覆盖，不设独立业务断言 | — |
| REQ-SKILL-021 | AC4 | E2E | 更新失败 → log 区块可见（含 git 输出） | e2e 同上 |
| REQ-SKILL-021 | AC5 | E2E | 失败面板与成功提示互斥（成功路径无 log 区块） | e2e 同上 |
| REQ-SKILL-022 | AC1 | E2E | 更新成功 → 行内成功提示可见（含 slug） | e2e 同上 |
| REQ-SKILL-022 | AC2 | E2E | 成功刷新后组头版本可见 | e2e 同上 |

## 新增 data-testid（实现方须落地）

| testid | 位置 | 用途 |
|---|---|---|
| `repo-version` | SkillTable 组头 meta | 版本号展示（null → "—"） |
| `update-success` | Skills 页 | 更新成功行内提示 |
| `update-log-panel` | Skills 页 | 更新失败 log 区块（git 输出） |

## 既有测试承载（零改动硬约束）

`skillLibrary.test.js`（REQ-SKILL-016 更新路径）、`skillLibrary.test.cjs`（E2E）——
新增 version/log 字段不得破坏既有断言（纯 additive 字段）。

## REFLECT 人工验收

- 无纯审美项需人工；颜色/间距沿用既有 actionError 卡片形态。
- 成功提示的具体文案措辞（中英）由实现期确定，REFLECT 复核可读性。
