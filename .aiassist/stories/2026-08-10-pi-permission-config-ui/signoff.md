# 断言签核记录 — 2026-08-10-pi-permission-config-ui

> 门 1：ASSERTION-SIGNOFF
> 日期：2026-08-10
> 方式：人签核（用户逐项过 TODO 确认 + 宽松断言拍板）

## 签核范围

- **REQ**：REQ-AGENT-059~069（11 条，requirements v1，hash `4b944146fd166a4f60e5ba65080efefeb75690ff7be837718c867c2d2c01b77d`）
- **测试**：4 文件（api 3 + e2e 1），`tests/capabilities/agent-dialogue/conversation-space/2026-08-10-pi-permission-config-ui/`
- **实现契约**：`tech-design.md` v0.1（接口 3.1/3.2、数据流 4、ADR-022）+ `test-plan.md`（seam 依赖清单）
- **移动块**：M1（克隆）/M2（审计）/M3（会话区入口）/M4（全局可编辑）留 PRD

## 断言裁决（人逐项确认）

### A. TODO 审查修正（2 处 seam 设计错误，签核前修正）

| # | 修正 | 原因（实证） |
|---|---|---|
| A1 | permissionMerge 对照对象 `mergeFlatPermissions` → `mergeUnifiedConfigs`（8 用例） | 前者只处理 permission 面，顶层字段（yoloMode/authorizerChain/预览长度）在后者——继承视图是全字段域，必须对照完整入口（config-loader.ts 实证） |
| A2 | permissionEvaluation seam `evaluateBashToolCall` → `createPolicyEvaluator({cwd})` | 前者走 classifyBashToolCall 纯函数分类不读项目文件（只兜重定向/管道）；后者工厂体内 loadPermissionRules(projectFile) 每次重读（pre-gate 真实路径） |

### B. 签核断言（20 处确认 + 1 处宽松拍板）

| # | 测试 | 断言 | 裁决 |
|---|---|---|---|
| 1 | permissionConfig | GET global = 部署 JSON 逐字段一致 | 人确认接受 |
| 2 | permissionConfig | `rm *` rule 带 family/label/readable | 人确认接受（family 来自 BASH_RULES） |
| 3 | permissionConfig | 每条 rule key 存在于部署 JSON | 人确认接受 |
| 4 | permissionConfig | 首次保存文件 = 请求体（最小覆盖集） | 人确认接受 |
| 5 | permissionConfig | 面板保存后自定义字段 customOrgKey 保留 | 人确认接受 |
| 6 | permissionConfig | 取消覆盖后 rm * 删除、write 保留 | 人确认接受 |
| 7 | permissionConfig | merged.authorizerChain = 项目数组（整体替换） | 人确认接受 |
| 8 | permissionConfig | 保存响应带 mtime | 人确认接受 |
| 9 | permissionConfig | 服务端 400 判定 = gotgenes validateUnifiedConfig | 人确认接受 |
| 10 | permissionMerge | 8 组用例两边输出逐字段一致 | 人确认接受 |
| 11 | permissionEvaluation | 基线 ask → 改文件 → allow（不重启） | 人确认接受 |
| 12 | permissionEvaluation | 反向 allow → ask | 人确认接受 |
| 13 | permissionEvaluation | 未覆盖 sudo 回落全局 ask | 人确认接受 |
| 14 | E2E | 空态文案 + 新建按钮可见 | 人确认接受 |
| 15 | E2E | 规则行可见 + 全局列无编辑控件 | 人确认接受 |
| 16 | E2E | 切换「允许」→ 覆盖徽标出现 | 人确认接受 |
| 17 | E2E | **保存成功提示（宽松）**：`perm-save-hint` 或 `perm-saved-hint` 任一可见——**人拍板宽松断言**（文案观感留 REFLECT） | 人确认接受 |
| 18 | E2E | JSON 文本区可见可编辑 | 人确认接受 |
| 19 | E2E | JSON 非法保存 → 错误条可见 | 人确认接受 |
| 20 | E2E | 继承说明文案可见（「项目只覆盖你改的条目/未改的继承全局」） | 人确认接受 |

## 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`
- [x] PRD 第 6-8 节已覆盖（F1-F7 + 6.2 分支 + §7 输入验证 + §8 E1-E6）
- [x] 每个 REQ-ID 都有对应测试（11/11：059-068 → permissionConfig + E2E、061 → permissionMerge、069 → permissionEvaluation）
- [x] 每个测试文件有 REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE / TEST-AUTHOR / ASSERTIONS-SIGNED（4 文件全部 true）
- [x] capability/entity 与 business-capabilities.md 一致（agent-dialogue / conversation-space）
- [x] 无 `// TODO: HUMAN ASSERTION` 残留依赖（签核后 TODO 均已确认，实现接线 seam 标注为明示约定）
- [x] 预期值来源 = 人逐项确认（上表 20 项 + 宽松拍板 1 项）
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖（未配置空态 / 校验失败不落盘 / 自定义字段保留 / 取消覆盖删除 / 整体替换 / 未覆盖回落 / 对照一致性）
- [x] signoff.md 已创建，随 `[test] assertion-signoff` commit 提交
