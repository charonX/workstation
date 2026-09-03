# 项目内文件预览

> 状态：已完结（历史记录，2026-09-03 验收）
> 故事 ID：`2026-08-31-file-preview`
> 最后更新：2026-09-03

---

## 1. 问题陈述

在 workstation 里查看项目内的 Markdown / 代码文件时，只能看到原始文本，没有渲染后的预览（Markdown 渲染、代码高亮），阅读和 review 体验差。agent 协作场景下高频出现：agent 说「我改了 src/foo.js」「文档写在 docs/a.md」，用户想看渲染结果却要离开 app 去别的工具。

## 2. 解决方案

给 workstation 加「项目内文件预览」能力：左侧文件树边栏（项目空间根）+ 右侧文件预览面板（复用内置浏览器面板的容器心智，React 层渲染），聊天内 agent 输出的本地文件路径变为可点击。Markdown 渲染成排版文档（复用聊天同一条 MarkdownRenderer 管线）、代码带语法高亮、图片直渲；纯只读；文件被外部修改时预览自动刷新；预览硬限制在项目空间根内。

## 3. 用户故事

1. 作为 agent 协作者，我想要点击聊天里 agent 提到的本地文件路径就看到渲染预览，以便不离开会话就能 review agent 产出的文档/代码。
2. 作为 agent 协作者，我想要一棵项目文件树，以便主动浏览项目里有什么文件并点开预览。
3. 作为 agent 协作者，我想要 agent 再次修改正在预览的文件时预览自动刷新，以便看到的始终是最新内容。
4. 作为项目所有者，我想要预览被硬限制在项目根内，以便聊天里出现的越界路径不会造成任意文件读取。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | 文件预览面板（右侧滑出，复用浏览器容器心智；Markdown 渲染/源码切换、代码高亮、图片直渲；只读；头部=路径+操作） | 访谈方向 A 显式确认；容器心智复用已签核的浏览器面板决策 |
| 2 | 聊天路径点击入口（行内 code 路径形态识别 → 点击打开文件预览面板；**代码围栏内不识别**） | 用户 Q1 显式确认主入口；识别范围 tech-design Q2 定案（ADR-042 决策 4） |
| 3 | 文件树边栏（左侧可收起；项目根全树懒加载；隐藏噪音目录；点文件开预览） | 用户 Q1 显式确认「同时需要文件树」，Q1(R2) 确认左侧边栏形态 |
| 4 | 自动刷新（文件外部变更 → 预览刷新） | 用户 Q5 显式确认「要刷新」 |
| 5 | 安全与边界（根目录硬约束主进程校验；>1MB 拒读；二进制/不支持类型明确提示） | 用户 Q4(R2)/Q5(R2) 确认；复用 artifactPathGuard 既有先例 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| — | 无（2026-09-02 tech-design 全部定案） | 块 1 路径识别 → 定案「仅行内 code，围栏不识别」（ADR-042 决策 4）；块 2 图片预览 → 定案「纳入，白名单对齐附件清单，SVG 拒收走 E4」（ADR-042 决策 3） |

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

**流 A：聊天路径点击预览（稳定块 2 → 1）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 项目空间会话中，agent 消息含本地文件路径（如 `docs/guide.md`） | 路径渲染为可点击链接样式 | 路径文本带可点击 affordance |
| 2 | 点击该路径 | 右侧文件预览面板滑出，头部显示该路径，内容区显示 Markdown 渲染视图 | 面板打开且渲染出 `<h1>` 等排版元素（非原始 `# ` 文本） |
| 3 | 点击头部「源码」切换 | 内容区切换为原始文本（等宽、带行高亮的纯文本视图） | 显示文件原始字节内容 |
| 4 | 点击「✕」或面板外收起控件 | 面板收起 | 面板不可见 |

**流 B：文件树浏览预览（稳定块 3 → 1）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 项目空间会话中点击文件树入口 | 左侧边栏展开，显示项目根目录顶层条目（目录在前、文件在后） | 顶层条目与磁盘一致；`.git`/`node_modules` 不出现 |
| 2 | 点击目录 | 该目录就地展开（懒加载子条目） | 子条目出现且与磁盘一致 |
| 3 | 点击代码文件（如 `src/main.js`） | 右侧文件预览面板打开，显示语法高亮源码 | 关键字/字符串等着色（高亮 token 存在） |
| 4 | 点击树头部「收起全部」 | 所有已展开目录收起；按钮变为「展开全部」，再点全部展开 | 树回到仅顶层可见 / 全部展开态 |
| 5 | 再次点击文件树入口 | 边栏收起 | 边栏不可见 |

