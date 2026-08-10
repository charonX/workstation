# Spike 报告：M2 签核前置假设验证（H3/H4/H5 + 授权桥补充验证）

> 日期：2026-08-06
> 类型：探索验证 spike（产出结论与证据，不提交实现代码）
> 结论：**H3 PASS（8/8）、H4 PASS（11/11）、H5 PASS（11/11）、authorizerChain 授权桥 PASS（6/6）** —— 无失败项，无需触发 ADR-017 回退预案
> 环境：Node v24.18.0；`@earendil-works/pi-coding-agent` 0.83.0（工作区 node_modules）；`@gotgenes/pi-permission-system` 24.0.0（npm i --no-save 装入 node_modules，未改 package.json/lock，已 git status 核实）
> 临时脚本：`$CLAUDE_JOB_DIR/tmp/spike-gotgenes/scripts/`（lib.mjs / h3-config-discovery.mjs / h4-session-isolation.mjs / h5-loader-isolation.mjs / spike-authorizer-chain.mjs / debug-*.mjs），不提交

---

## 结论速览

| 假设 | 结论 | 关键证据 |
|---|---|---|
| H3 gotgenes 嵌入 config 发现正常（自定义 agentDir、无 ~/.pi；全局+项目两级生效） | **PASS** | 全局= `getAgentDir()/extensions/pi-permission-system/config.json`（`getAgentDir()` 读 `$PI_CODING_AGENT_DIR` 而非会话 agentDir option，控制组证实）；项目=`<cwd>/.pi/extensions/pi-permission-system/config.json`；项目覆盖全局、origin 字段可区分；projectTrusted=false 时项目范围被剔除（fail-closed） |
| H4 gotgenes 单进程多会话策略隔离（globalThis 单槽不串扰） | **PASS** | 两会话（不同 cwd/项目策略）并发真实 gate 评估，各自 policy_allow/policy_deny origin=project 独立；决策流/确认 UI 各自路由；globalThis 单槽 last-wins 语义确认但不影响 gate 评估 |
| H5 多 AgentSession 多 DefaultResourceLoader 共存（cwd/skills/extensions 独立） | **PASS** | 两会话 system prompt 的 `<available_skills>` 各自只含本空间 skill；bash 各自 cwd 生效（cat/pwd 命中各自项目，交叉读取 No such file）；扩展决策流隔离 |
| 补充：authorizerChain 编程式授权桥（ADR-017 核心 seam） | **PASS** | permissions:ready 时 registerAuthorizer + config `authorizerChain` 显式 opt-in；ask 时链先于终端 UI：allow → 免 UI、defer → UI；external_directory 面有界委托（link allow 降级 defer 仍走 UI） |

---

## H3：嵌入形态 config 发现（PASS 8/8）

### 验证方法

最小嵌入装配（模拟 worker 形态，全部走 SDK 而非 CLI）：

```js
process.env.PI_CODING_AGENT_DIR = AGENT_HOME;   // 关键：见下
const loader = new DefaultResourceLoader({
  cwd, agentDir: AGENT_HOME, settingsManager: SettingsManager.inMemory(),
  noExtensions: true, noSkills: true, /* … */
  extensionFactories: [gotgenesFactory, …],     // gotgenes 默认导出工厂，jiti 加载 src/index.ts
});
const { session } = await createAgentSession({ cwd, agentDir, sessionManager,
  modelRuntime, model, resourceLoader: loader });
await session.bindExtensions({ mode: "rpc", uiContext: autoYesUi });  // session_start 触发配置刷新
// 断言探针：globalThis 单槽服务 checkPermission() + 真实 tool_call gate 决策事件（permissions:decision）
```

策略样例：全局 `bash: { "*": "ask", "git status": "allow", … }`；项目 A `<cwd>/.pi/extensions/pi-permission-system/config.json` `bash: { "rm -rf /tmp/spikeA*": "allow", "rm -rf /tmp/spikeB*": "deny" }`。

### 实际观察

