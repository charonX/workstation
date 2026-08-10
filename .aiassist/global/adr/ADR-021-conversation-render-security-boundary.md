# ADR-021: 对话渲染安全边界——LLM 输出全转义 + 本地资源主进程白名单

- **状态**: 已接受
- **日期**: 2026-08-10
- **相关 REQ**: REQ-AGENT-047（HTML 全转义）、REQ-AGENT-049（mermaid securityLevel strict）、REQ-AGENT-051（图片主进程白名单 + blob URL）
- **背景**: PI agent 对话从纯文本升级为富呈现（GFM/Mermaid/KaTeX/图片），LLM 输出直接进渲染层。对话内容不可信（LLM 可能被 prompt 注入诱导输出任意 Markdown/HTML/路径），同时本地图片引用需要访问项目目录文件。存在三类注入面：① 原始 HTML（`<script>`/事件属性）经 Markdown 管道渲染执行；② Mermaid 图表的 click 指令/HTML label 脚本注入；③ 图片 src 指向任意本地路径（读文件越权、泄露敏感影像入史）。
- **方案**:
  1. **HTML 全转义零白名单**：react-markdown 默认转义（无 rehype-raw），`<script>`/`<img onerror>`/`<iframe>` 渲染为转义源码文本，DOM 零原始 HTML。安全姿态保守：任何 raw HTML 渲染需求（白名单标签）需重新走安全评审。
  2. **mermaid `securityLevel:'strict'` 显式**：`mermaid.initialize({securityLevel:'strict', startOnLoad:false})`——strict 非 loose 均经 DOMPurify 清洗；click 指令/HTML label 不注入（浏览器 harness 断言无 onclick/handler）。语法失败回退源码文本（E1）。
  3. **图片主进程白名单判定 + blob URL 访问机制**：renderer 经本地 HTTP API（`GET /api/agent/files/image?projectId&path`，ADR-001 既有形态）读文件 → blob URL 渲染。白名单判定在主进程：projectId → registry 解析 localPath（realpath）→ 扩展名白名单（png/jpg/jpeg/gif/webp/svg）→ realpath containment（isInsideOrEqual，防 `..` 遍历/symlink 逃逸）→ 404 拒绝。renderer 侧不持有/不信任绝对路径，主进程单一权威映射（LLM 注入 img URL 时仍按 registry 校验目录边界）。
  4. 高亮（highlight.js）输出走 `dangerouslySetInnerHTML` 但仅喂库自身转义产物（库内 escapeHTML 实证），不预转义（防双重转义），异常 try/catch 回退 plaintext。
- **替代方案**:
  - rehype-raw + 白名单标签渲染：增加 XSS 面，需持续维护标签/属性白名单——拒绝（便利 vs 安全取舍取安全）。
  - renderer 侧白名单判定：弱防线（renderer 可被绕过），仅作展示层补充——拒绝作主防线。
  - `file://` 直链 / custom protocol：dev（http://localhost）与 prod（file://）origin 混合被 Chromium scheme 规则拦截，一致性差——拒绝，选 HTTP API + blob URL（dev/prod origin 一致）。
- **影响**:
  - 渲染层对任意输入不抛错（错误边界 + 组件内回退）；图片越权/不存在 → 占位不崩溃。
  - 新渲染面（如未来 raw HTML 白名单）必须先过本 ADR 安全姿态评审。
  - 图片功能依赖主进程 API 存活；`projectDir` 解析根语义 = 项目 ID（主进程权威映射）。
  - 高亮/Mermaid/图片均为纯前端或既有 HTTP 形态，事件流/存储契约零改动。