**流 C：自动刷新（稳定块 4）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 文件预览面板正打开 `docs/guide.md` | 面板显示当前内容 | — |
| 2 | 外部（agent）修改该文件并落盘 | 预览自动刷新为新内容 | 新内容中的特征字符串出现在渲染结果中 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 点击的路径解析后在项目根外（`..` 穿越 / 根外绝对路径） | 文件预览面板显示「仅支持预览项目内文件」，不读取磁盘 | E1 |
| 路径不存在 / 已被删除 | 面板显示「文件不存在」 | E2 |
| 文件 > 1MB | 不读取内容，面板显示「文件过大」+「在系统默认应用打开」按钮 | E3 |
| 文件为二进制 / 非 UTF-8 可解码 / 不支持类型（如 PDF） | 面板显示「不支持预览该类型」 | E4 |
| 预览中的文件被外部删除 | 面板切换为「文件不存在」态（watch 触发） | E2 |
| 非项目空间会话（通用/飞书/孤儿） | 不显示文件树入口；聊天路径点击提示无解析根 | E5 |
| 文件在读取后、渲染前被修改（竞态） | 以最近一次读取为准；watch 事件随后对齐 | —（无副作用） |
| 路径形态文本出现在代码围栏内 | 不转为可点击链接，保持纯代码呈现（仅行内 code 参与识别） | —（设计取舍，ADR-042 决策 4） |
| 聊天路径点击的文件是 SVG | 按不支持类型处理（白名单对齐附件清单，SVG 拒收） | E4 |

### 6.3 预期值锚点（Expected-Value Anchors）

| 稳定块 | 输入 | 预期输出/结果 | 依据 |
|---|---|---|---|
| 1（文件预览面板） | 文件 `a.md` 内容 `# Title` | 渲染视图含 `<h1>Title</h1>`；切源码视图显示字面量 `# Title` | 复用 MarkdownRenderer 管线（react-markdown + GFM）既有行为 |
| 1（文件预览面板） | 文件 `a.js` 内容 `const x = 1;` | 高亮视图中 `const` 被高亮 token 包裹；不进入 Markdown 渲染 | 与聊天内围栏代码块同高亮规则 |
| 2（路径入口） | 消息文本含 `docs/guide.md`（项目根 `/proj`） | 点击后主进程收到读取请求，路径参数解析为 `/proj/docs/guide.md` | 访谈 R2-Q4：相对路径按根解析 |
| 2（路径入口） | 消息文本含 `../outside.txt`（项目根 `/proj`） | 拒绝预览，面板显示「仅支持预览项目内文件」；不触达磁盘读取 | 复用 `isArtifactPathAllowed` 语义：解析后必须落在根内（含 realpath 符号链接检查） |
| 3（文件树） | 项目根含条目 `.git/`、`node_modules/`、`src/`、`README.md` | 树顶层只出现 `src/`、`README.md`（目录在前） | 访谈 R2-Q2：硬编码噪音目录隐藏 |
| 3（文件树） | `docs/`、`src/` 均展开时点击「收起全部」 | 两目录均收起，仅顶层条目可见；按钮文案变为「展开全部」 | DESIGN 原型确认（2026-09-02）：树头部提供全部展开/收起 |
| 4（自动刷新） | 预览中文件内容从 `v1` 改为 `v2` 落盘 | 预览渲染结果中出现 `v2`、不再出现 `v1` | 访谈 Q5：自动刷新 |
| 5（边界） | 文件大小 1MB + 1 字节（1,048,577 B） | E3「文件过大」；1,048,576 B 正常读取 | 访谈 R2-Q5：1MB 上限，边界值含 1MB 本身 |

## 7. 表单与输入验证（Form / Input Validation）

本 story 无表单输入；唯一用户输入是「点击的路径字符串」与「树中点击的条目」。

