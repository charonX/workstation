# 业务能力地图 — OPC Workstation

> 本文件由 `/crystallize` 和 `/reflect` 维护。
> 把测试按业务实体/能力组织，而不是按 story。
> 每个能力下挂测试文件和 REQ-ID。

---

## 能力清单

### Workspace 管理
> 配置 Workspace 根目录、Skill 仓库位置，管理项目导入与搜索。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| Settings | tests/settings.test.js | REQ-001, REQ-002, REQ-025 | tests/settings.test.js |
| Project | tests/project.test.js | REQ-003~005, REQ-021 | tests/project.test.js |

### 流程编排
> 设计、保存、执行流程图，支持条件分支与循环。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| Flow | tests/flow.test.js | REQ-006~010 | tests/flow.test.js |
| FlowEngine | tests/flowEngine.test.js | REQ-017~020 | tests/flowEngine.test.js |

### 调度与执行
> 手动触发、定时触发、查看执行历史与详情。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| Task / Schedule | tests/task.test.js | REQ-011~013 | tests/task.test.js |

### Skill 管理
> 集中式 skill 仓库、多源安装、项目关联。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| Skill | tests/skill.test.js | REQ-014, REQ-015, REQ-022 | tests/skill.test.js |

### 信息聚合
> Dashboard 展示关键指标与最近活动。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| Dashboard | tests/dashboard.test.js | REQ-023 | tests/dashboard.test.js |

### 国际化与主题
> 语言切换、主题切换、显示密度。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| Language / Theme | tests/language.test.js, tests/theme.test.js | REQ-016, REQ-024 | tests/language.test.js, tests/theme.test.js |

## 能力依赖图

```
Workspace 管理 ──> 流程编排 ──> 调度与执行
       │                │
       └─> Skill 管理 ──┘
       │
       └─> 信息聚合
```

## 健康指标

| 能力 | 测试数 | 覆盖率 | 最后更新 |
|------|--------|--------|----------|
| Workspace 管理 | 13 | - | 2026-07-08 |
| 流程编排 | 17 | - | 2026-07-08 |
| 调度与执行 | 13 | - | 2026-07-08 |
| Skill 管理 | 8 | - | 2026-07-08 |
| 信息聚合 | 3 | - | 2026-07-08 |
| 国际化与主题 | 5 | - | 2026-07-08 |
