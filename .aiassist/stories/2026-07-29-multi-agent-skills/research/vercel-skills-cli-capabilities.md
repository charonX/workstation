# Research: vercel-labs/skills CLI 能力边界

> 调研日期：2026-07-29
> 主题：vercel-labs/skills CLI 的集成方式、canonical copy 机制、扫描/list 能力、agent registry、平台处理
> 来源：primary sources —— 仓库源码（clone 于 2026-07-29，HEAD）、package.json、README、npm registry。本地 clone 路径 `/tmp/vercel-skills-research`（引用行号以此为准）；npm 包 `skills@1.5.20` tarball 已下载核对。

## 执行摘要

- **纯 CLI，无可编程 API**：npm 包 `skills`（无 scope）的 package.json 只有 `bin`，没有 `main`/`exports`；发布产物 `dist/cli.mjs` 末尾是 `export {}`，类型声明文件 `dist/cli.d.mts` 内容也是 `export {}`。任何程序化复用只能 spawn CLI 或 vendor 源码（MIT）。[package.json; package/dist/cli.d.mts]
- **canonical copy 固定在 `<cwd>/.agents/skills`（项目）或 `~/.agents/skills`（全局），不可配置**。默认 symlink 模式：skill 被**实体拷贝**进 canonical 目录，各 agent 目录创建指向 canonical 的 symlink（Windows 用 junction + 绝对路径；POSIX 用相对路径）。`skills add <本地路径>` 同样先把源目录拷贝进 canonical —— canonical 不是指向源目录的链接。[src/installer.ts:98-101, 255-258, 358-391; src/constants.ts]
- **75 个 agent 的目录约定表在 `src/agents.ts` 的 `agents` 对象**，字段含 `skillsDir`（项目相对）、`globalSkillsDir`（绝对）、`detectInstalled()` 等；但它在发布的 npm 包内不可 import。[src/agents.ts:63-758; src/types.ts:89-100]
- **exit code 不能作为安装成功的充分信号**：`add` 流程中单个 agent/skill 安装失败只打印错误、仍以 0 退出；只有灾难性错误（无 source、clone 失败、无效 agent 名等）才 exit 1。唯一机器可读输出是 `skills list --json`（且其中 `agents` 字段是 displayName 而非 agent key）。[src/add.ts:1745-1746, 1992-1998; src/list.ts:114-128]
- **包极小且无原生模块**：tarball ~120KB / 解压 ~508KB / 18 个文件，运行时依赖只有 `yaml`；但 git URL 安装需要系统 `git` 二进制（simple-git），私有 GitHub repo 可选依赖 `gh` CLI。`engines: node >=22.20.0`。[npm registry; src/git.ts:1,182-195; package.json]

## 详细发现

### 1. 包与分发形式

- **包名**：`skills`（无 scope），npm 上当前版本 1.5.20，MIT license。注意该包名 2016 年就存在（1.0.0 @ 2016-10-06），当前产品线从 1.0.1 @ 2026-01-17 开始 —— 包名应是后来取得的。[npm registry time 字段]
- **bin**：`"bin": {"skills": "./bin/cli.mjs", "add-skill": "./bin/cli.mjs"}` —— 两个命令名指向同一入口。[package.json]
- **无 main / 无 exports**：package.json 只有 `"type": "module"` 和 bin；npm registry 元数据确认 `exports: None, main: None`。[package.json; npm registry]
- **dist 产物零导出**：`bin/cli.mjs` 是薄加载器（启用 `module.enableCompileCache`，Node ≥22.8 特性，然后 `await import('../dist/cli.mjs')`）。`dist/cli.mjs`（257KB，obuild/rolldown 打包）末尾为 `export {}`；`dist/cli.d.mts` 内容为 `export {}`。[bin/cli.mjs; package/dist/cli.mjs:6897; package/dist/cli.d.mts]
- **结论**：官方不支持 `import ... from 'skills'`。可行路径只有：(a) spawn `skills` bin；(b) vendor/fork TypeScript 源码（`src/`，MIT）。
- **进程行为**：CLI 结束时总是显式 `process.exit(process.exitCode ?? 0)`（先 flush telemetry，5s 超时兜底），不会挂起。[src/cli.ts:414]
- **Node 要求**：`engines: node >=22.20.0`。[package.json]