| 输入字段 | 规则 | 有效例子 | 无效例子（→错误提示） | 错误状态 |
|---|---|---|---|---|
| 预览路径（点击传入） | 非空字符串；解析后落在项目根内（realpath 校验）；指向存在的文件 | `docs/guide.md`（根 `/proj` 下存在） | `../etc/passwd` → 「仅支持预览项目内文件」；`ghost.md` → 「文件不存在」 | E1 / E2 |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 例子（触发 → 期望结果） | 错误状态 |
|---|---|---|---|
| 文件大小 ≤ 1MB（1,048,576 B）才读取内容 | 读取前 stat | 1,048,577 B → E3 拒读 | E3 |
| UTF-8 可解码才进入文本类预览 | 读取后判定 | PDF 字节流 → 「不支持预览该类型」 | E4 |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| E1 越界路径 | 路径解析/符号链接解析后落在项目根外 | `E-PREVIEW-OUTSIDE-ROOT` | 面板内提示「仅支持预览项目内文件」 | 无（不读磁盘） |
| E2 文件不存在 | 路径不存在 / 预览中被删除 | `E-PREVIEW-NOT-FOUND` | 面板内提示「文件不存在」 | 无；watch 已注册则注销 |
| E3 文件过大 | size > 1,048,576 B | `E-PREVIEW-TOO-LARGE` | 面板提示「文件过大」+「在系统默认应用打开」按钮 | 无（不读内容） |
| E4 不支持类型 | 二进制 / 非 UTF-8 / 未纳入类型 | `E-PREVIEW-UNSUPPORTED` | 面板提示「不支持预览该类型」 | 无 |
| E5 无解析根 | 非项目空间会话触发预览/树 | `E-PREVIEW-NO-ROOT` | 提示「当前会话无项目空间」；树入口隐藏 | 无 |
| E6 读取 I/O 失败 | 权限不足 / 磁盘错误 | `E-PREVIEW-READ-FAILED` | 面板提示「读取失败」+ 重试 | 无 |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 模块数 4（主进程文件预览服务 HTTP+SSE、文件预览面板、文件树、聊天链接分发）；新增 HTTP/SSE 契约 ≥3（读目录/读文件/监听）；分支多（文件类型 × 6 种错误态 × watch 生命周期）；新外部依赖 fs.watch（跨平台语义差异）；路径识别规则有误报面。参照：内置浏览器 story 同为 complex。 |

- 结晶路径：`PRD → DESIGN → DOMAIN-MODEL → TECH-DESIGN → CRYSTALLIZE`（§10 由 `/tech-design` 深潜补全）。

## 10. 技术方案（Implementation Decisions）

> complex story：本节由 `/tech-design` 深潜完成（2026-09-02）。关键决策已沉淀 **ADR-042**。

### 10.1 设计目标

- 在不推翻浏览器协议白名单（http/https only）的前提下，为项目内文件提供一条「主进程受控读取 → React 层渲染」的预览通道，观感与聊天内 Markdown 渲染一致。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| 文件预览服务（主进程/服务层） | HTTP 端点：目录列举 / 文件读取 / watch 注册注销；根目录硬约束（registry 解析根 + `isArtifactPathAllowed` realpath 双检语义）；1MB 上限；类型判定（扩展名白名单 + UTF-8 嗅探）；fs.watch 单文件监听 + 200ms 防抖 → SSE 推送 | 是 |
| 文件预览面板（渲染进程） | 右侧槽位面板（与浏览器面板互斥，复用容器心智与 mini-store 模式）；Markdown 渲染复用 MarkdownRenderer 管线（传 projectDir=projectId）；代码 hljs 高亮（复用 highlightCode）；图片 blob URL；错误态页；toast 刷新提示 | 是 |
| 文件树边栏（渲染进程） | 左侧可收起边栏；懒加载目录树（一次展开一次 list）；噪音目录过滤；全部展开/收起；点击分发到文件预览面板 | 是 |
| 聊天路径分发（渲染进程） | 行内 code 路径形态识别纯逻辑 + 点击分发（先例：`mdLinkDispatch.js` 纯函数 seam）；围栏内不识别 | 既有模块扩展（MarkdownRenderer 行内 code 分支） |
| MarkdownRenderer | 渲染管线复用（非流式模式；projectDir 传项目 ID，文内图片走既有解析机制） | 否（复用） |
| 浏览器面板 | 槽位互斥的被收起方（实例保活，可见性解耦语义不变） | 否（仅联动） |

