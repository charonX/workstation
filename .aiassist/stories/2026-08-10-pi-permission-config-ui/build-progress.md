# Build Progress — 2026-08-10-pi-permission-config-ui

> 阶段：BUILD（门 1 已签核，b343ee2）
> REQ：REQ-AGENT-059~069（requirements v1，hash 4b944146）
> 测试契约：4 文件（api 3 + e2e 1），ASSERTIONS-SIGNED: true，实现者只读

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-060/061/068 | permissionConfigService 服务层：merge 纯函数（对齐 mergeUnifiedConfigs）+ 元数据注入（BASH_RULES→family/label）+ zod 校验（validateWithGotgenes）+ 原子写 + 项目路径解析 | — | pending |
| 2 | REQ-AGENT-059/060/061/063-068 | HTTP 路由 GET/PUT /api/projects/:id/permission（挂 projects.js 子路径分发） | 1 | pending |
| 3 | REQ-AGENT-059-066 UI | renderer 权限配置页签（PermissionConfigTab：继承视图面板/JSON 模式/面板状态↔项目 JSON 转换）+ ProjectDetailModal 接线 | 2 | pending |
| 4 | REQ-AGENT-059-068 E2E | E2E 接线跑绿 + 全量回归（单测 + 既有 E2E 水位不退） | 3 | pending |

## 关键 seam 契约速记（供子代理简报引用）

- 服务层：`src/services/permissionConfigService.js`（新）——导出 `getPermissionView` / `savePermission` / `mergeUnified`（纯函数）/ `validateWithGotgenes`。
- merge 语义 = gotgenes `mergeUnifiedConfigs`（顶层标量 `??`、数组替换、permission 面 `mergeFlatPermissions` 深浅合并）——对照测试 8 用例锁死。
- 全局基底 = `agent-policy/pi-permission-config.json` 原文（GLOBAL_POLICY_PATH 同源）。
- 元数据注入：`policyRules.js` BASH_RULES（pattern/family/decision）→ 部署 JSON pattern 对齐 → family/label/readable。
- 校验：gotgenes `validateUnifiedConfig`（config-loader.ts，jiti 加载）——保存拦截 = 运行时 fail-closed 一致。
- 原子写：tmp + rename（同目录）。
- 路径：projectId → projectService.localPath → `.pi/extensions/pi-permission-system/config.json`；realpath containment（pathUtils 复用）。
- API：GET → `{global, project, merged, rules[]}`；PUT body=项目 JSON → 200 `{saved, mtime}` / 400 `{code:"E-PERMISSION-INVALID", issues:[{path,message}]}` / 404 `E-PROJECT-NOT-FOUND`。
- renderer：`src/renderer/api/projects.js` 加 getProjectPermission/putProjectPermission；`ProjectDetailModal.jsx` 加权限 tab；新组件 `PermissionConfigTab.jsx`（+ CSS）。
- locator 契约（E2E）：`[data-perm-tab]` / `[data-testid='perm-empty-state']` / `[data-testid='perm-create-btn']` / `[data-perm-mode='vis'|'json']` / `[data-testid='perm-save-btn']` / `[data-rule-row='permission.bash.rm *']` / `[data-testid='perm-error-banner']` / `[data-testid='perm-json-editor']` / `[data-override-badge]` / `[data-testid='perm-save-hint'|'perm-saved-hint']`（宽松）。
- 评估 seam（REQ-AGENT-069）：`permissionPolicy.createPolicyEvaluator({cwd})` 每次新建读项目文件（permissionEvaluation.test.js）。

## Slice 记录

（每个 slice 完成后追加：实现 commit、测试结果、PRD→代码 可追溯性表、refactor 结果）

### Slice 2：HTTP 路由 GET/PUT /api/projects/:id/permission（commit 8201094）

- 实现：`src/http/routes/projects.js` handleProjects 新增 `pathParts.length === 2 && pathParts[1] === "permission"` 分支——GET → `permissionConfigService.getPermissionView(projectId)` → 200 `{global, project, merged, rules}`；PUT → `savePermission(projectId, body)` → 200 `{saved, mtime}`；其他方法 → 404。错误响应按契约形态（tech-design §3.1/3.2）在分支内显式构造（`permissionError` 辅助，顶层 `code` 字段）：404 `E-PROJECT-NOT-FOUND` / 400 `E-PERMISSION-INVALID`（err.issues 透传） / 500 `E-PERMISSION-WRITE`；不改 `mapError` 既有行为。
- 附带（Rule 0.5 唯一例外，2 文件）：`src/http/server.js` parseBody reject 分支——非法 JSON 语法对 `PUT /api/projects/:id/permission` 按契约映射 400 `E-PERMISSION-INVALID` + issues（REQ-AGENT-068 标准 1；否则上游 catch → 500 INTERNAL_ERROR 与契约冲突）；其余资源 rethrow 保持既有 500 行为不变。不改服务层。
- 测试：`node --test tests/capabilities/agent-dialogue/conversation-space/2026-08-10-pi-permission-config-ui/api/permissionConfig.test.js` → **16/18 绿**（S1 后全红 404 → 接线后 16 转绿；2 红为测试契约与实现语义冲突，见下「裁决」）。回归：projectAgents/project/projectSkills 三个同 seam 测试文件 44/44 绿。
- refactor：无（Slice 2 为薄路由接线 + 一个 scoped 错误映射，无重构面）。

