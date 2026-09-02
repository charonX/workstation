# 项目内文件预览 — 需求

> 故事 ID：`2026-08-31-file-preview`
> 版本：`v1`
> 哈希：见 `requirements-v1.hash`
> 最后更新：2026-09-02

---

## 全局约束

- 预览硬限制在当前会话项目空间解析根内：projectId → registry 解析项目目录，路径 normalize + realpath 双检（复用 `isArtifactPathAllowed` 语义）；渲染层零信任，主进程权威校验。
- 纯只读：全链路无写面。
- 协议白名单不推翻：预览不走 `file://` / WebContentsView，内容层全部 React 渲染（ADR-042 决策 1）。
- 渲染观感与聊天一致：Markdown 复用 MarkdownRenderer 管线；代码高亮复用 `highlightCode`（hljs 同语言集）。
- 图片白名单对齐附件清单（jpeg/png/gif/webp/bmp/heic/heif；SVG 拒收），传输复用既有 `GET /api/agent/files/image`（ADR-042 决策 3）。
- 右侧槽位互斥：文件预览面板与浏览器面板同一时刻至多开一个，互收不毁实例（ADR-042 决策 2）。
- 通道 = HTTP API（读/列/watch）+ 既有会话 SSE（变更推送），不走 Electron IPC（ADR-042 决策 1）。
- 术语：CONTEXT.md「文件预览面板」「文件树」「解析根」「噪音目录」；裸词「预览面板」禁用。

---

## REQ 列表

### REQ-PREVIEW-001: 文件预览面板容器与右侧槽位互斥

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 组件 / E2E
**UX 参照：** `ux/file-preview.html`

#### 验收标准

1. `openWithPath(projectId, path)` 触发后，文件预览面板打开（右侧滑出），头部显示该 path 与类型标签。
2. 文件预览面板打开时若浏览器面板处于打开态 → 浏览器面板收起（其实例保活，不被销毁）；反向同理（打开浏览器面板 → 文件预览面板收起）。
3. 点击头部「✕」→ 面板收起；收起后再次 `openWithPath` 可重新打开。
4. 面板头部操作区含：复制内容、在系统默认应用打开、收起三个控件（UX 参照 chrome 条）。

#### 测试可追溯性

- 测试：`previewPanel.test` / E2E `filePreview.test`
- seam：面板组件 + store（mini-store 模式，先例 browserPanelStore）；E2E 槽位互斥
- 断言：expected 值 trace 到 PRD §6.1 流 A 步骤 2/4、ADR-042 决策 2

---

### REQ-PREVIEW-002: Markdown 渲染视图与源码切换

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 组件
**UX 参照：** `ux/file-preview.html`

#### 验收标准

1. 读取响应 `{kind:"markdown", content:"# Title"}` → 渲染视图含 `<h1>Title</h1>`（非字面量 `# Title`）——EXPECTED-TRACE: PRD §6.3 块 1 行 1。
2. Markdown 文件头部显示「渲染 / 源码」分段开关，默认渲染视图；切「源码」→ 显示文件原始字节内容（等宽 + 行号，字面量 `# Title` 原样可见）。
3. 渲染时 `projectDir` 传当前会话项目 ID，文内相对路径图片经既有 image 解析机制渲染（ADR-021 机制不变）。
4. 非 Markdown 文件（kind=code/image）不显示「渲染 / 源码」分段开关。

#### 测试可追溯性

- 测试：`previewPanel.test`（mock fetch 返回 §10.4 接口 2 golden values）
- seam：面板组件
- 断言：EXPECTED-TRACE PRD §6.3 块 1、§10.4 接口 2 样例

---

### REQ-PREVIEW-003: 代码高亮视图

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 组件

#### 验收标准

1. 读取响应 `{kind:"code", language:"javascript", content:"const x = 1;"}` → 高亮视图中 `const` 被高亮 token 包裹（hljs span），且不进入 Markdown 渲染——EXPECTED-TRACE: PRD §6.3 块 1 行 2。
2. 高亮使用与聊天围栏块同一 `highlightCode` 函数与语言集；未识别语言 → plaintext 兜底（不报错）。
3. 代码视图带行号；横向溢出可滚动。

#### 测试可追溯性

- 测试：`previewPanel.test`
- seam：面板组件 + highlightCode（既有 seam）
- 断言：EXPECTED-TRACE PRD §6.3 块 1 行 2、§10.5 决策 6

---

### REQ-PREVIEW-004: 图片视图（白名单对齐附件）

**分类：** P1
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 组件 / 集成

#### 验收标准

1. 读取响应 `{kind:"image"}`（扩展名 ∈ jpeg/png/gif/webp/bmp/heic/heif）→ 面板经既有 `GET /api/agent/files/image` 取 blob URL 直渲，不受 1MB 文本上限约束——EXPECTED-TRACE: PRD §10.4 接口 4。
2. SVG 文件请求 → 接口 2 返回 `E-PREVIEW-UNSUPPORTED`，面板显示 E4 错误页（不尝试渲染）。
3. 面板关闭/切换文件后，已创建的 blob URL 被 revoke（不泄漏）。