#### 模块关系图

```
[聊天消息 行内 code 路径]          [文件树边栏]
        │ 路径形态识别(纯函数)            │ GET files/list(懒加载)
        ▼                            ▼
[路径分发] ──────────────► [文件预览面板 store] ◄── 右侧槽位互斥 ── [浏览器面板(收起保活)]
                                   │ GET files/read（文本）
                                   │ GET files/image（图片,既有端点）
                                   │ POST/DELETE files/watch
                                   ▼
                        [文件预览服务（主进程）]
                         registry 解析根 → realpath 双检
                         stat(1MB) → 类型判定 → UTF-8 读取
                                   │ fs.watch + 200ms 防抖
                                   ▼
                        [既有会话 SSE] ──file-preview-changed──► 面板重读/E2 页
```

### 10.3 数据流

**流 A：点击预览（聊天路径 / 树文件同路）**

1. **触发**：聊天消息行内 code 路径点击，或树中文件点击 → `openWithPath(projectId, path)`。
2. **输入校验**：renderer 路径形态判定（纯函数，决定渲染为可点击）；主进程权威校验：projectId → registry 解析根（无根 → E-PREVIEW-NO-ROOT）；路径 normalize + realpath 双检（越界 → E-PREVIEW-OUTSIDE-ROOT，不触达内容读取）。
3. **核心处理**：stat → 不存在 E-PREVIEW-NOT-FOUND；类型判定：图片白名单（jpeg/png/gif/webp/bmp/heic/heif，对齐附件清单）→ image（不带 content，不受 1MB 文本上限约束）；非图片文本/代码类若 size > 1,048,576 B → E-PREVIEW-TOO-LARGE；`.md/.markdown` → markdown；代码扩展名集 → code（带 hljs 语言键）；其余扩展名 → UTF-8 嗅探，可解码 → code（plaintext 兜底），不可解码 → E-PREVIEW-UNSUPPORTED。文本类读取 UTF-8 content。
4. **副作用**：面板打开文件 → `POST files/watch` 注册单文件 fs.watch（E2 态不注册）；变更事件 200ms 防抖合并 → SSE `file-preview-changed`；面板关闭/切换文件/切换会话 → `DELETE files/watch/:watchId` 注销。
5. **输出**：kind=markdown → MarkdownRenderer 渲染视图（默认）/源码视图切换；code → hljs 高亮 + 行号；image → 面板经既有 image 端点取 blob URL 直渲；错误 → 对应错误页（E1/E2/E3/E4/E5/E6）。

**流 C：自动刷新**

SSE `file-preview-changed{projectId, path, change}` 到达 → 匹配当前打开文件：`modified` → 重新 read + 渲染 + toast「文件已被外部修改，已自动刷新」；`deleted` → 切 E2 页 + 注销监听。SSE 重连/面板重新打开时主动 re-read 兜底（事件不做回溯，沿袭 SSE 只推增量语义）。

### 10.4 接口契约

#### 接口 1：GET `/api/agent/files/list` — 目录列举

| 项目 | 说明 |
|---|---|
| 调用方 | 文件树边栏（renderer） |
| 被调用方 | 文件预览服务（主进程） |
| 输入 | `projectId: string`、`dir: string`（相对解析根，`""` = 根） |
| 输出 | `{ entries: [{ name: string, type: "dir"\|"file", size?: number }] }`；排序：目录在前，同类按 name localeCompare；噪音目录（`.git`/`node_modules`/`dist` 等硬编码清单）不出现 |
| 业务错误 | `E-PREVIEW-NO-ROOT` / `E-PREVIEW-OUTSIDE-ROOT` / `E-PREVIEW-NOT-FOUND`（dir 不存在或非目录） |
| 系统错误 | 磁盘 I/O → `E-PREVIEW-READ-FAILED` |
| 副作用 | 无 |
| 幂等性 | 是 |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 正常 | fixture 根含 `.git/`、`node_modules/`、`src/`、`README.md`；`dir=""` | `entries=[{name:"src",type:"dir"},{name:"README.md",type:"file",size:<N>}]`（`.git`/`node_modules` 不出现；目录在前） |
| 边界 | `dir="empty-dir"`（空目录存在） | `entries=[]` |
| 异常 | `dir="../"` | 400 `E-PREVIEW-OUTSIDE-ROOT` |

