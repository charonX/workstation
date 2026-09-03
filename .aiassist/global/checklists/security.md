# 安全检查清单

本清单用于 `/to-prd`、`/tech-design`（仅 complex）、`/review --stage=code --mode=panel` 的 security-auditor 维度，以及任何涉及用户输入、鉴权、外部集成的实现。

## 威胁建模

- [ ] 已绘制信任边界（请求、上传、webhook、第三方 API、LLM 输出）
- [ ] 已命名关键资产（凭证、PII、支付数据、管理员操作）
- [ ] 已用 STRIDE 检查每个边界
- [ ] 已写出滥用 case："我会怎么误用这个功能？"

## 代码提交前

- [ ] 代码中无 secrets（密码、api_key、token）
- [ ] `.gitignore` 覆盖 `.env`、`.env.local`、`*.pem`、`*.key`
- [ ] `.env.example` 使用占位值，非真实 secret

## 认证

- [ ] 密码使用 bcrypt（≥12 rounds）、scrypt 或 argon2
- [ ] Session cookie：`httpOnly`、`secure`、`sameSite`
- [ ] Session 有过期时间
- [ ] 登录接口有速率限制
- [ ] 密码重置 token 有时效（≤1 小时）且一次性

## 授权

- [ ] 每个受保护端点都检查认证
- [ ] 每个资源访问检查所有权/角色（防 IDOR）
- [ ] 管理员端点额外校验 admin 角色
- [ ] API key 权限最小化
- [ ] **权限裁决管道四大安全不变量**：
  - 唯一执行者：授权桥挂起项在批准时主进程严禁二次执行（Zero Execute on Approve，防命令双跑）；
  - 严格降级（Fail-Closed）：未知工具、异常配置或缺失策略一律判定为 `ask` / `deny`；
  - 单一评估与单一询问：pre-gate 仅拦截不可见运算符，常规命令交底层引擎，单操作单 confirmId；
  - strict 等模式在策略/裁决层单点生效，上层装配仅做单点转发。

## 输入验证

- [ ] 所有用户输入在系统边界处验证
- [ ] 使用 allowlist 而非 denylist
- [ ] 字符串长度、数值范围、格式验证
- [ ] 文件上传限制类型、大小，并验证内容
- [ ] SQL 使用参数化查询
- [ ] HTML 输出编码（依赖框架自动转义）
- [ ] URL 重定向前验证（防 open redirect）
- [ ] 服务端外部请求使用 allowlist，阻断私有 IP（防 SSRF）

## 本地网络与跨域防护（Loopback API）

- [ ] 本地敏感端点（工程文件、配置、凭据、文件系统）严禁下发全局 `Access-Control-Allow-Origin: *`
- [ ] 必须校验 Host 头（仅允许 `127.0.0.1[:port]` 或 `localhost[:port]`）防御 DNS Rebinding 攻击
- [ ] 必须校验 Origin 头并使用本地回环白名单（`http://127.0.0.1[:port]` 或 `http://localhost[:port]`）
- [ ] 跨源探查防御：对无 Origin 请求（如跨站 `<img>`/`<script>` 探测）校验 `Sec-Fetch-Site: cross-site/cross-origin` 予以阻断
- [ ] 仅向合法本地 Origin 反射 CORS 头；CLI/curl 等无 Origin 请求严禁输出 ACAO 头
- [ ] 本地跨端口联动：对经白名单校验合法的本地 Origin（如 Vite dev 端口），允许其带 `sec-fetch-site: cross-site` 访问本地后端服务

## 安全响应头

