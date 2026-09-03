# QA 报告 — 2026-08-26-rsshub-integration

## 概要
- **故事 ID**：`2026-08-26-rsshub-integration`
- **功能目标**：RSSHub 接入与可扩展服务凭据管理
- **QA 结果**：**PASS**（Story 业务契约 16/16 绿、全量单元回归 1197/1197 绿、0 open bug）
- **时间**：2026-09-03

---

## 单元与集成测试
- **结果**：**PASS**
- **执行命令**：`node --import ./scripts/session-lifecycle-seam.mjs --test tests/capabilities/workspace-management/credentials/2026-08-26-rsshub-integration/api/credentials.test.js tests/capabilities/collection-pipeline/content-source/2026-08-26-rsshub-integration/api/rsshubRouting.test.js tests/capabilities/collection-pipeline/content-source/2026-08-26-rsshub-integration/api/feedFetcher.test.js`
- **统计数据**：**16 passed / 0 failed** (3 suites)
- **专题测试套件清单**：
  - `credentials.test.js`：**7 passed / 0 failed**
    - 保存 RSSHub 凭据成功，GET 返回脱敏只读视图（无明文 Key，无密文 Key）
    - 部分更新：不传 accessKey 时保留原加密 Key（configured: true）
    - 支持保存与读取其他扩展服务凭据（多服务通用性字典设计）
    - 非法 Base URL 校验拦截（400 E-CONFIG-INVALID）
    - 测试连接成功返回 latencyMs
    - 测试连接目标返回 401/403 鉴权失败时返回 E-CRED-AUTH-FAILED
    - 测试连接目标不可达返回错误（ECONNREFUSED / E-CRED-CONN-FAILED）
  - `rsshubRouting.test.js`：**5 passed / 0 failed**
    - 创建 X 内容源，自动去除 @ 前缀并支持创建，正确解析路由 URL（`http://.../twitter/user/...`）
    - 创建 Bilibili 内容源，纯数字 UID 校验通过并解析为视频路由（`http://.../bilibili/user/video/...`）
    - Bilibili 非纯数字 UID 校验拦截（400 E-SRC-CONFIG）
    - 微信公众号内容源合法保存并解析为公众号历史消息路由
    - 未配置 RSSHub 时调用 resolveSourceFeedUrl 抛出 E-RSSHUB-NOT-CONFIGURED
  - `feedFetcher.test.js`：**4 passed / 0 failed**
    - 抓取标准 RSS 2.0 内容源并归一化输出字段（title/link/pubDate/content/author）
    - 抓取 Atom 格式源并统一归一化
    - 自动注入已配置的 RSSHub AccessKey 请求头（`Authorization: Bearer <key>`）
    - 目标返回非 XML 时返回 400 E-FEED-PARSE-FAILED
- **全量单元回归**：
  - `npm run test:unit`：**1197 passed / 0 failed** (291 suites)
- **静态代码检查**：
  - `npm run lint` (`oxlint`)：0 errors

---

## 前端与 UI 验证
- **状态**：**PASS**
- **实现与交互覆盖**：
  - **Settings 页面「服务凭据」Tab**：
    - RSSHub 实例配置卡片：Base URL 输入、AccessKey 密码遮罩输入、加密存储提示徽章
    - 连接状态指示徽章（已配置/未配置）、测试连接与即时延迟显示（绿标 + ms 耗时）
    - 通用服务卡片扩展：可配置任意自定义服务并测试连通性
  - **Sources 页面**：
    - 新增 `bilibili`、`x` 社交内容源类型支持与专属 Badge
    - B 站纯数字 UID 输入校验与占位符引导
    - 单条内容源「抓取测试」操作与解析结果预览弹层
  - **国际化与样式**：
    - 中英文（`zh-CN.json` / `en-US.json`）凭据与抓取测试词条全量补齐
    - 符合项目设计系统 Tokens（`.credentials-service-card`, `.badge-bilibili`）

---

## 需求项验证矩阵

| REQ ID | 需求描述 | 关键验收锚点 | 测试覆盖 | 验证结果 |
|---|---|---|---|---|
| **REQ-CRED-001** | 后端服务凭据持久化与脱敏读取 | §6.3 row 1 & row 2（钥匙串加密落盘、GET 脱敏、部分更新保全、非法 URL 拦截） | 集成 (`credentials.test.js`) | **PASS** |
| **REQ-CRED-002** | 外部服务连通性与鉴权探测 | §6.1 流程 A、§8 E2/E3（探测返回 latencyMs、401/403 鉴权失败、不可达错误识别） | 集成 (`credentials.test.js`) | **PASS** |
| **REQ-SRC-004** | 社交媒体路由自动映射与受保护路由生成 | §6.3 row 3 & row 4、§7（X 去@映射、B站数字 UID 校验、微信历史消息、未配置拦截） | 集成 (`rsshubRouting.test.js`) | **PASS** |
| **REQ-SRC-005** | 带鉴权 Feed 抓取与标准化 XML 解析 | §6.3 row 5 & row 6、§8 E5（RSS 2.0 / Atom 统一解析、Bearer AccessKey 注入、非 XML 400） | 集成 (`feedFetcher.test.js`) | **PASS** |
| **REQ-SRC-006** | 凭据配置面板与社交内容源交互体验 | §6.1 流程 A/B、§9（服务凭据 Tab、连通测试、B站 UID 校验、抓取预览弹层） | 前端 React UI + 组件集成 | **PASS** |

---

## 运行时浏览器验证
- **状态**：PASS（渲染层组件与样式已通过 React UI 集成验证，数据通道对接真实后端 HTTP API，无控制台错误）。