### 2. 非交互驱动能力

**命令与 flag**（来源：`src/cli.ts:105-200` showHelp 文本 + 各命令 parse 函数）：

| 命令 | flag |
|---|---|
| `add` (alias: a/i/install) | `-g/--global`、`-a/--agent <多个\|*>`、`-s/--skill <多个\|*>`、`-l/--list`（只列出不安装）、`-y/--yes`、`--copy`、`--metadata <json>`、`--subagent`（Eve 专用）、`--all`（= `--skill '*' --agent '*' -y`）、`--full-depth` |
| `remove` (rm/r) | `-g/--global`、`-a/--agent <多个\|*>`、`-s/--skill <多个\|*>`、`-y/--yes`、`--all` |
| `update` (upgrade/check) | `-g/--global`、`-p/--project`、`-y/--yes`；位置参数为 skill 名 |
| `list` (ls) | `-g/--global`、`-a/--agent <多个>`、`--json` |
| `find` (search/f/s) | `--owner <owner>`；交互搜索 |
| `experimental_install` | 从 `skills-lock.json` 恢复（只装进 `.agents/skills/`）[src/install.ts:10-14] |
| `experimental_sync` | `-a/--agent`、`-y/--yes`；从 node_modules 同步 [src/sync.ts:23-27] |
| `use` | `-s/--skill`、`-a/--agent`、`--full-depth`；生成 prompt 不安装 |
| `init` | 位置参数 name |

**非交互行为**：
- `add`：检测到在 AI agent 内运行时自动 `-y` 并自动选 agent（`@vercel/detect-agent` 环境变量检测；普通 spawn 不会触发）。非 TTY stdin 时只打印提示 "use the --yes (-y) and --global (-g) flags to install without prompts"，**不会自动跳过交互** —— 多 skill 且无 `-y` 时仍会进入 `searchMultiselect` 阻塞。所以脚本驱动必须显式传 `-y`（通常连同 `-a`、`-s`）。[src/add.ts:1056-1067, 1080-1082, 1287-1337]
- `remove`：同理，agent 内自动 `-y`；否则显式 skill 名 + `-y` 可完全非交互。[src/remove.ts:62-71, 188-204]
- `update`：非 TTY stdin 时自动检测 scope（有 `skills-lock.json` 或 `.agents/skills/` 则为 project，否则 global），`-y` 效果相同。[src/update.ts:120-122]
- 交互取消（Esc）一律 `process.exit(0)` —— 取消与成功同码。[多处，如 src/add.ts:754, 844, 1333]

**exit code 语义**：
- exit 1：缺 source 参数、本地路径不存在、clone 失败、未发现 skill、`--skill` 无匹配、无效 agent 名（add/remove/list 都是）、flag 解析错误、未捕获异常、update 有失败项（`process.exitCode = 1`）。[src/add.ts:1046, 1137, 1203, 1276, 1363, 2020; src/cli.ts:361, 410; src/list.ts:91; src/remove.ts:143; src/update.ts:739]
- **关键陷阱**：`add` 的逐 agent/skill 安装失败（`results` 里 `success: false`）只打印 `Failed to install N`，**不设置非零退出码**，流程照常走到 `Done!`。要确认安装结果必须另跑 `skills list --json` 或自行验目录。[src/add.ts:1745-1746, 1992-2004]
- `remove` 对 "无匹配 skill" 只打印错误并 return，exit 0。[src/remove.ts:154-157]

