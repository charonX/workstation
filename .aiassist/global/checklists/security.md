# 安全检查清单

本清单用于 `/tech-design`、`/review --stage=code --mode=panel` 的 security-auditor 维度，以及任何涉及用户输入、鉴权、外部集成的实现。

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

## 输入验证

- [ ] 所有用户输入在系统边界处验证
- [ ] 使用 allowlist 而非 denylist
- [ ] 字符串长度、数值范围、格式验证
- [ ] 文件上传限制类型、大小，并验证内容
- [ ] SQL 使用参数化查询
- [ ] HTML 输出编码（依赖框架自动转义）
- [ ] URL 重定向前验证（防 open redirect）
- [ ] 服务端外部请求使用 allowlist，阻断私有 IP（防 SSRF）

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