#### 测试可追溯性

- 测试：`previewPanel.test`（组件）+ `filesApi.test`（image 既有端点回归，SVG → E4）
- seam：面板组件 + `GET /api/agent/files/image`（既有）
- 断言：EXPECTED-TRACE PRD §6.2 SVG 行、§10.4 接口 2/4

---

### REQ-PREVIEW-005: 错误态页（E1–E6）

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 组件
**UX 参照：** `ux/file-preview.html`

#### 验收标准

1. `E-PREVIEW-OUTSIDE-ROOT` → 面板显示「仅支持预览项目内文件」，不触达磁盘内容读取——EXPECTED-TRACE: PRD §8 E1。
2. `E-PREVIEW-NOT-FOUND` → 显示「文件不存在」；`E-PREVIEW-TOO-LARGE` → 显示「文件过大」+「在系统默认应用打开」按钮；`E-PREVIEW-UNSUPPORTED` → 显示「不支持预览该类型」+ 同逃生按钮。
3. `E-PREVIEW-NO-ROOT`（非项目空间会话触发）→ 提示「当前会话无项目空间」。
4. `E-PREVIEW-READ-FAILED` → 显示「读取失败」+ 重试按钮，重试重新发起 read 请求。
5. 各错误页含对应错误码标签（如 `E-PREVIEW-TOO-LARGE` 可见）。

#### 测试可追溯性

- 测试：`previewPanel.test`（mock fetch 各错误码 → 断言文案与按钮）
- seam：面板组件
- 断言：EXPECTED-TRACE PRD §8 错误表全行

---

### REQ-PREVIEW-006: 聊天路径识别与点击分发（仅行内 code）

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 单元 / 组件

#### 验收标准

1. 行内 code 文本 `docs/guide.md` → 识别为本地路径，渲染为可点击链接样式——EXPECTED-TRACE: PRD §6.1 流 A 步骤 1。
2. 识别为纯函数：输入字符串 → 判定结果；形态规则 = 含路径分隔符（`/` 或 `\`）且尾段含扩展名，且无空格、无 URL scheme。反例：`a b/c.txt`（含空格）、`https://x.com/a.md`（有 scheme，归 MdLink http 路径）、`readme`（无扩展名无分隔符）→ 均不识别。
3. 代码围栏（fenced block）内的路径形态文本不转为可点击链接——EXPECTED-TRACE: PRD §6.2 末行（ADR-042 决策 4）。
4. 点击识别出的路径 → 分发 `openWithPath(projectId, path)`（相对路径原样透传，主进程按解析根解析）；当前会话非项目空间（无 projectId）→ 点击提示「当前会话无项目空间」（E5），不发请求。
5. 渲染期不做存在性预校验；不存在路径点击后由面板 E2 页兜底。

#### 测试可追溯性

- 测试：`pathRecognition.test`（纯函数正/反例矩阵）+ `MessageList/MarkdownRenderer` 组件测试（行内 code 变链接、围栏不变）
- seam：路径识别纯函数（先例 `mdLinkDispatch.js`）
- 断言：EXPECTED-TRACE PRD §6.3 块 2、§10.5 决策 3

---

### REQ-PREVIEW-007: 文件树边栏

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-tree`
**测试类型：** 组件 / E2E
**UX 参照：** `ux/file-preview.html`

#### 验收标准

1. 项目空间会话点击「文件」入口 → 左侧边栏展开，顶层条目 = 解析根 `list(dir="")` 响应；fixture 根含 `.git/`、`node_modules/`、`src/`、`README.md` → 树只出现 `src/`（目录在前）、`README.md`——EXPECTED-TRACE: PRD §6.3 块 3 行 1。
2. 点击目录 → 就地展开并发起该目录 `list`（懒加载：未展开的目录不发 list 请求）。
3. 树头部「收起全部」→ 所有已展开目录收起、仅顶层可见，按钮文案变「展开全部」；再点全部展开——EXPECTED-TRACE: PRD §6.3 块 3 行 2。
4. 点击文件条目 → 分发 `openWithPath(projectId, <相对路径>)；选中条目高亮；再次点击「文件」入口 → 边栏收起。
5. 非项目空间会话（通用/飞书/孤儿）→ 不显示「文件」入口，树不出现（E5 的前置规避）。

#### 测试可追溯性

- 测试：`fileTree.test`（mock list 响应）+ E2E 入口显隐
- seam：树组件 + `GET /api/agent/files/list`
- 断言：EXPECTED-TRACE PRD §6.1 流 B、§6.3 块 3、§10.4 接口 1

---

### REQ-PREVIEW-008: watch 注册/注销生命周期与防抖推送（服务端）

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 集成

#### 验收标准

