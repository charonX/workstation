# ADR-042: 文件预览面板——HTTP/SSE 数据通道（非 IPC）+ 右侧槽位互斥 + 复用既有图片白名单

## 状态
已接受 (Accepted) — 2026-09-02

## 背景与问题

story 2026-08-31-file-preview 为项目内文件提供只读预览（Markdown 渲染 / 代码高亮 / 图片），三个决策点有真实取舍且难逆转：

1. **通道范式**：浏览器面板走 Electron IPC（`opc.browser.*` + `ipcRenderer.on`），因为它有 WebContentsView bounds 推送这个硬需求。文件预览是纯数据通道（读文件/列目录/监听变更），跟 IPC 还是跟 HTTP？
2. **右侧面板槽位**：文件预览面板与浏览器面板都落在会话区右侧。同开并存会挤压对话窗；互斥则布局简单。
3. **图片预览安全口径**：附件线（REQ-AGENT-098 / ADR-021）已定图片白名单（jpeg/png/gif/webp/bmp/heic/heif，SVG 拒收）。预览若另立清单，全 app 出现两份图片安全口径。

## 决策

1. **文件预览走本地 HTTP API + SSE，不走 Electron IPC**：
   - 读取/列举：`GET /api/agent/files/read|list`（projectId + 相对路径，主进程 registry 解析根 + realpath 双检，复用 `isArtifactPathAllowed` 语义）。
   - watch 注册/注销：`POST/DELETE /api/agent/files/watch`；变更事件经**既有会话 SSE 连接**推送 `file-preview-changed`，不新建推送通道。
   - 理由：预览无原生视图/bounds 需求，与图片读取先例（`GET /api/agent/files/image`，REQ-AGENT-051）同构；HTTP 面 CLI/curl 可测，符合「CLI 是默认 seam」纪律。浏览器面板继续走 IPC 不变——两范式各有硬需求背书，不强求统一。

2. **右侧槽位互斥**：文件预览面板打开 → 浏览器面板收起（实例保活，符合浏览器面板「可见性解耦」定义）；反之亦然。同一时刻右侧至多一个面板。

3. **图片预览纳入，白名单对齐附件清单**：复用既有 `GET /api/agent/files/image` 端点 + blob URL 机制；SVG 拒收 → E-PREVIEW-UNSUPPORTED。全 app 维持单份图片白名单。

4. **聊天路径识别仅行内 code**：仅 `` `path` `` 形态（含路径分隔、尾段有扩展名、无空格无 scheme）转为可点击；代码围栏内不识别（高亮 token 切碎后做链接复杂度高、收益低）。点击后不存在的路径由 E-PREVIEW-NOT-FOUND 错误页兜底，渲染期不做存在性预校验。

5. **本地敏感端点 Loopback 访问控制（2026-09-03 增补，BUG-001）**：
   - `/api/agent/files/*` 与 `/api/browser/*` 统一由 `browserApiGuard.js` 实施保护，校验 Host（`127.0.0.1[:port]` / `localhost[:port]` 防 DNS rebinding）与 Origin（合法本地回环地址）；
   - 严禁盲目配置全局 CORS `Access-Control-Allow-Origin: *`，防止恶意外部网页在普通浏览器标签页中跨站读取用户本地代码与配置；
   - 动态反射 CORS：仅向经过验证的本地回环 Origin 反射 CORS 响应头，无 Origin 请求（Node CLI / curl）不输出 ACAO；
   - 本地跨端口联动：Chromium 从 Vite dev 端口（`localhost:5173`）访问后端（`127.0.0.1:<port>`）时会附加 `sec-fetch-site: cross-site`，守卫将其与合法 loopback Origin 联动放行，兼顾桌面调试与跨源防护。

## 后果与影响

### 积极影响
- 数据面通道范式统一（HTTP+SSE），文件预览服务 CLI 可测，测试 seam 与既有 HTTP 集成测试同构。
- 图片预览近零新增风险面（端点/白名单/边界校验全部既有签核资产）。
- 槽位互斥消除双面板布局挤压，浏览器「可见性解耦」语义不被破坏。

### 潜在代价
- App 内并存 IPC（browser）与 HTTP（preview）两套 renderer→主进程通道范式，新人需理解各自适用边界（本 ADR 即说明）。
- 围栏内路径不可点击，agent 若以围栏形式输出路径清单，用户需手动复制——接受为 v1 取舍。
- SSE 断线窗口内文件变更事件丢失（SSE 只推增量不做回溯，既有语义）；面板在 SSE 重连/重新打开时主动 re-read 兜底。

### 替代方案
- **Electron IPC 通道**：与 browser 面板同范式，但为一个不存在的 bounds 需求引入第二范式，且丧失 CLI 可测性。
- **双面板并存**：同屏对照网页与文件的场景存在，但挤压对话窗；后续有真实需求可再议。
- **SVG 纳入预览**：需重审 ADR-021 安全边界（SVG 可含脚本），成本不匹配收益。
- **裸文本路径识别**：误报面取决于正则，骚扰正常文本，拒绝。

## 相关文件
- `src/renderer/components/assistant/MarkdownRenderer.jsx`（渲染管线复用 / fetchProjectImage 先例）
- `src/preload/artifactPathGuard.js`（`isArtifactPathAllowed` 根约束语义）
- `.aiassist/stories/2026-08-31-file-preview/prd.md` §10