#### 接口 2：GET `/api/agent/files/read` — 文件读取

| 项目 | 说明 |
|---|---|
| 调用方 | 文件预览面板（renderer） |
| 被调用方 | 文件预览服务（主进程） |
| 输入 | `projectId: string`、`path: string`（相对按根解析；根内绝对路径允许） |
| 输出 | `{ kind: "markdown"\|"code"\|"image", content?: string, language?: string, size: number, mtimeMs: number }`；`kind="image"` 不带 content（面板走接口 4 取 blob） |
| 业务错误 | `E-PREVIEW-OUTSIDE-ROOT` / `E-PREVIEW-NOT-FOUND` / `E-PREVIEW-TOO-LARGE` / `E-PREVIEW-UNSUPPORTED` / `E-PREVIEW-NO-ROOT` |
| 系统错误 | `E-PREVIEW-READ-FAILED` |
| 副作用 | 无（watch 注册是接口 3 的职责，不隐式附带） |
| 幂等性 | 是 |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 正常 md | `docs/guide.md`，内容 `# Title` | `{kind:"markdown", content:"# Title", size:7, mtimeMs:<N>}` |
| 正常 code | `src/auth.js`，内容 `const x = 1;` | `{kind:"code", language:"javascript", content:"const x = 1;"}` |
| 边界 1MB | size=1,048,576 B | 200 正常返回；size=1,048,577 B → `E-PREVIEW-TOO-LARGE` |
| 异常越界 | `../outside.txt` | `E-PREVIEW-OUTSIDE-ROOT`（含符号链接逃逸，realpath 双检） |
| 异常类型 | `docs/spec.pdf` / SVG | `E-PREVIEW-UNSUPPORTED` |

#### 接口 3：POST/DELETE `/api/agent/files/watch` — 变更监听生命周期

| 项目 | 说明 |
|---|---|
| 调用方 | 文件预览面板（renderer） |
| 被调用方 | 文件预览服务（主进程） |
| 输入 | POST `{ projectId, path }`；DELETE `watchId` |
| 输出 | POST → `{ watchId: string }`；DELETE → 204 |
| 业务错误 | POST 边界校验同接口 2（E1/E5）；**E2 不允许注册**（面板处于不存在态则无监听；用户重新点击触发重读） |
| 系统错误 | fs.watch 失败 → `E-PREVIEW-READ-FAILED` |
| 副作用 | 注册/注销 fs.watch 句柄；重复 POST 同 (projectId,path) 幂等返回同一 watchId |
| 幂等性 | 是（POST 同键幂等；DELETE 重复调用 204） |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 正常 | POST `{projectId:"p1", path:"docs/guide.md"}` | `{watchId:"w-1"}`；再次 POST 同参数 → 同 `{watchId:"w-1"}` |
| 边界 | 文件被删后 POST 同路径 | `E-PREVIEW-NOT-FOUND`（不注册） |
| 异常 | DELETE 不存在 watchId | 204（幂等吞掉） |

#### 接口 4：GET `/api/agent/files/image` — 图片读取（**既有契约复用，REQ-AGENT-051，不改**）

面板图片视图直接消费既有端点（projectId + path → 二进制 → blob URL）；扩展名白名单对齐附件清单；SVG 拒收由接口 2 的 `E-PREVIEW-UNSUPPORTED` 前置拦截。

#### 接口 5：SSE `file-preview-changed` — 变更推送

| 项目 | 说明 |
|---|---|
| 推送方 | 文件预览服务（主进程，watch 触发后经 200ms 防抖合并） |
| 消费方 | 文件预览面板（renderer，既有会话 SSE 连接，不新建通道） |
| 载荷 | `{ projectId: string, path: string, change: "modified"\|"deleted" }` |
| 消费语义 | 匹配当前打开文件：modified → 重新 read + toast；deleted → E2 页 + 注销监听；不匹配 → 忽略 |
| 可靠性 | SSE 只推增量不做回溯（沿袭既有语义）；断线窗口丢失由面板重连/重开时主动 re-read 兜底 |