```
Content-Security-Policy: default-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

## 错误处理

- [ ] 生产环境返回通用错误，不暴露堆栈/SQL/内部细节
- [ ] 安全事件记录到日志（但不记录 secret）

## 依赖

- [ ] lockfile 已提交，CI 使用 `npm ci` 而非 `npm install`
- [ ] 新依赖已 review（维护状态、下载量、postinstall 脚本）
- [ ] 定期运行 `npm audit`

## LLM / AI 功能

- [ ] 模型输出视为不可信，不进入 eval/SQL/shell/innerHTML/文件路径
- [ ] 权限在代码中强制，不依赖 system prompt
- [ ] secret、跨租户数据、完整 system prompt 不进入 context window
- [ ] 破坏性或不可逆操作需要确认
- [ ] token、速率、递归/循环上限已设置

## 对话富呈现安全边界（2026-08-10，ADR-021）

- [ ] LLM 输出 Markdown 渲染：HTML 全转义（无 rehype-raw / 零 raw 白名单），`<script>`/`<iframe>`/事件属性渲染为转义源码文本
- [ ] Mermaid 渲染：`securityLevel:'strict'` 显式（非 loose），click 指令/HTML label 不注入 DOM（DOMPurify 清洗）
- [ ] 本地图片/文件访问：白名单判定在主进程（projectId → registry 解析 realpath + 扩展名白名单 + containment 校验，防 `..` 遍历/symlink 逃逸），renderer 不持有/不信任绝对路径
- [ ] 图片访问机制走本地 HTTP API + blob URL（dev/prod origin 一致），不用 `file://` 直链
- [ ] 高亮输出走 dangerouslySetInnerHTML 仅限喂库自身转义产物，异常 try/catch 回退 plaintext

## 模型判断权限（auto mode）安全面（2026-08-12，ADR-023）

- [ ] 模型 link 对外部边界（external_directory/path）的 allow 被引擎系统级降级（envelope 强制）——验证系统强制存在，不依赖自觉
- [ ] deny-first：模型只 deny 明确危险，判断不了一律 defer（fail-safe by construction，不静默放行）
- [ ] 模型调用失败/超时/回复不可解析 → defer 弹卡（不降级为放行）
- [ ] 熔断：连续 deny N 次降级回标准模式（防模型把会话卡死或放水无感）
- [ ] 每次判断写 review log（verdict/deferReason/latency）——「静默全 defer/全放行」可查
- [ ] 模式不改持久配置（.pi 文件）；「模式=运行时档位」不污染契约层

## OWASP Top 10 速查

| # | 风险 | 防护 |
|---|---|---|
| 1 | 失效访问控制 | 每个端点鉴权 + 所有权校验 |
| 2 | 加密失败 | HTTPS、强哈希、无 secrets 入代码 |
| 3 | 注入 | 参数化查询、输入验证 |
| 4 | 不安全设计 | 威胁建模、spec 先行 |
| 5 | 安全配置错误 | 安全响应头、最小权限 |
| 6 | 易受攻击组件 | `npm audit`、最小依赖 |
| 7 | 认证失败 | 强密码、速率限制、session 管理 |
| 8 | 软件和数据完整性 | 验证更新/依赖、签名 artifact |
| 9 | 日志失败 | 记录安全事件、不记录 secret |
| 10 | SSRF | URL allowlist、限制出站请求 |

---

来源：改编自 `reference/agent-skills/references/security-checklist.md`。

## 2026-08-14 追加（ADR-027 / BUG-002 人签边界）

- **google 供应商探针 key-in-URL**：google-generative-ai 官方 API 唯一形态是
  `?key=<apiKey>`（query 参数）。已确认：fetch 错误消息与透传响应均不含 URL（key 不进入
  错误透传/日志链路）。边界已人签接受（2026-08-14）；**其他供应商禁止自行引入 key-in-URL
  形态**，新增探针形态须重新过安全签核。

## 2026-08-16 追加（2026-08-12-pi-mcp-plugin /reflect，BUG-006）

- **第三方凭据一等字段化 + 加密落库**：bearer token 类凭据必须是一等表单/CLI 字段，落库前经 secretStore 加密存 `*_enc` 列；**DB/API 响应/列表/页面/日志永不出现明文**，解密仅发生在快照注入消费方的瞬间（effectiveConfig → 桥 bearerToken）。手填 headers 注入凭据只是 workaround，不是凭据管理。
- **探测即连即断**：工具探测（probeTools）按库内配置直连第三方服务拉清单，10s 超时、不写库、不影响会话快照；错误呈「连接失败 + 详情」但不回显 token。