**stdout/stderr 机器可解析性**：
- 除 `list --json` 外全部为 @clack/prompts 风格的人类输出（ANSI 颜色、spinner、分节框），不适合机器解析。
- `list --json`：纯 JSON 数组写 stdout，无 ANSI。字段：`name`、`path`（canonicalPath）、`scope`（`project|global`）、`agents`（**displayName 数组**，如 `"Claude Code"`，不是 `claude-code` key）、`source`、`sourceUrl`、`sourceType`（后三者来自 lock 文件，可为 null）。[src/list.ts:114-128]

### 3. canonical copy 机制（最关键）

**canonical 位置（硬编码，无 flag/配置可改）**：
- 项目级：`<cwd>/.agents/skills`；全局级：`~/.agents/skills`（`homedir()`）。由 `getCanonicalSkillsDir()` 给出，常量 `AGENTS_DIR='.agents'`、`SKILLS_SUBDIR='skills'`。[src/installer.ts:98-101; src/constants.ts:1-3]

**symlink 模式（默认）**，以 `installSkillForAgent` 为例 [src/installer.ts:265-421]：
1. `cleanAndCreateDirectory(canonicalDir)` —— 先 `rm -rf` 再重建 canonical 目录 [installer.ts:163-170, 359]
2. `copyDirectory(skill.path, canonicalDir)` —— **实体拷贝**（排除 `.git`、`__pycache__`、`__pypackages__`、`metadata.json`；解引用源内 symlink；保留权限位）[installer.ts:360, 423-514]
3. `createSymlink(canonicalDir, agentDir)` —— agent 目录建链指向 canonical [installer.ts:391]

因此：
- **`skills add <本地路径>`**：canonical copy 是源目录的**拷贝**，不是指向源目录的链接；agent 目录的 symlink 指向 canonical copy。源目录安装后不再被引用。[src/add.ts:1131-1145 → installer.ts:358-391]
- **`skills add <git URL>`**：先 clone 到 OS 临时目录（simple-git → 系统 `git`；GitHub 私有库 fallback `gh repo clone`），然后走同样的 "拷贝到 canonical + symlink" 流程，`finally` 中删除临时目录。canonical copy 由库持有，与上游 repo 脱离。[src/add.ts:1174-1195, 2021-2035; src/git.ts:1,182-195]
- 例外（vercel/vercel-labs/heygen-com 等白名单 owner）：走 skills.sh blob 下载 API，不经过 git clone，直接把文件内容写入 canonical。[src/add.ts:1146-1167]
- **overlap 跳过**：若源路径与 canonical 目录重叠（如 `skills add ./.agents/skills/x`），跳过拷贝直接视为成功；源与 agentDir 重叠同理跳过。[src/installer.ts:327-356]
- **universal agent**（`skillsDir === '.agents/skills'` 的 15 个左右 agent，如 amp/codex/cursor/opencode/zed 等）：canonical 目录就是其目录，**不建 symlink**。全局安装到 universal agent 时也不再向 agent 专属全局目录（如 `~/.copilot/skills`）建链。[src/agents.ts:809-815; src/installer.ts:365-372]
- **项目级的重要边界**：非 universal agent 若其配置根目录在项目中不存在（如无 `.windsurf/`），则**跳过建 symlink**，skill 只留在 `.agents/skills/`；`claude-code` 是唯一豁免（即使无 `.claude/` 也会建链）。[src/installer.ts:378-389, 1017-1032]

**symlink target 形态** [src/installer.ts:197-263]：
- POSIX：从 link 的 real parent dir（解析过父级 symlink）到 target 的**相对路径**。
- Windows：`junction` 类型 + **绝对 resolved target**。
- 建链前若已存在同名 symlink：target 一致则复用；不一致则删除重建。若父目录本身是 symlink（如 `~/.claude/skills` → `~/.agents/skills`），realpath 比较后视为同一位置直接成功，避免误删 canonical。

**`--copy` 模式**：完全跳过 canonical，直接把文件拷贝到每个 agent 目录。[src/installer.ts:337-346]