#### Slice 2 裁决补录（2026-08-10，人裁决 ×3 + PRD 对齐缺口修复）

测试契约修正（commit 30d49f6，测试作者按裁决更新）：
- 裁决 ①（Slice 2 concern ①）：未知字段保留由 **renderer 视图转换**承担（tech-design §4.3，前端合入后发合并 payload），服务端原样写——066 标准 3 语义修正为 **permission 面内自定义字段保留**（`customSurface`，schema 合法）→ 绿。
- 裁决 ②（Slice 2 concern ②）：`{permission:{bash:"ask"}}` 是 gotgenes schema **合法**形态（surface 级字符串 = `{"*": action}` 简写）——068 标准 2 改用真正非法语料（action 枚举外 `write:"bogus"`）→ 绿。
- 裁决 A（PRD 对齐缺口 1，P0）：顶层未知键（unifiedConfigSchema strictObject）会让 gotgenes 运行时**整集 fail-closed**（`{config:{}}` → 全规则集回落 ask = 保存即全禁）——保存侧拒绝（400 E-PERMISSION-INVALID + issues，路径含顶层键名）；permission 面内自定义 surface/pattern 保留放行。**066 新增标准 5**（顶层未知键 → 400 + 文件未变）→ 绿。

服务端修复（commit 见 Slice 2 实现提交，`[build] fix: 保存侧拒绝顶层未知键（裁决 A）+ E2 错误形态/顺序 + 观测日志 + E4 降级 (REQ-AGENT-066/068)`）：
- 裁决 A 落地：`savePermission` 校验判定（validateWithGotgenes）不变；`validationIssues` 不再 filter 掉 `unrecognized_keys`——顶层未知键进入 issues（path 由 zod `issue.keys` 合成，如 `customTopLevelKey`），permission 面内自定义键（z.record）天然不产生 issues；删除死代码 `isUnrecognizedKeyIssue`；修正「运行时忽略」不实注释。
- 缺口 2（P1）：`fs.mkdirSync` 移入 try/catch → 目录不可写 E-PERMISSION-WRITE（不再裸抛 → 500 VALIDATION_ERROR）；`assertProjectConfigContained` 移到 mkdirSync **之前**（防 symlink 逃逸时在项目外创建目录的副作用）。
- 缺口 5（P1）：三态日志 `permission.save {projectId, mtime? | issues? | error}`（成功 console.log / 校验失败 / IO 失败 console.warn，前缀 `[permissionConfig]`）；family 对齐失败（BASH_RULES 无匹配）→ 「未分组」+ `permission.meta-mismatch {pattern, family:null}` 警告（tech-design §6.3/§7；不再回落到 surface 名——当前部署 JSON 的 `permission.bash.*` 兜底即此例）。
- 缺口 3（P2，E4 降级）：`loadGotgenesValidation` 加载失败 → 降级 JSON.parse 语法级校验（`permission.validation-downgrade` 警告，不抛 500）：语法对 → 放行，非 JSON 对象 → 400 E-PERMISSION-INVALID（PRD §6.2 E4）。
- 缺口 7（docs）：本文件记录更新。

测试：`permissionConfig.test.js` **19/19 绿**（18 + 066 标准 5）+ `permissionMerge.test.js` **8/8 绿**。

#### PRD→代码 可追溯性表（Slice 2）

| PRD/REQ | 路由（src/http/routes/projects.js） | 服务（S1） | 测试（permissionConfig.test.js） | 状态 |
|---|---|---|---|---|
| B1 / REQ-AGENT-059（API 面） | GET permission 分支 | getPermissionView | GET「无配置项目 GET 正常 project:null」 | COVERED（UI 页签面属 Slice 3） |
| B2/B3 / REQ-AGENT-060/061 | GET permission 分支 | getPermissionView（merge+元数据注入） | GET 5 用例（global 原文/family/label/继承态） | COVERED |
| B4/B5/B6/B7 / REQ-AGENT-062~065 | PUT permission 分支 | savePermission | PUT 保存用例（最小覆盖集/write/path/authorizerChain/开关） | COVERED（062 UI 组面 Slice 3） |
| B8 / REQ-AGENT-066 | PUT permission 分支 | savePermission（原样写，ADR-022） | 标准 4「取消覆盖=删除」绿；标准 3「permission 面内自定义字段保留」绿；标准 5「顶层未知键 → 400」绿（裁决 A） | COVERED |
| B9 / REQ-AGENT-067 | PUT permission 分支 | savePermission | 首次保存 2 用例 | COVERED |
| B10 / REQ-AGENT-068 | PUT + server.js 解析错误映射 | savePermission（validateWithGotgenes） | 标准 1（非法 JSON）绿；标准 3（对照）绿；标准 2（action 枚举外）绿 | COVERED |

