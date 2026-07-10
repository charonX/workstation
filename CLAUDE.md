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
| `/tac-review` | 手动审查 PRD/技术方案/代码（建议新会话） | 用户 |
| `/tac-design-system` | 建立或校验项目级设计系统 | 用户 |
| `/tac-ux-explore` | 用 HTML 原型进行高保真 UX 探索 | 用户 |
| `/tac-crystallize` | 把 PRD 稳定块转成 REQ-ID | 模型 |
| `/tac-test-author` | 从 REQ 生成测试骨架 | 模型 |
| `/tac-implementer` | 针对已签核测试实现代码 | 模型 |
| `/tac-qa-runner` | 运行 E2E、回归、收集证据 | 模型 |
| `/tac-signoff` | assertion 阶段签核断言；feel 阶段依据 HTML 参照验收观感 | 用户 |
| `/tac-reflect` | 捕获经验教训并更新知识 | 用户 |

### 产物目录

```
.aiassist/
├── stories/<story-id>/
│   ├── prd.md                 # 叙事意图（软）
│   ├── tech-design.md         # 技术方案（一挡可推翻）
│   ├── requirements.md        # 带 ID 的 REQ（契约）
│   ├── requirements-v1.hash   # 版本哈希，用于检测过时测试
│   ├── review-prd.md          # PRD 审查报告（可选）
│   ├── review-tech.md         # 技术方案审查报告（可选）
│   ├── review-code.md         # 代码审查报告（可选）
│   ├── ux/                    # 用于 `/tac-signoff --stage=feel` 的 HTML UX 参照
│   ├── test-plan.md           # 测试作者的计划
│   ├── signoff.md             # 断言签核 + 观感签核记录
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
5. **`/tac-signoff --stage=assertion` 阻塞 BUILD；`/tac-signoff --stage=feel` 阻塞合并**。
6. **没有 REQ-ID 就没有测试**：每个测试文件必须声明 `// REQ-TRACE` 和 `// REQ-VERSION`。
7. **主观判断不进测试**：观感/美学在 `/tac-signoff --stage=feel` 环节依据 HTML 参照验收。
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

## 双循环工作流

> **如果你是为本项目工作的 AI Agent，先读这一段。**
>
> 本项目使用 `loop-workflow` 工作流。你的核心约束是：**人持有断言，AI 持有实现；人对代码只读，AI 对业务测试只读。** 不要直接修改 `.aiassist/stories/<id>/signoff.md` 之外的契约文档，不要在 BUILD 阶段改测试，不要把实现细节暴露进业务测试。不确定时，用 `/story` 查看当前 phase，或用 AskUserQuestion 问用户。

### 可用 skill

| Skill | 用途 | 触发者 |
|---|---|---|
| `/story` | 开始/继续 story；执行回流（归档重做/删 story） | 用户 |
| `/bootstrap-workflow` | 初始化项目级工作流基础设施 | 用户 |
| `/demand-insight` | 对抗式需求访谈 | 用户 |
| `/to-prd` | 把讨论整理成 PRD | 用户 |
| `/domain-model` | 统一领域术语与业务实体，维护 `CONTEXT.md` | 用户 |
| `/tech-design` | 对抗式技术方案设计 | 用户 |
| `/design` | 设计阶段统一入口：建/更新设计系统、导入设计源、迭代 HTML UX 原型 | 用户 |
| `/file-bug` | 在当前 story 内登记、复现、分类 bug；支持从 GitHub/GitLab issue 拉取 | 用户 |
| `/review` | 手动审查 PRD/技术方案/代码（建议新会话）；`--stage=code --mode=panel` 启用 specialist 子代理并行审查 | 用户 |
| `/signoff` | 两个循环的切换点：门 1 签断言、门 2 验观感 | 用户 |
| `/reflect` | 捕获经验教训并更新全局知识、`adr/`、`checklists/` | 用户 |
| `/research` | 针对技术/API/库问题做带引用的调研 | 用户 |
| `/design-handoff` | 从已批准 UX 生成开发交接包 | 用户 |
| `/sync-refs` | 同步参考项目并吸收上游变更 | 用户 |
| `/crystallize` | 把 PRD 稳定块转成 REQ-ID；每个 REQ 至少一个自动化测试 | 模型 |
| `/test-author` | 从 REQ 生成业务测试骨架；前端需求必须生成组件/浏览器结构行为测试；浏览器 E2E 默认 Playwright | 模型 |
| `/tdd` | 内层实现纪律：RED → GREEN 写单元测试驱动代码 | 模型 |
| `/implementer` | 针对已签核测试实现代码；默认子代理实现切片，父代理调度验证；内部用 `/tdd` RED → GREEN；每个 slice 绿后由 refactor subagent 做一轮安全重构 | 模型 |
| `/qa-runner` | 运行 E2E（Playwright）、回归、收集证据；失败时建议 `/file-bug`；浏览器项目在 E2E 通过后可选调用 `/browser-verify` | 模型 |
| `/fix-bugs` | 在当前 story 内批量修复已分类 bug、跑全量回归、输出修复报告；支持同步关闭外部 issue | 模型 |
| `/browser-verify` | 用 Chrome DevTools MCP 做运行时浏览器验证（Console/DOM/Network/A11y/截图/性能） | 模型 |

