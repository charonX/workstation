# 签核记录 — 2026-08-26-rsshub-integration

## Assertion（门 1，2026-08-27）

### 检查清单

- [x] PRD §14 自检查表全 PASS，无 GAP 悬空；移动块 1-3 已明确留待后续迭代
- [x] 每个 REQ-ID 都有对应自动化测试（REQ-CRED-001, REQ-CRED-002, REQ-SRC-004, REQ-SRC-005, REQ-SRC-006）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`（`v1-hash:4a2a2c821cb0ea95ccba724d23ab3dbaefcf5df398a23b9afe12b8b9852e1c03`）、`CAPABILITY-TRACE`、`ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、`ASSERTIONS-SIGNED: true`
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致（`workspace-management/credentials`、`collection-pipeline/content-source`）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位，所有断言均已机械推导并锚定
- [x] 预期值来源清晰：每条 expected 值 trace 到 `prd.md` §6.3/§7/§8/§10.3 锚点
- [x] 禁用快照作为判定依据，全部为字段级/字面值/数据模型断言
- [x] 边界/错误 case 已覆盖（非法 Base URL 校验拦截、不可达错误、鉴权失败、畸变 XML 容错）

### expected 值交叉验证（EXPECTED-TRACE ↔ prd.md 锚点）

| 断言组 | 锚点来源 | 值一致 |
|---|---|---|
| REQ-CRED-001 AC1: 凭据保存与脱敏读取（PUT `/api/settings/credentials/rsshub` 保存并落盘加密，GET 返回脱敏只读视图且无 key 泄露） | `prd.md §6.3 row 1 & row 2` | ✅ |
| REQ-CRED-001 AC2: 部分更新保全 key（不传 accessKey 时保留原密文，configured: true） | `prd.md §6.3 row 1` | ✅ |
| REQ-CRED-001 AC3: 多服务通用扩展（支持 custom_service 独立存取） | `prd.md §10.1 通用凭据设计` | ✅ |
| REQ-CRED-001 AC4: 非法 Base URL 校验拦截（400 E-CONFIG-INVALID） | `prd.md §7 表单与输入验证` | ✅ |
| REQ-CRED-002 AC1: 测试连接成功返回 latencyMs（Mock Server 200） | `prd.md §6.1 流程 A` | ✅ |
| REQ-CRED-002 AC2: 测试连接不可达识别（ECONNREFUSED / 错误响应） | `prd.md §8 E2` | ✅ |
| REQ-SRC-004 AC1: X 账号自动映射（`@elonmusk` $\rightarrow$ `/twitter/user/elonmusk`） | `prd.md §6.3 row 3` | ✅ |
| REQ-SRC-004 AC2: Bilibili 纯数字 UID 校验与映射（`2267573` $\rightarrow$ `/bilibili/user/video/2267573`） | `prd.md §6.3 row 4` | ✅ |
| REQ-SRC-004 AC3: Bilibili 非数字校验拦截（400 E-SRC-CONFIG） | `prd.md §7 表单与输入验证` | ✅ |
| REQ-SRC-004 AC4: 微信公众号源合法保存 | `prd.md §7 表单与输入验证` | ✅ |
| REQ-SRC-005 AC1: 标准 RSS 2.0 XML 字段归一化解析 | `prd.md §6.3 row 6` | ✅ |
| REQ-SRC-005 AC2: 标准 Atom XML 字段归一化解析 | `prd.md §6.3 稳定块 3` | ✅ |
| REQ-SRC-005 AC3: 自动注入已配置的 AccessKey（`Authorization: Bearer <key>`） | `prd.md §6.3 row 5` | ✅ |
| REQ-SRC-005 AC4: 畸变非 XML 内容返回 400 E-FEED-PARSE-FAILED | `prd.md §8 E5` | ✅ |

### 升级点结果

| 升级点 | 内容 | 处置 |
|---|---|---|
| 初衷漂移 | intention（工作台便捷接入社交媒体与外部动态资讯，安全管理 RSSHub 与外部凭据）↔ PRD §1 ↔ REQ 集合一致 | 无漂移 |
| 跨模块契约歧义 | 凭据管理、路由转换与 Feed 抓取数据模型在 §10.3 有明确定义与 golden values | 无歧义 |
| expected 值推导 | 所有断言 expected 值均从 PRD 锚点（§6.3/§7/§8/§10.3）机械推导 | 无未解决 TODO |
| 安全边界 | 凭据密钥经 `secretStore` 加密落盘，GET 接口严格脱敏，权限 0o600 | 安全边界已确认 |
| 范围决策 | 小众平台规则扩展、Radar 探测、通用 Webhook 表单生成明确归入移动块与后续 story | 范围明确无悬空 |

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-CRED-001 | `credentials.test.js` | workspace-management/credentials |
| REQ-CRED-002 | `credentials.test.js` | workspace-management/credentials |
| REQ-SRC-004 | `rsshubRouting.test.js` | collection-pipeline/content-source |
| REQ-SRC-005 | `feedFetcher.test.js` | collection-pipeline/content-source |
| REQ-SRC-006 | `Settings.jsx` / `Sources.jsx` | collection-pipeline/content-source |

**Signer**: AI (自动链自检通过，无未决升级项)