#### Slice 2 原 2 红 → 已裁决关闭（详见上方「Slice 2 裁决补录」）

1. ~~REQ-AGENT-066 标准 3 红（customOrgKey 保留）~~：语义修正为 permission 面内自定义字段保留（renderer 视图转换承担未知字段保留，服务端原样写）→ 绿 + 新增标准 5（裁决 A）。
2. ~~REQ-AGENT-068 标准 2 红（bash 字符串拒绝）~~：语料修正为 action 枚举外（`{permission:{bash:"ask"}}` 是 gotgenes schema 合法简写）→ 绿。

### Slice 3：renderer 权限配置页签（commit 2b87ead）

- 实现（4 文件 + 2 新文件）：
  - `src/renderer/components/project/PermissionConfigTab.jsx`（新）+ `PermissionConfigTab.css`（新）：继承视图（family 分组 + 全局默认只读列「出厂默认」+ 项目值列 allow/ask seg + 跟随全局/项目已改标记 + 组头覆盖徽标）、path/外部目录列表编辑器（全局条目只读 + 项目条目增删 + 空/重复就地提示）、authorizerChain/piInfrastructureReadPaths 链编辑（数组整体替换，ADR-022）、开关组（yoloMode/debugLog/doublePressToConfirm/permissionReviewLog/预览长度数值）、JSON 高级模式（原样提交 + 自定义字段保护提示条）、校验错误条（400 issues 路径定位）、空态（未配置 → 新建配置进入已配置态，文件在首次保存时生成）、继承说明脚注（「项目只覆盖你改的条目，未改的继承全局」）。
  - 视图转换纯函数（tech-design §4.3/§6.6，模块级导出供 harness 断言）：`buildProjectJson`（覆盖项写入 / 跟随全局项不写=删除 / rules 之外键从原 project JSON 保留）、`overridesFromRules`（面板初始化 = projectOverridden 全量 → 未改动行保存时原样写回 → permission 面内自定义字段自动保留，裁决 ① 落地）、`overridesFromProjectJson`（json→vis 切换重推导）、`segmentsOf`（key 路径解析：pattern 含点/空格安全）、`groupRules`。
  - `src/renderer/api/projects.js` 追加 `getProjectPermission`/`putProjectPermission`。
  - `src/renderer/api/client.js`（唯一共享文件改动，纯增量）：错误响应透传修正——权限端点错误响应带**顶层 `code` 字段**（tech-design §3.2，非 mapError 的 `error` 字段，原 client.js 只读 `err.error` → permission 端点 code 丢失）+ `issues` 透传（400 E-PERMISSION-INVALID 路径化校验错误，UI 错误条定位用）。`err.code ?? err.error` 保持既有 mapError 行为不变。
  - `src/renderer/components/project/ProjectDetailModal.jsx`：新增「权限配置」页签（`[data-perm-tab]`，activeTab === "permission" → 渲染 `<PermissionConfigTab projectId={projectId} />`）。
- 验证：
  - `npx vite build --config vite.renderer.config.js` 通过；`oxlint` 干净。
  - 组件自验 harness（`.agent-home/slice3-harness/`，已 gitignore 不提交）：真实 HTTP server（startServer）+ 真实临时项目 fixture + vite dev server + playwright chromium，驱动组件全链路。**30/30 PASS**：空态/新建按钮/继承说明文案/模式按钮/rm * 行渲染/全局列只读/跟随全局无高亮/seg 切换→徽标计数 1+行高亮+项目已改+dirty 提示/保存→真实落盘断言（最小覆盖集只含 rm *:allow、未覆盖不落盘）/保存后 reload 高亮保留/JSON 模式文本区（含 rm * 覆盖）/JSON 语法错→错误条不落盘/schema 非法（write:bogus）→错误条 issues 路径 permission.write/顶层未知键→400 拒绝（裁决 A）/取消覆盖→保存→文件 rm * 删除（ADR-022）/JSON 写 customSurface→面板改 yoloMode 保存→**customSurface 仍保留**（裁决 ① 关键断言）。
  - S1/S2 API 回归：`permissionConfig.test.js` 19/19 + `permissionMerge.test.js` 8/8 = **27/27 绿**（renderer 改动不影响）。
