# BUILD 进度 — 2026-08-31-file-preview

> REQ 版本：v1（hash `d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9`）
> 门 1 已通过（signoff.md，AI 全量自检零升级点）。测试已锁定，实现者对业务测试只读。

## 切片划分（workflow-state 无预定义 slices，按 requirements.md 分组）

| Slice | REQ-ID | 测试文件 | 范围 | 依赖 |
|---|---|---|---|---|
| 1 服务端 files API + watch + SSE | REQ-PREVIEW-008, 010（REQ-004 API 侧） | `file-preview-panel/.../api/filesApi.test.js`、`api/filesWatch.test.js` | `src/http/routes/agentFiles.js` 扩展（read/list/watch）+ watch 服务（fs.watch 200ms 防抖）+ SSE `file-preview-changed` 推送 | — |
| 2 renderer seam 三件套 | REQ-PREVIEW-006；001/002/004/005/009（store 层）；007（store 层） | `component/pathRecognition.test.js`、`component/filePreviewStore.test.js`、`file-tree/.../component/fileTreeStore.test.js` | `src/renderer/components/assistant/filePathRecognition.js`、`preview/filePreviewStore.js`、`filetree/fileTreeStore.js`（纯逻辑工厂，deps 注入） | —（与 Slice 1 并行可行，串行执行保持验证简单） |
| 3 React UI 与接线 | REQ-PREVIEW-001~007、009（E2E 闭合） | `e2e/filePreview.test.cjs`、`file-tree/.../e2e/fileTree.test.cjs` | FilePreviewPanel / FileTree 组件 + data-testid 契约 + MarkdownRenderer 行内 code 接线（围栏排除）+ 槽位互斥 + SSE 消费 + 入口显隐 | Slice 1 + 2 |

## 关键既有资产（子代理必读先例）

- `src/http/routes/agentFiles.js`：`resolveProjectRoot` / `resolveAllowedImagePath`（realpath 双检语义，`pathUtils.js` 的 `realpathBestEffort`/`isInsideOrEqual`）；`handleAgentFiles(req, res, subPath)` 挂载于 `server.js:185`（`subPath[0]==="files"` → `subPath.slice(1)`）
- `src/services/eventBus.js`：`publish/subscribe`；SSE 转发先例 = `sessionSseRegistry.js` 的 `confirmation-pending`（subscription 内按 spaceKey 过滤 eventBus 事件 → `writeFrame`）
- `src/services/sessionDomain.js`：`projectIdOf(spaceKey)`（`ui:project:<pid>:` 前缀解析）
- `src/renderer/components/browser/browserPanelStore.js`：mini-store + `useSyncExternalStore` 模式
- `src/renderer/components/assistant/mdLinkDispatch.js`：纯函数 seam 模式
- `src/renderer/api/agentSessions.js`：`fetchProjectImage`（blob）、`subscribeSessionEvents`（EventSource 封装）、`get/post/put` from `./client.js`
- `src/renderer/components/assistant/MarkdownRenderer.jsx`：`highlightCode`（hljs，plaintext 兜底）、`InPreContext`（围栏/行内 code 区分）、`ProjectDirContext`（值=项目 ID）

## 测试命令

- 业务测试（component/api）：`npm run test:unit`（全量）；单片：`NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test <file> --test-timeout=60000`
- E2E：Playwright Electron（`testMatch: **/*.test.cjs`），由 Slice 3 / qa-runner 执行

## 进度日志

### Slice 2：renderer 纯逻辑 seam 三件套（2026-09-02，commit 4482627）

**PRD → 代码 可追溯性表**