**样例（golden values）**：

| 场景 | 事件载荷 | 面板结果 |
|---|---|---|
| 修改 | `{projectId:"p1", path:"docs/guide.md", change:"modified"}` | 重新 read；新内容特征串出现；toast 提示 |
| 删除 | `{...same, change:"deleted"}` | E2「文件不存在」页；监听注销 |
| 连写合并 | 200ms 窗口内 3 次落盘 | 仅 1 次事件 + 1 次重读 |

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 通道 = HTTP API + SSE（ADR-042 决策 1） | HTTP+SSE / Electron IPC | 纯数据无 bounds 需求；files/image 先例同构；CLI 可测 | 两套通道范式并存，ADR 已说明边界 |
| 右侧槽位互斥（ADR-042 决策 2） | 互斥 / 并存 | 不挤压对话窗；浏览器实例保活语义不破 | 同屏对照场景让位，后续可议 |
| 路径识别仅行内 code（ADR-042 决策 4） | 行内 code / +裸文本 / +存在性预校验 | 误报近零；纯函数可单测；E2 页兜底不存在路径 | 围栏/裸文本路径不可点（v1 接受） |
| 图片白名单对齐附件（ADR-042 决策 3） | 对齐 / +SVG / 不纳入 | 单份安全口径；复用既有端点零新增风险面 | SVG 设计稿看不了（E4 逃生口） |
| watch = fs.watch 单文件 + 200ms 防抖；rename 归并为 modified | fs.watch / fs.watchFile 轮询 / chokidar | 零新依赖；编辑器原子写（临时文件+rename）在 macOS 表现为 rename 序列，归并后等价修改 | 跨平台事件语义差异（§10.6 假设 1） |
| 代码高亮复用 MarkdownRenderer 的 `highlightCode`（hljs 同语言集） | 复用 / 另引高亮库 | 观感与聊天围栏块一致；零新依赖 | 语言集与聊天一致（超集需求回流） |
| Markdown 预览传 `projectDir=projectId` | 传 / 不传 | 文内图片走既有 ADR-021 解析机制，相对路径图片可见 | 无 |

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| fs.watch + rename 归并足以覆盖编辑器原子写（macOS 主战场） | 自动刷新丢失或抖动 | TECH-DESIGN（watch 策略改轮询/父子双监听） | 能（主进程 spike：writeFile / mv 实测事件序列） |
| 行内 code 路径形态正则误报率低 | 非路径文本变链接，点击见 E2 骚扰 | PRD §4 块 2（识别范围收紧/放宽） | 能（正则单测 + 真实会话样本） |
| SSE 断线窗口变更可接受（re-read 兜底） | 预览短暂陈旧，用户无感知刷新缺失 | TECH-DESIGN（补重连全量对账） | 能（E2E 断连重连场景） |
| 1MB 内 Markdown 渲染不卡（memo + 上限） | 大文档预览卡顿 | PRD（降上限/分页渲染） | 能（fixture 压测） |

### 10.7 安全/性能/可观测性

- **安全**（对齐 `checklists/security.md`）：全部文件读取经主进程权威校验——projectId → registry 解析根（无根拒），路径 normalize + realpath 双检（符号链接逃逸拦截），渲染层零信任。渲染安全沿袭 ADR-021：react-markdown 无 raw HTML、hljs 输出已转义、mermaid securityLevel strict。图片走既有白名单端点，SVG 拒收。全链路**无写面**（只读）。SSE 载荷只含路径元信息不含文件内容。
- **性能**（对齐 `checklists/performance.md`）：1MB 读取上限含本数；树懒加载（一次展开一次 list，不全树扫描）；watch 200ms 防抖合并连写；MarkdownRenderer memo 既有；blob URL 用后 revoke；面板关闭即注销监听（句柄不泄漏）。
- **可观测性**（对齐 `checklists/observability.md`）：E-PREVIEW-* 错误码日志（含 projectId+path，不含内容）；watch 注册/注销日志；SSE 推送计数。telemetry seam = 主进程日志。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