**lock 文件（与 canonical 配套的元数据）**：
- 项目级：`<cwd>/skills-lock.json`（建议入库，key 按字母序，含 source/sourceUrl/ref/sourceType/skillPath/computedHash/subagents）。[src/local-lock.ts:5-66]
- 全局级：`$XDG_STATE_HOME/skills/.skill-lock.json`，否则 `~/.agents/.skill-lock.json`；**只有远程来源才写**（local 来源 `normalizedSource` 为 null 不写全局 lock）。[src/skill-lock.ts:67-73; src/add.ts:1810]
- local 来源在项目 lock 中记为 `sourceType: 'local'`，**不参与 update**（见第 8 节）。

### 4. list/scan 能力

- `skills list` **默认只列项目级**；`-g` 只列全局。CLI 层没有 "两者都列" 的 flag —— 底层 `listInstalledSkills` 在 `global === undefined` 时支持双 scope，但 `runList` 永远传 true/false。[src/list.ts:80; src/installer.ts:1099-1103]
- 扫描目标（单 scope 内）[src/installer.ts:1105-1166]：
  1. canonical 目录（`.agents/skills` 或 `~/.agents/skills`）；
  2. **检测为已安装**的每个 agent 的 skills 目录（detectInstalled 基于各 agent 配置目录存在性）；
  3. 未检测到、但磁盘上实际存在该目录的 agent skills 目录（兜底，防止 agent 卸载后漏列）。
  Eve subagent 目录（`agent/subagents/<name>/skills`）在项目级也会扫。
- **能发现"非本库安装"的 skill**：只要它位于 75 个已知 agent 目录约定之一、且含合法 `SKILL.md`（frontmatter 必须有字符串类型的 `name` 和 `description`），就会被列出 —— 扫描不依赖 lock 文件。[src/installer.ts:1169-1311; src/skills.ts:75-128]
- **不能扫描任意指定目录**：扫描集合完全由 registry 的目录约定 + cwd/homedir 决定，无自定义路径入口。
- 归因与去重：按 `scope:name` 去重；在 agent 专属目录发现的直接归因该 agent；在 canonical 发现的会逐个 agent 目录探测（目录名匹配 + SKILL.md name 兜底匹配）来填充 `agents` 列表。[src/installer.ts:1193-1305]
- 输出：人类格式按 plugin 分组；`--json` 见第 2 节（注意 `agents` 是 displayName）。
- 另有 `skills add <source> -l/--list`：列出某 repo/路径内**可安装**的 skill（不安装），人类输出，无 --json。[src/add.ts:1210-1258]

### 5. agent registry

- **位置**：`src/agents.ts`，`export const agents: Record<AgentType, AgentConfig>`，当前 **75 个条目**（脚本数得）。[src/agents.ts:63-758]
- **数据格式**（`AgentConfig`，src/types.ts:89-100）：
  | 字段 | 类型 | 说明 |
  |---|---|---|
  | `name` | string | agent key（如 `claude-code`） |
  | `displayName` | string | 展示名（如 `Claude Code`） |
  | `skillsDir` | string | 项目级 skills 目录（相对项目根），如 `.claude/skills`、`.agents/skills` |
  | `globalSkillsDir` | string \| undefined | 全局 skills 目录（**模块加载时展开的绝对路径**）；`undefined` = 不支持全局（eve、promptscript） |
  | `detectInstalled()` | `() => Promise<boolean>` | 基于配置目录存在性等判断 |
  | `showInUniversalList?` / `showInUniversalPrompt?` | boolean | 控制交互列表展示 |