1. **全局配置发现路径 = `getAgentDir()/extensions/pi-permission-system/config.json`**（源码 config-paths.ts `getGlobalConfigPath`），而 `getAgentDir()`（pi config.js）读 `process.env.PI_CODING_AGENT_DIR`，缺省 `~/.pi/agent` —— **不是** createAgentSession/DefaultResourceLoader 的 `agentDir` option（ExtensionAPI/ExtensionContext 均无 agentDir 字段，扩展内调用的是 pi 包导出的 `getAgentDir()`）。
   - 控制组证实：`PI_CODING_AGENT_DIR=fakeAgentHome`、会话 agentDir 仍传 AGENT_HOME 时，全局配置从 fakeAgentHome 加载（`git status -> deny`）；项目配置仍按 cwd 发现（`rm -rf /tmp/spikeA-1 -> allow origin=project`）。
   - **嵌入形态必须由主进程 spawn worker 时注入 `PI_CODING_AGENT_DIR=<agentHome>`**，否则全局策略会落到真实 `~/.pi/agent/extensions/…`（污染用户主目录，与 worker.js 现有 authPath 重定向的 H2 纪律同源）。
2. **项目配置发现路径 = `<cwd>/.pi/extensions/pi-permission-system/config.json`**，session_start 时按 ctx.cwd 加载；项目覆盖全局（merge 顺序：legacy global → legacy ext → new global → legacy project → new project）。
3. **两级均生效且可区分**：`checkPermission` 与决策事件都带 `origin: "global" | "project"` 与 `matchedPattern`；真实 gate（faux tool call 走 agent loop → tool_call 钩子）产出 `policy_allow origin=global`。
4. **信任门**：`SettingsManager.inMemory()` 默认 `projectTrusted=true`（settings-manager L153 `options.projectTrusted ?? true`）；构造 `inMemory({}, { projectTrusted: false })` 后项目范围被剔除（H3.6：`rm -rf /tmp/spikeA-1` 从项目 allow 回落全局 ask）。gotgenes 在 session_start 读 `ctx.isProjectTrusted()` 并以 warn + review log 记录跳过（UNTRUSTED_PROJECT_MESSAGE）。
5. **非 TUI ask 流程可用**：mode != "tui" 时走 `ctx.ui.select()` 四选项（Yes / Yes, for this session / No / No, provide reason），宿主自实现 select 即可接管（spike 用 autoYes 探针，decision 记 `user_approved`）。

### 结论

H3 **PASS**。config 发现与两级策略加载在 SDK 嵌入形态（自定义 agentDir、无 ~/.pi）下按预期工作；唯一装配前提是显式设置 `PI_CODING_AGENT_DIR`。

---

## H4：单进程多会话策略隔离（PASS 11/11）

### 验证方法

同一进程两会话（各自独立 DefaultResourceLoader + 独立 gotgenes 实例 + 独立事件总线），不同 cwd（projA/projB）、互相矛盾的路径规则（A: spikeA allow/spikeB deny；B: spikeB allow/spikeA deny），faux provider 驱动**并发**真实 tool_call 评估，决策经 per-session `permissions:decision` 探针收集，ask 经 per-session 独立 autoYes uiContext 记录。

### 实际观察

1. **gate 评估严格按本会话策略**：并发场景下 A 的 `rm -rf /tmp/spikeA-1` → `policy_allow origin=project matched=rm -rf /tmp/spikeA*`；B 的 `rm -rf /tmp/spikeB-1` → 同理（H4.3/H4.4）。交叉命令：A 执行 `rm -rf /tmp/spikeB-2` → `policy_deny origin=project`（B 的策略未泄漏进 A），B 执行 `rm -rf /tmp/spikeA-2` → `policy_deny`（H4.7/H4.8）。
2. **决策流与确认 UI 按会话隔离**：A 的决策事件流只含 A 空间命令，B 只含 B 的（per-session 事件总线，每 loader `createEventBus()`）；ask 的确认 UI 各走各的 uiContext，A 的 UI 未收到 B 的命令（H4.11）。
3. **globalThis 单槽语义确认（M2 需知的事实）**：`globalThis[Symbol.for("@gotgenes/pi-permission-system:service")]` 在 session_start 发布、后启会话覆盖（last-wins，H4.1/H4.2：B 启动后槽位服务按 B 策略回答）；session_shutdown 时 unpublish。**gate 评估走各实例内部 resolver，不读槽位** —— 槽位只影响跨扩展 API 消费者（`getPermissionsService()` 拿到的恒为最近启动会话的服务）。M2 的授权桥（bridge extension 在 permissions:ready 里 registerAuthorizer）注册的是**每实例**的 AuthorizerRegistry，不受槽位覆盖影响（见补充验证）。
4. 副发现：一次 bash 工具调用会过**多个 surface gate**（本 spike 中 `rm -rf /tmp/spikeA-1` 同时触发 `external_directory`（cwd 外路径，默认 ask）与 `bash`）；cwd 外路径默认 ask 与 signoff 决策 14 语义一致。

