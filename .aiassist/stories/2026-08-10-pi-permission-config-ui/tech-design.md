# Tech Design — PI 权限策略可视化管理（Permission Config UI）

> 故事 ID：`2026-08-10-pi-permission-config-ui`
> 版本：v0.1
> 日期：2026-08-10
> 输入：`prd.md` v0.1（B1-B12）+ `interview-notes.md`（Q1-Q10）+ `ux/permission-config.html`（已 approved）
> 技术事实：gotgenes 源码实证（config-loader/permission-merge/permission-manager/policy-loader）

---

## 1. 技术前提（实证，非假设）

| # | 事实 | 实证位置 |
|---|---|---|
| T1 | 项目级配置 = **字段级覆盖**：布尔/数值/数组字段「override 替换，未定义继承全局」；`permission` 面标量键替换、对象键（bash map）浅合并只覆盖写了的 pattern | `config-loader.ts mergeUnifiedConfigs` + `permission-merge.ts mergeFlatPermissions` |
| T2 | 合并优先级（低→高）：legacy 全局 < legacy 扩展 < 新全局 < legacy 项目 < **新项目** | `config-loader.ts loadAndMergeConfigs` |
| T3 | **每次权限评估 stat 文件**（mtime stamp 缓存）：stamp 变 → 立即重读 global+project 文件重新 merge——「保存即生效」零自造热重载 | `permission-manager.ts resolvePermissions` + `policy-loader.ts getFileStamp` |
| T4 | 来源追踪：gotgenes 用 `mergeScopesWithOrigins` 构建每条规则的 origin（global/project/agent/…）——继承视图「来源标注」可对齐该语义 | `permission-manager.ts` |
| T5 | 校验：gotgenes 内部用 **zod**（`config-schema.ts`），`validateUnifiedConfig` 产出路径化错误——保存校验应复用同一函数（保存拦截 = 运行时 fail-closed 一致） | `config-loader.ts validateUnifiedConfig` |
| T6 | 坏文件运行时 fail-closed：存在但解析失败 → `{invalid:true}` 拒绝 | `policy-loader.ts loadProjectConfig` |
| T7 | 项目配置路径：`<cwd>/.pi/extensions/pi-permission-system/config.json`（cwd = 会话项目目录，M2 装配） | `config-paths.ts getProjectConfigPath` + worker M2 |
| T8 | 部署 JSON 为扁平结构（`"rm *": "ask"`），**不含 family/可读文案**——展示元数据需从 BASH_RULES（真源）注入 | `agent-policy/pi-permission-config.json` |
| T9 | 全局基底展示 = 部署 JSON 原文（代码规则表是出厂配置，JSON 是运行时真相） | Q1 人拍板 |

## 2. 模块边界

```
┌─────────────────────────────────────────────────────────────┐
│ renderer（项目详情弹窗「权限配置」页签）                        │
│   PermissionConfigTab.jsx（新）                              │
│   ├─ 继承视图面板（rules 数组 → 分组渲染，覆盖高亮）            │
│   ├─ JSON 模式（文本编辑，单向同步）                           │
│   └─ 面板状态 → 项目 JSON 转换（前端：含未知字段保留）           │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP API
┌──────────────────────────────▼──────────────────────────────┐
│ 主进程权限配置服务（新：permissionConfigService.js）            │
│   ├─ getPermissionView(projectId) → {global, project,        │
│   │    merged, rules[]}   // 读两个 JSON + merge + 元数据注入   │
│   ├─ savePermission(projectId, configJSON)                   │
│   │   → zod 校验（gotgenes validateUnifiedConfig）→ 原子写     │
│   ├─ merge 纯函数（对齐 gotgenes mergeFlatPermissions 语义）   │
│   ├─ 元数据注入（读 policyRules.js BASH_RULES → family/label） │
│   └─ 项目路径解析（projectId → localPath → .pi 路径，           │
│       与 agentService 项目装配同源）                           │
└──────────────────────────────┬──────────────────────────────┘
                               │ 写文件（原子：tmp + rename）
                    <projectDir>/.pi/extensions/
                    pi-permission-system/config.json
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ worker 子进程（gotgenes 运行时，零改动）                       │
│   每次评估 stat 文件 → 保存即生效（T3）                        │
└─────────────────────────────────────────────────────────────┘
```

**职责边界**：
- 权限配置**服务**（读写/校验/merge/元数据）只活主进程；worker/gotgenes 零改动。
- renderer 只经 HTTP API 交互，不直接碰文件系统。
- 前端负责「面板状态 ↔ 项目 JSON」视图转换（含未知字段保留）；服务端只有一个语义：**校验并写入这份 JSON**（Q5 单端点）。

## 3. 接口契约

### 3.1 GET /api/projects/:id/permission