- **注意**：`globalSkillsDir` 是模块加载时用当前进程的 `homedir()`/环境变量算好的**值**，不是函数 —— 直接 vendor 时要注意展开时机与环境（Electron 主进程 env 与用户 shell env 可能不同）。受影响的环境变量：`XDG_CONFIG_HOME`（经 xdg-basedir）、`CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`VIBE_HOME`、`HERMES_HOME`、`AUTOHAND_HOME`、`GROK_HOME`、`APPDATA`、`FLATPAK_XDG_CONFIG_HOME`。[src/agents.ts:7-17]
- 辅助导出：`detectInstalledAgents()`、`getAgentConfig(type)`、`getUniversalAgents()`、`getVisibleUniversalAgents()`、`getNonUniversalAgents()`、`isUniversalAgent(type)`、`getEveSubagents(cwd)`、`EVE_SUBAGENTS_DIR`。[src/agents.ts:760-847]
- **可 import 复用性**：npm 包无 exports，**不能** `import { agents } from 'skills'`。复用途径：vendor `src/agents.ts` + `src/types.ts`（依赖仅 `xdg-basedir`，MIT license）。
- README 有人类可读的目录约定表（Supported Agents 一节，含每个 agent 的 Project Path / Global Path）。[README.md:242-312]

### 6. Windows 处理

- 建链统一走 `createSymlink()`：`platform() === 'win32'` 时用 `symlinkType = 'junction'`，target 用**绝对 resolved 路径**；POSIX 用相对路径、默认类型。junction 针对目录、**不需要开发者模式/管理员权限**（普通目录 junction 在 Windows 上始终可用）。[src/installer.ts:253-258]
- 任何 symlink 错误（权限、ELOOP 无法清理等）→ 返回 false → 调用方**自动降级为目录拷贝**（`symlinkFailed: true`），安装结果仍算成功。[src/installer.ts:260-263, 393-405]
- CLI 在出现 symlink 降级时打印提示："Files were copied instead. On Windows, enable Developer Mode for symlink support."（指真 symlink 场景；junction 本身不依赖开发者模式）。[src/add.ts:1981-1989]
- 边界处理：父目录本身是 symlink 时用 realpath 解析后比较/计算相对路径，避免 canonical 与 agent 目录互为链接时误删 canonical；ELOOP 循环链接尝试 `rm --force` 清理。[src/installer.ts:181-263]

### 7. 体积与依赖

- **发布体积**（npm registry `dist` 字段 + tarball 实测）：tarball ~120KB；解压 ~508KB（`unpackedSize: 508221`）；18 个文件。内容：`bin/cli.mjs`、`dist/cli.mjs`（257KB 主 bundle）、`dist/_chunks/`（rolldown runtime + 打包进去的 @clack/prompts、@clack/core、picocolors、simple-git、@kwsites/*、xdg-basedir、@vercel/detect-agent）、`dist/cli.d.mts`、README、license 文件。
- **运行时 dependencies**：仅 `yaml ^2.8.3`。其余均为 devDependencies（构建时打包进 dist）。**无原生模块**。[package.json]
- **外部进程依赖**：
  - 系统 `git`：simple-git 包装，所有 git URL / GitLab / 非白名单 GitHub clone 都需要；本地路径安装不需要。[src/git.ts:1]
  - `gh` CLI（可选）：私有 GitHub repo 认证 fallback（`gh repo clone`、`gh auth token`）。[src/git.ts:182-195; src/skill-lock.ts:157-166]
  - 白名单 owner（vercel、vercel-labs、heygen-com 及 `BLOB_ALLOWED_REPOS`）的公开 GitHub repo 走 HTTPS blob 下载，无需 git。[src/add.ts:1146-1167]
- **网络出向**：telemetry `https://add-skill.vercel.sh/t`（可用 `DISABLE_TELEMETRY` / `DO_NOT_TRACK` 环境变量关闭，CI 自动关闭）、audit API `add-skill.vercel.sh/audit`（3s 超时，失败不阻塞）、skills.sh blob 下载、GitHub/GitLab API。[src/telemetry.ts:1-2, 84-86, 108-134]
- **发布频率**：npm 共 87 个版本；当前线 2026-01-17 起，近 5 周约 8 个版本（1.5.12 @ 2026-06-18 → 1.5.20 @ 2026-07-22）。有 snapshot 预发布通道（`--tag snapshot`）。未见成文的版本策略；版本号呈 semver 形态。**演进非常快，API/行为稳定性需按"追随上游"心态对待**。[npm registry time 字段; package.json scripts]
- **其他运行时环境变量**：`SKILLS_CLONE_TIMEOUT_MS`（clone 超时，默认 300s）、`INSTALL_INTERNAL_SKILLS`、`NODE_DISABLE_COMPILE_CACHE`。[src/git.ts:11-16; src/skills.ts:56-59; bin/cli.mjs]