### 结论

H4 **PASS**。单 worker 进程多并发独立会话各自持有独立 loader 时，策略评估/决策流/确认 UI 完全隔离，无串扰。两处测试侧陷阱（非产品缺陷）：共享 faux 响应队列并发会错位（需每会话独立 provider id）；`details` 字段取用（见补充验证）。

---

## H5：多 AgentSession 多 loader 共存（PASS 11/11）

### 验证方法

两会话各持独立 `DefaultResourceLoader`：不同 cwd（projA/projB）+ 不同 `additionalSkillPaths`（各一个 SKILL.md skill）+ 各自 gotgenes/探针扩展，`noSkills: true` 隔离默认发现。断言：system prompt 装配、skill 路径、bash cwd 行为、扩展决策流。

### 实际观察

1. **system prompt 装配独立**：A 的 `session.systemPrompt` 的 `<available_skills>` 只含 `proj-skill-a`（location=projA 目录），B 只含 `proj-skill-b`（H5.1~H5.3）。skill 名称/描述/location 是渐进披露的只读清单，互不污染。
2. **cwd 各自生效**：A 执行 `cat marker-a.txt` 输出 `marker-a`，B 的 `cat marker-b.txt` 输出 `marker-b`；交叉读取均 `No such file or directory`；`pwd` 各回各项目目录（H5.5~H5.9）。
3. **loader/扩展实例独立**：`loaderA !== loaderB`、扩展对象引用不同；gotgenes 决策流各自路由（H5.4/H5.10/H5.11）。

### 结论

H5 **PASS**。多 AgentSession 各持独立 DefaultResourceLoader 共存无资源串扰；worker.js 现装配（每 session 一个 resourceLoader）可直接叠加 `additionalSkillPaths`/`extensionFactories`。

---

## 补充验证：authorizerChain 编程式授权桥（ADR-017 核心 seam，PASS 6/6）

M2 的 ask 落地走 ADR-017 授权桥（registerAuthorizer 接既有确认挂起队列），故对桥 seam 做了实证：

1. **注册**：下游扩展在 `permissions:ready` 事件处理器里 `getPermissionsService().registerAuthorizer("bridge-name", authorize)`（ready 保证服务已发布）。**注册本身不授权** —— 必须在配置 `authorizerChain: ["bridge-name"]` 显式 opt-in；未注册的名字被跳过（fail-safe 为更多提示）。
2. **裁决语义**：ask 时链按 config 顺序先于终端（LocalUserAuthorizer）：link 返回 `{kind:"allow"}` → 免 UI 直接放行（实测 prompts=0）；`{kind:"defer"}` → 回退 UI；`{kind:"deny"}` → 拒绝。
3. **字段核对（实现期契约）**：authorize 收到的 `details` 中**没有 `value` 字段** —— 命令在 `details.command`、surface 在 `details.accessIntent.surface`、工具名在 `details.toolName`。决议可用 `details.command`/`details.toolName`/`details.accessIntent.matchValues`。
4. **决议分辨率**：链 allow 与 UI 批准同样记为 `user_approved`（deriveResolution 无独立 chain 分辨率）；链生效的判别证据 = link 被调用 + 无 UI prompt。`yoloMode` 记 `auto_approved`，可区分。
5. **有界委托（重要边界）**：`external_directory` 面上 link 的 allow 被降级为 defer，仍走 UI（实测 `ls /tmp/spikeB-dir`：ext 面 user_approved + UI，同命令 bash 面免 UI）。即 **cwd 外路径的放行无法经桥自动批准** —— 与 signoff 决策 14「只读工具 cwd 外路径 = ask」一致，是 gotgenes 的固有权衡而非缺陷。
6. **自定义工具默认 ask**：worker.js 的 FS 工具面以 customTools 注入时，未在策略中显式命名的自定义工具走全局 `"*"` 回退（ask → 桥 → UI），不会硬 block（实测 `custom-write` 工具 → ask → chain defer → UI user_approved）。M2 策略文件需为 read/write/bash 工具名显式配置（或依赖全局 `"*"` ask）。

---

## 失败项与回退预案

**无失败项**：H3/H4/H5 与授权桥全部实证通过，ADR-017 回退预案（自实现 `tool_call` 钩子）**不需要触发**。

