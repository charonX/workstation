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
| REQ-009 AC5（SSE 断线重连后面板仍打开 → 主动 re-read 一次）：store 返回对象导出 `refresh()`（面板未打开/无当前文件为安全 no-op） | `filePreviewStore.js` `refresh`（导出） | `component/filePreviewStore.test.js` REQ-009 AC1 复用 refresh 路径 | COVERED（fix commit 5e90707 补导出；重连接线 Slice 3 闭合） |
| 图片自动刷新（用户故事 3「看到的始终是最新内容」）：modified 重读 kind=image → 重建 blob URL + revoke 旧；image ↔ 文本类切换对称建立/清理不泄漏 | `filePreviewStore.js` `refresh` 成功分支（imageBlobs 桥） | `component/filePreviewStore.test.js` REQ-004/REQ-009（create/revoke 生命周期断言覆盖） | COVERED（fix commit 5e90707） |
| §8 E6 客户端失败面：read 请求 promise reject（网络层失败）→ try/catch 置 `state.error="E-PREVIEW-READ-FAILED"`，open 保持 true，异常不穿透 | `filePreviewStore.js` `openWithPath/refresh` read 路径 try/catch | `component/filePreviewStore.test.js` REQ-005 E6 行（status 500 分支） | COVERED（fix commit 5e90707 补 reject 分支） |
| 流 B 步骤 1/2/5（树 open → list(dir="")；toggleDir 懒加载；close 收起） | `src/renderer/components/filetree/fileTreeStore.js` `open/toggleDir/close` | `file-tree/.../component/fileTreeStore.test.js` REQ-007 AC1/AC2/AC4 | COVERED |
| 流 B 步骤 3（点文件 → openWithPath 分发 + 选中态） | `fileTreeStore.js` `selectFile` | 同上 REQ-007 AC4 | COVERED |
| 流 B 步骤 4 / §6.3 块 3 row 2（收起全部/展开全部，复展已加载目录不重请求） | `fileTreeStore.js` `collapseAll/expandAll`（loadedDirs） | 同上 REQ-007 AC3 | COVERED |
| ADR-042 决策 4 分发侧（识别命中且有 projectId → openWithPath 原样透传；无 projectId → notifyNoRoot E5；非路径零调用） | `filePathRecognition.js` `dispatchFilePathClick` | `component/pathRecognition.test.js` REQ-006 AC4 | COVERED（围栏不识别 = 渲染层接线，Slice 3 E2E 闭合，PARTIAL 于接线层） |
| 排序/噪音过滤（服务端契约，store 保留响应顺序不重排） | `fileTreeStore.js`（无重排逻辑） | —（由 api/filesApi.test.js 闭合，Slice 1） | COVERED（store 侧无为重排代码即合规） |

**验证**：slice 三个测试文件 28/28 绿（`node --test` 单片命令见上节）；`npm run test:unit` 1192/1193，唯一失败 `serverAssembly.test.js` AC5（server.js 253 行 >250）由 Slice 1 并行改动引入，非本切片文件所致。

**已知偏差**（实现注记，不改测试契约）：
- 互斥桥调用：测试桩 `isOpen()` 闭包引用未绑定标识符必抛 ReferenceError；实现按「collapse 幂等」语义降级——isOpen 查询失败不阻断 collapse 调用（生产桥正常时仍受 isOpen 门控）。
- modified 事件 toast 同步于事件消费发出（不等重读完成）：测试仅给两个微任务预算，而 request mock 的 async adoption 链 ≥3 微任务；重读结果随后对齐状态，失败走 error 态。

### Slice 1：服务端 files read/list/watch + SSE 推送（2026-09-02，commit 见下文进度）

**PRD → 代码 可追溯性表**