### 两个循环与两道门

```
外层循环（人控制）
  THINK → PRD → DESIGN → DOMAIN-MODEL → TECH-DESIGN → CRYSTALLIZE → TEST
              ↑                                     │
              └──────── FEEL-SIGNOFF 不通过，回流 ─────┘
                                                   │
                                            门 1: ASSERTION-SIGNOFF
                                                   │
                                                   ▼
内层循环（agent 控制）
  BUILD → QA  （测试不绿就自修，不许改断言）
                                                   │
                                            门 2: FEEL-SIGNOFF
                                                   │
                                                   ▼
                                         人验收 → 通过 / 不通过回流
```

- **门 1 `/signoff --stage=assertion`**：人在实现前签核所有断言。**不签不准 BUILD。**
- **门 2 `/signoff --stage=feel`**：人依据 HTML UX 参照验收实现观感。**不签不准合并。**

### 产物目录

```
.aiassist/
├── stories/<story-id>/
│   ├── prd.md                 # 叙事意图（软，一挡可推翻）
│   ├── tech-design.md         # 技术方案（一挡可推翻）
│   ├── requirements.md        # 带 ID 的 REQ（契约）
│   ├── requirements-v1.hash   # 版本哈希，检测过时测试
│   ├── ux/                    # HTML UX 参照（用于 feel-signoff）
│   │   ├── *.html             # HTML 原型
│   │   ├── components/        # （可选）story 局部组件
│   │   ├── _ds_bundle.js      # （生成）组件 bundle
│   │   ├── _ds_manifest.json # （生成）story 设计系统清单
│   │   ├── preview.html       # （生成）自包含预览页
│   │   ├── _d_meta.json      # （生成）资产注册表 + 设计系统绑定
│   │   └── _ds/<slug>/        # （生成）全局设计系统运行时拷贝
│   ├── design_handoff/
│   │   ├── README.md
│   │   └── _handoff_manifest.json
│   ├── test-plan.md           # 测试作者的计划
│   ├── signoff.md             # 断言签核 + 观感签核记录
│   ├── workflow-state.yaml    # 当前 phase / 阻塞项 / 归档历史
│   └── archive/               # 归档重做时被推翻的承诺层产物 + reason.md
└── global/
    ├── CONTEXT.md              # 领域词汇表与业务实体定义（由 /domain-model 维护）
    ├── business-capabilities.md # 业务能力地图（由 /crystallize、/reflect 维护）
    ├── adr/                     # 架构决策记录目录（由 /tech-design、/reflect 维护）
    │   └── README.md            # ADR 索引
    ├── checklists/              # 共享检查清单（由 /reflect 维护）
    │   ├── testing.md
    │   ├── security.md
    │   ├── performance.md
    │   ├── accessibility.md
    │   └── observability.md
    ├── codegraph.json           # CodeGraph 配置（可选，由 /bootstrap-workflow 初始化）
    ├── DESIGN.md                # 项目级设计系统文档
    ├── tokens.css               # CSS token 入口
    ├── styles.css               # 全局样式入口
    ├── README.md                # 设计系统概览
    ├── components/              # （可选）可复用组件
    ├── engineering-lessons.md
    ├── architecture.md          # 架构概览（具体决策写入 adr/）
    └── STANDARDS.md             # 编码与流程标准（索引 + 项目特定约定 + Definition of Done）
```

