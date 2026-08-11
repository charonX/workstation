# QA 报告 — 2026-08-10-pi-permission-config-ui

> 日期：2026-08-11
> 范围：REQ-AGENT-059~069（权限配置可视化管理：继承视图/全量面板化/JSON 单向同步/保存即生效/校验 fail-closed）
> 环境：macOS（darwin 25.5）、Node v24.18.0、Electron、Playwright

## 单元/集成测试

- **结果：PASS — 727/727（168 suites）**
- 命令：`npm run test:unit`（rebuild:node + `node --import ./scripts/session-lifecycle-seam.mjs --test` 全量）
- 本 story：permissionConfig 19 + permissionMerge 8（merge 对照 gotgenes `mergeUnifiedConfigs`）+ permissionEvaluation 3（保存即生效 pre-gate 评估器）= 30 用例
- 既有 697 水位全绿不退

## E2E/UITests

- **结果：PASS — 179/179（1.3m）**
- 命令：`npm run rebuild:electron && npx playwright test`
- 本 story 10/10：REQ-AGENT-059（页签+空态）/060（全局只读基底）/061（继承视图）/062（bash 族切换）/063（工具级+取消覆盖）/064（path 增删保存）/065（开关+链+继承文案）/066（JSON 模式）/068（非法保存拦截）/E6（坏文件提示+修复）
- 既有 169 用例全绿不退（含 assistantFeishu 等全部回归）
- 失败详情：无
- Playwright 产物：无失败，无 trace/screenshot 产出
- flaky：无

## 运行时浏览器验证

- 状态：**SKIPPED**（Chrome DevTools MCP 未配置；Electron E2E 即真实浏览器/窗口验证，交互与结构由 Playwright 179/179 覆盖，视觉观感留 REFLECT 人工验收）

## Coverage

- N/A（node --test 项目无覆盖率阈值配置；seams 全覆盖由 REQ-TRACE + 对照测试（merge 与 gotgenes 语义一致）保证）

## 手动验证（E2E 等价）

- 权限配置全流程经 Playwright Electron 真实应用验证（10 用例）：页签入口 → 空态 → 新建 → 继承视图 → 规则切换/覆盖徽标 → path 增删 → 开关/链 → JSON 模式 → 保存落盘（真实文件断言）→ 非法保存拦截 → 坏文件提示修复
- 保存即生效：permissionEvaluation 3 用例（真实 gotgenes 消费链路：ask↔allow 同会话评估变化，未覆盖回落全局）

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| hydrationWindow「标准1：启动水合仅覆盖 JSONL mtime ≤ 窗口」 | mtime 窗口计时敏感环境性 flake（既有记录，非本 story 引入） | 复跑全绿；既有惯例记录不处理 |

## Bug 处理回顾

- **BUG-001**（code-defect，人裁决）：面板保存 known-gate 丢弃 path/外部目录新增键（`permission.path.<pattern>` 不在 GET rules known 集）→ 修复：前缀放行（`permission.path.`/`permission.external_directory.`）→ 回归：E2E 064 修复前红/修复后绿 + harness 先红后绿 6/6
- bug-counter：1（BUG-001 闭环）

## 结论

- [x] **可进入 `/reflect`**（无 open bugs，QA 全绿）
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug`

## 遗留观察（非阻塞，REFLECT 复核）

1. REQ-AGENT-061 标准 4（merged.bash 浅合并 API 面断言）仅对照单测覆盖，无独立 API seam 断言（弱对照，对齐报告缺口 8）
2. hydrationWindow flake（既有环境性）
3. 观感项（继承视图两列密度/覆盖高亮配色/JSON 模式排版）留 REFLECT 人工验收（对照 ux/permission-config.html）
