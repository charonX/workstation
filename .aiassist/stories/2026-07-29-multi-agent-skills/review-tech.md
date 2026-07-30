# Review 报告 — 多 Agent Skill 管理与分发 / tech

> 故事 ID：`2026-07-29-multi-agent-skills`
> 审查阶段：`tech`
> 日期：2026-07-29

---

## 审查摘要

- **总体结果**：**FAIL**
- **阻塞项数量**：1
- **重要项数量**：3（不阻塞但须在 crystallize 前就地补全）
- **建议项数量**：7

审查基于：prd.md v0.3、tech-design.md v0.1、research/vercel-skills-cli-capabilities.md、ADR-003/004/009/011 及索引、CONTEXT.md、STANDARDS.md、architecture.md，并对照实际代码核实（`skillService.js` 现有 junction 兜底/解析函数/job 模式、`settingsService.js:22` 默认 `skillRepoPath`、`db.js` 三表、`package.json` 已有 simple-git 依赖）。

方案整体质量高：D1（运行链路自持、库仅作 registry 数据源）有 spike 实证支撑（附录 A 三场景 + dist 行号），ADR-011 与 ADR-003/004 修订注记当天落地，模块边界干净，测试 seams 覆盖全部 9 个稳定块。但发现 **1 个语义级矛盾**（收敛扫描域与 PRD S5 用户流冲突）必须在结晶前修正，另有 3 个重要契约缺口。

---

## 审查项

| 维度 | 结果 | 说明 |
|---|---|---|
| 对齐 PRD | **FAIL** | 模块/数据流覆盖 S1–S9 全部稳定块；但 F3 收敛的"已关联"扫描域与 PRD §6 S5 用户操作流直接矛盾（F1）；PRD §8 的 E3/E4 是"spawn 库 CLI"时代的死错误码，未随 D1 反向同步（W1） |
| 模块边界 | PASS | agentRegistryService 是 registry 唯一入口、skillService 持全部 FS 语义、projectService 只做 CRUD+触发收敛，职责单一；同步脚本为构建期工具不进运行时，边界正确 |
| 接口契约 | WARN | HTTP/CLI 端点四要素大体齐全（错误码引 E1–E11、收敛结果有结构化 JSON）；但 skill 身份用裸 `skillName` 存在跨来源重名歧义（W2），local slug 冲突覆盖语义不对称且无防呆（W3）；`PUT /api/projects/:id` 响应结构变化未标注（S5） |
| 测试 seams | PASS | 主 seam HTTP API + FS 断言符合 STANDARDS「FS 副作用真实 I/O」；git 裸仓库 fixture、registry 固定快照、同步脚本 smoke、临时目录隔离均有无网络策略；capability/entity 归属（含新增 `skill-management/agent-registry`）明确 |
| 复杂度 | PASS | 无过度设计：快照 + 同步脚本是最简可行形态；spike 否决了更重/更轻的替代（spawn CLI、vendor 源码、全局 canonical）且证据充分；扫描不缓存是显性取舍 |
| 风险与回流点 | WARN | 风险表覆盖漂移/Windows/本地改动/slug 冲突，回退路径明确；但 `globalSkillsDir` 模板的**提取机制**未说明，是快照方案的主要实现风险（W4） |
| ADR 覆盖 | PASS | D1/D3/D5/D9 及外部条目语义已写入 ADR-011（含替代方案与后果）；ADR-003/004 修订注记双向链接；D2/D6/D7/D8 不满足 ADR 三条件（可逆转/实现细节），不需独立 ADR |
| ADR 冲突 | PASS | 遵守 ADR-009（快照惰性读、模板运行时展开、禁顶层 env）；CLI 对齐 ADR-001；E2E 对齐 ADR-002；删除三表符合 ADR-006 统一存储；junction 兜底复用现有 `skillService.js:572` 代码 |
| 术语一致性 | WARN | CONTEXT.md 未同步：Dependency Cascade 将废止、Skill 行代码映射（`skills` 表）将删除、Skill Symlink 定义过时；新词汇（技能库、agentTypes、收敛、外部条目）未登记；tech-design 内"技能库/repo/来源目录"三词混用（W5） |
| 标准/约定 | PASS | 符合 FS 副作用断言约定、命名约定（服务 Service 结尾、RESTful 路由）；`project skill link` 三级 CLI 子命令是对两级约定的扩展（S6）；删除实体同步清理 FS 的约定由 F5 级联删链满足 |

---

## 阻塞项

### F1（对齐 PRD，FAIL）：F3 收敛扫描域与 PRD S5 用户操作流矛盾

