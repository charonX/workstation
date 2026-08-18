# 访谈笔记 — 2026-08-18-skill-update-diagnostics

> 触发：/bug 跨 story 路由（技能界面更新体验问题，用户拍板单开新 story）。
> 日期：2026-08-18。已完成的勘察事实与用户确认记录于此。

## 核心问题

技能源更新是黑盒：点「更新」无任何可见反馈；失败原因不可读（无 log）；技能组无
版本号可辨新旧。用户无法判断更新是否发生、为何失败。

## 已勘察事实（诊断输入）

1. **技能源清单**（~/charon/code/workspace/skills/）：
   | 源 | 类型 | package.json version | 能否自动更新 |
   |---|---|---|---|
   | charonX-workflow（loop-workflow 插件） | git | 0.24.0 | ✅ git pull --ff-only |
   | mattpocock-skills | local | 1.1.0 | ❌ E8 设计不支持 |
   | baoyu-skills | local | **无 version 字段** | ❌ E8 设计不支持 |
2. **复现（服务层）**：`requestSourceUpdate("charonX-workflow")` → job `status: success`。
   仓库干净、远程 https://github.com/charonX/workflow.git 可达。→ 更新机制本身没坏。
3. **根因（症状①）**：UI `handleUpdate` 成功路径无任何反馈（setBusySlug 一闪而过、
   无成功提示、无版本变化可辨）→ 用户感知为「点了没反应/无法更新」。真黑盒。
4. **job 模型缺口（症状②）**：`{id, status, error}` 无 log 字段；runUpdateJob 的
   git 输出（stdout/stderr）被 execFileAsync 丢弃，只翻译成一行错误文案。
5. **API 缺口（症状③）**：`GET /api/skills` 技能组无 version 字段；UI 无从展示。

## 用户确认（2026-08-18）

- Q1 现象：**点了无反应** → 坐实黑盒观感（非硬失败）。
- Q2 版本号：**package.json 中应包含** → 来源 = 技能源 package.json version
  （已验证：2/3 源有 version；baoyu-skills 无 → 需 fallback）。
- Q3 log：**仅失败时展示** → 失败时 UI 展开 git 输出；成功不展示。
- Q4 范围：**三合一全做** → ①更新反馈/可诊断 ②失败 log ③版本号展示，一个 story。

## 关键边界

1. local 源不支持自动更新是既有 E8 设计，**不改**——但错误文案要解释清楚为什么
   （比现在的生硬 400 更可读）。
2. 版本号来源 = 读 package.json（纯文件读取，非 git 操作）；无 version 字段 →
   git 源回落 commit 短哈希，local 源标「未知」。
3. log 仅失败时展示，不做持久化历史。
4. 更新机制本身（git pull --ff-only）不动，行为保持不变。

## 隐含假设

1. 用户判断「更新成功」的锚点 = 版本号/更新时间变化可见。
2. 失败 log 展示的是该次 job 的 git 输出（job 内嵌 log 字段，终态带出）。

## 矛盾/风险

1. baoyu-skills 无 version → 版本号展示必须有 fallback，否则该组永远显示空白。
2. 成功反馈的形态（toast？版本号高亮？）待 PRD 定——最小可行 = 更新后版本号
   （若有变化）可见 + 一条成功提示。

## 候选方向（单一方向，scope 明确）

### 方向 A：更新可诊断性三合一（确认）
- 技能组列表展示版本号（package.json version，fallback git commit/local 未知）。
- 更新成功 → 可见反馈（提示 + 版本号刷新可见）。
- 更新失败 → 展示失败原因 + 本次 git 输出 log（job 内嵌 log 字段）。
- local 源更新按钮 → 解释性提示（不改变 E8 行为）。
- 推荐度：首选（用户三合一全做拍板）。

## 确认方向（供用户 Yes/refine）

- Outcome: 技能源更新有可见结果——成功有反馈、失败有可读原因 + log、每源有版本号。
- User: 维护多个技能源的 workstation 用户。
- Why now: 技能源从 1 涨到 3，更新频繁，黑盒无法判断成败。
- Success: 点更新成功 → 版本号可见变化/成功提示；失败 → 原因 + git log；列表见版本号。
- Constraint: 版本号 = package.json 读取（含 fallback）；local 源 E8 行为不变；log 仅失败展示。
- Out of scope: 不改 local 源更新能力；不做持久化历史 log；不改 git 更新机制。

## 待确认问题
- [x] 症状①根因 = 黑盒无反馈（非硬失败）——用户确认「点了无反应」
- [x] 版本号来源 = package.json——用户确认；fallback 语义（无 version → commit/未知）未逐项拍板，归 PRD
- [x] log 展示时机 = 仅失败——用户确认
- [x] scope = 三合一——用户确认
