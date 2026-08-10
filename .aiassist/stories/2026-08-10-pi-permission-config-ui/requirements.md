# Requirements — PI 权限策略可视化管理（Permission Config UI）

> 故事 ID：`2026-08-10-pi-permission-config-ui`
> 版本：v1
> 最后更新：2026-08-10
> 来源：`prd.md` v0.1（B1-B12）+ `tech-design.md` v0.1（接口 3.1/3.2、数据流 4、ADR-022 字段级覆盖语义）
> UX 参照：`ux/permission-config.html`（已 approved）
> 移动块 M1（克隆）/M2（审计）/M3（会话区入口）/M4（全局可编辑）留 PRD，不入 REQ。
> 技术事实（tech-design T1-T9）：字段级覆盖语义 / 保存即生效零自造 / zod 校验复用 / 元数据注入。

---

## REQ-AGENT-059 权限配置入口（B1）

- 优先级 P0 / 必须 / intra-module / PermissionConfigTab（renderer 项目详情弹窗）/ agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：项目详情弹窗（ProjectDetailModal）新增「权限配置」页签，与既有 skills 等页签并列（既有 tab 形态扩展）
- UX 参照：`ux/permission-config.html`（弹窗壳 + 页签栏）

验收标准：
1. 管理区打开项目详情弹窗 → 页签栏含「权限配置」且可点击（E2E：tab 元素存在 + 点击切到权限面板）。
2. 点击「权限配置」页签 → 显示权限面板（顶栏：模式切换 + 保存按钮 + 状态提示）。（E2E：面板可见）
3. 权限面板初始态 = 空态「未配置，全部跟随全局」+「新建配置」按钮（无 `.pi` 文件项目）。（E2E：空态文案可见）

## REQ-AGENT-060 全局只读基底 + 元数据注入（B2/T8/T9）

- 优先级 P0 / 必须 / cross-module / permissionConfigService + 项目详情弹窗 / agent-dialogue / conversation-space / API + 集成
- 接口契约：GET `/api/projects/:id/permission` 响应含 `global`（部署 JSON 原文）；`rules[]` 每项含 `family`/`label`/`readable`（服务端从 policyRules.js BASH_RULES 注入对齐）
- UX 参照：`ux/permission-config.html`（全局默认列 + family 分组）

验收标准：
1. GET 响应的 `global` 字段 = `agent-policy/pi-permission-config.json` 原文（API 断言逐字段一致）。
2. `rules[]` 中 bash 高危项带 `family`（如 destructive-fs/privilege-escalation）与 `label`（人可读文案），与 BASH_RULES 对齐（API 断言：规则表存在的 pattern 均有 family/label）。
3. 规则表与部署 JSON 漂移（规则表有但 JSON 无的 pattern）→ 该 pattern 不产生 rule 项，且不报错（API 断言：仅返回 JSON 中实际存在的规则）。
4. UI 全局默认列只读（无编辑控件）（E2E：全局列无 input/select/seg）。

## REQ-AGENT-061 继承视图（B3/T1-T4）

- 优先级 P0 / 必须 / cross-module / permissionConfigService merge + renderer / agent-dialogue / conversation-space / 单元 + API
- 接口契约：GET 响应 `merged`（字段级 merge 结果）+ `rules[]` 每项含 `value`（项目值或 null=跟随全局）、`source`（global|project）、`projectOverridden`（bool）
- UX 参照：`ux/permission-config.html`（两列：全局默认 + 项目值；覆盖高亮「项目已改」）

验收标准：
1. merge 纯函数与 gotgenes `mergeFlatPermissions` 语义一致：同一输入（全局 + 项目）喂两边 → 输出 merged 逐字段一致（对照单测：标量覆盖/对象浅合并/未定义继承/数组替换）。
2. 无项目文件（project=null）→ merged = 全局；`rules[]` 全部 `source:"global"`、`value:null`、`projectOverridden:false`（API）。
3. 项目覆盖某字段 → 该 rule `source:"project"`、`value=覆盖值`、`projectOverridden:true`；未覆盖字段保持继承（API）。
4. `permission.bash` 对象键浅合并：项目只写 `rm *` → merged.bash 仅该 pattern 变，其余 pattern 继承全局（API/对照单测）。
5. UI 覆盖项行高亮 + 「项目已改」标记；跟随全局行显示「跟随全局」且无高亮（E2E）。

## REQ-AGENT-062 bash 高危族可视化（B4）

- 优先级 P0 / 必须 / intra-module / PermissionConfigTab / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：`rules[]` 的 family 分组渲染；每项 allow/ask 双态切换（seg 控件，原型语义）
- UX 参照：`ux/permission-config.html`（删除文件/提权系统/重定向管道族）

验收标准：
1. bash 高危规则按 family 分组展示（组头 + 组内规则行）（E2E：destructive-fs 组含 `rm *` 行）。
2. 切换某规则 allow↔ask → 该行标记「项目已改」+ 组头覆盖徽标计数 +1（E2E：切换后高亮 + 徽标）。
3. 保存后 `.pi` 文件含该规则的覆盖值（API：文件内容断言）。

## REQ-AGENT-063 工具级裁决 + 全局兜底可视化（B5）

- 优先级 P0 / 必须 / intra-module / PermissionConfigTab / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：read/write/edit/create/delete/ls/grep/find → allow/ask 下拉/seg；`permission."*"` 兜底控件
- UX 参照：`ux/permission-config.html`（工具级裁决组 + 兜底）