- 修复（自验发现，提交前）：保存成功提示被 `reload()`（applyView 清 savedHint）吞掉 → 调整为先 reload 再置 savedHint（E2E 宽松断言 perm-saved-hint 依赖此修复）。
- refactor：无（新组件 + 2 文件接线 + client.js 增量，无重构面）。

#### PRD→代码 可追溯性表（Slice 3）

| PRD/REQ（UI 面） | 组件/API 封装（renderer） | E2E（permissionConfig.test.cjs） | 状态 |
|---|---|---|---|
| B1 / REQ-AGENT-059（页签入口 + 空态） | ProjectDetailModal `[data-perm-tab]` + PermissionConfigTab 空态 `perm-empty-state`/`perm-create-btn` | test 1（空态 + 新建按钮） | COVERED |
| B2 / REQ-AGENT-060（全局只读基底 + 出厂默认标注） | 规则行全局默认列（pill + 「出厂默认」，无编辑控件） | test 2（全局列只读） | PARTIAL（见偏差 1：E2E 行级 count 断言过宽） |
| B3 / REQ-AGENT-061（继承视图：跟随全局/项目已改） | 项目值列（跟随全局 italic / 覆盖高亮 + 项目已改 + reset-chip）、组头覆盖徽标 `[data-override-badge]` | test 2/3（行可见 + 徽标） | COVERED |
| B4 / REQ-AGENT-062（bash 高危族分组 + seg 切换） | family 分组渲染（删除文件/提权/进程/磁盘/强制推送/全局安装…）+ `[data-perm-seg]` allow/ask | test 2/3（rm * 行 + 允许切换 + 徽标 + 保存提示） | COVERED |
| B5 / REQ-AGENT-063（工具级裁决 + 兜底） | tool 组（read/write/edit/create/delete/ls/grep/find/CLI 工具 + `*` 兜底）seg | —（API 面已绿） | COVERED（UI 面无专项 E2E，harness 覆盖） |
| B6 / REQ-AGENT-064（path/外部目录列表编辑器） | PathEditor（全局只读 + 项目增删 + 空/重复就地提示） | —（API 面已绿） | COVERED（UI 面 harness 间接覆盖） |
| B7 / REQ-AGENT-065（authorizerChain + 开关 + 继承说明） | ListEditor（整体替换 + 跟随全局 reset）+ toggle/数值行 + 脚注文案 | test 6（继承说明文案正则） | COVERED |
| B8 / REQ-AGENT-066（JSON 单向同步） | JSON 模式 `perm-json-editor`（原样提交）+ 自定义字段保护提示条 + 视图转换（permission 面内保留/顶层未知键由服务端 400） | test 4（JSON 文本区） | COVERED |
| B9 / REQ-AGENT-067（首次编辑时生成） | 空态 → 新建配置进入已配置态（首次保存生成文件，B9 语义） | test 1/2（空态 → 建配置 → 行可见） | COVERED |
| B10 / REQ-AGENT-068（校验 fail-closed UI 面） | `perm-error-banner`（message + issues 路径列表）+ 客户端 JSON 语法预检 + client.js code/issues 透传 | test 5（非法保存 → 错误条） | COVERED |

#### 与 UX 原型（permission-config.html）的已知偏差

1. **跟随全局行也渲染 seg（允许/询问双按钮，未选中态）**——原型跟随全局行只有「跟随全局」文字、覆盖行才有 seg。实现取舍：seg 常驻是 allow/ask 切换的交互入口（原型的静态 mock 未表达「如何从跟随全局变为覆盖」）；覆盖态按钮高亮 + 「项目已改」。由此产生 **E2E test 2 行级 `input, select, [data-perm-seg]` count=0 断言必失败**（行内项目列有 seg；该断言本意是「全局列只读」——全局列实际无任何编辑控件，harness 已按全局列 cell 断言通过）。test 2 与 test 3（点 seg 允许）locator 互相矛盾，**S4 接线时按 test-gap 处理**（建议 E2E 断言改为定位全局列 cell）。
2. **空态与继承视图同屏**：空态为顶部横幅（未配置时）+ 规则行全量渲染（全跟随全局）在下；原型为空态替换视图。取舍：E2E test 2 首条断言「rm * 行可见」在空态下要求行存在；且「全跟随全局」形态本身就是继承视图的有效展示（B3 语义）。「新建配置」= 隐藏横幅进入已配置态（文件仍首次保存时生成，原型 mock 的「立即生成」为示意）。
3. **JSON 空态内容**：未配置项目切 JSON 显示 `{}`（合法 JSON，保存即生成最小文件），原型用 JS 注释占位（非法 JSON，保存必 400——不采用）。
4. **authorizerChain 展示**：原型为链式箭头行（仅示意）；实现为可编辑列表（add/remove + 箭头连接 + 跟随全局 reset），对齐「数组整体替换」语义（REQ-AGENT-065 AC1）。
5. **自定义字段提示条文案**按裁决 A 修正：permission 面内自定义保留 + 顶层未知键会被保存拦截（原型文案写于裁决 A 之前，未区分两层）。
6. **文案直写中文**（E2E 断言契约先例，Assistant.jsx 同款）；i18n en-US 直译观感入 REFLECT。