- **问题**：tech-design F3 写「保存 projects.agentTypes → 收敛：已关联 = 扫描项目**声明的** agent 目录中指向技能库的链」。收敛发生在保存**之后**，"声明"= 新集合。按此字面实现：
  - PRD §6 S5 操作流场景「增加 `cursor`、移除 `codex` → 保存」：codex 目录已不在新声明中，其中的链不会被计入"已关联"集合 → cursor 目录收不到任何补建链 → 然后"被移除 agent 目录的链被删"再把 codex 的链删掉。
  - 结果：**关联静默丢失**，而 PRD S5 明确要求「cursor 对应目录（registry 查得）出现全部已关联 skill 的软链、codex 独有链被删除」。
  - ※ 注记「收敛只保证已关联 skill 在新增 agent 目录有链」只有已关联集合非空时才成立，恰恰在最常见的"换 agent"场景下它是空的。
- **建议**：F3 明确收敛输入为**变更前 ∪ 变更后**的声明目录：先扫描并集建立已关联集合（realpath ∈ 技能库的链），再对新声明目录补建、对移除目录删链。这是一句话的修订，但不改就会结晶出错误的 REQ/测试。
- **建议动作**：就地修订 tech-design F3（不需要回流阶段；稳定块与初衷未变）。

---

## 重要项（须在 crystallize 前就地补全，不阻塞阶段）

### W1：E3/E4 死错误码未反向同步，且新增"系统 git 不可用"无错误态

- **问题**：PRD §8 的 E3（库 CLI 不可用，503 `SKILL_LIBRARY_UNAVAILABLE`）、E4（库 exit 0 但 `list --json` 核验不一致，500 `SKILL_LIBRARY_PARTIAL`）属于"spawn 库 CLI"方案。D1 已定运行时零库调用，这两个场景不复存在。tech-design 接口契约节写「错误码沿用 PRD E1–E11」未指出。同时自持 git 链路后，**系统 git 缺失/不可用**（simple-git spawn 失败）成为新的现实失败面，却没有对应错误态。
- **建议**：按"错误向上回"就地修订 PRD §8：删除 E4；把 E3 改造为「系统 git 不可用 → 503（如 `GIT_UNAVAILABLE`），技能库页显示不可用横幅」。tech-design 接口契约节同步一句说明。

### W2：skill 身份用裸 `skillName`，跨来源重名时关联 API 歧义

- **问题**：F4 `POST /api/projects/:id/skills {skillName}` 与 `DELETE .../skills/:name` 以裸名定位 skill。磁盘即真相后 skill 身份 = 来源 slug + 源内相对路径；两个来源含同名 skill（两个 repo 都有 `skills/helper`）是正常情形（ADR-003 保留 repo 一级实体的理由就是"一个来源含多个 skill"）。F6 项目视图可以靠 realpath 归因，但**关联动作**无法区分该链哪一个。
- **建议**：关联/取消关联请求体加 slug 限定（`{slug, skillName}` 或复合 id `slug/path`）；或在 F1 入库校验时强制"全库 skill name 唯一"、冲突拒绝。二选一，写进接口契约与 PRD §7。

### W3：local 来源 slug 冲突静默覆盖，与 git 语义不对称且无防呆

- **问题**：D5 零元数据；F2「重添加同名 slug = 清理后覆盖」是 local 更新的唯一途径。但 local 来源无任何凭据（git 能读 `.git` remote 比对同源），用户添加另一个 basename 相同的本地路径时会**静默覆盖**已入库 skill，所有项目软链指向瞬间变成另一个 skill 的内容。且 F1（git）冲突是"加后缀"、F2（local）冲突是"覆盖"，不对称也未说明理由。
- **建议**：local 添加时 slug 已存在 → 默认拒绝并提示（HTTP 409 + 冲突错误码），显式确认/强制参数才覆盖；或统一为加后缀。PRD §7 表单验证补一条，F2 同步。

---

## 建议项（实现/结晶阶段顺手处理）

### W4（风险）：`globalSkillsDir` 模板提取机制未说明

库里 `globalSkillsDir` 是模块加载时展开后的**值**（research §5：受 XDG_CONFIG_HOME、CODEX_HOME、CLAUDE_CONFIG_DIR 等 9 个 env 影响）。同步脚本要从"值"反推"模板"，可行做法是用 sentinel homedir/env 跑两次差分（或解析源码），但方案完全没写提取机制；运行时"环境变量白名单"展开是自研逻辑，与上游 agents.ts 的展开语义有漂移风险。建议 tech-design 补一小节：提取方法 + 快照中记录每个模板的展开依赖（哪些 env），快照 diff 审查时重点核对这些。

### S1：E11 校验应明确双向包含 + 路径归一

「不得重合」建议明确为：库路径与任何 agent 全局扫描路径互为**前缀包含**即拒绝（库在扫描路径之内、或扫描路径在库之内），比较前做 `~` 展开 + realpath + 大小写归一（macOS/Windows 大小写不敏感；注意 `/tmp`→`/private/tmp` 这类 symlink，spike 已踩过）。

### S2：建链名 `skillName` 的来源未定义

