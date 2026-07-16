# Project Standards

本文件记录项目约定与标准。

## 设计系统

项目设计系统见根目录 `DESIGN.md` 与 `tokens.css`。

- 所有 UX 原型 HTML 必须引用 `tokens.css`。
- 不允许使用设计 token 之外的颜色或字体。
- 如需新增 token，先更新 `DESIGN.md` 和 `tokens.css`。
- 支持明暗两套主题：HTML 根元素设置 `data-theme="dark"` 或 `data-theme="light"`；未设置时跟随系统偏好。

## 编码规范

- TypeScript / React / Node.js 遵循各自社区默认风格
- 核心逻辑优先写单元测试
- Electron main process / IPC 层写集成测试

## 目录结构约定

```
.aiassist/
├── stories/                 # 具体 story
└── global/
    ├── engineering-lessons.md
    ├── architecture.md
    └── STANDARDS.md         # 本文件
```

## 命名约定

- Story ID: kebab-case，如 `codex-harness-desktop`
- REQ ID: `REQ-<AREA>-<NNN>`，如 `REQ-DESIGN-001`
- CSS 变量前缀: `--ch-`

## Electron 开发约定

- 服务层代码（`src/services/`、`src/http/`、`src/cli/`）运行在 Electron main 进程，修改后必须重启应用或重新运行 `npm run dev`，renderer HMR 不会重载主进程。
- 产生文件系统副作用的功能（如 symlink、目录创建、文件写入）必须在 REQ 中明确验收标准，并在 API/CLI 测试中断言实际路径与状态。
- 删除产生文件系统副作用的实体时，必须同步清理相关文件，避免 dangling symlink / 孤儿目录。

## 测试约定

- 测试即契约（test-as-contract）
- 每个 REQ 至少对应一个可自动化验收测试
- Gate 2（feel-signoff）以高保真 HTML 为参照
- 文件系统副作用需用真实 I/O 断言，不能用纯 DB 状态推断

## 文档约定

- PRD 放在 `.aiassist/stories/<id>/prd.md`
- REQ 放在 `.aiassist/stories/<id>/requirements.md`
- 设计系统更新需同步 `DESIGN.md`、`tokens.css`、`.aiassist/global/STANDARDS.md`、`.aiassist/global/tokens.css`
