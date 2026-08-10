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
