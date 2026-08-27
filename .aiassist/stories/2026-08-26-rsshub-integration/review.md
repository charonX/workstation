# Review 报告 — 2026-08-26-rsshub-integration / 全链统一审查 (prd, tech, req, test, code)

> 故事 ID：`2026-08-26-rsshub-integration`  
> 审查层：`prd, tech, req, test, code`（全链条）  
> 模式：`panel`（5 个专项 Specialist 子代理并行审查）  
> 日期：2026-08-27  

---

## 审查摘要

- **总体结果**：**WARN**（PRD、技术方案、需求契约、代码实现与安全审计均通过；测试契约层发现 3 项关于断言精度与覆盖补充的改进建议）
- **阻塞项数量**：3（测试契约与断言深化）
- **警告与重要项数量**：4
- **建议项数量**：8

---

## 分层发现（Panel 模式）

| 审查层 | 负责 Specialist | 结论 | 严重 (CRITICAL) | 重要 (IMPORTANT) | 建议 (SUGGESTION) |
|---|---|---|---|---|---|
| **prd** | prd-reviewer | **PASS** | 0 | 0 | 2 |
| **tech** | tech-reviewer | **PASS** | 0 | 1 | 2 |
| **req** | req-reviewer | **PASS** | 0 | 0 | 1 |
| **test** | test-engineer | **FAIL** | 3 | 3 | 2 |
| **code & security** | code-reviewer | **WARN** | 0 | 1 | 3 |

---

## 关键发现（按层汇总）

### 1. PRD 审查层（prd-reviewer：PASS）
- [x] **§1 痛点锚定与业务意图**：真实反映用户手动拼装路由繁琐、缺乏统一安全凭据管理的痛点。
- [x] **§4/§5 稳定块与移动块**：界定清晰，4 个核心稳定块闭环覆盖。
- [x] **§6.3/§7/§10.4 预期值锚点**：提供字面输入与输出样例，自检无悬空 GAP。
- **优化建议**：
  - [SUGGESTION] `prd.md:86-89`：建议补充 WeChat 路由映射样例及 Atom XML `<entry>` 样例字面锚点。
  - [SUGGESTION] `prd.md:77,105`：细化未配置 RSSHub 时“仅保存内容源”与“在弹窗内测试连通/触发抓取”的交互分支说明。

### 2. 技术方案审查层（tech-reviewer：PASS）
- [x] **模块职责与依赖链路**：单向无环依赖（Routes $\rightarrow$ FeedFetcher $\rightarrow$ ContentSource $\rightarrow$ Credentials $\rightarrow$ Settings/SecretStore），职责正交。
- [x] **测试 Seams**：原生 `fetch` 与内存 SQLite / HTTP Mock 隔离良好，支持独立自动化测试。
- [x] **过度设计防范**：采用通用的 `settings.credentials[serviceType]` 字典，简洁支持未来多服务扩展，未过度抽象。
- **优化建议**：
  - [IMPORTANT] `src/http/routes/contentSources.js`：内联实现了私有响应助手，建议对齐 ADR-036 统一使用 `src/http/responders.js`。
  - [SUGGESTION] `prd.md:144-164`：§10.3 接口契约补充集中的错误码与副作用列表。
  - [SUGGESTION] `requirements.md:42`：统一错误码名称为标准 `E-CRED-AUTH-FAILED`。

### 3. 需求契约审查层（req-reviewer：PASS）
- [x] **稳定块映射**：5 个 REQ 完整覆盖 4 个稳定块，无孤儿 REQ。
- [x] **验收标准一致性**：脱敏字段、路由规则、XML 提取字段、错误码与 PRD 完全吻合。
- [x] **全局能力地图**：与 `business-capabilities.md` 及 `CONTEXT.md` 划分完全一致，哈希校验链完整。
- **优化建议**：
  - [SUGGESTION] `requirements.md:94`：REQ-SRC-006 涉及 Settings 与 Sources 两个视图，建议标注为 `cross-module (UI Views)`。

