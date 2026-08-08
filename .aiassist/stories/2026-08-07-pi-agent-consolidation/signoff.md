# 断言签核记录 — 2026-08-07-pi-agent-consolidation

> 门 1：ASSERTION-SIGNOFF
> 日期：2026-08-08
> 方式：人签核（用户「签核」，全部预期值来源 = 访谈 D1-D7 + tech-design 单题裁决 + review-tech 修复裁决）

## 签核范围

- **REQ**：REQ-AGENT-035~046（12 条，requirements v1，hash `2bc5b491ca5f1826acb810baef5baacbdb70e369ddb71546103967c9aeccdf8b`）
- **测试**：11 文件 44 用例（api 9 文件 + e2e 2 文件），`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/`
- **实现契约**：见 `tech-design.md` v0.3 接口 1-5（sessionLifecycle / session-evicted / evicted tombstone / 生成器 CLI / 规则表）+ `test-plan.md`（seam 依赖清单）
- **移动块**：M1（冷恢复延迟阈值）留 PRD，QA 阶段实测消化，不在签核范围

## 断言裁决（人拍板）

| # | 裁决项 | 签核值 | 来源 |
|---|---|---|---|
| 1 | TTL | 1 小时（3_600_000ms） | D5 访谈拍板 |
| 2 | sweep 周期 | 60s 语义 | D5 默认提议（未否决） |
| 3 | LRU 上限 | 50（默认值，注入可测） | D5 拍板 |
| 4 | 淘汰副作用 | dispose + 辅助 Map×3（toolContexts/sessionQueues/lastReplies）+ tombstone + session-evicted；**keySecrets 不清理**（keyRef 级共享） | review-tech 阻塞1 修复 |
| 5 | evicted 判别 | tombstone 集合（仅本运行亲手淘汰的 key）；孤儿/旧世代/从未存在 → E-AGENT-NO-SESSION 不复活 | review-tech 阻塞2 修复 |
| 6 | evicted 重投 | 重发 session-config + 重投恰一次 | 接口 3（REQ-AGENT-005 标准4 调和） |
| 7 | groupOf 语料 | feishu:chat→自身；ui:copilot:*→"ui:copilot"；ui:project:<pid>:*→"ui:project:<pid>"；畸形→自身不抛错 | ADR-016 + 同组单活裁决 |
| 8 | 同组单活范围 | 项目组 + copilot 通用组同一规则，无特殊逻辑；跨组并发 | 2026-08-08 人裁决 |
| 9 | 流式豁免 | TTL/LRU/组冷却三触发均豁免；流结束立即淘汰（组冷却）或回归候选（TTL/LRU） | D5 + 同组单活裁决 |
| 10 | 水合窗口 | JSONL mtime ≤ 60min 的行；边界含；启动/崩溃重启同规则 | B12 拍板 |
| 11 | 日志环形 | ≤1000 条覆盖最旧；ping/pong 不入日志；心跳语义不变 | D7 拍板 |
| 12 | 生成器 | 手动脚本 + golden 检入 + `--check`（一致 exit 0 / 漂移 exit 1 + diff）；golden 仅可见族 | D6 + 生成器时机裁决（A） |
| 13 | 判别表 | 仅不可见族→ask；仅可见族→allow；双命中→allow（gotgenes 优先）；wrapper→allow（floor 承接） | tech-design 数据流 6（review-tech 警告4 并入） |
| 14 | 语料变种 | 2> / >> / \|sh / \|bash / URL // 防误判 / wrapper 叠加 | 同上 |
| 15 | 信任门 | projectTrusted=false 剔除项目范围（fail-closed，对齐 gotgenes H3） | H3 spike + B7 标准3 |
| 16 | E2E 链路 | T-7（worker confirm→IPC→卡→批准→执行→回投）；T-9（pre-gate→桥→批准→执行，副作用 fs 断言，恰一卡） | B8/B9 + ADR-017 |
| 17 | 文档断言 | ADR-019/020 关键字面 + README 索引；CONTEXT.md 术语六项 | D1/D4 + review-tech 警告5 |
| 18 | 回归保全 | 不修改既有测试；618+148 水位不退由 QA 全量承担 | 纪律 |

## 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`
- [x] PRD 第 6-8 节已覆盖（F1-F7 + §6.2 分支 + §7 N/A 理由 + §8 E1-E6）
- [x] 每个 REQ-ID 都有对应测试（12/12，回溯检查见 test-plan.md）
- [x] 每个测试文件有 REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE / TEST-AUTHOR / ASSERTIONS-SIGNED
- [x] capability/entity 与 business-capabilities.md 一致（agent-dialogue / conversation-space + confirmation）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（全部替换为签核断言）
- [x] 预期值来源 = 人签核裁决（上表），非代码输出
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖（TTL 边界、流式豁免、LRU 让位 E5、tombstone 判别、水合窗口边界、--check 漂移、信任门、拒绝路径、0 双卡）
- [x] signoff.md 已创建，随 `[test] assertion-signoff` commit 提交
