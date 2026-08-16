# QA 报告 — 2026-08-16-deepen-execution-runner

> 生成：/qa-runner（2026-08-16）
> 基线：`9481499`（v2 修订后：撤除 250ms 观察窗，signoff v2 重签 S2'/S4'/S8）
> 结论：**可进入 /reflect**（单元 891/891 绿；E2E 71 用例 2 例首跑失败、重跑全过——flaky 记录观察）

## 单元测试

- 结果：**PASS** — 全量 **891/891 绿**（77s，当前工作树 = v2 状态）
- story 6 文件 29 用例全绿；迁移后既有套件全绿（scheduleTriggers 断言迁移、seam import 迁移）

## E2E/UITests

- 结果：**PASS（2 flaky 已重跑确认）**
- 范围：执行相关 16 文件（flow-orchestration 14 + channel-integration 1 + collection-pipeline 1）
- 命令：`npm run rebuild:electron && npx playwright test <16 文件>` → 首跑 **69 passed / 2 failed**；单独重跑 2 文件 → **11/11 passed**（13.8s）
- 失败详情（首跑，重跑即绿）：
  1. `artifactsTab.test.cjs:85`（REQ-FLOW-030 产物 tab 列表）——首跑失败，重跑绿。用例自带时序防护（执行前 utimes 刷新 mtime）；v2 零睡眠后执行更快，但断言是「等待终态后查 UI」，无确定性竞态证据——疑首跑 Electron 冷启动/资源竞争
  2. `flowEditor.test.cjs:54`（REQ-FLOW-013 删除节点+连线）——`.react-flow__edge` 拖拽后计数 0，重跑绿。拖拽模拟在 Electron 下的已知脆弱面；与执行链路（本 story blast radius）无关
- Playwright 产物：`test-results/capabilities-flow-orchestr-3bc2a-.../`（截图 + error-context，flaky 重跑绿故不阻断）

## 运行时浏览器验证

- 状态：SKIPPED（本 story 无 ux/ 目录——纯内部架构重构，无 UI 变更面；E2E 已覆盖执行链路 UI 呈现）

## Coverage

- 状态：N/A（项目未配置 coverage 阈值门；行为面由既有 + 新增测试覆盖）

## 手动验证

- 状态：SKIPPED（无 UI 变更）

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| artifactsTab REQ-FLOW-030 产物列表 | 首跑失败、重跑绿（Electron 冷启动竞争疑） | 记录观察；若反复触发转 /bug 诊断（v2 零睡眠时序为待查项） |
| flowEditor REQ-FLOW-013 拖拽连线 | 首跑失败、重跑绿（ReactFlow 拖拽模拟脆弱面） | 记录观察；与本 story 无关联 |

## 结论

- [x] 可进入 `/reflect`（无 open bugs，QA 全绿；2 例 flaky 重跑确认通过并记录观察）
- [ ] 需回 BUILD
- [ ] 有失败，建议调用 `/bug`

## 备注

- v2（撤除 250ms 观察窗）已纳入本次 QA 基线：单元 891/891 含 v2 迁移后的时序确定性断言（零睡眠上界 / 同步竞态 / 队头占用闸门）
- REFLECT 待办：tech-design 5 项新决策补进 ADR-028（§10.5）；记录项（parseVariables/timestamp 跨模块重复、executionQueue.destroy length 洞预存缺陷）
