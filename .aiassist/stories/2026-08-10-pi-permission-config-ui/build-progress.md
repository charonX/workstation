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