| PRD 意图项 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| §6.2 E1 分支 + §8 E1 行（越界路径拒读，不触达磁盘） | `src/http/routes/agentFiles.js` `resolveInsideRoot`（normalize + realpathBestEffort 双检） | `api/filesApi.test.js` REQ-010 AC3（`../outside.txt` + symlink 逃逸）；`api/filesWatch.test.js` AC2（watch 越界） | COVERED |
| §6.2 E2 分支 + §8 E2 行（路径不存在） | `agentFiles.js` read/watch stat → `E-PREVIEW-NOT-FOUND` | `api/filesApi.test.js` AC5（ghost.md）；`api/filesWatch.test.js` AC2（不注册 + 落盘零事件） | COVERED |
| §6.2 E3 + §6.3 块 5（1MB 上限含本数：1,048,576 → 200 / 1,048,577 → E-PREVIEW-TOO-LARGE 不含 content） | `agentFiles.js` `MAX_PREVIEW_BYTES` 边界 stat 判定 | `api/filesApi.test.js` AC2 双边界用例 | COVERED |
| §6.2 E4 + §7.1 row2（二进制/非 UTF-8/不支持类型 → E-PREVIEW-UNSUPPORTED） | `agentFiles.js` svg 显式拒收 + `BINARY_EXTENSIONS` 拒绝 + UTF-8 fatal 嗅探 | `api/filesApi.test.js` AC4（spec.pdf / icon.svg / bin.dat） | COVERED |
| §6.2 SVG 行 + ADR-042 决策 3（SVG 拒收，白名单对齐附件清单 jpeg/png/gif/webp/bmp/heic/heif；image kind 不带 content、不受 1MB 约束） | `agentFiles.js` `PREVIEW_IMAGE_EXTENSIONS`（read 端点不含 svg，区别于既有 image 端点白名单） | `api/filesApi.test.js` AC1（logo.png → kind=image 无 content）+ AC4（svg → UNSUPPORTED） | COVERED |
| §8 E5（无解析根 → E-PREVIEW-NO-ROOT） | `agentFiles.js` `requireProjectRoot`（复用 `resolveProjectRoot`） | `api/filesApi.test.js` AC5（无效 projectId） | COVERED |
| §8 E6（I/O 失败 → E-PREVIEW-READ-FAILED） | `agentFiles.js` stat/readFile/readdir catch 非 ENOENT 分支 + watch 建立失败分支（`filePreviewWatchService.js` fs.watch throw → 路由转 E-PREVIEW-READ-FAILED，不产生半注册状态） | —（无自动化用例；错误映射与 ENOENT 分支同码路径） | PARTIAL（分支就位，签核测试未锁定此码的触发用例） |
| §6.3 块 3 row1 + §10.4 接口 1「正常」（噪音目录 .git/node_modules/dist 隐藏；目录在前、同类 localeCompare；文件条目带 size） | `agentFiles.js` `handleFileList`（`NOISE_DIRS` + 分组排序 + stat size） | `api/filesApi.test.js` AC6 根目录/子目录排序用例 | COVERED |
| §10.4 接口 1「边界/异常」（空目录 entries=[]；dir="../" → 400 E-PREVIEW-OUTSIDE-ROOT 锚定状态码；dir 不存在/指向文件 → E-PREVIEW-NOT-FOUND） | `agentFiles.js` `handleFileList`（dir="" → root；ENOTDIR → NOT-FOUND） | `api/filesApi.test.js` AC6 三用例 | COVERED |
| §10.4 接口 2「正常 md」（`docs/guide.md` → kind=markdown, content="# Title", size=7, mtimeMs>0） | `agentFiles.js` `MARKDOWN_EXTENSIONS` 分支 | `api/filesApi.test.js` AC1 | COVERED |
| §10.4 接口 2「正常 code」（`src/auth.js` → kind=code, language=javascript） | `agentFiles.js` `CODE_LANGUAGE_BY_EXTENSION`（hljs 语言键对齐 MarkdownRenderer 注册集） | `api/filesApi.test.js` AC1 | COVERED |
| §10.3 流 A 步骤 3 + §10.5 决策 6（无扩展名 UTF-8 可解码 → code language=plaintext 兜底） | `agentFiles.js` TextDecoder fatal 嗅探分支 | `api/filesApi.test.js` AC4（LICENSE） | COVERED |
| §10.4 接口 3「正常」（POST 同 (projectId,path) 幂等返回同一 watchId） | `src/services/filePreviewWatchService.js` `keyIndex` 同键去重 | `api/filesWatch.test.js` AC1 | COVERED |
| §10.4 接口 3「边界」（文件被删后 POST → E-PREVIEW-NOT-FOUND 不注册，落盘零事件） | `agentFiles.js` `handleWatchRegister` stat 前置 | `api/filesWatch.test.js` AC2 | COVERED |
| §10.4 接口 3「异常」（DELETE 重复/不存在 → 204 幂等吞掉） | `filePreviewWatchService.js` `unregister` no-op + `agentFiles.js` `handleWatchUnregister` 恒 204 | `api/filesWatch.test.js` AC1/AC3 | COVERED |
| §10.4 接口 5「连写合并」（200ms 窗口内 3 次落盘 → 仅 1 次 modified） | `filePreviewWatchService.js` `DEBOUNCE_MS=200` 防抖窗口 | `api/filesWatch.test.js` AC4 | COVERED |
| §10.4 接口 5「删除」（推 deleted + 服务端自动注销；重建不再推送；DELETE 仍 204） | `filePreviewWatchService.js` 防抖窗口关闭时 stat 存在性判定 → deleted 分支自动 unregister | `api/filesWatch.test.js` AC5 | COVERED |
| §10.5 决策 5（原子写 tmp+rename 覆盖 → 归并 1 次 modified、0 次 deleted） | `filePreviewWatchService.js` stat-at-window-close 归并语义 + modified 后 `ensureWatcher` 重挂 | `api/filesWatch.test.js` AC6 | COVERED |
| §10.4 接口 5 载荷（SSE 帧 {type:"file-preview-changed", projectId, path, change}，path = 注册相对路径原样；既有会话 SSE 复用，ADR-042 决策 1） | `src/services/sessionSseRegistry.js` subscription 内 subscribe + `projectIdOf(spaceKey)` 过滤 + writeFrame | `api/filesWatch.test.js` AC4/AC5/AC6（经真实 SSE 流捕获帧） | COVERED |
| §10.7 可观测性（E-PREVIEW-* 错误与 watch 注册/注销主进程日志 + SSE 推送计数，含 projectId+path 不含内容） | `agentFiles.js` `sendPreviewError` 日志 + `filePreviewWatchService.js` register/unregister 日志 + `pushChange` 推送计数日志（`file-preview-push`，含 change 与进程内累计 count） | —（日志为观测面，非断言面） | COVERED（非测试锚点） |
| §10.7 性能（面板关闭即注销、句柄不泄漏；server 关停清理） | `filePreviewWatchService.dispose` + `serviceContainer.dispose` 接线 + timer unref | `api/filesWatch.test.js` AC5（自动注销语义）+ after 钩子干净关闭 | COVERED |