```
200 →
{
  "global": { ...完整全局 JSON },            // 部署 JSON 原文（只读基底）
  "project": { ...项目 JSON } | null,        // null = 未配置
  "merged": { ...字段级 merge 结果 },        // 权威生效视图（校验/展示锚点）
  "rules": [                                  // 面板渲染数据源（扁平化 + 元数据）
    {
      "key": "permission.bash.rm *",          // 字段路径（面板识别/删除白名单用）
      "family": "destructive-fs",             // 分组（BASH_RULES 注入，T8）
      "label": "删除任意文件/目录",            // 可读文案（注入）
      "readable": "rm *",                     // 展示用命令形态
      "type": "scalar" | "map-entry" | "array" | "switch",
      "global": "ask",                        // 全局值
      "value": "ask" | null,                  // 项目值；null = 跟随全局（未覆盖）
      "source": "global" | "project",         // 生效来源（对齐 T4 origin 语义）
      "projectOverridden": false              // 该项目是否覆盖了此字段
    },
    ...  // 覆盖：bash 高危族（family 分组）/ 工具级 / path 白名单 / 外部目录 /
         // authorizerChain / 布尔开关
  ]
}
404 → { code: "E-PROJECT-NOT-FOUND" }        // 项目不存在/无 localPath
```

### 3.2 PUT /api/projects/:id/permission

```
body = { ...完整项目配置 JSON }   // 面板模式：前端生成（已知字段取面板值 +
                                 // 未知字段保留原文件值）；JSON 模式：原样传
200 → { "saved": true, "mtime": "<文件 mtimeMs>" }   // mtime 供前端可选提示
400 → { code: "E-PERMISSION-INVALID", "issues": [     // zod 路径化错误（T5）
         { "path": "permission.bash.rm *", "message": "..." }
       ] }                                            // 不落盘
500 → { code: "E-PERMISSION-WRITE" }                  // IO 失败，文件保持原状
```

**保存语义**（Q5/Q8）：
- 覆盖式保存，无版本协商（不 409）；成功响应带最新 mtime。
- 取消覆盖（改回跟随全局）= 字段不在请求 JSON 中 → 落盘后该字段消失 → 回落全局（Q4）。
- 首次保存（无文件）→ 生成最小覆盖集文件；目录不存在则递归创建。

## 4. 数据流

### 4.1 读取（继承视图组装）

```
projectId → projectService.localPath（同源 agentService 项目装配）
  → 读 agent-policy/pi-permission-config.json（全局基底，T9）
  → 读 <localPath>/.pi/extensions/pi-permission-system/config.json（project，缺失=null）
  → merge 纯函数（对齐 T1/T2 语义）→ merged
  → rules 组装：遍历 merged 字段 → 注入 family/label（BASH_RULES 对齐）→
     source/origin 标注（对齐 T4）
  → 响应
```

### 4.2 保存

```
renderer 面板/JSON → {完整项目 JSON}
  → PUT → zod 校验（validateUnifiedConfig，T5）
  → 原子写（<path>.tmp 写入 → rename 覆盖，失败不污染现有文件）
  → 响应 {saved, mtime}
  →（无需通知 worker——T3：下次评估自动感知）
```

### 4.3 面板状态 ↔ 项目 JSON（前端视图转换）

```
面板渲染：rules[]（source=project 的行高亮「项目已改」）
用户编辑：改 allow/ask → 标记 projectOverridden；改回跟随全局 → 取消标记
保存生成：project JSON =
   已知字段取面板状态（覆盖项写入；跟随全局项不写=删除）
   + 未知字段（rules 之外的顶层/深层键）原样保留（读自原 project JSON）
```

## 5. 测试 seams（对齐 Q7 拍板）

| 稳定块 | seam | 测试类型 | 关键断言 |
|---|---|---|---|
| B2 全局基底 | GET 响应 global 字段 | API | = 部署 JSON 原文 |
| B3 继承视图 | merge 纯函数 + GET rules | 单测 + API | 与 gotgenes `mergeFlatPermissions` 语义一致（对照测试：同一输入 → 同一 merged）；source/origin 标注正确 |
| B4-B7 面板化 | GET rules 元数据 + 面板组件 | API + E2E | family 分组正确；label 注入正确（BASH_RULES 对齐）；覆盖/继承双态 |
| B8 JSON 单向同步 | PUT（未知字段保留） | API | 原文件含自定义键 → 面板保存后仍在 |
| B9 首次生成 | PUT（无文件） | API | 生成最小覆盖集文件；目录创建 |
| B10 校验 | PUT（非法） | API | 400 + 路径化错误；文件未变 |
| B11 保存即生效 | 1 条真实链路 E2E | E2E | 保存后同会话内命令评估变化（rm 放行→询问） |
| 取消覆盖 | PUT（字段删除） | API | 落盘后字段消失，merged 回落全局 |
| 原子写 | PUT 失败注入 | API | 文件保持上次合法状态 |

**capability/entity**：`agent-dialogue` / `conversation-space`（权限策略属于对话 agent 能力域；与既有 REQ-AGENT-041 同域）。

## 6. 关键实现决策

