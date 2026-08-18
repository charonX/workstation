# 技能源更新可诊断性（版本号 + 失败 log + 成功反馈）

## 1. 问题陈述

技能源更新是黑盒：点「更新」无任何可见反馈——成功时按钮 busy 一闪而过、无成功提示、
版本号无处可辨，用户以为没更新（实测 service 层 git pull 实际成功）；失败时只有一行
不可读的翻译文案，没有 git 实际输出可查（job 模型丢弃 stdout/stderr）。用户无法判断
更新是否发生、为何失败、当前版本新旧。

## 2. 解决方案

三个稳定块，把技能更新从黑盒变成可观察：

- **B1 版本号展示**：`GET /api/skills` 技能组加 `version` 字段（来源 = 技能源根
  package.json 的 `version`）；缺失时 fallback（git 源 → `git rev-parse --short HEAD`
  提交短哈希；local 源 → `null`）。UI 技能组头 meta 展示。
- **B2 更新失败 log**：job 捕获 git 命令输出（stdout/stderr），`getJob` 终态返回
  `log` 字段；`waitForJob` 把 log 带进抛错；UI 失败时展开展示 git 实际输出。
- **B3 更新成功反馈**：更新成功后在技能页显示行内成功提示（含新版本号，若有）；
  版本刷新随 `fetchGroups` 自然可见。

## 3. 用户故事

- 作为技能源维护者，我点「更新」后需要知道结果：成功——更新到哪个版本；失败——为什么失败。
- 我需要在技能列表看到每个源的版本号，判断哪个该更新。
- 当更新失败时，我需要看到 git 实际做了什么，而不是一行无意义的报错。

## 4. 稳定块

| 块 | 内容 |
|---|---|
| B1 | 版本号字段（skillService 扫描加 version；routes 透出；SkillTable 组头展示） |
| B2 | 失败 log（job 捕获 git 输出；getJob 透出 log；waitForJob 带 log 抛错；UI 失败展开） |
| B3 | 成功反馈（Skills 页行内成功提示，含版本号；fetchGroups 刷新可见版本变化） |

## 5. 移动块

- local 源更新能力（E8 保持 400，本 story 不动）。
- 持久化历史 log（每次更新的 log 留档回溯）。
- install 的 log 展示（i18n `installLog*` 键已预留，本 story 聚焦 update）。

## 6. 用户操作流

### 6.1 主路径

1. 打开技能页 → `GET /api/skills` → 每组显示 slug + sourceType + **version** + 技能数。
2. 点 git 源「更新」→ `POST /api/skills/:slug/update` → 202 `{jobId}` → 轮询
   `GET /api/skills/jobs/:jobId`：
   - success → 显示行内成功提示（含新版本号）→ `fetchGroups` 刷新（组头版本可见变化）。
   - error → 显示失败原因 + **git 输出 log** 区块。
3. local 源无更新按钮（现状不变）。

### 6.3 预期值锚点（快照实证）

| 场景 | 锚点值 |
|---|---|
| charonX-workflow（git，package.json version=0.24.0） | version 字段 = `"0.24.0"` |
| mattpocock-skills（local，version=1.1.0） | version = `"1.1.0"` |
| baoyu-skills（local，package.json 无 version 字段） | version = `null`（UI 显示「—」） |
| git 源 package.json 无 version | version = `git rev-parse --short HEAD` 输出（7 位短哈希） |
| 技能源无 package.json 且非 git | version = `null` |
| 更新成功（git pull 无新提交） | job `{status:"success", error:null, log:null}`，UI 提示成功 |
| 更新失败（git pull 报错） | job `{status:"error", error:{code:"SKILL_UPDATE_FAILED",...}, log:<git stderr>}`，UI 展示 log |
| local 源 POST update | 400 `SKILL_UPDATE_UNSUPPORTED`（E8 现状不变） |

## 7. 表单与输入验证

- version 字段：字符串或 `null`（非字符串值归一化；package.json 解析失败 → null，不阻断扫描）。
- job.log：字符串或 `null`（git 输出**原样**，非 trim——原样性是「log ≠ error.message」契约的承重差异；无输出 → null）。
- 无新增用户输入。

## 8. 错误状态与失败响应

| 场景 | 行为 |
|---|---|
| package.json 损坏/读取失败 | version → null，扫描不失败（E10 语义保持） |
| git rev-parse 失败（非 git 仓库但标记 git） | version → null |
| 更新失败 | job error + log 一起返回，UI 双展示 |
| `waitForJob` 超时 | 保持现有 `SKILL_JOB_TIMEOUT`；无 log（job 未终态） |

## 9. 复杂度分级

**simple**——三个小块、1 个 service 文件 + 1 个 route + 1 hook + 1 UI 组件 + i18n，
无新基础设施，不引入新抽象。

## 10. 技术方案（simple 高层）

### 10.2 模块与边界