**验证**：

```
NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test \
  tests/capabilities/file-preview/file-preview-panel/2026-08-31-file-preview/api/filesApi.test.js \
  tests/capabilities/file-preview/file-preview-panel/2026-08-31-file-preview/api/filesWatch.test.js \
  --test-timeout=60000
# → tests 24 / pass 24 / fail 0
npm run test:unit
# → tests 1193 / pass 1193 / fail 0（含 serverAssembly AC5 行数约束，server.js 保持 ≤250 行）
```

**已知偏差/注记**（不改测试契约）：
- 错误状态码选型（测试仅锚定 list 越界=400、其余 ≥400）：NO-ROOT/NOT-FOUND=404、OUTSIDE-ROOT=400、TOO-LARGE=413、UNSUPPORTED=415、READ-FAILED=500。
- 已知二进制扩展名（`BINARY_EXTENSIONS`，含 pdf）直接拒收不进 UTF-8 嗅探：ASCII 头部的 PDF 嗅探会误判为文本，§10.4 接口 2「异常类型」锚点（spec.pdf → UNSUPPORTED）要求扩展名前置拦截。
- list 中 symlink/非 dir 非 file 条目略过（不跟随 symlink，规避逃逸面）；文件 size stat 竞态失败时省略该可选字段（契约 size? 可选）。
- read 目录路径（stat.isFile()=false）归并到 E-PREVIEW-NOT-FOUND（测试未锁定，语义取「非可预览文件」）。