#### Slice 3 备注（供 S4 接线）

- E2E 需 `rebuild:electron` + 全量接线，本 slice 以组件自验（30/30）+ vite build 为准；E2E 文件未跑（S4 统一）。
- E2E test 2 的 locator 矛盾（见偏差 1）与「空态下行可见」（偏差 2 已满足）在 S4 需测试作者按 test-gap 流程确认。
- `permission.bash.*`（bash 兜底 pattern）family 为「未分组」+ `permission.meta-mismatch` 警告——S2 已记录的设计行为（BASH_RULES 无该 glob），非本 slice 回归。

#### Slice 3 PRD 对齐裁决补录（2026-08-11，人裁决 ×4，commit 见下）

PRD 对齐子代理（S3）报告 8 缺口，人裁决 4 项需实现侧改动；测试契约由 S4 测试作者更新（E2E test 2 locator 改定位 `[data-global-cell]` + 补用例），本补录不碰测试文件：

1. **缺口 6（P2，E6 坏文件 projectInvalid 信号）→ 裁决：本期补**。
   - 服务端：`readProjectConfig` 返回区分信号 `{config, invalid}`（坏文件 invalid:true，缺失 invalid:false）；`getPermissionView` 响应加 `projectInvalid`（坏文件 true）；E-PROJECT-NOT-FOUND 语义不变。
   - renderer：`projectInvalid === true` → 显示坏文件提示「配置文件已损坏，已按全局默认处理——重新保存可修复」（`[data-testid='perm-invalid-banner']`，错误色），替代「未配置」空态；进入已配置态（规则行 + 保存入口可用，保存即覆盖修复）。
   - docs：tech-design §3.1 GET 契约补 `projectInvalid` 字段说明。
2. **缺口 4（E5 自定义字段只读标记 vs 实现可编辑行）→ 裁决：接受现状**。permission 面内自定义字段以普通可编辑行渲染保持不变；prd.md E5 行与 B8 中「标记「自定义字段」只读展示」→「以可编辑行呈现（B5 全量面板化语义）」；顶层未知键仍保存拒绝（裁决 A 不变）。
3. **E2E test 2 全局列 locator（行级 count 断言与 test 3 矛盾）→ 裁决：改测试定位**。实现侧配合：全局默认列 cell 加 `[data-global-cell]` 属性（S4 测试作者将 test 2 断言改定位到它；实现侧不改测试）。
4. **缺口 7（key 协议含点 surface 误解析）→ 裁决：防御**。服务端 `savePermission` 拒绝 permission 面含点 surface 键（400 E-PERMISSION-INVALID，issue 提示「surface 名含点不支持」）——permission 面是 z.record（schema 接受含点键，实证），需协议层补拦；只拒段内含点的 surface 键，pattern 键（`permission.bash."rm *"` 等）不受影响。测试（S4 补）：含点 surface → 400 + 文件未变；`bash."rm *"` 类正常键照常保存。

验证：`permissionConfig.test.js` 19/19 绿（新增 `projectInvalid` 字段未破坏 GET 断言——既有用例均为字段级断言，无整响应 deepEqual）+ `vite build` 通过 + slice3-harness 30/30 基线全绿（新增坏文件分支断言后 38/38）。

### Slice 4：E2E 接线 + 全量回归（commit 见下）

- 测试契约修正（test-gap 就地补全，人裁决 ①②，断言语义不变）：
  - **test 2 locator 修正（人裁决 ①）**：全局列只读断言改定位 `[data-global-cell]` cell
    ——实现全局默认列 cell 已加该属性；项目值列 seg 常驻是 allow/ask 切换交互入口
    （S3 偏差 1，行级 count 断言与 test 3 locator 自相矛盾）。断言内容不变：全局列无
    input/select/seg。另补 REQ-AGENT-062 AC1 组内行断言（destructive-fs 组头「删除文件」
    可见 + 组内含 rm * 行）。
  - **新增 4 用例（人裁决 ②，证据可复现）**：
    - REQ-AGENT-063：工具级 write 行可见 + 全局默认值（询问 ask）→ 切「允许」→ 项目已改
      → 保存 → .pi 文件 `write:"allow"` + GET source:project → 取消覆盖（跟随全局）→ 保存
      → 文件字段删除 + GET 回落全局（AC2/AC3）。
    - REQ-AGENT-064：path 组全局 `*` 只读基底 + 添加控件 → 添加 `src/**` → 保存 → 条目渲染
      + 文件含条目 → 删除 → 保存 → 条目消失 + 文件同步删除（AC1/AC2/AC3）。
    - REQ-AGENT-065：yoloMode 开关（aria-pressed 翻转）+ authorizerChain 添加授权器 →
      保存 → 文件 `yoloMode:true` + `authorizerChain` 整体替换 + GET merged（AC1/AC2）。
    - REQ-AGENT-060 E6（2026-08-11 人裁决落地）：项目 .pi 写坏 JSON → `perm-invalid-banner`
      可见（而非「未配置」空态）→ 改规则保存 → 文件修复为合法 JSON 且含覆盖值，坏文件
      提示消失。