1. `POST /api/agent/files/watch {projectId, path}` → `{watchId}`；同 (projectId, path) 重复 POST → 返回同一 watchId（幂等）——EXPECTED-TRACE: PRD §10.4 接口 3 样例。
2. 目标文件不存在 → POST 返回 `E-PREVIEW-NOT-FOUND`，不注册监听；越界路径 → `E-PREVIEW-OUTSIDE-ROOT`。
3. `DELETE /api/agent/files/watch/:watchId` → 204；重复 DELETE → 204（幂等吞掉）。
4. 被监听文件 200ms 窗口内连续 3 次落盘 → 仅推送 1 次 SSE `file-preview-changed{change:"modified"}`（防抖合并）——EXPECTED-TRACE: PRD §10.4 接口 5 样例。
5. 文件被删除 → 推送 `{change:"deleted"}` 且服务端自动注销该 watch（句柄不泄漏）。
6. 编辑器原子写（临时文件 + rename 覆盖）→ 归并为一次 `modified` 事件。

#### 测试可追溯性

- 测试：`filesWatch.test`（真实 fs fixture 临时目录）
- seam：`POST/DELETE /api/agent/files/watch` + fs.watch + SSE 推送
- 断言：EXPECTED-TRACE PRD §10.4 接口 3/5 全部样例

---

### REQ-PREVIEW-009: 面板自动刷新消费（渲染进程）

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 组件

#### 验收标准

1. 面板正打开 `docs/guide.md`，SSE `file-preview-changed{projectId, path:"docs/guide.md", change:"modified"}` 到达 → 重新 read 并渲染新内容（新特征串出现、旧内容消失）+ toast「文件已被外部修改，已自动刷新」——EXPECTED-TRACE: PRD §6.3 块 4。
2. `change:"deleted"` → 面板切 E2「文件不存在」页并注销监听（DELETE watch）。
3. 事件 (projectId, path) 与当前打开文件不匹配 → 忽略（不重读、不 toast）。
4. 面板关闭/切换打开另一文件 → 旧 watch 被 DELETE 注销，新文件重新 POST 注册。
5. SSE 断线重连后面板仍处于打开态 → 主动 re-read 当前文件一次（事件不回溯的兜底）。

#### 测试可追溯性

- 测试：`previewPanel.test`（mock SSE 事件序列）
- seam：面板组件 + SSE 消费
- 断言：EXPECTED-TRACE PRD §6.1 流 C、§10.4 接口 5

---

### REQ-PREVIEW-010: 文件读取/列举服务 API（根约束 + 上限 + 类型判定）

**分类：** P0
**优先级：** 必须
**Capability：** `file-preview`
**Entity：** `file-preview-panel`
**测试类型：** 集成（CLI/curl 可复验）

#### 验收标准

1. `GET /api/agent/files/read?projectId&path`：`docs/guide.md`（内容 `# Title`）→ `{kind:"markdown", content:"# Title", size:7, mtimeMs}`；`src/auth.js` → `{kind:"code", language:"javascript", content:"const x = 1;"}`——EXPECTED-TRACE: PRD §10.4 接口 2 样例。
2. 大小边界：size=1,048,576 B → 200 正常；size=1,048,577 B → `E-PREVIEW-TOO-LARGE`（不含内容）——EXPECTED-TRACE: PRD §6.3 块 5。
3. 越界：`../outside.txt` → `E-PREVIEW-OUTSIDE-ROOT`；经符号链接指向根外的路径 → 同码拒绝（realpath 双检）——EXPECTED-TRACE: PRD §10.4 接口 2 异常行。
4. 类型：`spec.pdf`、SVG → `E-PREVIEW-UNSUPPORTED`；无扩展名但 UTF-8 可解码 → `kind:"code"`（plaintext 兜底）；非 UTF-8 二进制 → `E-PREVIEW-UNSUPPORTED`。
5. 无解析根（projectId 无效/非项目空间）→ `E-PREVIEW-NO-ROOT`；I/O 失败 → `E-PREVIEW-READ-FAILED`。
6. `GET /api/agent/files/list?projectId&dir`：目录在前、同类按 name 排序；噪音目录（`.git`/`node_modules`/`dist`）不出现；`dir="../"` → `E-PREVIEW-OUTSIDE-ROOT`；`dir` 不存在或非目录 → `E-PREVIEW-NOT-FOUND`；空目录 → `entries=[]`——EXPECTED-TRACE: PRD §10.4 接口 1 样例。

#### 测试可追溯性

- 测试：`filesApi.test`（真实 fs fixture + registry stub；HTTP 集成）
- seam：`GET /api/agent/files/read|list`
- 断言：EXPECTED-TRACE PRD §6.3 块 2/5、§7.1、§10.4 接口 1/2 全部样例

---

## 变更记录

| 版本 | 哈希 | 日期 | 变更内容 | 触发重签的 REQ-ID |
|---|---|---|---|---|
| v1 | 见 requirements-v1.hash | 2026-09-02 | 初版（10 REQ，全部 trace 到 PRD v1.0 锚点） | 全部 |