| 模块 | 职责（本 story 增量） |
|---|---|
| `src/services/skillService.js` | `scanSourceDir` 组对象加 `version`（读 package.json + fallback git rev-parse）；`createJob` 加 `log:null`；`runUpdateJob` 捕获 git 输出写入 job.log（成功 trim 或 null、失败取 stderr）；`getJob` 返回 log |
| `src/http/routes/skills.js` | `GET /api/skills`（经 service 天然带 version）；`GET /api/skills/jobs/:id` 透出 log |
| `src/renderer/api/skills.js` | `waitForJob` 失败时把 `job.log` 附到抛错对象（`err.log`） |
| `src/renderer/hooks/useSkills.js` | `updateSource` 不变（错误经 waitForJob 抛错带 log） |
| `src/renderer/components/skill/SkillTable.jsx` | 组头 meta 展示 version（sourceType · version · sourceUrl） |
| `src/renderer/pages/Skills.jsx` | 更新成功行内提示（actionSuccess 态，含版本号）；失败展示 actionError + log 区块 |
| `src/renderer/i18n/zh-CN.json / en-US.json` | 补成功提示/失败 log 标题等键（`version` 键已有） |

### 10.3 数据流

- **version**：`scanSourceDir(sourceDir)` → 读 `sourceDir/package.json` 的 `version`；
  null/缺失 → git 源 `execFile("git",["rev-parse","--short","HEAD"])`（只读）→ local 源 null。
- **log**：`runUpdateJob(job)` → `execFileAsync("git",["-C",dir,"pull","--ff-only"])`
  的 stdout/stderr 捕获 → 成功写 trim 输出或 null，失败写 stderr（原样，非翻译）→
  终态 `getJob` 返回 `{id,status,error,log}` → `waitForJob` 失败时 `err.log = job.log` →
  UI 失败区块渲染。

### 10.4 接口契约

| 接口 | 变化 |
|---|---|
| `GET /api/skills` 组对象 | `+version: string \| null`（其余不变） |
| `GET /api/skills/jobs/:jobId` | `+log: string \| null`（终态才有值；pending/running 为 null） |
| `POST /api/skills/:slug/update` | 不变（`{jobId}`；local → 400 E8） |
| `useSkills.updateSource` 抛错对象 | `+log`（错误时带本次 git 输出） |

### 10.5 关键决策

- **D1 版本来源 = package.json 读取**（非 git 操作）：用户确认"package.json 中应该包含"。
  读文件即可，git rev-parse 仅作 fallback（git 源无 version 时）。
- **D2 log 仅失败展示、不持久化**：用户确认；job 内存态随 job 生命周期消亡。
- **D3 成功反馈 = 行内提示**（沿用 actionError 卡片形态加 actionSuccess），非 toast——
  本应用无 toast 惯例（ModeToolbar 显式避免）。
- **D4 local 源 E8 行为不动**：更新按钮本就不对 local 渲染（SkillTable 仅 git），无用户暴露面。

### 10.7 安全/性能/可观测性

- version/log 均为只读操作（读 package.json / git rev-parse / git pull 输出），无新信任边界。
- `git rev-parse` 在扫描路径每 git 源最多一次（`listSkillGroups` 同步扫描，量小）。
- log 捕获不落盘、不持久化，无泄漏面。

## 11. 测试决策（含覆盖接缝）

### 11.1 覆盖接缝

| 块 | seam | 载体 |
|---|---|---|
| B1 | API（startServer 全栈，skillLibrary.test.js 先例） | `tests/capabilities/skill-management/skill/<story>/api/` 新测试：version 字段四态（git 有 version / local 有 version / local 无 version / git 无 version fallback 哈希） |
| B2 | API（job 终态含 log）+ 组件（UI 失败展示） | job log 断言：失败 job 返回 log；`waitForJob` 抛错带 log；UI 失败区块（组件测试） |
| B3 | 组件/E2E | 成功提示可见 + 版本刷新（组件或 E2E） |

- 既有 `skillLibrary.test.js`（REQ-SKILL-015/016/017）零改动全绿硬约束。
- fixture：临时技能库（mattpocock nested 布局先例）+ 临时 git 仓 fixture。

## 12. 范围外

- local 源自动更新能力（E8 不变）。
- 持久化历史 log / 更新历史列表。
- install 的 log 展示（i18n 键已有，不属本 story）。
- 技能列表分页/搜索（既有）。

## 13. 补充说明

- i18n 已有 `version`（"版本"）键，可直接用于组头 label；`installLogTitle` 等键为
  预置未用，本 story 复用命名风格新增 `updateLogTitle`/`updateSuccess` 等。
- 复现基线：`requestSourceUpdate("charonX-workflow")` → success（git pull 无新提交）。
- 本 story 承接 `2026-07-29-multi-agent-skills` 的技能功能，不触碰其已签核 REQ。

## 14. PRD 完整性自检查

- [x] 三个稳定块各有 happy path（§6.1 步骤 1/2/3）
- [x] 涉及字段有验证规则（§7 version/log 类型 + fallback）
- [x] 每块有预期值锚点（§6.3 快照实证 7 行）
- [x] 失败场景覆盖（§8：package.json 坏/rev-parse 失败/更新失败/超时）
- [x] 复杂度 simple（§9，理由充分）
- [x] §10 高层方案完整（模块表/数据流/接口契约/决策/安全）
- [x] §11 seams 每块 ≥1 可测载体
- GAP：无悬空（B1/B2/B3 全就地；移动块在 §5；范围外在 §12）
