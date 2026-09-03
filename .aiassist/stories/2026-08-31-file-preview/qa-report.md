# QA 报告 — 2026-08-31-file-preview

## 单元测试
- **结果**：PASS
- **执行命令**：`npm run test:unit`
- **统计数据**：1197 passed / 0 failed (291 suites)
- **核心契约测试清单**：
  - `pathRecognition.test.js` (8/8 passed) —— 路径形态判定纯逻辑、行内 code 提取、代码围栏排除
  - `filePreviewStore.test.js` (9/9 passed) —— 面板状态机、错误态映射、blob URL 生命周期
  - `fileTreeStore.test.js` (9/9 passed) —— 树节点懒加载、全部展开/收起、展开态维护
  - `filesApi.test.js` (22/22 passed) —— read/list HTTP 端点、1MB 上限、根约束、类型判定、本地回环安全守卫与 CORS 检查（BUG-001 回归）
  - `filesWatch.test.js` (6/6 passed) —— fs.watch 注册注销幂等、200ms 防抖合并、文件删除推送、原子写归并

## E2E / 自动化验收测试
- **结果**：PASS
- **执行命令**：`npx playwright test tests/capabilities/file-preview/...`
- **详细用例结果**（14/14 全绿）：
  - **文件树边栏** (`fileTree.test.cjs`, 4/4 passed, 5.6s)：
    - ✔ 流B 步骤1-2：入口展开 → 顶层条目 dirs-first、噪音目录不出现；点目录就地展开
    - ✔ 流B 步骤4：全部收起 → 仅顶层可见、文案变「展开全部」；再点全部展开
    - ✔ 流B 步骤3/5：点文件 → 预览面板打开且条目选中高亮；再点入口 → 边栏收起
    - ✔ REQ-PREVIEW-007 AC5：非项目空间会话不显示「文件」入口（E5 前置规避）
  - **文件预览面板** (`filePreview.test.cjs`, 10/10 passed, 23.1s)：
    - ✔ 流A：聊天行内 code 路径点击 → 面板打开并渲染 Markdown（REQ-006 AC1 + REQ-002 AC1 + REQ-001 AC1）
    - ✔ REQ-PREVIEW-006 AC3：代码围栏内的路径形态文本不转为可点击链接
    - ✔ REQ-PREVIEW-006 AC4 边界：点击 `../outside.txt` → E1 错误页（不读磁盘）
    - ✔ REQ-PREVIEW-002 AC2：渲染/源码分段切换——源码视图显示字面量 # Title
    - ✔ REQ-PREVIEW-003 AC1：代码文件 → hljs 高亮 token 存在（const 被包裹）
    - ✔ REQ-PREVIEW-004 AC1：图片文件 → 面板 img 直渲（既有 image 端点 blob）
    - ✔ REQ-PREVIEW-005：E2 不存在 / E3 过大（含系统打开逃生按钮）
    - ✔ REQ-PREVIEW-001 AC2：槽位互斥——预览开 → 浏览器收起；浏览器开 → 预览收起
    - ✔ REQ-PREVIEW-001 AC3：✕ 收起面板
    - ✔ 流C：外部修改 → 自动刷新 + toast；外部删除 → E2 页（REQ-009 AC1/AC2）
- **关联能力回归**：
  - `browserPanel.test.cjs` + `assistantSessions.test.cjs`：21 passed (42.2s)
- **Playwright 产物**：
  - 全部用例一次性通过，无失败截屏与 trace 产物。
- **Flaky 测试**：0（无不稳定测试）。

## 运行时浏览器验证
- **状态**：SKIPPED（未配置 Chrome DevTools MCP；桌面端全流程已由 Electron Playwright 深度覆盖）。

## 需求覆盖 (REQ Coverage)
- REQ-PREVIEW-001 ~ REQ-PREVIEW-010 共 10 项需求规范全部通过自动化回归验证：
  - REQ-001 文件预览面板右侧槽位与浏览器互斥：PASSED (E2E)
  - REQ-002 Markdown 文件渲染视图与源码视图：PASSED (E2E + Store)
  - REQ-003 代码文件高亮展示与行号：PASSED (E2E + Store + API)
  - REQ-004 图片文件直接预览：PASSED (E2E + API)
  - REQ-005 错误状态与安全逃生按钮：PASSED (E2E + API)
  - REQ-006 聊天行内代码路径形态识别与分发：PASSED (E2E + Component)
  - REQ-007 文件树边栏懒加载与展开收起：PASSED (E2E + Component + API)
  - REQ-008 文件变更单文件 watch 监听与防抖推送：PASSED (API + E2E)
  - REQ-009 文件变更自动刷新与 Toast 提示：PASSED (E2E)
  - REQ-010 文件预览 HTTP API 契约与安全守卫：PASSED (API 22/22)

## 不稳定测试
| 测试名 | 现象 | 处理 |
|---|---|---|
| 无 | 全部用例稳定一次性通过 | 无 |

## 结论
- [x] 可进入 `/reflect`（无 open bugs，QA 全绿，单元+E2E 契约全部闭环）
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug`
