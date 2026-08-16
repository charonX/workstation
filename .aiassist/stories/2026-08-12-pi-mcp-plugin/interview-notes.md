# 访谈笔记 — 2026-08-12-pi-mcp-plugin

> 5 轮单题访谈 + 2 次文档实证（pi extensions.md / packages.md）。
> 确认方向：A（插件机制 + MCP 桥随舰），人显式 yes。

## 核心问题

PI agent 能力受限：无法调用外部工具（MCP server），也没有「安装 → 配置 → 使用」的扩展链路。pi 官方无原生 MCP（README 明示："No MCP. Build an extension that adds MCP support"），MCP 只能经 extension 机制落地。

## 用户画像

本机单用户产品的唯一使用者 + 维护者。用户自己决定装什么插件、配什么 MCP server；同时以维护者身份关心插件生态与权限边界的一致性。

## 关键边界

1. **管理对象 = pi extensions 唯一**：pi 包内捆绑的 skills/prompts/themes 不纳入管理。skills 归既有通用技能库（已支持 pi 分发，覆盖「随项目发布的基础 agent + 用户本机已装 agent」两类）。
2. **形态 = 集中管理 + 按项目分发**：对齐 pi 官方包机制——npm/git/本地三种来源；全局安装（`~/.pi/agent/settings.json` 层）+ 项目级启用/覆盖（`.pi/settings.json` 层）。用户原话：「如果 pi 支持的话，最好可以集中管理，然后按项目分发」——实证 pi 原生支持。
3. **MCP server 配置 = workstation 一等实体**：管理区 UI 增删改查 + 启用开关，落库；全局定义、按项目启用。运行时由 MCP 桥 extension 在进程内直接读取（pi 无需原生支持；extension 的 registerTool + Dynamic Tool Loading 足够）。同步写 pi config.json 仅为可选生态兼容。
4. **安全 = 全量纳入 gotgenes 权限面**：extension/MCP 注册的工具与内置工具一视同仁，按项目权限配置 + strict/standard/auto 三档管控。明确否决「安装即信任」与「插件级总开关」。
5. **飞书通道与 UI 同工同权**：两条入口的会话都能用 MCP 工具，都过权限面（默认假设，人未纠偏）。

## 隐含假设

1. MCP 桥 extension 可以由「我们控制」——自研或社区评估后接入，因此它能读 workstation 的库、能接入 gotgenes 工具面。若社区桥是黑盒且不支持配置注入/权限挂接，此假设破裂 → 转自研。
2. 进程内嵌入模式（worker.js SDK 式建会话）能复用 pi 官方包加载机制（settings.json 读写、npm/git 安装、两级作用域）。当前 gotgenes 是 jiti 手挂的，官方机制复用度未实证。
3. 用户愿意装任意第三方 extension 的场景真实存在（通用扩展能力），不是只为 MCP 包装的伪需求——人已在方向选择中显式否决「只做 MCP」的方向 B。

## 矛盾/风险

1. **pi 无原生 MCP 是官方立场**（作者撰文反对 MCP，推崇 CLI+README）：社区 MCP 桥可能稀少或质量参差。缓解：/research 先行；自研兜底。
2. **extension = 进程内任意代码**：worker 进程握有飞书连接与全部项目目录。安装第三方代码是代码级信任，官方文档亦加粗警告。缓解：权限面全量纳入（工具调用层拦截）；安装动作的应用内确认留给 TECH-DESIGN 定。
3. **story 体积**：管理机制 + MCP 桥 + 权限集成三块。缓解：CRYSTALLIZE 时按「插件机制 → MCP 桥 → 权限集成」切 slice，桥可随舰最小化（只支持 stdio server，远程 URL 二期）。

## 候选方向

### 方向 A：插件机制 + MCP 桥随舰（首选 ✅ 已确认）
- 适用场景：目标是通用扩展能力，MCP 是最高价值用例。
- 主要取舍：story 较大；但一次打通全链路不欠账。
- 推荐度：首选。

### 方向 B：最小切片——只做 MCP，桥内置随应用发布
- 适用场景：只想要 MCP，插件管理是顺带想的。
- 主要取舍：小、快；但通用插件能力缺失，下个插件需求重开 story。
- 推荐度：不推荐（人已在访谈中显式否决）。

### 方向 C：全量包管理（extensions + skills + prompts + themes）
- 推荐度：不推荐（skills 归既有技能库，人显式否决）。

## 确认方向

最终确认的方向：**方向 A**。

确认意图（人显式 yes）：

- **Outcome**: workstation 应用内集中安装/管理 PI extensions（npm/git/本地），按项目分发启用；随舰落地 MCP 桥——用户 UI 配置任意 MCP server 后，PI agent 对话中可调用其工具，全程过 gotgenes 权限面与三档模式。
- **User**: 本机用户；维护者视角管插件生态。
- **Why now**: PI agent 权限/模式/UX 已成型（2026-08-07 整合、08-08 富呈现、08-10 权限配置、08-11 模式），能力扩展是下一瓶颈；pi 0.83 官方包机制成熟可对齐。
- **Success**: 装第三方 extension（MCP 桥）→ 项目启用 → 配真实 MCP server → 对话中 agent 成功调用其工具 → strict 模式下该调用弹确认卡。
- **Constraint**: extension/MCP 工具必须纳入 gotgenes 权限面；进程内嵌入复用 pi 官方包机制的程度需实证。
- **Out of scope**: 包内 skills/prompts/themes 管理；插件市场/发现浏览；MCP 桥自研（除非 /research 证明社区无可用）；飞书通道差异化工具策略。

确认理由：方向 A 是访谈逐题选择（通用能力 → 通用 extension 管理 → 集中+按项目分发 → 纳入权限 → 只管 extensions）的自然累积。

## 最窄的切入点

插件管理机制的最小闭环：本地路径来源安装一个 extension → 全局可见 → 某项目启用 → 会话中其工具可用且过权限面。MCP 桥是这个闭环的第一个真实负载。

## 待确认问题

- [ ] /research：pi 社区有无现成 MCP 桥 extension（pi.dev/packages gallery、npm `pi-package` keyword、GitHub）；有则评估配置注入与权限挂接可行性。
- [ ] /research：SDK/嵌入模式下 pi 官方包机制（settings.json 两级、npm/git install、enable/disable）的可复用度——workstation 是直读写 settings 约定还是调 pi 暴露的程序化 API。
- [ ] TECH-DESIGN：安装第三方 extension 的应用内确认形态（一次性明示？每次安装确认？）。
- [ ] TECH-DESIGN：MCP 桥一期范围（仅 stdio server？远程 URL/鉴权二期？）。
