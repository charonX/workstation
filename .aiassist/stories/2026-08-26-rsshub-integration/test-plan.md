# Test Plan — 2026-08-26-rsshub-integration

> 关联需求：`requirements.md` (v1-hash:4a2a2c821cb0ea95ccba724d23ab3dbaefcf5df398a23b9afe12b8b9852e1c03)
> 覆盖业务能力：`workspace-management`、`collection-pipeline`

---

## 1. 测试用例映射清单

| REQ-ID | 业务能力 / 实体 | Seam | 测试文件 | 测试用例方法/目标 |
|---|---|---|---|---|
| REQ-CRED-001 | workspace-management / credentials | HTTP API / Service | `tests/capabilities/workspace-management/credentials/2026-08-26-rsshub-integration/api/credentials.test.js` | 1. 保存 RSSHub 凭据成功，GET 返回脱敏只读视图（无明文 Key）<br>2. 部分更新保全已有加密 Key<br>3. 多服务凭据通用扩展性（custom_service）<br>4. 非法 Base URL 校验拦截（400 E-CONFIG-INVALID） |
| REQ-CRED-002 | workspace-management / credentials | HTTP API / Mock Server | `tests/capabilities/workspace-management/credentials/2026-08-26-rsshub-integration/api/credentials.test.js` | 1. 测试连接成功返回 latencyMs<br>2. 测试连接目标不可达返回错误 |
| REQ-SRC-004 | collection-pipeline / content-source | Service / HTTP API | `tests/capabilities/collection-pipeline/content-source/2026-08-26-rsshub-integration/api/rsshubRouting.test.js` | 1. 创建 X 内容源，自动去除 @ 前缀并支持创建<br>2. 创建 Bilibili 内容源，纯数字 UID 校验通过<br>3. Bilibili 非纯数字 UID 校验拦截（400 E-SRC-CONFIG）<br>4. 微信公众号内容源合法保存 |
| REQ-SRC-005 | collection-pipeline / content-source | HTTP API / Mock Server | `tests/capabilities/collection-pipeline/content-source/2026-08-26-rsshub-integration/api/feedFetcher.test.js` | 1. 抓取标准 RSS 2.0 内容源并归一化输出字段<br>2. 抓取 Atom 格式源并统一归一化<br>3. 自动注入已配置的 RSSHub AccessKey 请求头<br>4. 目标返回非 XML 时返回 400 E-FEED-PARSE-FAILED |
| REQ-SRC-006 | collection-pipeline / content-source | UI 组件 / 前端交互 | `Settings.jsx` / `Sources.jsx` | 1. Settings 凭据面板存在与 Tab 切换<br>2. RSSHub 凭据输入与测试按钮交互<br>3. Sources 页面社交类型表单切换 |

---

## 2. 预期值来源 Trace（Expected Trace）

- `credentials.test.js` 预期值 trace 到 `prd.md` §6.3 稳定块 1 锚点及 §7 输入验证。
- `rsshubRouting.test.js` 预期值 trace 到 `prd.md` §6.3 稳定块 2 锚点及 §7 社交账号规范。
- `feedFetcher.test.js` 预期值 trace 到 `prd.md` §6.3 稳定块 3 锚点及 §8 错误处理定义。