### 4. 测试工程审查层（test-engineer：FAIL $\rightarrow$ 需深化测试断言）
- **阻塞项 (CRITICAL)**：
  - [ ] **[CRITICAL] C-01: `test-plan.md:16` REQ-SRC-006 测试归属规范**：`test-plan.md` 中将源码文件作为测试文件登记，需校正测试计划映射。
  - [ ] **[CRITICAL] C-02: `rsshubRouting.test.js` 强化路由解析字面断言**：当前用例断言了内容源配置保存，需增加直接断言 `resolveSourceFeedUrl` 产出的目标 URL（如 `http://.../twitter/user/elonmusk` 与 `http://.../bilibili/user/video/2267573`）。
  - [ ] **[CRITICAL] C-03: `credentials.test.js` 增加 401/403 鉴权失败分支测试**：新增 Mock Server 返回 401/403 的用例，断言 `POST /api/settings/credentials/:service/test` 识别并返回 `E-CRED-AUTH-FAILED`。
- **重要改进项 (IMPORTANT)**：
  - [ ] **[IMPORTANT] I-01: `feedFetcher.test.js` 弱断言强化**：将 `assert.ok(item.pubDate)` 强化为 ISO 8601 格式断言，并补全 Atom 源的 `content` 与 `author` 字段断言。
  - [ ] **[IMPORTANT] I-02: `rsshubRouting.test.js` 未配置 RSSHub 异常分支**：补充未配置 RSSHub 时调用 `resolveSourceFeedUrl` 抛出 `E-RSSHUB-NOT-CONFIGURED` 的测试。
  - [ ] **[IMPORTANT] I-03: `credentials.test.js` 精确错误码断言**：连接失败测试断言精确的 `E-CRED-CONN-FAILED`。

### 5. 代码实现与安全审计层（code-reviewer：WARN）
- [x] **契约与功能实现**：REQ-CRED-001/002 及 REQ-SRC-004/005/006 全部闭环落地。
- [x] **安全审计（100% PASS）**：
  - `accessKey` 全程通过 `safeStorage`/`secretStore` 系统钥匙串加密落盘；
  - `settings.json` 写入严格保持 `0o600` 权限保护；
  - `GET /api/settings/credentials` 与 `GET /api/settings` 100% 脱敏，绝不泄露明文与密文 Key；
  - 日志与错误响应无敏感信息泄露。
- [x] **Fowler 异味基线**：无重大架构异味。
- **优化建议**：
  - [IMPORTANT] `src/http/routes/contentSources.js`：收敛私有响应函数至 `src/http/responders.js`（ADR-036）。
  - [SUGGESTION] `src/renderer/index.css`：`.badge-bilibili` 建议将 Hex 颜色注册为 Design Token。

---

## 阻塞项与建议处理清单

1. **测试契约与断言深化（由 Test Engineer 提出）**：
   - 更新 `test-plan.md` 纠正 REQ-SRC-006 测试映射；
   - 在 `rsshubRouting.test.js` 中增加 `resolveSourceFeedUrl` 显式路由 URL 断言及未配置 RSSHub 异常测试；
   - 在 `credentials.test.js` 中补充 401/403 鉴权失败分支测试（断言 `E-CRED-AUTH-FAILED`）；
   - 在 `feedFetcher.test.js` 中补齐 Atom author/pubDate 强断言。
2. **代码规范小重构（由 Tech Reviewer / Code Reviewer 提出）**：
   - 将 `src/http/routes/contentSources.js` 统一重构为从 `src/http/responders.js` 导入。

---

## 结论

- [ ] 可直接进入下一阶段（REFLECT）
- [x] **需修复测试契约断言与小重构项（推荐原地补齐，无需架构回流）**
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `REQ`

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：有条件接受（接受全链设计与代码实现，原地补强 3 项测试断言与 1 处 HTTP 响应代码规范，无需大幅回流）。

**理由**：
1. PRD、技术架构与代码实现完全正确且安全审计全绿；
2. Test Engineer 提出的阻塞点属于“测试断言的深度与精细度不足”（路由计算 URL、401 错误码），并非业务设计缺陷；
3. Tech/Code Reviewer 提出的 `contentSources.js` 响应助手重构属于局部规范对齐。

**下一步动作**：
原地补齐测试用例与对齐 `responders.js`，运行测试全绿后直接流转至 `REFLECT` 阶段。