### 8. update/remove 行为

**`skills update`** [src/update.ts]：
- 数据源：全局 `~/.agents/.skill-lock.json`（或 `$XDG_STATE_HOME/skills/`）与项目 `skills-lock.json` 中记录的 source/ref/skillPath/hash。
- 检查方式：GitHub 来源用 Trees API 比较 `skillFolderHash`（tree SHA）；其他 git 来源 clone 到临时目录后计算目录 SHA-256 对比。[update.ts:341-414]
- **更新 = 整体重装**：对每个有变化的 skill，`spawnSync(process.execPath, [bin/cli.mjs, 'add', <url>, ..., '-g'?, '-y'])` 重新跑一遍 add 流程 —— 即 canonical 目录先 `rm -rf` 再重新拷贝，symlink 由 `createSymlink` 删除重建（同 target 时直接复用）。**没有增量 patch 概念**。[update.ts:469-482, 633-654; installer.ts:163-170, 224-258]
- 明确**不更新**的来源：`sourceType: 'local'`（本地路径）、`'node_modules'`、well-known、无 hash/skillPath 记录的旧条目 —— 打印 "cannot be checked automatically" 及手动重装提示。[update.ts:167-184, 233-235]
- 上游已删除的 skill：交互模式询问是否删除本地副本；**非交互模式跳过删除**（保守）。[update.ts:256-282]
- 有任何失败项时 `process.exitCode = 1`。[update.ts:739]

**`skills remove`** [src/remove.ts:61-354]：
- 默认 targetAgents = **全部 75 个 agent**（即使未检测到安装），目的是清理 ghost symlink；`-a` 可收窄。[remove.ts:181-186]
- 对每个目标 agent：删除 agent 目录下的条目（symlink 或拷贝目录，`rm -rf`；universal agent 还会检查其 "原生" 目录以清理历史遗留链接）。[remove.ts:216-260]
- **canonical 目录的删除条件**：删完目标 agent 后，重新跑 `detectInstalledAgents()`，若任一**剩余** agent 的安装路径仍存在该 skill，则保留 canonical；否则 `rm -rf` canonical。即 `-a` 定向删除时不会误伤其他 agent。[remove.ts:262-279]
- 同时清理 lock 条目（全局/项目分别处理）；磁盘已删但 lock 残留的 stale 条目也会被清掉。[remove.ts:281-295]
- remove 不区分该 skill 是否由本库安装 —— 只要名字匹配（sanitize 后匹配目录名或 lock key）就删。

## 不确定 / 待验证

1. **非 TTY 下 `add` 不带 `-y` 的实际行为**：源码路径显示会进入 `searchMultiselect`（@clack/prompts）。非 TTY stdin 下 clack 会立即失败、报错还是阻塞，未实测；脚本驱动应始终传 `-y` 规避。[src/add.ts:1287-1337]
2. **`list --json` 在非 TTY 下的输出纯净度**：`runList` 本身无 spinner（与 add/remove 不同），JSON 前应无杂质；但未对全平台实测。[src/list.ts:76-128]
3. **README 与实现的一处出入**：README 示例注释写 `skills list` = "List all installed skills (project and global)"，但实现默认只列项目级。以源码为准。[README.md:121-123 vs src/list.ts:79-80]
4. **行号引用基于 2026-07-29 clone 的 main HEAD**；该仓库演进极快（平均每周发版），行号会漂移，结构（文件/导出名）短期内应稳定。
5. **Eve subagent、well-known provider、blob 安装**等路径只做了机制级阅读，未逐行走查；与本项目（多 agent 桌面同步）相关性低。
6. **`detectInstalledAgents()` 在 Electron 主进程 spawn 环境下的结果**：检测基于 homedir 下配置目录存在性，与父进程类型无关，应无差异；但 `process.cwd()` 决定项目级行为 —— spawn 时必须显式控制 cwd（`getCanonicalSkillsDir(false, cwd || process.cwd())`，src/installer.ts:98-101）。

