# 访谈笔记 — 2026-09-06-cli-service-connection

## 核心问题

agent 运行时需要调用本机 CLI 服务来完成任务，但工作台目前只支持 MCP 连接（mcp-server 一等配置实体，REQ-AGENT-084~088），CLI 服务既不纳入管理，也不知道当前环境里装了哪些、可用性如何，agent 无法稳定使用。

## 用户画像

- 工作台用户：在独立页面管理 CLI 连接（看安装状态/版本/更新提示、配凭据、按项目启用）。
- PI agent：运行时发现可用 CLI 清单，借助内置 skill 以一次性任务形态调用。

## 关键边界

1. **严格本机 CLI**：只管「本机可执行命令」型 CLI（claude、codex、crawl4ai 等），不泛化为外部服务连接；飞书已有独立接入（ADR-007），不重复。
2. **内置清单**：支持哪些 CLI 由工作台内置清单定义（检测命令、分发渠道、安装指引是 CLI 特定的，无法通用推导），不支持用户自定义任意 CLI。
3. **一次性任务形态**：agent 调用 = spawn CLI 执行一次任务拿输出；不做交互式会话/REPL。
4. **调用面 = skill 配套**：不做专门调用桥；内置清单每个 CLI 带一份内置说明 skill（简单 CLI 用通用模板即可），用户可覆盖；agent 通过工作台执行通道调用，权限走现有 broker/policy rules（ADR-020/023/032）。
5. **凭据**：登录态优先（复用 CLI 自身本机登录，对齐 ADR-005 claude code 的做法）+ env 注入（secretStore 加密，对齐 mcpService bearer token 处理）。
6. **检测**：实时探测（which + --version）+ 短缓存；新版本检查按分发渠道（npm registry / PyPI / GitHub releases）查询对比。
7. **UI**：独立页（仿 Mcp.jsx），侧边栏加导航；清单内未安装的 CLI 标灰 + 安装指引。
8. **启用模型**：两层启用（全局开关 + 按项目启用），对齐 mcp_project_enablement。

## 隐含假设

1. 工作台 spawn CLI 时的权限边界复用现有 permission broker，不新建授权体系（用户已确认）。
2. 首批清单：claude、codex、crawl4ai（用户点名；gemini 未选，后续可加——清单机制本身支持扩展）。
3. ADR-013 后果第 4 条「扫描本机已装 agent、无则回退 PI」与 ADR-005「调用本机 claude CLI / 本地 CLI agent 扫描」的推迟/范围外项，正是本 story 要补齐的部分——但只补「检测 + 管理 + 一次性调用」，不补「CLI-as-runtime」。

## 矛盾/风险

1. **crawl4ai 的 CLI 形态待验证**：它主要是 Python 库（`crawl4ai`/`crwl` 命令、或需起本地 server），检测与调用方式与 npm 系 CLI 不同，PRD/技术方案阶段需确认其确切 CLI 入口。
2. **权限颗粒度**：bash 类执行通道的权限规则如何精确到「只允许调用已启用的 CLI」，避免变成任意命令执行——技术方案阶段必须回答（安全边界，可能是 signoff 升级点）。
3. **skill 与实体联动**：内置 skill 内容如何随 CLI 启用状态/配置注入 agent 上下文，技术方案阶段定。

## 候选方向

### 方向 A：对齐 MCP 实体模式（已确认 ✅）
- 一句话：CLI 服务做一等配置实体，全链复用 MCP 模式（内置清单注册表 + DB 用户配置 + 检测 API + 两层启用 + 独立 UI 页 + 内置 skill 调用面）。
- 适用场景：本 story；与 mcp-server 能力逐层同构。
- 主要取舍：成本中等，但权限/启用/审计全复用，维护心智负担小。
- 推荐度：**首选（用户已确认）**

### 方向 B：轻量注册表，无 CRUD
- 一句话：清单纯代码内置，只存启用开关 + env，无 DB 实体。
- 主要取舍：快，但与 MCP 模式分裂，后续欠实体层技术债。
- 推荐度：备选

### 方向 C：泛化外部服务连接框架
- 一句话：统一抽象本机 CLI / 本地服务 / 远程服务。
- 主要取舍：用户已明确严格本机 CLI，过度设计。
- 推荐度：不推荐

## 确认方向

最终确认的方向：**方向 A（对齐 MCP 实体模式）**

确认意图（用户显式 yes）：

- Outcome: 工作台把本机 CLI 服务（首批 claude / codex / crawl4ai）纳为一等管理实体——检测环境安装情况（版本、更新提示）、配置凭据/参数、按项目启用，agent 借助内置 skill 以一次性任务形态调用
- User: 工作台用户（管理）+ PI agent（发现与调用）
- Why now: MCP 连接已落地（ADR-025），CLI 侧是 ADR-013/005 显式推迟的能力，现在补齐
- Success: 独立页展示清单内每个 CLI 的安装状态/版本/更新提示，未安装有指引；启用后 agent 能通过内置 skill 成功调用一次 codex/claude 任务拿到输出；权限走 broker
- Constraint: 复用 MCP 实体模式与权限体系；凭据登录态优先 + env 注入（secretStore 加密）
- Out of scope: CLI-as-agent-runtime、交互式会话、非本机服务（飞书/远程 HTTP）、自动安装/升级 CLI、用户自定义 CLI

确认理由：与 mcp-server 能力同构，风险最低，调用面正好落在「内置 skill + 简单 CLI 通用说明」上。

## 最窄的切入点

内置清单注册表（claude/codex 两项）+ 环境检测 API（probe + 版本检查）+ 独立页只读列表（安装状态/版本/指引）。启用、env 配置、skill 调用面随后跟上。

## 待确认问题

- [ ] crawl4ai 的确切 CLI 入口与检测命令（PRD/技术方案阶段验证）
- [ ] 「只放行已启用 CLI」的权限规则颗粒度（技术方案阶段；可能是 signoff 升级点）
- [ ] 内置 skill 的注入机制与覆盖方式（技术方案阶段）
