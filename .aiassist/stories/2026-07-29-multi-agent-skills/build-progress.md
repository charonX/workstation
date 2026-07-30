# Build Progress — 2026-07-29-multi-agent-skills

> BUILD 阶段进度账本。每个 slice：子代理实现 → 父代理独立验证 → PRD 对齐子代理 → refactor 子代理 → 父代理复验 → 标记完成。

## 切片计划（依赖序）

| Slice | 名称 | REQ-ID | 测试文件 | 测试数 | 状态 |
|---|---|---|---|---|---|
| 1 | agent-registry | REQ-SKILL-018, REQ-SKILL-019 | agentRegistry.test.js, agentRegistrySnapshot.test.js | 12 | pending |
| 2 | skill-library（含旧机制清除） | REQ-SKILL-005/006/007/008/009/015/016/017 | skillLibrary.test.js, skillInstall.test.js | 31 | pending |
| 3 | distribution（含 agentTypes） | REQ-SKILL-010/011/012/013/014, REQ-WORKSPACE-011/013 | projectSkills.test.js, skillSync.test.js, projectAgents.test.js | 34 | pending |
| 4 | CLI | REQ-CLI-002 | skillCli.test.js | 10 | pending |
| 5 | E2E UI | REQ-WORKSPACE-012 + skill E2E（006/009/013/014/015 等 UI 行为） | skillLibrary.test.cjs, agentTypes.test.cjs | 12 | pending |

依赖关系：1 → 2（E11 校验用 registry 展开）→ 3（建链用 registry skillsDir + 技能库扫描）→ 4（CLI 包 API）→ 5（UI 调全部端点）。

跨切片落点约定：
- `src/db.js`（projects.agentTypes 列 + 删三表）→ slice 2（REQ-SKILL-017 AC1 断言在 skillLibrary.test.js）。
- `src/http/server.js` 移除 reconcileUserSkillRepos → slice 2（REQ-SKILL-017 AC3）；reset 模式 temp skillRepoPath 隔离保留。
- PUT /api/projects/:id 响应附加 `convergence` 字段（breaking）→ slice 3；renderer/CLI 适配 → slice 4/5。
- 旧 renderer 组件（SkillTable repo 模型等）替换 → slice 5；中间态 UI 调旧端点可能运行时报错（可编译即可，E2E 旧测试已退役）。

## 进度记录

（随 slice 推进追加）