## 开放问题（留给 /tech-design）

- 集成形态取舍：spawn CLI（零绑定、跟随上游，但输出非机器化、exit code 语义弱、需额外 `list --json` 二次确认、依赖系统 git/node 版本）vs vendor `src/agents.ts` + 自写 install/symlink 逻辑（获得 registry 数据与完全控制，但需跟踪上游 75 agent 表的高频变动）。
- `agents` JSON 字段输出 displayName 而非 key：若用 `list --json` 做结果核验，需要 displayName → key 的反映射（可从 vendored registry 生成）。
- canonical 目录不可配置（固定 `.agents/skills`）：若产品希望 canonical 放应用自有目录（如 userData），spawn CLI 无法满足，只能自建或绕过。
- 项目级安装时 "非 universal agent 配置目录不存在则跳过建链（claude-code 豁免）" 的行为，与 "项目声明支持的 agent 类型（多选）" 的语义如何对齐 —— CLI 的跳过逻辑是基于磁盘现状的隐式判断。
- telemetry 出向（add-skill.vercel.sh）在桌面应用中的处置（`DISABLE_TELEMETRY=1` env 注入即可关闭，属事实陈述；是否关闭是产品决策）。
- 上游约每周发版：pin 版本 + 定期升级策略、以及 lock 文件 schema version（全局 v3 / 项目 v1）变更时的兼容策略。
- `skills update` 对 local 来源不更新；若产品需要支持 "本地目录 skill 随源更新"，CLI 不提供，需自行处理。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| 仓库源码（main HEAD clone） | https://github.com/vercel-labs/skills → `/tmp/vercel-skills-research` | 2026-07-29 | 全部机制性结论 |
| package.json | `/tmp/vercel-skills-research/package.json` | 2026-07-29 | 包名、bin、deps、engines |
| README | `/tmp/vercel-skills-research/README.md` | 2026-07-29 | 文档化行为、agent 目录表、env 变量 |
| CLI 入口与命令分派 | `src/cli.ts` | 2026-07-29 | flag 全集、exit code、进程退出行为 |
| 安装/symlink/canonical 核心 | `src/installer.ts` | 2026-07-29 | canonical copy 机制、Windows junction、list 扫描 |
| agent registry | `src/agents.ts`、`src/types.ts` | 2026-07-29 | 75 agent 表、字段格式、universal 分类 |
| add 主流程 | `src/add.ts` | 2026-07-29 | 非交互行为、本地/git 来源处理、lock 写入、exit code |
| list/remove/update | `src/list.ts`、`src/remove.ts`、`src/update.ts` | 2026-07-29 | --json 输出、删除语义、更新=重装语义 |
| lock 文件 | `src/skill-lock.ts`、`src/local-lock.ts` | 2026-07-29 | lock 位置、schema、local 来源不更新 |
| git 操作 | `src/git.ts` | 2026-07-29 | 系统 git / gh 依赖、clone 超时 |
| telemetry | `src/telemetry.ts` | 2026-07-29 | 出向端点、关闭方式 |
| npm registry 元数据 | https://registry.npmjs.org/skills 与 /skills/latest | 2026-07-29 | 发布频率、体积、确认无 exports/main |
| npm tarball 实测 | `skills-1.5.20.tgz`（`/tmp/skills-pkg.tgz`，解于 `/tmp/package`） | 2026-07-29 | 发布产物清单、`dist/cli.d.mts` 零导出确认 |