- 测试结果：
  - 本 story E2E（rebuild:electron + playwright）：**9/10 绿**（059/060/061/062/063/065/066/068/
    E6 坏文件）；1 红 = REQ-AGENT-064 path 增删——**实现缺陷（见下「S4 发现的实现缺陷」），
    非测试问题**，红 = 缺陷证据。
  - E2E 全量：**178 绿 / 1 红（179 用例）**——既有水位 169 用例全绿不退；红仅本 story 064。
  - 单测全量（rebuild:node + node --test）：**727/727 绿（697 既有 + 本 story 30：permissionConfig
    19 + permissionMerge 8 + permissionEvaluation 3）**。首跑 hydrationCooling 用例 afterEach
    ENOTEMPTY 清理竞态（mtime 窗口环境性 flake，`pi-hydration-*`/`pi-bug3-*` 临时目录），复跑
    全绿 727/727——非本 story 引入。
- refactor：无（本 slice 只动 E2E 测试文件）。
- ABI：E2E 用 rebuild:electron 跑通后，单测 rebuild:node——终态 node（按顺序执行完毕）。

#### S4 发现的实现缺陷（REQ-AGENT-064 UI 面，报告父代理裁决，本 slice 未改实现）

**症状**：path 白名单 UI 添加条目 → 保存成功提示出现（`perm-saved-hint`）→ 条目未渲染、
文件未含该条目（E2E 红 + 确定性复现）。

**根因**：`PermissionConfigTab.jsx` `buildProjectJson` 的 known-gate——
`for (const [key, value] of Object.entries(overrides)) { if (!known.has(key)) continue; … }`——
`known` = GET rules 的 key 集，而服务端 `buildRules` 只产出 merged 中**已存在**的键。PathEditor
新增条目键 `permission.path.<pattern>`（fresh 项目 merged 无该 pattern）不在 known →
保存 payload 丢弃该覆盖 → PUT `{}` → 200 落盘 `{}` → reload 后条目消失。authorizerChain /
yoloMode 不受影响（键已在 rules 中——E2E 065 绿实证）。

**证据**（确定性复现，rebuild:node 后直连真实服务）：
```
GET rules 含 permission.path.src/** ? false
面板保存 SKIPPED: permission.path.src/**
PUT status: 200
落盘内容: {}
```
+ E2E 失败截图（保存提示可见、path 列表仅剩全局 `*` 条目、添加输入框已清空=add 已执行）。

**影响面**：REQ-AGENT-064 AC2（添加 → 保存 → 文件含条目）/ AC3（删除 → 保存 → 文件删除）
UI 面失效；`external_directory`（同构 PathEditor）同受影响；API 面不受影响（PUT 直接携带
条目 → 服务端原样写，permissionConfig.test.js 064 用例绿）。

**修复方向（待父代理裁决）**：known-gate 放行列表编辑器生成的键（如 `permission.path.` /
`permission.external_directory.` 前缀的 overrides 键，或改为「overrides 中所有键都写」——面板
overrides 只含面板交互产生的键：seg/toggle/数值/链/列表新增，无任意键风险面）。

#### PRD→代码 可追溯性表（Slice 4 最终版）