### 核心规则

1. **真理向下流**：PRD → REQ → 测试 → 代码。代码永远不是真理来源。
2. **错误向上回**：在受影响的最高层修复；永远不要因为测试或规格错了就直接改代码。
3. **断言归人**：AI 写测试脚手架；人签 expected 值。
4. **实现者对测试只读**：任何触及业务测试文件的代码差异都会让本轮作废。
5. **`/signoff --stage=assertion` 阻塞 BUILD；`/signoff --stage=feel` 阻塞合并**。
6. **没有 REQ-ID 就没有测试；没有自动化测试的 REQ 不能进入 BUILD**：每个测试文件必须声明：
   ```
   // REQ-TRACE: <story-id>/<req-id>
   // REQ-VERSION: <hash>
   // CAPABILITY-TRACE: <capability-name>
   // ENTITY-TRACE: <entity-name>
   ```
   测试按 `tests/capabilities/<capability>/<entity>/<story-id>/` 组织。feel-signoff 只覆盖纯审美判断。
7. **测试按 capability/entity 组织**：`tests/capabilities/<capability>/<entity>/<story-id>/...`
8. **主观判断不进测试**：观感/美学在 `/signoff --stage=feel` 环节依据 HTML 参照验收；结构/行为必须有自动化测试。
9. **story = 初衷**：初衷（痛点）不变 → 归档重做；初衷错 → 删 story。回流前先做根因诊断。
10. **测试全绿只是最低门槛**：实现还必须对齐 PRD 意图、`tech-design.md` 模块/数据流/接口契约、以及 UX HTML 结构/行为。禁止为绿而硬凑。
11. **ADR 是硬约束**：已有 `adr/` 中的决策，在 `/tech-design`、`/review`、`/implementer` 阶段必须检查冲突。

### commit 约定

为了保护“实现者对测试只读”的契约，所有 story 相关 commit 应带标签：

| 标签 | 用途 | 可改文件 |
|---|---|---|
| `[test]` | 编写/修改测试、签核断言 | `test/`、`*.{test,spec}.*`、`e2e/` 等 |
| `[build]` | 编写实现代码 | `src/`、`app/`、`lib/` 等 |
| `[docs]` | PRD/REQ 文档更新 | `.aiassist/stories/*/prd.md`、`requirements.md` 等 |
| `[ux]` | UX 原型/设计系统更新 | `.aiassist/stories/*/ux/`、`global/DESIGN.md` 等 |
| `[bootstrap]` | 工作流基础设施 | `.aiassist/`、`CLAUDE.md`、hooks 等 |

**核心纪律：一个 commit 不能同时包含实现代码和测试文件。**
仓库已配置 `.aiassist/hooks/pre-commit` 和 `commit-msg` 进行拦截。

### 回流路径

当 `/signoff --stage=feel` 不通过时：

1. **偏差是缺陷**（实现偏离已签 REQ）→ 补标准增量 → `/crystallize` → `/test-author` → `/signoff --stage=assertion` → `/implementer`
2. **偏差是需求变更**（REQ 没写或写错）→ 改 PRD/REQ → `/crystallize` → `/test-author` → `/signoff --stage=assertion` → `/implementer`
3. **可接受偏差**（平台限制等 HTML 无法 1:1 翻译）→ 记录并放行

### 开始新 story

```bash
/story
# 或
/bootstrap-workflow
```

### 更新 skill

当 `loop-workflow` 插件更新后，重新安装：

```bash
rm -rf .claude/skills/*
cp -R <workflow-path>/skills/productivity/* .claude/skills/
cp -R <workflow-path>/skills/engineering/* .claude/skills/
cp -R <workflow-path>/skills/maintenance/* .claude/skills/
```

