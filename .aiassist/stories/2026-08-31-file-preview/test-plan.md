# 测试计划 — 2026-08-31-file-preview

> REQ 版本：v1（hash `d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9`）
> 能力：`file-preview`；实体：`file-preview-panel` / `file-tree`
> 目录：`tests/capabilities/file-preview/<entity>/2026-08-31-file-preview/`

## 覆盖矩阵

| REQ-ID | seam | 测试文件 | 测试类型 | 断言锚点 |
|---|---|---|---|---|
| REQ-PREVIEW-001 面板容器与槽位互斥 | store（mini-store，先例 browserPanelStore）+ 窗口 | `file-preview-panel/component/filePreviewStore.test.js`、`file-preview-panel/e2e/filePreview.test.cjs` | 组件 / E2E | §6.1 流A 步骤2/4、ADR-042 决策2 |
| REQ-PREVIEW-002 Markdown 渲染/源码切换 | store 视图态 + 窗口渲染 | `component/filePreviewStore.test.js`（viewMode/showRenderToggle）、`e2e/filePreview.test.cjs`（`<h1>Title</h1>` / 字面量 `# Title`） | 组件 / E2E | §6.3 块1 row1 |
| REQ-PREVIEW-003 代码高亮 | 窗口渲染 | `e2e/filePreview.test.cjs`（`.hljs-keyword` 存在、无 h1） | E2E | §6.3 块1 row2 |
| REQ-PREVIEW-004 图片视图 | store blob 桥 + HTTP + 窗口 | `component/filePreviewStore.test.js`（create/revoke）、`api/filesApi.test.js`（kind=image 无 content；SVG→E4）、`e2e/filePreview.test.cjs`（img blob:） | 组件 / 集成 / E2E | §10.4 接口2/4、ADR-042 决策3 |
| REQ-PREVIEW-005 错误态页 E1-E6 | store 错误映射 + 窗口文案 | `component/filePreviewStore.test.js`（六码全行）、`e2e/filePreview.test.cjs`（E1/E2/E3 文案 + 逃生按钮） | 组件 / E2E | §8 错误表全行 |
| REQ-PREVIEW-006 路径识别与分发 | 纯函数（先例 mdLinkDispatch）+ 窗口点击 | `component/pathRecognition.test.js`（正反矩阵/分发/no-root）、`e2e/filePreview.test.cjs`（行内 code 可点、围栏不转链接、越界 E1） | 单元 / E2E | §6.3 块2、§6.2 围栏行、§10.5 决策3 |
| REQ-PREVIEW-007 文件树边栏 | tree store + 窗口 | `file-tree/component/fileTreeStore.test.js`（懒加载/展开态机/分发）、`file-tree/e2e/fileTree.test.cjs`（入口显隐/噪音过滤/全部展开收起/选中高亮） | 组件 / E2E | §6.1 流B、§6.3 块3、§10.4 接口1 |
| REQ-PREVIEW-008 watch 生命周期与防抖 | HTTP + fs.watch + SSE（真实 fs） | `file-preview-panel/api/filesWatch.test.js`（幂等/E2 不注册/204 幂等/200ms 合并/deleted 自动注销/rename 归并） | 集成 | §10.4 接口3/5 全部样例 |
| REQ-PREVIEW-009 自动刷新消费 | store SSE 消费 + 窗口 | `component/filePreviewStore.test.js`（modified/deleted/不匹配/注册注销）、`e2e/filePreview.test.cjs`（流C：v1→v2 + toast + 删除切 E2） | 组件 / E2E | §6.3 块4、§10.4 接口5 |
| REQ-PREVIEW-010 read/list 服务 API | HTTP 集成（真实 fs fixture + 真实项目注册） | `file-preview-panel/api/filesApi.test.js`（golden values/1MB 边界/realpath 双检/类型判定/噪音过滤/排序） | 集成（CLI/curl 可复验） | §6.3 块2/5、§7.1、§10.4 接口1/2 |

## HTML 原型映射（ux/file-preview.html → 自动化测试）

| 原型结构/行为 | 落点 |
|---|---|
| 树头部「⇅ 收起全部 / 展开全部」按钮 + 行为 | fileTreeStore.test.js AC3 + fileTree.test.cjs 流B 步骤4 |
| 预览面板头部（路径 + 类型标签 + ✕） | filePreview.test.cjs 流A / REQ-001 AC3 |
| 渲染/源码分段开关 | filePreviewStore.test.js + filePreview.test.cjs REQ-002 |
| 错误态页 E1/E2/E3/E4 + 错误码标签 + 逃生按钮 | filePreviewStore.test.js（六码）+ filePreview.test.cjs（E1/E2/E3） |
| 聊天 file-link chip（可点击路径）/ bad（越界） | filePreview.test.cjs 流A + E1 用例 |
| 自动刷新 toast「文件已被外部修改，已自动刷新」 | filePreviewStore.test.js AC1 + filePreview.test.cjs 流C |

## 新增 seam 落点（实现契约路径）

| seam | 路径 | 先例 |
|---|---|---|
| 路径识别/分发纯模块 | `src/renderer/components/assistant/filePathRecognition.js` | mdLinkDispatch.js |
| 面板 mini-store 工厂 | `src/renderer/components/preview/filePreviewStore.js` | browserPanelStore.js |
| 树 mini-store 工厂 | `src/renderer/components/filetree/fileTreeStore.js` | browserPanelStore.js |
| HTTP 端点 | `GET /api/agent/files/read|list`、`POST/DELETE /api/agent/files/watch`（src/http/routes/agentFiles.js 扩展） | handleAgentFiles（image 端点） |
| SSE 帧 | 既有会话 events 流上 `type:"file-preview-changed"` | sessionSseRegistry pushFrame |

## 留给 REFLECT 人工验收（纯审美，无结构断言）

- 高亮配色、树缩进密度、面板滑出动效、toast 停留时长 —— 理由：颜色/间距/动效曲线属主观观感（PRD §11.2 末行），结构存在性已全部自动化。

## 分层占比自检

- 小型（纯函数/store/组件）：3 文件 26 用例；中型（HTTP 集成）：2 文件 24 用例；大型（E2E）：2 文件 11 用例 —— 大致 42% / 39% / 18%。E2E 偏高因 Electron 无组件渲染测试基建（无 jsdom/testing-library 先例），面板 React 层行为只能真实窗口闭合；store 抽取已把可下沉逻辑全部下沉。

## 回溯检查

- 10 个 REQ 全部 ≥1 自动化测试；无 `TODO: HUMAN ASSERTION`；无 `人工(仅视觉)` 分类的 REQ。
- 组件/集成测试已跑通至「seam 未就绪 / 404 契约未实现」的 RED 态（失败信息可读）；E2E 待 BUILD 后由 /qa-runner 执行。