| PRD/REQ | 实现（路由/服务/renderer） | E2E（permissionConfig.test.cjs） | API/单测 | 状态 |
|---|---|---|---|---|
| B1 / REQ-AGENT-059 | ProjectDetailModal `[data-perm-tab]` + 空态 | test 1（页签 + 空态 + 新建按钮） | GET project:null | COVERED |
| B2 / REQ-AGENT-060 | GET global 原文 + 元数据注入 + 全局列只读 | test 2（全局列 `[data-global-cell]` 无编辑控件）+ test 10（E6 坏文件） | GET 5 用例 + E6 | COVERED |
| B3 / REQ-AGENT-061 | 继承视图（跟随全局/项目已改） | test 2/3 + test 6 文案 | merge 对照 8 + GET 继承态 | COVERED |
| B4 / REQ-AGENT-062 | family 分组 + seg 切换 | test 2（组内行）+ test 3（切换→徽标→保存） | PUT 保存 | COVERED |
| B5 / REQ-AGENT-063 | 工具级裁决组 + 兜底 | test 3/7（write 切换保存 + 取消覆盖回落） | PUT write:allow | COVERED |
| B6 / REQ-AGENT-064 | PathEditor 列表编辑器 | test 8（增删保存）——**红：实现缺陷待裁决** | PUT path 增删（API 面绿） | **DEFECT（UI 面）** |
| B7 / REQ-AGENT-065 | ListEditor 链 + 开关组 + 脚注 | test 9（开关 + 链整体替换）+ test 6（文案） | PUT 整体替换/开关 | COVERED |
| B8 / REQ-AGENT-066 | JSON 模式单向同步 + 视图转换 | test 4/5（JSON 文本区 + 非法拦截） | 标准 3/4/5 | COVERED |
| B9 / REQ-AGENT-067 | 首次编辑时生成（最小覆盖集） | test 1/2/3（空态 → 新建 → 行操作） | PUT 首次 2 用例 | COVERED |
| B10 / REQ-AGENT-068 | 校验 fail-closed（zod 复用） | test 5（非法 → 错误条） | 标准 1/2/3 | COVERED |
| B11 / REQ-AGENT-069 | 保存即生效（worker 零改动） | —（非 UI 面） | permissionEvaluation 3 | COVERED |

---

#### BUG-001（code-defect，2026-08-11 人裁决 → 修复完成）

**症状**：E2E REQ-AGENT-064 红——面板添加 path 条目 → 保存成功提示出现 → 条目未渲染、
文件未含条目（PUT 落盘空配置）。

**根因**：`src/renderer/components/project/PermissionConfigTab.jsx` `buildProjectJson` 的
known-gate——`if (!known.has(key)) continue`——`known` = GET rules 的 key 集，而服务端
`buildRules` 只产出 merged 中**已存在**的键；PathEditor 新增键
`permission.path.<pattern>` / `permission.external_directory.<pattern>` 不在其中 →
保存 payload 丢弃该覆盖 → PUT 200 落盘 `{}`。authorizerChain/yoloMode 不受影响（键已在
rules）；API 面不受影响（服务端原样写）。

**修复**（保守方案，前缀放行）：known-gate 对 `permission.path.` /
`permission.external_directory.` 前缀的 overrides 键放行（这两个前缀是面板交互唯一的新键
来源——PathEditor/ListEditor 交互产生，无任意键注入面）；其余未知键仍被 gate 拦截。
同时确认「新增条目保存后才渲染」UX：`handleSave` 保存后 `reload()` 重新 GET（列表源 =
GET rules），条目自然在保存后刷新出现——无需额外改动。

**回归验证**：
- 快速 API 级回归（`.agent-home/bug1-harness/build-project-json.test.mjs`，gitignored，
  先红后绿 Prove-It）：修复前 4/6（path/external_directory 新增键断言红 = 缺陷证据）；
  修复后 **6/6 绿**（含已知键照常写、未覆盖 known 键删除语义、$schema 保留、未知非前缀
  键仍拦截 4 项防回归断言）。
- `npx vite build` 通过。
- 本 story E2E 全量（permissionConfig.test.cjs）：**10/10 绿**（含修复前红的
  REQ-AGENT-064 增删保存）。

---

#### 构建产物契约 smoke（BUG-002 护栏，2026-08-11 06:37:08）

**结果：FAIL (no-require-shim, bundle-load)**

- ✅ build：vite build 成功；产物: agentRegistry.json, channelManager-BTHrtHm0.js, channelManager-DnerOb7g.js, main.js, server-Blt0_XLj.js, server-DvNWaOgw.js
- ❌ no-require-shim：产物含 require 兜底（jiti 被内联？）: channelManager-DnerOb7g.js:Calling `require`@1417
- ❌ bundle-load：加载失败（非 require 类，疑环境不匹配）: M.AsyncLocalStorage is not a constructor

（脚本：`.agent-home/build-smoke/smoke-main-bundle.mjs`，gitignored。重新运行：`node .agent-home/build-smoke/smoke-main-bundle.mjs`）
---

#### 构建产物契约 smoke（BUG-002 护栏，2026-08-11 06:49:01）

**结果：FAIL (no-require-shim, bundle-load)**

- ✅ build：vite build 成功；产物: agentRegistry.json, channelManager-BTHrtHm0.js, channelManager-DnerOb7g.js, main.js, server-BrWqE4RF.js, server-Dvqg9MKa.js
- ❌ no-require-shim：产物含 require 兜底（jiti 被内联？）: channelManager-DnerOb7g.js:Calling `require`@1417
- ❌ bundle-load：加载抛 require 错误（jiti 未 external？）: Calling `require` for "node:os" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.

