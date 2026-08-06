# Research: PI skills 机制

> 调研日期：2026-08-06
> 主题：PI agent 运行时（earendil-works/pi）的 skills 机制——是否原生支持、格式与 Claude Code SKILL.md 的兼容性、发现/加载/生效机制、能否按会话动态注入、与工具的关系、替代注入路径
> 来源：primary sources（本地浅克隆 GitHub 仓库 main 分支 2026-08-05 快照 commit 6b461b7、packages/coding-agent/docs/ 与 src/ 源码）
> 版本基线：main 分支 6b461b75b39b5a19b378dc42fbfbd1655bc446a6（2026-08-05）；与 npm 0.83.0 同一代码线

## 执行摘要

1. **PI 原生支持 skills，格式与 Claude Code 的 SKILL.md 约定同源兼容**：PI 实现 [Agent Skills 标准](https://agentskills.io/specification)（`SKILL.md` + frontmatter `name`/`description` 的目录格式），官方文档明确给出"消费 Claude Code skills 目录"的配置方法（settings 里加 `~/.claude/skills`）；PI 比标准宽松——不要求 skill 名与父目录同名，违规多为警告仍加载，唯独缺 `description` 的 skill 不加载。[docs/skills.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)、[src/core/skills.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts)
2. **生效机制是"渐进披露"（progressive disclosure），与假设一致但分两层**：启动/reload 时只把各 skill 的 `name`/`description`/文件路径以 `<available_skills>` XML 块拼进 system prompt；**SKILL.md 全文不自动注入**，由 agent 用 `read` 工具按需自行读取（system prompt 明确指示这么做），或通过 `/skill:name` 命令把全文展开进用户消息强制加载。[docs/skills.md "How Skills Work"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)、[src/core/skills.ts `formatSkillsForPrompt`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts)、[src/core/agent-session.ts `_expandSkillCommand`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
3. **按会话动态指定 skill 集合：SDK 层原生可行（会话创建时）**。`createAgentSession({ resourceLoader })` 每会话可挂独立 `DefaultResourceLoader`，其选项 `additionalSkillPaths`（指向任意磁盘 skill 目录/文件）、`noSkills`、`skillsOverride`（过滤/替换/追加，含内存合成 skill）足以实现"每个项目空间会话挂该项目关联的 skills"。skills 在会话构建时烧进 base system prompt；**会话中途更换 skill 集合没有细粒度 API**，只有整体 `session.reload()`（重扫资源并重建 system prompt）或扩展的 `resources_discover` 钩子（startup/reload 时贡献额外 skillPaths）。[docs/sdk.md "Skills"/"ResourceLoader"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[src/core/resource-loader.ts `DefaultResourceLoaderOptions`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts)、[src/core/agent-session.ts `reload()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
4. **skills 与工具强耦合：渐进披露依赖 `read` 工具，skill 内脚本依赖 `bash` 工具**。system prompt 仅在 `read` 工具激活时才追加 skills 段；skill 的 relative path 资源由 agent 用 read/bash 解析执行（官方安全提示：skill 可含可执行代码，模型会调用之）。`/skill:name` 展开路径不依赖 read 工具（宿主侧 `readFileSync` 读全文注入用户消息）。[src/core/system-prompt.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts)、[docs/skills.md Security 提示](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
5. **替代注入路径齐全且官方支持**：SDK 可用 `systemPromptOverride`（整体替换）、`appendSystemPrompt`/`appendSystemPromptOverride`（追加）直接定制 system prompt；CLI/RPC 有 `--system-prompt` / `--append-system-prompt`（可重复、支持文件路径）；包还导出 `loadSkills`/`loadSkillsFromDir`/`formatSkillsForPrompt`，可复用 PI 自己的解析器+XML 格式化器把 SKILL.md 内容拼进自定义 prompt。另外 `session.prompt("/skill:name args")` 本身就是一条"运行时编程式注入 skill 全文"的路径（SDK 与 RPC 同一代码路径）。[docs/sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[src/cli/args.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts)、[src/index.ts exports](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/index.ts)

## 详细发现

### 1. PI 是否原生支持 skills？格式与 Claude Code 的兼容性

- **原生支持，一等公民**。README 定位语即含 "extended through TypeScript extensions, **skills**, prompt templates, themes, and pi packages"；docs 有专页 `docs/skills.md`。[GitHub README](https://github.com/earendil-works/pi)
- **格式标准**：实现 [Agent Skills 标准](https://agentskills.io/specification)。"Pi implements the Agent Skills standard, warning about most violations but remaining lenient." skill = 含 `SKILL.md` 的目录，其余文件自由组织（`scripts/`、`references/`、`assets/` 为惯例）。[docs/skills.md "Skill Structure"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
- **frontmatter 字段**（[docs/skills.md "Frontmatter"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)）：
  | 字段 | 必填 | 说明 |
  |---|---|---|
  | `name` | 是 | ≤64 字符，小写 a-z/0-9/连字符；**PI 不要求与父目录同名**（标准原本要求，PI 认为不利于多 harness 共享目录） |
  | `description` | 是 | ≤1024 字符；**缺失则整个 skill 不加载**（唯一硬性失败条件） |
  | `license` / `compatibility` / `metadata` | 否 | 标准可选字段 |
  | `allowed-tools` | 否 | 空格分隔的预批准工具列表（experimental） |
  | `disable-model-invocation` | 否 | `true` 时不出现在 system prompt，只能 `/skill:name` 显式调用 |
- **与 Claude Code 的兼容性：官方明示**。docs/skills.md "Using Skills from Other Harnesses" 一节给出直接复用 Claude Code / Codex skills 目录的配置：`settings.json` 加 `"skills": ["~/.claude/skills", "~/.codex/skills"]`，项目级 `.pi/settings.json` 加 `"skills": ["../.claude/skills"]`。即 Claude Code 的 skill 目录可直接被 PI 发现加载。[docs/skills.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
- **宽松度细节**（[src/core/skills.ts `validateName`/`loadSkillFromFile`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts)）：name 超长/非法字符、description 超长 → 警告但仍加载；未知 frontmatter 字段忽略；name 缺省回落到父目录名；同名冲突 → 警告并保留先发现者；同一文件经 symlink 重复出现 → 静默去重（按 canonical path）。
- **额外的裸 `.md` 发现规则**：`~/.pi/agent/skills/` 与 `.pi/skills/` 根目录下的直接 `.md` 文件也算独立 skill；`~/.agents/skills/` 与项目 `.agents/skills/` 根目录裸 `.md` 被忽略（只认含 SKILL.md 的子目录）。[docs/skills.md "Discovery rules"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)

### 2. 发现与加载机制：目录扫描、加载时机、生效方式

**扫描位置**（[docs/skills.md "Locations"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) + [src/core/package-manager.ts `resolve()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/package-manager.ts) + [src/core/skills.ts `loadSkills`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts)）：

| 来源 | 路径 | 说明 |
|---|---|---|
| 全局（pi 自有） | `~/.pi/agent/skills/`（即 `agentDir/skills`） | 根裸 .md 也算 |
| 全局（跨 harness） | `~/.agents/skills/` | 始终加载（无 trust 门槛） |
| 项目（pi 自有） | `<cwd>/.pi/skills/` | **需项目被信任** |
| 项目（跨 harness） | `<cwd>/.agents/skills/`，沿祖先目录上溯至 git repo root（非 repo 则到文件系统根） | **需项目被信任**（[src/core/package-manager.ts `projectAgentsSkillDirs`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/package-manager.ts)、[src/core/trust-manager.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/trust-manager.ts)） |
| pi packages | 包的 `skills/` 目录或 `package.json` 的 `pi.skills` 条目 | 包管理器解析 |
| settings | `skills` 数组（文件或目录路径），全局/项目 settings.json 均可 | [src/core/settings-manager.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/settings-manager.ts) |
| CLI | `--skill <path>` 可重复，即使 `--no-skills` 也叠加生效 | [src/cli/args.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts) |
| SDK | `DefaultResourceLoader` 的 `additionalSkillPaths` | [src/core/resource-loader.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts) |

- `--no-skills` / `noSkills: true` 关闭默认目录发现，但显式路径（`--skill`、`additionalSkillPaths`）仍加载。
- **扫描行为**：含 `SKILL.md` 的目录视为 skill root 且不继续下钻；否则递归子目录（跳过 `.` 开头目录与 `node_modules`）；尊重 `.gitignore`/`.ignore`/`.fdignore`。[src/core/skills.ts `loadSkillsFromDirInternal`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts)

**加载时机与生效方式**（[docs/skills.md "How Skills Work"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)，官方原文四步）：

1. 启动时扫描所有位置，**只提取 name 和 description**（frontmatter 级解析，全文不读入上下文）。
2. system prompt 以 XML 格式包含可用 skills（按 [agentskills.io/integrate-skills](https://agentskills.io/integrate-skills)）。
3. 任务匹配时 agent 用 `read` 工具加载 SKILL.md 全文（官方注明：模型不总是主动这么做，可用 prompt 引导或 `/skill:name` 强制）。
4. agent 遵循其中指令，用相对路径引用脚本与资产。

- 实际拼进 system prompt 的文本（[src/core/skills.ts `formatSkillsForPrompt`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts)）：
  ```
  The following skills provide specialized instructions for specific tasks.
  Use the read tool to load a skill's file when the task matches its description.
  When a skill file references a relative path, resolve it against the skill directory ...
  <available_skills>
    <skill><name>...</name><description>...</description><location>/abs/path/SKILL.md</location></skill>
    ...
  </available_skills>
  ```
  `disableModelInvocation: true` 的 skill 被过滤不出现在此块。
- **skills 段仅当 `read` 工具在激活工具集里才追加**（[src/core/system-prompt.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts)，两处均为 `if (hasRead && skills.length > 0)`）。默认激活工具为 `read, bash, edit, write`（[src/core/agent-session.ts `_buildRuntime` 默认](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)）。
- **system prompt 构建时机**：会话构建（`_buildRuntime` → `_rebuildSystemPrompt`，从 `resourceLoader.getSkills()` 取快照）以及 `session.reload()` / 扩展 `resources_discover` 之后重建。skills 在会话运行期间是 system prompt 的静态组成部分，不随磁盘变化自动刷新。[src/core/agent-session.ts `_rebuildSystemPrompt`/`extendResourcesFromExtensions`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)

**Skill Commands（`/skill:name`）**：

- skills 注册为 `/skill:name` 斜杠命令；`enableSkillCommands` 设置默认 `true`（[src/core/settings-manager.ts L1055 `?? true`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/settings-manager.ts)）。
- 展开语义（[src/core/agent-session.ts `_expandSkillCommand`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)）：宿主侧 `readFileSync(skill.filePath)` 读全文，剥离 frontmatter，包成
  `<skill name="..." location="...">\nReferences are relative to <baseDir>.\n\n<body>\n</skill>`
  替换用户消息文本，命令后参数追加为尾部文本。**即全文作为用户消息注入，而非 system prompt**。
- 展开发生在 `prompt()` 标准路径（`expandPromptTemplates` 默认 `true`），SDK `session.prompt("/skill:xxx ...")` 与 RPC `prompt` 命令均走此路径；`expandPromptTemplates: false` 可关闭。[src/core/agent-session.ts `prompt()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
- RPC 模式 `get_commands` 会把 skills 列进命令清单（`source: "skill"`）。[src/modes/rpc/rpc-mode.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts)

### 3. 运行时按会话动态指定/切换 skill 集合（核心问题）

**会话创建时按会话隔离 skill 集合：SDK 原生支持。** `createAgentSession()` 接受 `resourceLoader`；每个会话可构造自己的 `DefaultResourceLoader`（[docs/sdk.md "Skills" 一节](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[examples/sdk/04-skills.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/04-skills.ts)）：

- `additionalSkillPaths: string[]`：追加任意磁盘 skill 目录/文件——**正好对应"项目关联的 skill 目录列表"**。可配合 `noSkills: true` 关掉全局/项目默认发现，做到会话 skill 集合 = 平台指定集合。
- `skillsOverride: (base) => ({ skills, diagnostics })`：对发现结果做过滤/替换/追加；可注入程序合成的 `Skill` 对象（`name/description/filePath/baseDir/sourceInfo/disableModelInvocation`，官方示例用 `createSyntheticSourceInfo`）。
- 官方 SDK 示例完整演示了"过滤 + 追加自定义 skill → `loader.reload()` → `createAgentSession({ resourceLoader: loader })`"。
- 也可以完全自实现 `ResourceLoader` 接口（`getSkills()` 等方法），此时 `cwd`/`agentDir` 不再控制资源发现（[docs/sdk.md "ResourceLoader"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)）。

**会话中途切换 skill 集合：无细粒度 API。** 已确认的路径：

- `session.reload()`：重载 settings + resources + 重建 system prompt（`_buildRuntime` → `_rebuildSystemPrompt`）。但这是整体重载（重置 providers、扩展 runner 作废重建），不是"只换 skills"的轻量操作。[src/core/agent-session.ts `reload()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
- 扩展 `resources_discover` 钩子：在 `session_start` 后（startup/reload 两种 reason）返回额外 `skillPaths`，session 会 `extendResources()` 并重建 system prompt——即扩展可在会话启动/重载时按 `event.cwd` 动态贡献 skill 路径。[docs/extensions.md "resources_discover"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[src/core/agent-session.ts `extendResourcesFromExtensions`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
- 消息级注入：`session.prompt("/skill:name args")` 把某个 skill 全文注入当前会话的用户消息——skill 需已被 loader 发现（`_expandSkillCommand` 按 name 查 `resourceLoader.getSkills()`，未命中则原文透传）。
- 一个进程内多个 `AgentSession` 各自持有自己的 `ResourceLoader` 是 SDK 的常态用法（sdk.md 未对多 loader 共存提出限制）；每会话独立 skill 集合互不干扰。

**RPC 形态**：skills 只能走文件系统发现（启动参数 `--skill`、settings、默认目录），无 RPC 命令在运行中改 skill 集合（RPC 命令枚举中无 skills 相关命令，仅 `get_commands` 暴露 skill 命令清单）。每空间一个 RPC 子进程时，可用各自的 `--skill`/`--no-skills` 启动参数隔离。[docs/rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[src/cli/args.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts)

**trust 注意点**：项目级 `.pi/skills` 与祖先 `.agents/skills` 仅在项目被信任时加载；但 `SettingsManager` 的 `projectTrusted` **默认 `true`**（[src/core/settings-manager.ts L301/L325](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/settings-manager.ts)），CLI 交互模式的信任提示流程是上层行为。显式路径（`--skill`/`additionalSkillPaths`/settings `skills` 数组）不受 trust 门槛影响。

### 4. skills 与工具的关系

- **发现层与执行层分离**：system prompt 只放 name/description/location；SKILL.md 全文、references、scripts 全靠 agent 用工具按需访问。
- **`read` 工具是渐进披露的前提**：无 read 工具则 skills 段不进 system prompt（见第 2 节）。
- **`bash` 工具承载 skill 内脚本**：官方示例 skill（brave-search）的用法就是 SKILL.md 里写 `./search.js "query"` 这类命令，由 agent 用 bash 执行；官方明确安全提示："Skills can instruct the model to perform any action and may include executable code the model invokes. Review skill content before use."[docs/skills.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
- **相对路径解析约定**：system prompt 指示"skill 文件的相对路径相对其所在目录解析成绝对路径再用于工具命令"；`/skill:name` 展开块里也内联 `References are relative to <baseDir>.`。[src/core/skills.ts `formatSkillsForPrompt`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts)、[src/core/agent-session.ts `_expandSkillCommand`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)
- **`allowed-tools` frontmatter**：空格分隔的预批准工具列表，标注 experimental；本次调研未深入其对 PI 工具权限的实际强制逻辑（PI 本身无内置权限系统）。[docs/skills.md "Frontmatter"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
- **`/skill:name` 展开路径不依赖 agent 的工具集**：全文由宿主 `readFileSync` 读取注入用户消息——即便缩减 agent 工具（如去掉 read），该路径仍可注入 skill 指令（但 skill 内引用的脚本/资产仍需要 bash/read 才能被 agent 使用）。

### 5. 替代/补充注入路径（"把 SKILL.md 文本拼入上下文"）

若不依赖 PI 原生 skills 机制，以下官方路径均可行（SDK 侧能力最完整）：

- **system prompt 定制**（[docs/sdk.md "System Prompt"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[src/core/resource-loader.ts `DefaultResourceLoaderOptions`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts)）：
  - `systemPrompt: string` / `systemPromptOverride: (base) => string`：整体替换（替换后走 custom prompt 分支，skills 段仍可在 custom prompt 有 read 工具时追加——[src/core/system-prompt.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts)）。
  - `appendSystemPrompt: string[]` / `appendSystemPromptOverride`：在默认 system prompt 后追加任意文本——**把 SKILL.md 内容直接拼进 system prompt 的最直接官方通道**。
- **CLI/RPC 等价物**：`--system-prompt <text>`、`--append-system-prompt <text|file>`（可重复，传文件路径则读文件内容）。[src/cli/args.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts)
- **Context files（AGENTS.md 机制）**：`agentsFilesOverride` 可注入虚拟上下文文件（路径+内容），进 system prompt 的 context files 段。[docs/sdk.md "Context Files"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- **消息级注入**：`session.prompt()`/`steer()`/`followUp()` 直接发送包含 SKILL.md 文本的消息；或利用 `/skill:name` 展开获得与原生机制一致的 `<skill ...>` 包裹格式。
- **复用 PI 的解析/格式化原语**：包入口导出 `loadSkills`、`loadSkillsFromDir`、`formatSkillsForPrompt`、`Skill`、`SkillFrontmatter`、`parseSkillBlock`（[src/index.ts L262-270](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/index.ts)）——平台可用 PI 自己的加载器扫描项目 skill 目录，再按自选方式注入。
- **注意**：`skillsOverride` 注入的合成 skill 若 `filePath` 指向不存在的文件（官方示例用了 `/virtual/SKILL.md`），其 name/description 会出现在 system prompt 的 `<available_skills>` 中，但 agent 用 read 加载全文、`/skill:name` 展开（`readFileSync`）都会失败——**虚拟 skill 只适合"只挂描述"的场景，全文注入应走 appendSystemPrompt 或消息注入**。

## 不确定 / 待验证

- **合成（虚拟路径）skill 的行为边界**：官方 SDK 示例确实构造了 `/virtual/SKILL.md` 的 skill，但示例只打印了发现结果，未演示 agent 实际加载其内容；`/skill:name` 展开与 read 工具都按 `filePath` 读磁盘，虚拟路径必然失败。不确定官方对"无磁盘文件 skill"的定位是"仅挂描述"还是有其他兜底。
- **`enableSkillCommands` 的精确门槛范围**：该设置默认 `true`（settings-manager 注释 "register skills as /skill:name commands"）；`_expandSkillCommand` 在 `prompt()` 路径中只受 `expandPromptTemplates` 选项控制，未看到对 `enableSkillCommands` 的检查——该设置可能只影响交互模式的命令注册/补全，不影响 prompt 文本展开。未逐行核实所有调用点。
- **`allowed-tools` frontmatter 的强制语义**：文档标注 experimental，未核实其在工具执行层的实际效果（PI 无内置权限系统，可能只是提示性元数据）。
- **compaction 后 skills 段的持续性**：compaction 复用 `_baseSystemPromptOptions` 重建 prompt（[src/core/agent-session.ts L1237](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)），推断 skills 段在压缩后保留，但未做运行实证。
- **多个 `AgentSession` 各持独立 `DefaultResourceLoader` 共存的官方背书**：代码上无明显共享可变状态（每 loader 自有 SettingsManager/PackageManager 实例），sdk.md 也未禁止；但未找到官方多会话各挂不同 skill 集合的示例，且若各 loader 用默认 FileSettingsStorage 指向同一 settings.json，写设置时可能互相覆盖（只读使用无碍）。
- **RPC 模式 `--append-system-prompt` 传文件路径的行为**：args 帮助文本说 "Append text or file contents"，未核实 RPC 启动时该参数的解析与 --skill 的叠加顺序。
- **pi.dev 官网与 GitHub docs 的同步差**：本次全部以 main 分支源码/docs 为准（commit 6b461b7），未对照官网渲染版。

## 开放问题（留给 /tech-design）

- 每空间 skill 集合的挂载点选择：SDK `additionalSkillPaths`/`skillsOverride`（创建时固定）vs 扩展 `resources_discover`（startup/reload 动态）vs `appendSystemPrompt` 直接拼文本——三者在"skill 变更后已开会话如何感知"上语义不同。
- 是否需要 `/skill:name` 这条"用户/平台强制全文加载"通道暴露给空间 UI，还是仅依赖 description 匹配的渐进披露。
- 平台 skills 目录与 PI 默认发现（`~/.pi/agent/skills`、`.agents/skills` 等）的关系：隔离（`noSkills: true` + 显式路径）还是叠加。
- skill 内可执行脚本在桌面应用 worker 子进程中的安全边界（PI 无内置权限系统，skill 代码以用户权限运行）。
- 若采用 RPC 形态（每空间一子进程），`--skill` 启动参数方案与 SDK 形态的能力差（无 skillsOverride/合成 skill）是否可接受。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| skills 文档（源码 docs） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md | 2026-08-06 | skills 标准/位置/发现规则/生效机制/frontmatter/Claude Code 复用 |
| skills.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts | 2026-08-06 | 扫描/校验/去重/`formatSkillsForPrompt` XML 格式/`loadSkills` |
| resource-loader.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts | 2026-08-06 | `DefaultResourceLoaderOptions`（additionalSkillPaths/noSkills/skillsOverride/systemPrompt*）/reload |
| agent-session.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts | 2026-08-06 | system prompt 构建时机、`/skill:name` 展开、prompt() 路径、reload()、resources_discover 接线 |
| system-prompt.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts | 2026-08-06 | skills 段仅在 read 工具激活时追加 |
| package-manager.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/package-manager.ts | 2026-08-06 | `.agents/skills` 全局/项目/祖先目录解析、trust 门槛 |
| trust-manager.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/trust-manager.ts | 2026-08-06 | 项目 skills 的信任门规则 |
| settings-manager.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/settings-manager.ts | 2026-08-06 | settings `skills` 数组、`enableSkillCommands` 默认 true、`projectTrusted` 默认 true |
| SDK 文档（源码 docs） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md | 2026-08-06 | resourceLoader/skillsOverride/systemPromptOverride/agentsFilesOverride 用法、cwd/agentDir 发现规则 |
| SDK skills 示例（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/04-skills.ts | 2026-08-06 | 过滤+合成 skill 的官方示例 |
| extensions 文档（源码 docs） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md | 2026-08-06 | `resources_discover` 钩子（运行时贡献 skillPaths） |
| cli/args.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts | 2026-08-06 | `--skill`/`--no-skills`/`--system-prompt`/`--append-system-prompt` |
| rpc-mode.ts / rpc-types.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts | 2026-08-06 | RPC 无 skill 集合变更命令；get_commands 暴露 skill 命令 |
| index.ts（源码 exports） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/index.ts | 2026-08-06 | `loadSkills`/`loadSkillsFromDir`/`formatSkillsForPrompt` 等公共导出 |
| Agent Skills 标准 | https://agentskills.io/specification 、 https://agentskills.io/integrate-skills | 2026-08-06 | PI 声明遵循的上游标准（本次未独立核对标准全文） |
| 本地浅克隆 | /tmp/pi-research/pi（main @ 6b461b7, 2026-08-05） | 2026-08-06 | 全部源码引用的读取基线 |