F4 目标 `<skillsDir>/<skillName>`：是 SKILL.md frontmatter 的 `name` 还是源内目录名？agent 按目录名发现 skill，frontmatter name 可含空格/大写/中文。建议明确：链接名 = 源内目录名（磁盘即真相的 natural choice），并在 F1 校验时拒绝目录名不合法（含路径分隔符等）的 skill。

### S3：resync 范围措辞对齐"已关联集合"

D7「幂等重建全部技能库条目」字面像"把全库 skill 都链上"，与 F3 ※「不自动关联新 skill」矛盾。PRD §6 S5 操作流的措辞是「全部**已关联** skill 按当前声明重建一次」——建议 D7/F5 沿用同一措辞，避免结晶出过度关联的 REQ。

### S4：settings 默认技能库路径的决策未记录

现有默认 `skillRepoPath: ~/.codex-harness/skills`（`settingsService.js:22`，旧产品命名）。PRD 写「默认应用数据目录下，如 `~/.opc-workstation/skills/`」。默认值是否更名、更名后旧目录已入库的 skill 怎么办（开发阶段可不迁移，但应写明"不迁移，用户重新添加"），方案未提。

### S5：`PUT /api/projects/:id` 响应结构变化未标注

保存项目端点将附加收敛结果（`{agents: [...]}`），这是对既有端点响应结构的 breaking change。应用内消费者可控，但接口契约节应显式注明"响应结构变更，renderer 项目编辑页与 CLI `project update` 需同步适配"。

### S6：CLI 三级子命令是对命名约定的扩展

CONTEXT.md 约定 `opc-workstation <entity> <action>` 两级；`project skill link/unlink/list/resync` 引入三级。可接受，建议顺势在 CONTEXT.md 登记约定扩展（或在crystallize 时定夺）。

### S7：级联移除扫不到"已从 workstation 删除但磁盘保留"的项目

F5 移除 = 扫 projects 表内所有项目的声明 agent 目录。项目从 workstation 删除后磁盘目录仍在，其中的链扫不到 → 断链残留（下次 agent 读到一个 dangling link）。磁盘即真相下可接受，建议写入 PRD §13 已知取舍，一句话即可。

---

## 已验证的积极点

1. **D1 有实证而非拍脑袋**：附录 A 三场景（单 agent 强制 copy / 多 agent 链向项目内拷贝 / overlap 跳过）带 dist 行号与 npm 版本钉（skills@1.5.20），且声明"发布版 dist 与 main HEAD 源码逐行核对"。这是本方案最重决策的合格地基。
2. **D9 安全边界直接封住最大风险面**：「我们建的链 target 必须 realpath ∈ 技能库；删除只作用于链，绝不递归删外部实体」——与 D4 外部条目语义闭环，`rm -rf` 的破坏半径被限制在 E11 保证的私有库内。
3. **磁盘即真相消除了历史病根**：BUG-009/011 的双写分裂靠 reconcile 补丁维持；三表删除后 `reconcileUserSkillRepos`（`skillService.js:236`）随表移除，分裂根源消失。PRD §1 问题陈述与方案自洽。
4. **ADR 纪律执行到位**：ADR-011 当天写就且含替代方案（spawn CLI / 全局 canonical / vendor 源码，各有否决理由）；ADR-003/004 用"修订注记"保留历史原文，索引状态同步更新——完全符合"ADR 是硬约束"的维护方式。
5. **复用面核实无误**：junction 兜底（`skillService.js:572`）、SKILL.md frontmatter 解析（`parseSkillMarkdown`）、job+event 异步模式（`startInstallJob`/`subscribeInstallJob`）、simple-git 已是依赖（`package.json:30`）、`skillRepoPath` 设置已存在——方案声称的"复用现有代码"全部属实，无虚构。
6. **E5 不静默降级为拷贝**是有意区别于库的行为（库 symlink 失败自动转 copy，research §6），避免了"磁盘即真相"下拷贝与链接语义混淆，决策合理。

---

## 结论

- [ ] 可进入下一阶段
- [x] **需修复阻塞项后重审**（F1 收敛扫描域）
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `BUILD`

**建议动作**：不需要回流重做任何阶段（初衷与稳定块未变）。在**同一会话或新会话就地修订**：

1. tech-design F3：收敛输入明确为变更前 ∪ 变更后声明目录（F1，阻塞项）。
2. tech-design 接口契约 + PRD §7/§8：W1（E3 改造、E4 删除）、W2（skill 身份加 slug）、W3（local slug 冲突防呆）三处就地补全。
3. W4 补模板提取机制说明；S1–S7 顺手吸收。
4. 修订后可不重开完整 review，由人在 crystallize 前确认上述点位即可；crystallize 前建议跑一次 `/domain-model` 同步 CONTEXT.md（W5）。

---

## 审查人决策记录

**决策**：（人填写）

**理由**：

**下一步动作**：