> capability = `file-preview`；entity = `file-preview-panel` / `file-tree`。测试目录：`tests/capabilities/file-preview/<entity>/2026-08-31-file-preview/`。

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 5（安全与边界） | `GET /api/agent/files/read|list`（HTTP 集成，CLI/curl 可复验）：根约束 / realpath 双检 / 1MB 边界值 / 类型判定 | 集成（真实 fs fixture 临时目录 + registry stub） | 真实文件系统 |
| 2（路径入口） | 路径识别纯函数（行内 code 形态判定 + 分发动作；先例：`mdLinkDispatch`） | 单元 | 纯逻辑无依赖 |
| 1（文件预览面板） | 面板组件：渲染/源码切换、kind 分支（md/code/image）、错误态页、SSE 事件消费、槽位互斥 | 组件测试（mock fetch/SSE） | mock HTTP/SSE |
| 3（文件树） | 树组件：展开/懒加载/噪音过滤/全部展开收起/点击分发 | 组件测试（mock fetch） | mock HTTP |
| 4（自动刷新） | `POST/DELETE files/watch` + fs.watch → SSE `file-preview-changed`：防抖合并 / modified 重读 / deleted→E2 / 注销幂等 | 集成（主进程，真实 fs fixture）+ 组件（SSE 事件消费） | 真实 fs / mock SSE |
| 全链路 | E2E：聊天点路径 → 面板打开渲染；树点文件 → 面板打开；面板互斥；watch 修改自动刷新 | Playwright Electron（先例：embedded-browser E2E） | 真实 app + fixture 项目 |

### 11.2 测试策略与先例

- 只测外部行为：路径识别测「输入字符串 → 分发动作」，面板测「HTTP 响应/SSE 事件 → 渲染结果」，服务端测「请求 → 响应/事件」，不测内部状态。
- 先例：`mdLinkDispatch.js`（链接分发纯逻辑 + 组件测试）、`artifactPathGuard.js`（路径约束单元测试）、`fetchProjectImage`（HTTP 文件读取端点，REQ-AGENT-051）、embedded-browser 的 mini-store + 组件测试与 Playwright E2E。
- 主观观感（高亮配色、树缩进密度）不进断言，归 REFLECT 人工验收。

## 12. 范围外

- 文件编辑 / 保存（另一个 story）
- PDF / 二进制预览
- `.gitignore` 解析（第一版硬编码噪音目录清单）
- 多项目切换的文件树（树绑定当前会话项目空间）
- 文件操作（新建 / 删除 / 重命名 / 拖拽）
- 浏览器面板本身改动（地址栏 / 导航历史等）
- 编辑器级能力（minimap、折叠、跳转定义）

## 13. 补充说明

- 既有可复用资产：`MarkdownRenderer`（渲染管线，含 GFM/KaTeX/mermaid/高亮/项目根图片解析）、`isArtifactPathAllowed`（根目录约束）、`browserPanelStore`（面板 mini-store 模式先例）、`mdLinkDispatch`（链接分发纯函数 seam 先例）。
- 访谈笔记：`.aiassist/stories/2026-08-31-file-preview/interview-notes.md`。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | 流 A/B/C 覆盖 5 个稳定块；分支异常 §6.2 |
| 输入验证 | PASS | §7 路径规则含有效/无效例子；无表单已声明 |
| 错误状态 | PASS | §8 六种错误态含错误码与用户可见状态 |
| 预期值锚点 | PASS | §6.3 每稳定块 ≥1 条字面值锚点（含 1MB 边界值、噪音目录过滤例子） |
| 复杂度分级 | complex | §9 理由已给；结晶前需 `/tech-design` |
| 技术方案（§10） | PASS | tech-design 深潜完成（2026-09-02）：§10.2–10.7 全量 + 5 接口契约 golden values；ADR-042 落地 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-31 | 初稿 | AI + 人 |
| v0.2 | 2026-09-02 | DESIGN 收割：文件树全部展开/收起回流 §6.1/§6.3 | AI + 人 |
| v1.0 | 2026-09-02 | tech-design 深潜：移动块全定案（路径识别仅行内 code；图片纳入对齐附件白名单）；§10 完整填充（HTTP+SSE 通道、槽位互斥、5 接口契约 golden values）；ADR-042；术语规范化（文件预览面板） | AI + 人 |