1. **merge 纯函数对齐 gotgenes**：不重复造 merge 语义——单测用「同一输入喂 gotgenes `mergeFlatPermissions` 与我们的实现 → 输出一致」做对照，防止继承视图与运行时执行错位（最危险错位）。
2. **zod 校验复用**：直接调 gotgenes `validateUnifiedConfig`（T5）——保存拦截的 = 运行时 fail-closed 的，同一把尺。
3. **元数据注入**：BASH_RULES 的 family/pattern 与部署 JSON pattern 对齐（T8）——对齐失败（规则表与部署 JSON 漂移）时该条 rule 的 family 标「未分组」+ 警告日志（呼应 ADR-020 配平心智）；对齐逻辑单测。
4. **原子写**：tmp + rename（同目录，保证同文件系统 rename 原子性）；失败清理 tmp。
5. **路径安全**：projectId → localPath 走 projectService（与 agentService 装配同源）；写入前 realpath containment 校验（防 projectId 映射目录被替换为 symlink 逃逸——复用既有 pathUtils，参考图片白名单 BUG-005 教训）。
6. **前端视图转换**：未知字段保留 = 读原 project JSON，删除 rules 认识的键，合入面板状态生成的覆盖键——「面板认识字段清单」来自 GET rules 的 key 集合。

## 7. 安全 / 性能 / 可观测性

**安全**（checklists/security.md）：
- 信任边界：项目 `.pi` 文件 = 用户可写面（本来就可手写，UI 不扩大攻击面）；主进程校验写入路径 containment（防 symlink 逃逸）。
- 校验 = gotgenes zod（与运行时一致），非法不落盘。
- 全局部署 JSON 只读，UI 无全局编辑入口（ADR-020 保持）。

**性能**：文件小（KB 级），无性能热点；读路径无缓存（每 GET 读两个小文件，可接受）；保存路径单写。

**可观测性**（checklists/observability.md）：
- 保存日志：`permission.save {projectId, path, mtime, issues?}`（成功/校验失败/IO 失败三态）。
- 元数据对齐失败警告：`permission.meta-mismatch {pattern, family?}`。
- 读取失败（项目 JSON 坏文件）：`permission.read-project-invalid {projectId, issues}`——UI 显示解析错误（E6 防御面）。

## 8. 与既有约束的关系

- **ADR-020 不动**：全局只读（UI 展示部署 JSON，不提供编辑）；「代码=真源」指出厂语义，本方案不改变生成器/配平机制。
- **ADR-017 不动**：授权桥/确认卡运行时机制零改动。
- **REQ-AGENT-033 冲突**：既有断言「设置页无权限 tab/区」针对 Settings 页 locator；本方案入口在**项目详情弹窗**（ProjectDetailModal.jsx 新增 tab，管理区）——locator 面隔离，需在实现时确认既有 E2E 不触碰新 tab 断言（技术复核项）。
- **worker/gotgenes 零改动**：全部变更在 renderer + 主进程服务层 + HTTP 路由。

## 9. 风险与回退

| 风险 | 概率/影响 | 缓解 |
|---|---|---|
| merge 语义与 gotgenes 不一致（UI 显示 ≠ 实际执行） | 低/高 | 对照单测（同一输入 → 同一输出）；T1/T2 实证基线 |
| 面板表达面 < JSON 全字段（自定义字段） | 低/中 | 未知字段保留机制（4.3）；JSON 模式兜底 |
| 元数据对齐漂移（BASH_RULES 与部署 JSON 不同步） | 低/低 | 对齐失败降级「未分组」+ 警告日志；ADR-020 配平测试本就会红 |
| gotgenes 上游合并语义变更（升级破坏对照测试） | 低/中 | 对照测试会红 → 显式升级动作 |
| E2E 保存即生效 flaky（worker 冷启动） | 中/低 | 复用 OPC_AGENT_FAUX + 轮询预算（既有模式）；仅 1 条 |

## 10. ADR 判断

本方案满足 ADR 三条件（难逆转/不说明困惑/真实取舍）的决策：

- **「项目级配置 UI 以字段级覆盖为语义（未定义继承全局）」**——这是 gotgenes 原生语义的确认与契约化，实现将以此为准；未来读者困惑「为什么项目文件只有几行」时会需要此说明。**候选 ADR-022**（覆盖语义 + 最小覆盖集文件形态 + 取消覆盖=删除）。
- 其余决策（单端点、覆盖式保存、元数据注入）为接口层面选择，随实现可调，不满足「难逆转」。

## 11. 待确认（提交审查后定稿）

- [ ] ADR-022 是否落档（字段级覆盖语义契约化）——建议落，供未来「项目级配置」相关 story 引用
- [ ] REQ-AGENT-033 断言面隔离的技术复核（实现时确认既有 E2E locator 不受新 tab 影响）
- [ ] rules 数组的 family 分组命名与 UX 原型一致（删除文件/提权系统/重定向管道/工具级/path/外部目录/授权链开关）

---

## 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-08-10 | 初稿：Q1-Q8 技术决策收敛（全局=部署 JSON / 字段级覆盖 / 最小覆盖集 / 单端点 / 元数据注入 / 覆盖式保存）+ gotgenes 实证 T1-T9 + 模块/接口/数据流/测试 seams |
