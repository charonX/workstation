# workstation

项目初始化中。

## Test-as-Contract Workflow

本项目使用 test-as-contract workflow 进行需求管理与验收。

### 目录结构

```
.aiassist/
├── stories/                 # 具体 story，由 /test-as-contract 创建
└── global/
    ├── engineering-lessons.md   # 跨 story 经验
    ├── architecture.md          # ADR
    └── STANDARDS.md             # 项目约定
```

### 使用方式

- 创建 story：运行 `/test-as-contract`
- 每个 story 对应一个明确的用户可验收行为，包含测试作为契约。
- 全局约定和经验记录在 `.aiassist/global/` 中，供跨 story 复用。
