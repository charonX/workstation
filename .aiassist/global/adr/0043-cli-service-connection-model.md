# ADR-043: CLI 服务连接模型——内置清单 + 两层启用静态生成进权限层 + 内置 SKILL.md 缝 + env 快照注入

## 状态
已接受 (Accepted) — 2026-09-06

## 背景与问题

story 2026-09-06-cli-service-connection 把本机 CLI 服务（首批 claude / codex / crawl4ai）纳为一等配置实体（检测/管理/两层启用/agent 一次性调用），三个决策点有真实取舍且难逆转：

1. **启用状态如何映射进权限层**：agent 调用 CLI 走既有 bash 执行通道，「只放行已启用 CLI」需要权限层感知两层启用状态。gotgenes bash 规则面是静态策略文件（ADR-020 规则表真源 + 项目层覆盖），不支持按会话动态编程。
2. **agent 调用说明的承载形态**：用户确认「内置 skill + 可覆盖」。worker 装配链路有两条现成缝——SDK 原生 skill 机制（additionalSkillPaths / listLinkedSkillPaths）与 systemPrompt 文本段（buildConfigMessage 拼接）。
3. **env 凭据如何到子进程**：API key 类 env 需注入 agent 发起的 CLI 子进程环境，但 worker 无 DB 访问，且明文密钥不应落盘。

## 决策

1. **权限接线 = 静态生成**：清单内 CLI 命令（`claude`/`codex`/`crwl`）进 `policyRules.js` BASH_RULES 出厂规则表，同时覆盖带参（`cmd *`）与裸命令（`cmd`）形态，默认 ask（用户可在权限配置调 allow）；两层启用状态生成项目层覆盖——未启用 → deny，启用 → 回落默认层。显式确认分裂生效语义：权限基于 ADR-022 mtime 热生效（即时 deny 阻断未启用 CLI 防止逃逸），而环境变量快照基于 session-config 冷注入（新会话生效，保障会话中凭据一致性不发生漂移）。对齐 MCP 默认层合并与项目覆盖先例（ADR-020/022/025），零新机制。
   - 安全约束：环境变量注入仅匹配裸命令（不含 `/` 或 `\` 路径分隔符），任何路径前缀调用不注入受管 env；组合命令逃逸面由出厂破坏性 pattern 兜底。

2. **内置 skill = 真 SKILL.md 缝**：每 CLI 一份内置 SKILL.md 作为应用自带只读目录注册进技能库（新增「内置来源」目录类）；CLI 项目启用 ⇄ 自动 link/unlink（复用收敛机制幂等重建）；用户覆盖 = 自建同 slug skill 优先或手动 unlink 后自管。零新装配代码，天然满足「内置 + 可覆盖」。

3. **env 注入 = session-config 快照**：cliService.effectiveConfig(projectId) 在 buildConfigMessage（session-config 唯一构造点）输出已启用 CLI 的解密 env 快照；worker bash 执行检出命令属于已启用 CLI 时合并该快照进子进程环境。解密点唯一（对齐 ADR-025「快照是唯一解密点」）；API 任何响应不回 value 明文。

4. **探测缓存并发模型**：per-entry 缓存 TTL 60s（命中不 spawn，失败态负缓存同 TTL）；分发渠道版本检查独立缓存 TTL 1h；同 id in-flight 合并；全局探测并发 ≤4。`?refresh=1` 强制重探。

## 后果与影响

### 积极影响
- 权限/启用/审计全复用已验收的 MCP 模式与 gotgenes 规则面，无新授权机制，安全语义单一真源。
- agent 调用面零新装配代码：skill 发现、按项目分发、会话注入全走既有链路。
- env 明文不出主进程快照边界，不落盘、不出 API。

### 潜在代价
- env 快照与 skill link 的会话内装配需新会话生效（与 MCP 一致，用户已有心智）；权限 deny 规则经 ADR-022 mtime 热生效，保存即生效。
- 技能库新增「内置来源」目录类型（小扩展，但来源目录模型多一个分支）。
- worker 内存持有明文密钥（与 MCP bearer 快照同风险级，已接受先例）。
- 组合命令逃逸面未根除，依赖默认 ask 兜底（显式接受的残余风险）。
- CLI-only 模式（非 Electron 宿主）下凭据存储退化为 base64 可逆混淆存储（与 MCP 先例保持一致），且解密失败按单 key 粒度 fail-closed 跳过（记警告日志），不向子进程透传密文或阻断健康 key；配置层设高危注入变量黑名单（BASH_ENV/LD_PRELOAD/DYLD_INSERT_LIBRARIES/NODE_OPTIONS 等 18 项，见 `DANGEROUS_ENV_KEYS`）防进程劫持。


### 替代方案
- **动态 pre-gate**（classifyBashToolCall 清单感知，实时查启用态）：动态生效无需新会话，但权限语义分两处表达，且 pre-gate 是 pre-gate、规则是规则，读者要面对两套真相——拒绝。
- **systemPrompt 文本段**：更简单且热更新现成，但不是真 skill、无渐进披露，「用户覆盖」要另造机制——拒绝。
- **专门调用桥**（仿 pi-mcp-adapter 把 CLI 包装成工具）：管控力最强但成本高；用户确认简单 CLI 用通用 skill 模板即可——本期拒绝，若 skill 指导实测失败率高可回流升级（PRD §10.6）。
- **调用时实时查库取 env**：worker 需 DB 访问，解密点分散——拒绝。

## 相关文件

- `.aiassist/stories/2026-09-06-cli-service-connection/prd.md` §10（模块/数据流/接口契约全文）
- 先例：ADR-020（规则真源）、ADR-022（项目覆盖语义）、ADR-025（MCP 桥/快照注入）、ADR-024（插件装配缝）
