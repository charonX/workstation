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
- 测试：`node --test tests/capabilities/agent-dialogue/conversation-space/2026-08-10-pi-permission-config-ui/api/permissionConfig.test.js` → **16/18 绿**（S1 后全红 404 → 接线后 16 转绿）。回归：projectAgents/project/projectSkills 三个同 seam 测试文件 44/44 绿。
- refactor：无（Slice 2 为薄路由接线 + 一个 scoped 错误映射，无重构面）。

#### PRD→代码 可追溯性表（Slice 2）

| PRD/REQ | 路由（src/http/routes/projects.js） | 服务（S1） | 测试（permissionConfig.test.js） | 状态 |
|---|---|---|---|---|
| B1 / REQ-AGENT-059（API 面） | GET permission 分支 | getPermissionView | GET「无配置项目 GET 正常 project:null」 | COVERED（UI 页签面属 Slice 3） |
| B2/B3 / REQ-AGENT-060/061 | GET permission 分支 | getPermissionView（merge+元数据注入） | GET 5 用例（global 原文/family/label/继承态） | COVERED |
| B4/B5/B6/B7 / REQ-AGENT-062~065 | PUT permission 分支 | savePermission | PUT 保存用例（最小覆盖集/write/path/authorizerChain/开关） | COVERED（062 UI 组面 Slice 3） |
| B8 / REQ-AGENT-066 | PUT permission 分支 | savePermission（原样写，ADR-022） | 标准 4「取消覆盖=删除」绿；标准 3「自定义字段保留」红 | PARTIAL（见 concerns） |
| B9 / REQ-AGENT-067 | PUT permission 分支 | savePermission | 首次保存 2 用例 | COVERED |
| B10 / REQ-AGENT-068 | PUT + server.js 解析错误映射 | savePermission（validateWithGotgenes） | 标准 1（非法 JSON）绿；标准 3（对照）绿；标准 2（bash 字符串）红 | PARTIAL（见 concerns） |

#### Slice 2 concerns（2 红均不改测试——实现者对测试只读，待 /bug 或回流裁决）

1. **REQ-AGENT-066 标准 3 红（customOrgKey 保留）**：第二次 PUT body 不含 customOrgKey，断言落盘文件仍含之。与服务端「原样写」语义冲突——tech-design §4.3/§6.6 明确未知字段保留由 **renderer 视图转换**承担（Slice 3），测试自身注释亦写「服务端原样写」；断言与注释自相矛盾（body 若为前端合并后 payload 应含 customOrgKey）。服务端/路由若做保留将破坏标准 4（取消覆盖=删除，现绿）与 JSON 模式全量替换（REQ-AGENT-066 标准 2「落盘=请求体」）语义——API seam 无「面板保存 vs JSON 模式」区分信号。
2. **REQ-AGENT-068 标准 2 红（bash 字符串拒绝）**：测试前提「bash 应为对象，字符串非法」与 gotgenes schema 冲突——config-schema.ts 实证：surface 级字符串 = `{"*": action}` 简写**合法**；`validateWithGotgenes({permission:{bash:"ask"}}) = false`（接受），路由 200 与标准 3 对照断言一致（标准 3 绿）。标准 2 断言了错误形态（拒绝合法输入反而破坏「保存拦截 = 运行时 fail-closed 同一把尺」T5）。