验收标准：
1. 工具级规则组含 read/write/edit/create/delete/ls/grep/find 各行，显示全局默认值（E2E：组可见 + 各行全局值正确）。
2. 切换 write 为「允许」→ 保存 → 项目文件含 `"write":"allow"`（E2E + API 文件断言）。
3. 切换回「跟随全局」→ 保存 → 项目文件该字段删除，merged 回落全局（E2E/API）。

## REQ-AGENT-064 path 白名单 / 外部目录列表编辑器（B6）

- 优先级 P1 / 应该 / intra-module / PermissionConfigTab / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：path/external_directory 条目增删；`rules[]` 对应 array 字段
- UX 参照：`ux/permission-config.html`（path 列表编辑器）

验收标准：
1. path 白名单组显示全局条目（只读基底）+ 项目条目（可增删）（E2E：全局 `*` 可见 + 添加控件存在）。
2. 添加路径条目 → 保存 → 项目文件 path 字段含该条目（API）。
3. 删除项目条目 → 保存 → 文件同步删除（API）。
4. 重复/空条目保存被拒（400 + 错误信息）（API）。

## REQ-AGENT-065 authorizerChain + 开关面板化（B7）

- 优先级 P1 / 应该 / intra-module / PermissionConfigTab / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：authorizerChain 数组（整体替换语义，ADR-022）；yoloMode/debugLog/doublePressToConfirm/预览长度开关
- UX 参照：`ux/permission-config.html`（授权链与开关组）

验收标准：
1. authorizerChain 显示全局链（只读基底）+ 项目链编辑入口；项目链**整体替换**全局（保存后 merged.authorizerChain = 项目数组）（API）。
2. yoloMode 等开关切换 → 保存 → 文件对应字段更新（E2E + API）。
3. 面板说明文案明示「项目只覆盖你改的条目，未改的继承全局」（E2E：文案可见——E5 用户理解）。

## REQ-AGENT-066 JSON 模式单向同步（B8）

- 优先级 P0 / 必须 / cross-module / PermissionConfigTab + permissionConfigService / agent-dialogue / conversation-space / API + 浏览器 E2E
- 接口契约：PUT `/api/projects/:id/permission` body = 完整项目 JSON；未知字段保留
- UX 参照：`ux/permission-config.html`（JSON 模式 + 自定义字段提示条）

验收标准：
1. 切 JSON 模式 → 文本区显示当前项目配置 JSON（可编辑）（E2E：文本区可见 + 内容含项目字段）。
2. JSON 模式保存合法 JSON → 落盘原样写入（API：文件 = 请求体）。
3. 面板模式保存**保留** JSON 手写的自定义字段（面板不认识键）：项目文件先含 `customKey` → 面板改一个开关保存 → 文件仍含 `customKey`（API 关键断言）。
4. 面板模式保存**删除**被取消覆盖的字段：面板把覆盖项改回跟随全局 → 保存 → 文件该字段消失（API，ADR-022）。

## REQ-AGENT-067 首次编辑时生成（B9/ADR-022）

- 优先级 P0 / 必须 / cross-module / permissionConfigService / agent-dialogue / conversation-space / API
- 接口契约：无 `.pi` 文件 → PUT 首次保存生成最小覆盖集文件（目录递归创建）
- UX 参照：`ux/permission-config.html`（空态 → 新建配置）

验收标准：
1. 无 `.pi` 文件项目：GET 返回 `project:null` + 空态（API + E2E 空态）。
2. 首次 PUT 保存（面板改 1 条规则）→ 生成 `.pi/extensions/pi-permission-system/config.json`，内容 = 最小覆盖集（只含改动字段，不含未动规则）（API 文件断言）。
3. 首次保存后 GET → `project` 非 null，改动的规则 `source:"project"`（API）。

## REQ-AGENT-068 保存校验 fail-closed（B10/T5/T6）

- 优先级 P0 / 必须 / cross-module / permissionConfigService（zod 复用 gotgenes validateUnifiedConfig）/ agent-dialogue / conversation-space / API
- 接口契约：PUT 非法 → 400 `{code:"E-PERMISSION-INVALID", issues:[{path, message}]}`；不落盘
- UX 参照：`ux/permission-config.html`（错误 banner + 定位）

验收标准：
1. PUT 非法 JSON（语法错）→ 400 + issues 含定位；文件未变（API：文件内容与保存前一致）。
2. PUT schema 不合法（如 `"permission.bash":"ask"` 字符串形式被拒）→ 400 + issues 含路径；文件未变（API）。
3. 400 响应与 gotgenes `validateUnifiedConfig` 的判定一致：同一输入喂两边 → 都拒或都收（对照单测）。
4. UI 显示校验错误（banner + 错误信息），保存按钮态回退（E2E）。

## REQ-AGENT-069 保存即生效（B11/T3）

- 优先级 P0 / 必须 / cross-module / permissionConfigService（写文件）+ worker gotgenes（零改动）/ agent-dialogue / conversation-space / 集成（真实 worker）
- 接口契约：保存写文件 → 下次权限评估自动感知（每次评估 stat 文件，T3 实证）
- 技术前提：T3 已实证 gotgenes 每次评估 stat 文件——本 REQ 验证「我们保存的文件被运行时正确消费」

验收标准：
1. 真实 worker + 会话：项目文件把某规则从 ask 改为 allow → 保存（写文件）→ 同会话内该规则评估结果变 allow（集成：FAUX 工具序列驱动，改文件前后对比）。
2. 反向：allow 改 ask → 评估变 ask（集成反向）。
3. 评估路径零改动：worker/gotgenes 代码不变（实现侧仅主进程写文件）（diff 审查）。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-08-10 | 初版结晶：B1-B11 → REQ-AGENT-059~069（B12 确认卡机制不动为约束非功能，不结晶）；ADR-022 语义入 REQ | AI + 人 |
