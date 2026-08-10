# Test Plan — 2026-08-10-pi-permission-config-ui

> 阶段：TEST（test-author 骨架生成）
> REQ：REQ-AGENT-059~069（requirements v1，hash 4b944146）
> 目录：`tests/capabilities/agent-dialogue/conversation-space/2026-08-10-pi-permission-config-ui/`

## 测试文件与 REQ 映射

| 文件 | seam 类型 | 覆盖 REQ | 关键断言（签核 TODO 标注处） |
|---|---|---|---|
| `api/permissionConfig.test.js` | API（真实 server + 项目 fixture） | 059/060/061/063/064/065/066/067/068 | GET global=部署 JSON 原文；rules 带 family/label；无配置 merged=全局；首次保存最小覆盖集；自定义字段保留；取消覆盖=删除；path 增删；authorizerChain 整体替换；开关更新；校验 400+issues+文件未变；gotgenes 判定对照 |
| `api/permissionMerge.test.js` | 单元对照（我们的 merge vs gotgenes mergeFlatPermissions） | 061 标准 1 | 7 组用例（标量覆盖/对象浅合并/未定义继承/数组替换/布尔覆盖/空项目/深层 path）输出逐字段一致 |
| `api/permissionEvaluation.test.js` | 集成（真实 worker + gotgenes + 项目文件） | 069 | ask→allow / allow→ask 同会话改文件评估变化；未覆盖字段回落全局 |
| `e2e/permissionConfig.test.cjs` | 浏览器 E2E（Playwright Electron） | 059/060/061/062/063/065/066/068 | 页签入口+空态；bash 族规则行+全局列只读；allow-ask 切换+覆盖徽标+保存；JSON 模式切换；JSON 非法保存错误条；继承说明文案 |

## HTML 原型映射（ux/permission-config.html → 测试）

| 原型元素 | 测试断言 | 来源 REQ |
|---|---|---|
| 空态（未配置跟随全局 + 新建按钮） | E2E 空态可见性 | 059 |
| 两列继承视图（全局默认 + 项目值） | API merged/source 断言 + E2E 规则行 | 060/061 |
| family 分组 + 覆盖徽标 | E2E 组行可见 + 徽标计数 | 062 |
| allow/ask seg 切换 + 「项目已改」高亮 | E2E 切换断言 | 062/063 |
| path 列表增删 | API 文件断言 | 064 |
| authorizerChain 链 + 开关组 | API merged 断言 | 065 |
| JSON 模式 + 自定义字段提示条 | E2E JSON 切换 + API 自定义字段保留 | 066 |
| 保存校验错误 banner | E2E 错误条 + API 400 | 068 |
| 继承说明文案 | E2E 文案可见 | 065 标准 3 |

## seam 依赖清单（实现时接线）

1. `src/services/permissionConfigService.js`（新）：GET/PUT 权限视图 + merge 纯函数 + zod 校验 + 原子写 + 元数据注入——**BUILD 产物，测试动态 import RED 失败**。
2. HTTP 路由：`/api/projects/:id/permission` GET/PUT（挂 projects.js 或新路由文件）。
3. gotgenes merge 对照：jiti 加载 `node_modules/@gotgenes/pi-permission-system/src/permission-merge.ts`（对齐 worker.js loadGotgenesFactory 先例）。
4. 校验对照：`validateWithGotgenes`（服务端导出，内部复用 gotgenes `validateUnifiedConfig`）——实现后接线 permissionConfig.test.js 068 标准 3。
5. 评估 seam：`permissionBridge.evaluateBashToolCall`（既有）+ 项目空间会话 cwd——permissionEvaluation.test.js 接线确认调用形态。
6. E2E locator 契约：`[data-perm-tab]` / `[data-rule-row='permission.bash.rm *']` / `[data-perm-seg]` / `[data-testid='perm-*']`——实现时 renderer 对齐（原型语义）。
7. E2E 既有复用：startElectronApp({extraEnv: OPC_AGENT_FAUX}) + seedAgentConfig + createProject(localPath) + goToAdminRoute("#/workspace") + PROJECT_CARD/CONFIGURE_SKILLS_BUTTON/PROJECT_DETAIL_MODAL locators。

## 留给 REFLECT 人工验收（仅纯审美）

- 面板视觉密度/间距/配色（继承视图两列布局观感）——原型 approved，实现后 REFLECT 对照。
- 无其他人工项：全部 REQ 有自动化断言（含结构/行为/错误路径）。

## 签核状态

- ASSERTIONS-SIGNED: false（待门 1 人逐项确认签核 TODO 处预期值）。
- 签核 TODO 统计：permissionConfig 13 处 / permissionMerge 1 处 / permissionEvaluation 3 处 / E2E 8 处。

## 覆盖回溯

| REQ | 测试覆盖 | 状态 |
|---|---|---|
| 059 | E2E 页签+空态 / API project:null | ✅ |
| 060 | API global 原文 + family/label + 只读 | ✅ |
| 061 | API merged + merge 对照 7 用例 | ✅ |
| 062 | E2E 切换 + API 文件断言 | ✅ |
| 063 | E2E + API write 覆盖/取消 | ✅ |
| 064 | API path 增删 | ✅ |
| 065 | API 链替换 + 开关 + E2E 文案 | ✅ |
| 066 | API 自定义字段保留 + E2E JSON 切换 | ✅ |
| 067 | API 首次生成 | ✅ |
| 068 | API 400 + 对照 + E2E 错误条 | ✅ |
| 069 | 集成真实 worker 评估变化 | ✅ |
