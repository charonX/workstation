# workstation

项目初始化中。

## 测试即契约工作流

本项目使用 `test-as-contract` 工作流。Skill 安装在 `.claude/skills/` 下。

### 可用 skill

| Skill | 用途 | 触发者 |
|---|---|---|
| `/tac-story` | 开始/继续 story;执行回流(归档重做/删 story) | 用户 |
| `/tac-bootstrap-workflow` | 初始化项目级工作流基础设施 | 用户 |
| `/tac-demand-insight` | 对抗式需求访谈 | 用户 |
| `/tac-to-prd` | 把讨论整理成 PRD | 用户 |
| `/tac-tech-design` | 对抗式技术方案设计 | 用户 |
| `/tac-design-system` | 建立或校验项目级设计系统 | 用户 |
| `/tac-ux-explore` | 用 HTML 原型进行高保真 UX 探索 | 用户 |
| `/tac-crystallize` | 把 PRD 稳定块转成 REQ-ID | 模型 |
| `/tac-test-author` | 从 REQ 生成测试骨架 | 模型 |
| `/tac-assertion-signoff` | 在实现前签核断言 | 用户 |
| `/tac-implementer` | 针对已签核测试实现代码 | 模型 |
| `/tac-qa-runner` | 运行 E2E、回归、收集证据 | 模型 |
| `/tac-feel-signoff` | 依据 HTML 参照验收观感 | 用户 |
| `/tac-reflect` | 捕获经验教训并更新知识 | 用户 |

### 产物目录

```
.aiassist/
├── stories/<story-id>/
│   ├── prd.md                 # 叙事意图（软）
│   ├── tech-design.md         # 技术方案（一挡可推翻）
│   ├── requirements.md        # 带 ID 的 REQ（契约）
│   ├── requirements-v1.hash   # 版本哈希，用于检测过时测试
│   ├── ux/                    # 用于 feel-signoff 的 HTML UX 参照
│   ├── test-plan.md           # 测试作者的计划
│   ├── assertion-signoff.md   # 人签核断言
│   ├── feel-signoff.md        # 人验收观感
│   ├── workflow-state.yaml    # 当前阶段 / 阻塞项 / 归档历史
│   └── archive/               # 归档重做时，被推翻的承诺层产物 + reason.md
└── global/
    ├── DESIGN.md              # 项目级设计系统文档
    ├── tokens.css             # 可运行的 CSS token
    ├── engineering-lessons.md
    ├── architecture.md
    └── STANDARDS.md
```

### 核心规则

1. **真理向下流**：PRD → REQ → 测试 → 代码。
2. **错误向上回**：在受影响的最高层修复；永远不要因为测试或规格错了就直接改代码。
3. **断言归人**：AI 写测试脚手架；人签 expected 值。
4. **实现者对测试只读**：任何触及测试文件的代码差异都会让本轮作废。
5. **`/tac-assertion-signoff` 阻塞 BUILD；`/tac-feel-signoff` 阻塞合并**。
6. **没有 REQ-ID 就没有测试**：每个测试文件必须声明 `// REQ-TRACE` 和 `// REQ-VERSION`。
7. **主观判断不进测试**：观感/美学在 feel-signoff 环节依据 HTML 参照验收。
8. **story = 初衷**：初衷（痛点）不变 → 归档重做；初衷错 → 删 story。回流前先做根因诊断。详见 `/tac-story`。

### commit 约定

为了保护"实现者对测试只读"的契约，所有 story 相关 commit 应带标签：

| 标签 | 用途 | 可改文件 |
|---|---|---|
| `[tac-test]` | 编写/修改测试、签核断言 | `test/`、`*.{test,spec}.*`、`e2e/` 等 |
| `[tac-build]` | 编写实现代码 | `src/`、`app/`、`lib/` 等 |
| `[tac-docs]` | PRD/REQ 文档更新 | `.aiassist/stories/*/prd.md`、`requirements.md` 等 |
| `[tac-ux]` | UX 原型/设计系统更新 | `.aiassist/stories/*/ux/`、`global/DESIGN.md` 等 |
| `[tac-bootstrap]` | 工作流基础设施 | `.aiassist/`、`CLAUDE.md`、hooks 等 |

**核心纪律：一个 commit 不能同时包含实现代码和测试文件。**
仓库已配置 `.aiassist/hooks/pre-commit` 和 `commit-msg` 进行拦截。

### 开始新 story

```
/tac-story
# 或
/tac-bootstrap-workflow
```

### 更新 skill

当 `<workflow-path>/skills/` 中的 canonical skill 变更时，重新安装：

```bash
rm -rf .claude/skills/*
cp -R <workflow-path>/skills/productivity/* .claude/skills/
cp -R <workflow-path>/skills/engineering/* .claude/skills/
```