（脚本：`.agent-home/build-smoke/smoke-main-bundle.mjs`，gitignored。重新运行：`node .agent-home/build-smoke/smoke-main-bundle.mjs`）
---

#### 构建产物契约 smoke（BUG-002 护栏，2026-08-11 06:56:20）

**结果：PASS**

- ✅ build：vite build 成功；产物: agentRegistry.json, channelManager-DnYlUdis.js, channelManager-nsCRxjW1.js, main.js, server-9lq_Da2s.js, server-CJeNkjgG.js
- ✅ no-require-shim：产物 5 个 js 均无 __require(（jiti 未内联）
- ✅ bundle-load：入口加载成功，顶层 import 链评估通过（最接近真实启动）

（脚本：`.agent-home/build-smoke/smoke-main-bundle.mjs`，gitignored。重新运行：`node .agent-home/build-smoke/smoke-main-bundle.mjs`）
---

#### BUG-002（code-defect，QA blocker：打包形态启动崩溃 → 修复完成）

**症状**：`npm start`（打包形态，.vite/build 产物）启动即崩：
`Error: Calling "require" for "node:os" in an environment that doesn't expose the "require" function`，
栈指向 `.vite/build/channelManager-*.js`（实际根因在主进程 bundle 内联的 jiti 代码）。

**根因**（已实证）：S1 服务层 `src/services/permissionConfigService.js` 顶层
`import { createJiti } from "jiti"`（加载 gotgenes TS 源码做校验）——jiti 是 CJS
（dist/jiti.cjs），rolldown 内联它时保留其内部 webpack chunk 的
`__require("node:os")` 等 require 兜底调用（CJS require-of-external 形态），而主
bundle 是 ESM（vite.main.config.js `formats: ["es"]`）无 require → 加载即崩。
对比：`vite.worker.config.js` 早就有 `/^jiti(\/|$)/` external（worker 用 jiti 从不
崩）——jiti 必须 external（运行期从 node_modules/asar 加载，内部动态
import/fs 加载 .ts 源码，不可内联）。为何 E2E 全绿：E2E 从 src 源码启动（vite
dev），从不加载 .vite/build 打包产物——「构建产物包含性是源码启动测试盲区」
（agentRegistry ENOENT 同源教训）。

**修复**（commit 见下）：`vite.main.config.js` `rollupOptions.external` 增加
`/^jiti(\/|$)/`（regex 覆盖子路径，对齐 worker 配置同规则 + 注释）。产物侧实证：
修复后主 bundle 保留 `import { createJiti } from "jiti"` 外部导入，无任何
`__require(`；server chunk 1,653 kB → 1,420 kB（jiti 不再内联）。jiti 在
package.json `dependencies`（electron-forge 打包 dependencies 进 asar）→ 运行期
可加载。仅加 jiti，未扩大范围（其余 external 保持原样；claude-agent-sdk 等 ESM
依赖走 ESM import 天然 external 化，不需要 require 兜底）。

**回归验证**（构建产物契约 smoke，`.agent-home/build-smoke/`，gitignored）：
- 新增 `smoke-main-bundle.mjs` 回归护栏：forge 等价配置真实构建（临时 outDir
  .agent-home/build-smoke/out）+ 断言产物无 `__require(` / `Calling `require`` +
  node 加载产物入口（electron stub 垫底，评估顶层 import 链，最接近真实启动）。
  **先红后绿**：修复前 → 产物含 `Calling `require`` 且加载抛
  `Calling `require` for "node:os"...`（与生产崩溃逐字一致）；修复后 → 产物无
  require 兜底 + 入口加载成功。
- 裸 `npx vite build --config vite.main.config.js --outDir .agent-home/build-smoke/raw-out`
  同样通过：产物无 `__require(`，jiti 保持外部 import。
- **为何 smoke 用 forge 等价配置而非裸命令**：forge 构建会 merge 进
  `resolve.conditions:['node']` + 全部 node builtin external（vite.base.config.js）；
  裸构建缺这些 → vite 把依赖里的 node builtin 替换成 `__vite-browser-external`
  空桩（实证：裸构建里 async_hooks 变空桩 → `new AsyncLocalStorage()` 崩，
  而旧 .vite/build 产物里是真 external import）——裸构建与生产产物语义不同。
  smoke 直接走 forge 的 `getConfig` 同一条代码路径。
- E2E 快速回归未跑（可选）：本修复只动主进程构建配置，源码形态（vite dev）E2E
  从不加载打包产物，跑 E2E 无法验证本修复；产物验证已由 smoke 承担。