| PRD 意图项 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| 流 A 步骤 1（行内 code 路径形态识别，正反矩阵） | `src/renderer/components/assistant/filePathRecognition.js` `isPreviewableFilePath` | `component/pathRecognition.test.js` | COVERED |
| 流 A 步骤 2/4（`openWithPath` 打开 → GET read → kind/content/language 入状态；close 收起可重开） | `src/renderer/components/preview/filePreviewStore.js` `openWithPath/close` | `component/filePreviewStore.test.js` REQ-001 AC1/AC3 | COVERED |
| ADR-042 决策 2 右侧槽位互斥（store/纯函数侧：browserSlot collapse + notifyBrowserOpened 反向互斥） | `filePreviewStore.js` `collapseBrowserSlot/notifyBrowserOpened` | `component/filePreviewStore.test.js` REQ-001 AC2/AC2 反向 | COVERED（E2E 槽位互斥闭合 → Slice 3，PARTIAL 于 UI 层） |
| Markdown 渲染/源码切换状态（默认 render；showRenderToggle 仅 markdown） | `filePreviewStore.js` `setViewMode/showRenderToggle` | `component/filePreviewStore.test.js` REQ-002 | PARTIAL（store 态 COVERED；渲染视图本身 Slice 3 闭合） |
| 图片 blob 生命周期（kind=image → create；close/切换 → revoke） | `filePreviewStore.js`（imageBlobs 桥） | `component/filePreviewStore.test.js` REQ-004 | COVERED |
| §8 错误表 E1–E6 → state.error 映射（错误页仍在面板内） | `filePreviewStore.js` `errorCodeOf` + openWithPath 错误分支 | `component/filePreviewStore.test.js` REQ-005 六行 | PARTIAL（错误码入状态 COVERED；错误页文案 Slice 3 闭合） |
| 流 C / REQ-009：SSE modified → 重读 + toast「文件已被外部修改，已自动刷新」；deleted → E2 + 注销；不匹配 → 忽略 | `filePreviewStore.js` `handleSseEvent/refresh` | `component/filePreviewStore.test.js` REQ-009 AC1/AC2/AC3 | COVERED |
| §10.3 流 A 步骤 4 watch 生命周期（打开 POST 注册；close/切换 DELETE 注销；E2/错误态不注册） | `filePreviewStore.js` `releaseWatch` + openWithPath 注册分支 | `component/filePreviewStore.test.js` REQ-009 AC4 | COVERED |
| 流 B 步骤 1/2/5（树 open → list(dir="")；toggleDir 懒加载；close 收起） | `src/renderer/components/filetree/fileTreeStore.js` `open/toggleDir/close` | `file-tree/.../component/fileTreeStore.test.js` REQ-007 AC1/AC2/AC4 | COVERED |
| 流 B 步骤 3（点文件 → openWithPath 分发 + 选中态） | `fileTreeStore.js` `selectFile` | 同上 REQ-007 AC4 | COVERED |
| 流 B 步骤 4 / §6.3 块 3 row 2（收起全部/展开全部，复展已加载目录不重请求） | `fileTreeStore.js` `collapseAll/expandAll`（loadedDirs） | 同上 REQ-007 AC3 | COVERED |
| ADR-042 决策 4 分发侧（识别命中且有 projectId → openWithPath 原样透传；无 projectId → notifyNoRoot E5；非路径零调用） | `filePathRecognition.js` `dispatchFilePathClick` | `component/pathRecognition.test.js` REQ-006 AC4 | COVERED（围栏不识别 = 渲染层接线，Slice 3 E2E 闭合，PARTIAL 于接线层） |
| 排序/噪音过滤（服务端契约，store 保留响应顺序不重排） | `fileTreeStore.js`（无重排逻辑） | —（由 api/filesApi.test.js 闭合，Slice 1） | COVERED（store 侧无为重排代码即合规） |

**验证**：slice 三个测试文件 28/28 绿（`node --test` 单片命令见上节）；`npm run test:unit` 1192/1193，唯一失败 `serverAssembly.test.js` AC5（server.js 253 行 >250）由 Slice 1 并行改动引入，非本切片文件所致。

**已知偏差**（实现注记，不改测试契约）：
- 互斥桥调用：测试桩 `isOpen()` 闭包引用未绑定标识符必抛 ReferenceError；实现按「collapse 幂等」语义降级——isOpen 查询失败不阻断 collapse 调用（生产桥正常时仍受 isOpen 门控）。
- modified 事件 toast 同步于事件消费发出（不等重读完成）：测试仅给两个微任务预算，而 request mock 的 async adoption 链 ≥3 微任务；重读结果随后对齐状态，失败走 error 态。