过程中修正的三处均为 spike 测试自身问题（非 gotgenes 缺陷），记录以防复踩：

1. 并发 prompt 时共享 faux 响应队列错位 → 两会话需独立 faux provider 且 **provider id 必须不同**（`registerNativeProvider` 按 provider.id 覆盖；会话内模型重解析 `getModel(provider, id)` 会全部路由到最后注册者）。
2. 一次工具调用过多个 surface gate → 断言需按 `surface` 过滤（`bash` vs `external_directory`）。
3. `details.value` 不存在 → 桥实现用 `details.command`（见上）。

---

## 装配建议（worker.js 落地要点）

1. **spawn 环境注入**：主进程 spawn worker 时设置 `PI_CODING_AGENT_DIR=<agentHome>`（与现有 `OPC_AGENT_*` 同批注入）。这是 gotgenes 全局配置发现的唯一定位锚点；不设则回落到真实 `~/.pi/agent`。PI 核心对 agentDir 的显式传参（createAgentSession/DefaultResourceLoader）不受该 env 影响（explicit option 优先），故无副作用。
2. **注入点**：在现有 `createSessionEntry` 的 `new DefaultResourceLoader({…})` 中追加 `extensionFactories: [gotgenesFactory]`（保留现有 `noExtensions: true` —— 内联工厂不受 noExtensions 影响，文件系统发现保持关闭）。每会话独立 loader ⇒ 每会话独立 gotgenes 实例（H4/H5 已验证的隔离前提）。gotgenes 工厂以 jiti 加载 `@gotgenes/pi-permission-system` 包的 `src/index.ts` 默认导出（包 exports "." 指向 service.ts，不含工厂；`pi.extensions` 元数据指明入口）。
3. **策略文件路径约定**（M2 写盘与分发）：
   - 全局（应用资源、只读默认）：`<agentHome>/extensions/pi-permission-system/config.json`
   - 项目（用户手写可选）：`<cwd>/.pi/extensions/pi-permission-system/config.json`
   - 注意路径是 `<agentDir>/extensions/…`（无 `agent/` 段）——research 笔记写的 `~/.pi/agent/extensions/…` 只是默认 agentDir 的展开，非独立路径规则。
4. **授权桥**：worker 内以第二个内联扩展工厂注册桥（`permissions:ready` 时 `registerAuthorizer("opc-bridge", authorize)`），授权回调把确认请求经现有 IPC confirm-request 队列转发主进程；全局策略文件 `authorizerChain: ["opc-bridge"]` 显式启用。桥内取命令用 `details.command`、surface 用 `details.accessIntent.surface`。**cwd 外路径（external_directory）无法经桥放行**，M2 按 signoff 决策 14 保持 ask（其 UI 通道照常工作）。
5. **确认 UI**：保持非 TUI 模式（bindExtensions `mode: "rpc"` + 宿主 uiContext 实现 `select/input/confirm/notify`）即接通 gotgenes 的 select 流程；`hasUI` 判定 = uiContext 非 noOp，注入即视为有 UI。
6. **自定义工具面**：FS/脚本工具（read/write/bash 小写命名，签核裁决 6）在全局策略中显式配置（如 `"read": "allow"`、`"bash": {…}`、`"path": {"*": "allow"}` 项目内默认），否则走 `"*"` ask 兜底。
7. **信任门**：SDK 形态 `SettingsManager.inMemory()` 默认 projectTrusted=true，项目策略按 cwd 自动加载；如需「未信任项目不加载项目策略」语义，主进程可在 session-config 下发信任位时以 `inMemory({}, { projectTrusted })` 构造（H3.6 已验证该门）。

## 复现路径

```bash
cd $CLAUDE_JOB_DIR/tmp/spike-gotgenes/scripts   # 脚本目录
node h3-config-discovery.mjs                     # H3: 8/8 PASS
node h4-session-isolation.mjs                    # H4: 11/11 PASS
node h5-loader-isolation.mjs                     # H5: 11/11 PASS
node spike-authorizer-chain.mjs                  # 授权桥: 6/6 PASS
```

fixture（全局/项目策略 JSON、双 skill 目录、marker 文件）在 `$CLAUDE_JOB_DIR/tmp/spike-gotgenes/`；依赖 `@gotgenes/pi-permission-system@24.0.0` 已 `npm i --no-save` 装入工作区 node_modules（git status 无 package.json/lock 变更）。
