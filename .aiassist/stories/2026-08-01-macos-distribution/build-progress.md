# Build Progress — 2026-08-01-macos-distribution

> 由 /implementer 维护。每个 slice 完成后由实现者/父代理追加记录。
> 门 1 已签核（ASSERTIONS-SIGNED: true, 2026-08-02）；红态验证 14/14 红。

## 切片计划

| Slice | 名称 | REQ-ID | 测试文件 | 依赖 |
|---|---|---|---|---|
| S1 | release CLI 命令 | REQ-DIST-001 | `cli/release.test.js`（7 用例） | 无 |
| S2 | 主进程更新服务 + IPC | REQ-DIST-002 | `api/checkUpdates.test.js`（7 用例） | 无（与 S1 顺序执行，避免 package.json 编辑冲突） |
| S3 | Settings 关于/更新区 UI + README 引导 | REQ-DIST-002/003/004 | `e2e/versionDisplay.test.cjs`（3 用例） | S2（依赖 IPC） |

## 设计上下文要点（父代理 2026-08-02）

- capability/entity：app-distribution / release；产物命名 `Workstation-<version>.dmg/.zip` 于 `out/`。
- 错误码全集：`E_RELEASE_INVALID_VERSION / E_RELEASE_VERSION_BELOW / E_RELEASE_NOT_MAIN / E_RELEASE_TAG_EXISTS / E_RELEASE_GH_AUTH / E_RELEASE_BUILD_FAILED / E_RELEASE_GIT_FAILED`；`E_UPDATE_NO_RELEASE / E_UPDATE_PARSE / E_UPDATE_CHECK_NETWORK`。
- ADR-012 例外：release 命令绕过本地 HTTP server（dev-time 发布者工具），代码需注释说明。
- 仓库 `charonX/workstation`（git remote 确认）；package.json 目前无 `repository` 字段、无 `release` script（S1/S2 分别补）。
- Settings 现有 About 卡片硬编码版本 `0.1.0-alpha`，REQ-DIST-003 要求改为经 IPC 的真实版本（不硬编码）。
- 已知 pre-existing 单测失败基线（2026-07-29-multi-agent-skills BUG-002 记录）：imRouting AC4 / dailyDigest 2 条，与本 story 无关。

## Slice 记录

### Slice 1（REQ-DIST-001 release CLI 命令）— implementer subagent，2026-08-02

#### PRD→代码 可追溯性表

| PRD 意图（§/AC） | 实现文件/函数 | 测试用例 | 状态 |
|---|---|---|---|
| §7 版本格式验证：X.Y.Z（可带 v 前缀）→ `E_RELEASE_INVALID_VERSION`（AC1） | `src/cli/commands/release.js`：`VERSION_RE` + `release()` 第 1 步 | AC1 非法版本被拒绝（真实 CLI，stderr 含错误码，package.json 不变） | COVERED |
| §10 版本比较手写最小 semver、数值比较不信任字符串序（AC2 边界） | `release.js`：`compareVersions`（X.Y.Z 数值比较） | AC2「等于当前」被拒绝 | COVERED |
| §7/§8 版本递增：≤ 当前 → `E_RELEASE_VERSION_BELOW`；v 前缀规范化（AC2） | `release.js`：`normalizeVersion` + `release()` 第 3 步（dry-run 跳过；读 `process.cwd()/package.json`） | AC2 低于/等于当前被拒绝 + `v<current>` dry-run 通过 | COVERED |
| §6.2 非 main 分支 → `E_RELEASE_NOT_MAIN`，无副作用（AC3） | `release.js`：`currentBranch`（真实 git `-C cwd branch --show-current`）+ `release()` 第 2 步（先于 package.json 读取执行） | AC3 非 main 分支被拒绝（真实 CLI） | COVERED（实现已用绝对路径手工验证；AC3 测试用例本身受 harness bug 阻塞，见下方实现记录） |
| §7.1 tag 防重：`gh release view v<v>` 成功 → `E_RELEASE_TAG_EXISTS`（AC4） | `release.js`：`release()` 第 5 步（仅当 make 失败时执行） | AC4/AC8「tag 已存在拒绝」（注入 runner） | COVERED |
| §8 gh 未认证 → `E_RELEASE_GH_AUTH`，提示先 `gh auth login`（AC5） | `release.js`：`release()` 第 7 步（`gh auth status` 前置，失败中止） | AC4/AC8 注入 runner 覆盖认证前置；AC9 dry-run 无 gh 容错为 failed 不阻塞 | COVERED |
| §6.1 步骤 1 打包 `npm run make`；§8 打包失败 → `E_RELEASE_BUILD_FAILED`；产物校验（AC6） | `release.js`：`release()` 第 4 步（结果记录、失败不致命）+ 第 6 步 fs 校验（只查 `out/` 目录存在性，不查文件名） | AC6 产物缺失 → `E_RELEASE_BUILD_FAILED` 且未调用 push/gh（注入 runner） | COVERED |
| §6.1 步骤 2 `gh release create` + upload dmg/zip 资产，成功输出 Release URL（AC8） | `release.js`：`release()` 第 10/11/12 步（失败复用 `E_RELEASE_BUILD_FAILED` + stderr，设计注记） | AC4/AC8 成功路径 create+upload 被调用且 URL 匹配（注入 runner） | COVERED |
| §10 自动 commit+push；§8 push 失败回滚 → `E_RELEASE_GIT_FAILED`（AC7） | `release.js`：`release()` 第 8/9 步（bump 保留原字符串，commit/push 任一失败逐字节恢复后抛错） | AC7 push 失败 → `E_RELEASE_GIT_FAILED` + package.json 逐字节回滚（注入 runner） | COVERED |
| §10 `--dry-run` 只打印步骤序列与校验结果、无副作用（AC9） | `release.js`：`dryRunReport`（checks/steps 含中文关键词「版本校验/分支/gh 认证/tag/打包/推送/创建 Release」；gh 只读检查经 run + 10s timeout 容错不崩溃） | AC9 dry-run 关键词齐全 + package.json 不变（真实 CLI） | COVERED |
| §10 release 命令加入现有 CLI 命令组；ADR-012 第 4 条绕过本地 HTTP server（对 ADR-001 的例外，注释说明；不 ensureServer/stopManagedServer） | `src/cli/opc-workstation.js`：`main()` release special-case（`<entity> <action>` 分发不适用，action 位是版本号；错误统一 `fail({error: err.code})`） | AC1/2/3/9 走真实 CLI 分发（错误码 + 退出码 + 输出契约） | COVERED |
| §6.1 `npm run release -- 1.1.0` 等价入口（用户故事 1） | `package.json`：`"release": "node src/cli/opc-workstation.js release"`（CLI 入口 1:1 别名） | 测试直接覆盖 CLI 入口（AC1/2/3/9） | COVERED |
| §3 用户故事 1：一条命令完成版本提升+打包+上传 | 上述全部（release.js 12 步编排） | AC1~AC9 | COVERED |

#### 实现记录（implementer subagent）

- 新增 `src/cli/commands/release.js`：导出 `release(version, {dryRun, run, cwd})` 与 `createDefaultRun(cwd)`（shell 执行器，测试可注入 fake）。执行顺序严格按父代理契约 12 步：格式校验 → 分支校验（真实 git，先于 package.json 读取）→ 版本递增校验（dry-run 跳过）→ `npm run make`（失败不致命）→ tag 防重（仅 make 失败时）→ `out/` 目录存在性校验 → `gh auth status` → bump（保留原字符串）→ `git add/commit/push`（失败逐字节回滚 → `E_RELEASE_GIT_FAILED`）→ `gh release create` → upload → `{url}`。
- 修改 `src/cli/opc-workstation.js`：`main()` 通用分发前加 release special-case（版本缺失 → `E_RELEASE_INVALID_VERSION`「缺少版本参数」；成功 `output(result)` exit 0；错误 `fail({error: err.code||"INTERNAL_ERROR", message}, 1)`）；注释说明 ADR-012 例外（绕过本地 HTTP server）。
- 修改 `package.json`：新增 `"release"` script。
- 测试结果：本 slice 7 用例中 **6 绿**；**AC3 红且与实现无关**——测试以相对路径 `node src/cli/opc-workstation.js` + 子进程 `cwd=临时 git 仓库` 调用 CLI，node 按子进程 cwd 解析入口脚本导致 MODULE_NOT_FOUND（实现永远无法介入）。已用绝对路径 + cwd=dev 分支临时仓库手工验证分支校验逻辑正确（`{"error":"E_RELEASE_NOT_MAIN","message":"发布仅允许在 main 分支进行（当前分支：dev）"}`，exit 1）。建议测试侧一行修复：`const CLI = ["node", [path.resolve("src/cli/opc-workstation.js")]]`（`path` 已 import），由 test-author 处理。
- 设计注记：`gh release create/upload` 失败路径（未直接测试）复用错误码池中最贴近的 `E_RELEASE_BUILD_FAILED`，消息含 stderr；已在 release.js 注释标明。
- 全套单元测试基线检查：见父代理验证结论（imRouting AC4 / dailyDigest 2 条 pre-existing 失败已知存在）。

#### 修复记录（父代理 PRD 对齐 + 用户批准，2026-08-02）

| GAP | 修复内容 | 实现位置 |
|---|---|---|
| GAP-1 | bump 前置：真实模式第 4 步改为 bump（读 `process.cwd()/package.json`、保留原字符串），第 5 步才打包——真实模式用新版本打包（原顺序用旧版本打包） | `release.js` `release()` 第 4 步 |
| GAP-4 | make 失败中止：`npm run make` `{ok:false}` 时 tag 防重检查后——tag 已存在 → `E_RELEASE_TAG_EXISTS`（回滚）；tag 不存在 → `E_RELEASE_BUILD_FAILED` 中止（回滚）。对齐 PRD §8「打包失败 → 命令中止，不创建 tag/Release」（原实现 make 失败仅记录） | `release.js` `release()` 第 5 步 + `rollback()` |
| 回滚纪律 | bump 之后、push 成功之前的**所有**错误路径（TAG_EXISTS / BUILD_FAILED / 产物缺失 / GH_AUTH / commit / push）一律逐字节恢复原 package.json 字符串 | `release.js` `rollback()` 闭包 |
| GAP-2 | 真实产物定位 `resolveArtifacts(cwd, version)`：在 `out/`（限深度 2）与 `out/zip/`（限深度 4）内递归查找 `.dmg`/`.zip` 且文件名含版本号的文件，返回相对 cwd 路径；找不到回退契约名 `out/Workstation-<v>.dmg/.zip`（签核测试 AC4/AC8 成功路径必须走回退）。upload 命令使用解析后路径。产物校验（第 6 步）保持只查 `out/` 目录存在性，不升级为文件名级 | `release.js` `resolveArtifacts()` + `release()` 第 10/12 步 |

- 产物命名依据（已从 maker 源码核实）：`out/<appName>-<version>-<arch>.dmg`、`out/zip/<platform>/<arch>/<basename>-<version>.zip`。
- **GAP-3 测试缺口**：`resolveArtifacts` 真实命名分支无自动化测试覆盖（签核测试只覆盖回退分支），留待 /test-author 或 /bug 补测。
- **PRD §6.1 产物名锚点**（`Workstation-1.1.0.dmg`）与 forge 实际命名不一致，留待 REFLECT 同步 PRD/README。
- 测试证据（修复后）：本 slice 7/7 绿（含 harness 修复 commit `932ef5c` 后基线）；全套单测（排除 feishuChannel/nestedExecution 两个真实网络挂死文件）421 用例仅 REQ-DIST-002 7 条预期红（Slice 2 未实现）。
- 修复 commit：`78aaa97`（[build] release CLI 修复：bump 前置 + make 失败中止 + 真实产物定位（GAP-1/2/4））。

#### 父代理验证结论（2026-08-02）

- 业务测试：父代理亲自跑 `release.test.js` → **7/7 全绿**（`932ef5c` harness 修复后）。AC3 复现确认：相对入口 + 子进程 cwd 确实 MODULE_NOT_FOUND，实现侧不可满足，测试侧一行修复已获用户批准（断言不变）。
- 全套单测（排除 feishuChannel/nestedExecution 挂死文件，`--test-timeout=20000`）：421 用例，仅 REQ-DIST-002 7 条预期红（Slice 2 未实现），无其他失败；此前记录的 imRouting AC4 / dailyDigest 2 条 pre-existing 失败在 `npm run rebuild:node` 后未复现（ABI 问题）。
- GAP-2 真实命名分支：静态追踪验证（`resolveArtifacts` 递归深度限制内命中 `out/opc-workstation-<v>-arm64.dmg` 深度 1、`out/zip/darwin/arm64/...-<v>.zip` 深度 3，相对路径正确）；回退分支由 AC4/AC8 实证。父代理尝试 empirical 复验时 Bash 分类器间歇不可用，未完成——已在 GAP-3 记录补测建议。
- 重构后复验：`b19b99a`（[refactor]）后父代理重跑 → 7/7 绿，diff 仅 2 个实现文件、行为保持。
- **Slice 1: complete**（`ca78f7f`..`b19b99a`，tests green 7/7，PRD alignment passed——GAP-1/2/4 修复获用户批准，GAP-3 测试缺口与 PRD §6.1 产物名锚点留待后续）
- **Slice 1: refactor pass done**（`b19b99a`，tests green，no rollback）

### Slice 2（REQ-DIST-002 主进程更新服务 + IPC）— implementer subagent，2026-08-02

#### PRD→代码 可追溯性表

| PRD 意图（§/AC） | 实现文件/函数 | 测试用例 | 状态 |
|---|---|---|---|
| §6.1 步骤 6 / §10 检查更新服务放主进程、经 `ipcMain.handle("opc-check-updates")` 暴露、查询逻辑与 UI 解耦（AC1） | `src/main/updates.js`：`checkForUpdates`（纯 Node 模块，无 electron import）；`src/main/main.js`：`opc-check-updates` handler；`src/preload/preload.js`：`checkUpdates` | AC1 返回契约结构（deepEqual 仅 4 key），hasUpdate 由版本比较得出 | COVERED |
| §10 版本比较手写最小 semver（X.Y.Z 数值比较，不信任字符串序）（AC1/AC2/AC3 边界） | `src/main/updates.js`：`compareVersions`（数值比较；非法输入返回 0 安全默认，未测试路径） | compareVersions 相等/高于/低于/0.x 边界/数值比较（1.10.0 vs 1.9.9） | COVERED |
| §8/§6.2 检查更新网络失败（超时/断网）→ `E_UPDATE_CHECK_NETWORK`，UI"检查失败请重试"、不崩溃（AC4） | `updates.js` `checkForUpdates`：fetch 失败 catch → error 字段，绝不向上抛；内部 `AbortSignal.timeout(5000)` 超时（E2E 15s 内出结果契约） | AC4 网络失败 → error.code E_UPDATE_CHECK_NETWORK + hasUpdate false | COVERED |
| §8 仓库无 Release（GitHub 404）→ `E_UPDATE_NO_RELEASE`，UI"暂无发布版本"（AC5） | `updates.js` `checkForUpdates`：`res.status === 404` 分支（其他非 ok 如 403/5xx → `E_UPDATE_CHECK_NETWORK`） | AC5 404 → latestVersion null + hasUpdate false | COVERED |
| §8 最新版本解析失败（tag 非 semver）→ `E_UPDATE_PARSE`（AC6） | `updates.js` `checkForUpdates`：`/^v?(\d+\.\d+\.\d+)$/` 匹配，`tag_name` 去 `v` 前缀规范化 | AC6 nightly-build → error.code E_UPDATE_PARSE | COVERED |
| §10 仓库 owner/repo 读 package.json repository 字段（可配置可测）；兼容字符串/对象两种形态；缺失 → 降级不抛（AC1/AC5 数据来源） | `main.js`：`parseRepositoryFromPackageJson`（`fileURLToPath(new URL("../../package.json", import.meta.url))`；字符串 `"owner/repo"` 与对象 `{url: "https://github.com/owner/repo.git"}`；失败 → `E_UPDATE_PARSE` 契约结构返回） | 无直接签核测试（IPC 层）；Slice 3 E2E 间接覆盖 | PARTIAL（实现覆盖；测试缺口 → Slice 3 E2E / 可补 IPC 单测） |
| §10 启动静默检查：app 启动后异步触发一次，超时短（~5s）、失败仅记日志、绝不打扰用户；AC7 服务不抛（AC7） | `main.js`：`scheduleSilentUpdateCheck`（窗口创建/加载后约 8s 触发；有新版 → `webContents.send("opc-silent-update")`；失败/无新版仅 `console.log` 一行；window 判空） | AC7 静默路径失败仅返回 error、服务不抛（doesNotReject） | COVERED（main→preload 事件通道已实现；**UI 提示路径在 Slice 3 Settings 页接入**） |
| §6.1 步骤 7 / §10 "去下载" → `shell.openExternal(GitHub Releases 页)`（主进程已有 shell 用法）（AC2） | `main.js`：`opc-open-releases-page` handler（解析失败/打开失败返回 false 不抛）；`preload.js`：`openReleasesPage` | 无直接签核测试（IPC 层）；Slice 3 E2E 点击后跳转由人工/弱断言覆盖 | PARTIAL（实现覆盖；测试 → Slice 3） |
| §10 手动检查按钮（AC8）+ 当前版本号展示（REQ-DIST-003 配套） | `main.js`：`opc-get-version` handler；`preload.js`：`getVersion` | 无（UI 在 Slice 3） | GAP（本 slice 仅提供 IPC 能力；**AC8 按钮 UI 在 Slice 3**） |

#### 实现记录（implementer subagent）

- 新增 `src/main/updates.js`：导出 `checkForUpdates({fetchImpl, getVersion, repo})` 与 `compareVersions(a, b)`，纯 Node 模块（无 electron import，单测可直接 import）。请求 `https://api.github.com/repos/{owner}/{repo}/releases/latest`，内部 `AbortSignal.timeout(5000)`；非 ok → `E_UPDATE_NO_RELEASE`；tag 匹配 `/^v?(\d+\.\d+\.\d+)$/` 取捕获组去 `v` 前缀，不匹配 → `E_UPDATE_PARSE`；fetch/json 任何异常 → catch 返回 `E_UPDATE_CHECK_NETWORK`（**绝不向上抛**，AC4/AC7 契约）；成功返回仅 4 key 结构（AC1 deepEqual）。`compareVersions` X.Y.Z 数值比较，非法输入返回 0。
- 修改 `src/main/main.js`：新增 `parseRepositoryFromPackageJson`（兼容 repository 字符串/对象两形态，失败返回 null 不抛）；`opc-check-updates` / `opc-get-version` / `opc-open-releases-page` 三个 handler（前两者失败形态按契约返回/不抛）；`scheduleSilentUpdateCheck`（约 8s 后真实 fetch，hasUpdate 才 send `opc-silent-update`，日志仅一行，window 判空，try/catch 最后防线），在 `createWindow` 加载完成后调用一次。
- 修改 `src/preload/preload.js`：`window.opc` 新增 `checkUpdates` / `getVersion` / `openReleasesPage` / `onUpdateResult`（返回退订函数），遵循现有 contextBridge 模式与 JSDoc 风格。
- 修改 `package.json`：version 之后新增 `"repository": {"type": "git", "url": "https://github.com/charonX/workstation.git"}`（2 空格缩进，与 `JSON.stringify(pkg, null, 2)` 格式一致）。
- 测试结果：本 slice 7 用例 **7/7 绿**（`checkUpdates.test.js`）；全套单测（排除 feishuChannel/nestedExecution）**421/0 无新失败**（基线 414 pass + 本 slice 7 = 421）。
- 与签核测试零偏差：测试缝契约（`checkForUpdates({fetchImpl, getVersion, repo})` / `compareVersions` / 错误码全集 / 4-key 成功结构）全部满足，无任何断言妥协。
- 设计注记：`json()` 解析失败（非契约测试路径）与 fetch 失败同归 `E_UPDATE_CHECK_NETWORK`（"绝不向上抛"不变量优先）；IPC 层 repository 解析失败返回 `E_UPDATE_PARSE` 契约结构而非抛异常。IPC 层与静默事件通道无直接签核单测，已在上表标 PARTIAL，由 Slice 3 E2E 与未来 IPC 单测补。commit：见 Slice 2 [build]/[docs] 提交记录。
- 修复记录（PRD 对齐子代理 2026-08-02）：`!res.ok` 分支按状态码细分——`res.status === 404` → `E_UPDATE_NO_RELEASE`（PRD §8 触发 = "404/latest 为空"）；其他非 ok（403 限流 / 5xx）→ `E_UPDATE_CHECK_NETWORK`（tech-design 风险表：限流表现为网络错误）。签核测试 AC5 仅覆盖 404，零断言影响（本 slice 7/7 仍绿）。JSDoc 同步修正：`fetchImpl` 无默认值、调用方必须传入（IPC 层传真实 fetch，测试注入 stub）。commit：`a26c81a`（[build] checkForUpdates 错误状态映射修正（403/5xx → E_UPDATE_CHECK_NETWORK））。

#### 父代理验证结论（2026-08-02）

- 业务测试：父代理亲自跑 `checkUpdates.test.js` → **7/7 全绿**；全套单测（排除 feishuChannel/nestedExecution 挂死文件）→ **421/0**（Slice 1 的 7 条预期红全部转绿，无新失败）。
- PRD 对齐子代理：`ALIGNED`。唯一缺口（非 404 非 ok 状态码误归 E_UPDATE_NO_RELEASE，PRD §8 触发定义为"404/latest 为空"）已修复：404 → `E_UPDATE_NO_RELEASE`，403/5xx → `E_UPDATE_CHECK_NETWORK`（`a26c81a`，零签核断言影响）。JSDoc 失实同步修正。AC7 调度器/事件通道无直接单测为已知 missing-test，留待后续。
- 重构后复验：`1e8aecd`（[refactor]：errorResult 提取 + 错误码常量导出 + runUpdateCheck helper）后父代理重跑 → 7/7 绿，diff 仅 3 个本 slice 文件、行为保持。
- 已知设计注记（refactor 子代理）：`scheduleSilentUpdateCheck` 每次 createWindow 注册新定时器（macOS activate 重建窗口会多次触发；幂等+静默无实际危害，行为变更留待 REFLECT 讨论）；repository 解析失败复用 E_UPDATE_PARSE 码为既有契约决策。
- **Slice 2: complete**（`878e6e5`..`1e8aecd`，tests green 7/7 + 421/0，PRD alignment passed）
- **Slice 2: refactor pass done**（`1e8aecd`，tests green，no rollback）

### Slice 3（REQ-DIST-002/003/004 Settings 关于/更新区 UI + README 引导）— implementer subagent，2026-08-02

#### PRD→代码 可追溯性表

| PRD 意图（§/AC） | 实现文件/函数 | 测试用例 | 状态 |
|---|---|---|---|
| §6.1 步骤 6 手动检查：应用内点"检查更新"→ 查询 GitHub 最新 release 并展示状态（REQ-DIST-002 AC8） | `src/renderer/pages/Settings.jsx`：`handleCheckUpdates`（点击 → `window.opc.checkUpdates()` → 三态渲染；检查中禁用按钮）；`data-testid="update-check-button"` / `update-status` | E2E 用例 2「按钮存在，点击后 15s 内状态区可见」 | COVERED |
| §6.1 步骤 7 / §10 "去下载" → `shell.openExternal(Releases 页)`（REQ-DIST-002 AC2） | `Settings.jsx`：`handleDownload`（`window.opc.openReleasesPage()`）+ `data-testid="update-download-button"`（仅 hasUpdate 态渲染） | 无直接签核用例（跳转打开浏览器不可自动化）；主进程 handler 已在 Slice 2 实现 | PARTIAL（实现覆盖；测试 → 人工/REFLECT） |
| §10 / REQ-DIST-002 AC7 启动静默检查复用同一提示路径（页面未挂载自然丢弃） | `Settings.jsx`：`useEffect` 订阅 `window.opc.onUpdateResult(...)`，收到且 `hasUpdate` → 状态区更新为"发现新版本"；effect cleanup 退订 | 无签核用例（E2E 无法稳定复现静默事件）；由实现保证 + Slice 2 服务不抛断言覆盖 | COVERED（实现）；测试无签核用例 |
| §6.2/§8 检查更新三错误态 UI 文案：`E_UPDATE_CHECK_NETWORK` → "检查失败，请重试"（AC4）；`E_UPDATE_NO_RELEASE` → "暂无发布版本"（AC5）；`E_UPDATE_PARSE` → 检查失败（AC6） | `Settings.jsx`：`updateStatusText`（error.code === "E_UPDATE_NO_RELEASE" 分支 → noRelease，其余 → checkFailed）；IPC 失败兜底 catch → 网络错误态（不崩溃） | E2E 用例 2 宽松断言"三态之一可见"（test-plan 明确：具体状态由 api 单测 4 态覆盖，E2E 只断言结构/交互）；文案映射本身无签核用例 | PARTIAL（实现覆盖；文案映射测试 → 未来 /test-author 或 /bug） |
| §10 版本比较/查询状态：hasUpdate → "发现新版本 v{latest}"（AC2）；latest ≤ current → "当前已是最新版本"（AC3） | `Settings.jsx`：`updateStatusText`（STATUS_HAS_UPDATE → `updateAvailable`（含 `{{version}}` 插值）/ STATUS_UP_TO_DATE → `upToDate`） | 同上（E2E 弱断言；状态逻辑由 api 单测覆盖） | COVERED（实现）；测试弱断言 |
| REQ-DIST-003 AC1 版本号展示：经主进程 IPC / app.getVersion() 获取，不硬编码 renderer（S3） | `Settings.jsx`：`appVersion` state + `useEffect`（挂载时 `window.opc.getVersion()`；失败降级空串不抛）；`data-testid="update-version"` 仅在有值后渲染（避免空文本竞态）；原硬编码 `0.1.0-alpha` 已移除 | E2E 用例 1「版本号可见且文本非空」 | COVERED |
| REQ-DIST-003 AC2 结构可定位（testid） | `Settings.jsx`：`data-testid="update-version"`（与 locators.cjs `UPDATE_VERSION` 一致） | E2E 用例 1 | COVERED |
| §13 / REQ-DIST-004 AC2 应用内引导文案：Settings 批准路径（macOS 15+ 无右键打开）+ 放入 /Applications 建议（避免 Translocation 只读卷） | `Settings.jsx`：`data-testid="update-guide"` 段落 → `t("settings.updateGuide")`；en-US 文案含 "System Settings > Privacy & Security" 与 "/Applications"；zh-CN 中文叙述保留 "System Settings"/"Privacy & Security"/"/Applications" 字样（切语言后语义仍满足） | E2E 用例 3「guide 可见 + 正则 System Settings/Privacy & Security + toContain /Applications」 | COVERED |
| REQ-DIST-004 AC1 README「从 Release 安装」章节：下载 .dmg → 拖入 /Applications → Gatekeeper 拦截 → System Settings > Privacy & Security 批准（macOS 15+ 无右键打开）→ 重新启动（S4） | `README.md`：「从 Release 安装（macOS）」章节（构建与打包之后；含 GitHub Releases 链接、Translocation 说明、Open Anyway 路径）；另附「发布新版本」小节（`npm run release -- 1.1.0`，需 `gh auth login`，仅 main 分支——对齐 PRD §6.1/ADR-012） | AC1 为文档审查项（无自动化测试）；应用内 AC2 由 E2E 用例 3 覆盖 | COVERED（文档）；测试 → REFLECT 人工审查 |
| 文案走 i18n（双语言键，命名对齐现有风格） | `src/renderer/i18n/en-US.json` + `zh-CN.json`：settings 块新增 `aboutUpdate`/`checkForUpdates`/`checkingUpdates`/`updateAvailable`/`upToDate`/`checkFailed`/`noRelease`/`download`/`updateGuide` | E2E（默认 en-US）间接覆盖 en 文案 | COVERED |
| 样式：现有 CSS 变量 token（var(--ch-*)），不新写大段 CSS | `Settings.jsx`：`update-status` 内联样式复用 channel-status-row 同款 token 组合（surface-high/border/radius-md/text-sm/space-3） | — | COVERED |

#### 实现记录（implementer subagent）

- 改造 `src/renderer/pages/Settings.jsx`「关于/更新」区（settings-side 内原 About 卡片）：容器 `data-testid="update-section"`；版本行 `update-version` 经 `window.opc.getVersion()` 挂载时读取（渲染条件 `appVersion !== null`，规避 E2E 读空文本竞态；IPC 失败降级空串不抛）；`update-check-button` 检查中禁用并显示"检查中..."；`update-status` 状态区在检查中/结果三态（hasUpdate → 发现新版本 v{latest} + `update-download-button`；upToDate → 已是最新；error → E_UPDATE_NO_RELEASE 显示"暂无发布版本"、其他显示"检查失败，请重试"）；`update-guide` 引导文案常驻渲染；启动静默检查经 `window.opc.onUpdateResult` 订阅（hasUpdate 才更新状态区，卸载退订）。数据目录行与 form-static 样式保留。硬编码 `0.1.0-alpha` 已移除。
- `en-US.json` / `zh-CN.json` settings 块新增 9 键（见上表）。en `updateGuide` 含 "System Settings > Privacy & Security" 与 "/Applications"（满足 E2E 正则与 toContain）。
- `README.md`：构建与打包章节之后新增「从 Release 安装（macOS）」+「发布新版本」两小节（对齐 PRD §6.1 步骤 3-5 / §13 / ADR-012；`npm run release -- 1.1.0`、`gh auth login`、仅 main 分支）。
- 测试证据：rebuild:electron 后跑 `versionDisplay.test.cjs` → **3/3 全绿**（见下）。实现与签核测试零偏差：五个 testid（update-section/update-version/update-check-button/update-status/update-guide）与 locators.cjs 完全一致；未触碰任何 tests/ 文件与 main/preload/updates 文件。
- 已知注记（REFLECT 人工验收项）：状态区视觉（颜色/间距）为纯审美；静默检查的 UI 提示路径无签核测试（E2E 无法稳定复现 hasUpdate 事件）；"去下载"跳转打开浏览器不可自动化。

### Slice 3（REQ-DIST-002/003/004 Settings 关于/更新区 UI + README 引导）— implementer subagent，2026-08-02

#### PRD→代码 可追溯性表（摘录，完整见 commit 2d3b3fc 对应实现）

| PRD 意图（§/AC） | 实现文件/函数 | 测试用例 | 状态 |
|---|---|---|---|
| §6.1 步骤 6 手动检查：按钮 → IPC → 三态展示（AC8） | `Settings.jsx` `handleCheckUpdates`（window.opc.checkUpdates；检查中禁用防重入） | E2E 用例 2（点击后 15s 内 update-status 可见） | COVERED |
| §10/AC7 启动静默检查复用同一提示路径 | `Settings.jsx` useEffect 订阅 `onUpdateResult`（仅 hasUpdate 更新状态区；cleanup 退订） | 无签核用例（E2E 无法稳定复现 hasUpdate，测试注释支持） | COVERED（测试合理延期） |
| §6.1 步骤 7 / AC2 "去下载" → shell.openExternal | `handleDownload` → `window.opc.openReleasesPage()`（update-download-button 仅 hasUpdate 态渲染） | 无签核用例（浏览器跳转不可自动化） | PARTIAL（合理延期） |
| §8 四态 UI 文案（NO_RELEASE/NETWORK+PARSE/hasUpdate/upToDate） | `updateStatusText`（error.code 分支 + hasUpdate + 默认已最新；IPC 抛错 catch 兜底网络错误态不崩溃） | E2E 弱断言三态之一；状态逻辑由 api 单测 4 态覆盖 | COVERED |
| REQ-DIST-003 AC1 版本号经 IPC 获取、不硬编码 | `appVersion` 经 `window.opc.getVersion()` 挂载时读取（硬编码 0.1.0-alpha 已移除；IPC 失败降级空串；值加载后才渲染） | E2E 用例 1（可见且非空） | COVERED |
| REQ-DIST-003 AC2 结构可定位 | 5 testid 与 locators.cjs 逐一一致 | E2E 用例 1-3 | COVERED |
| §13/REQ-DIST-004 AC2 应用内引导文案 | `update-guide` 常驻渲染（en/zh 均含 System Settings / Privacy & Security / /Applications） | E2E 用例 3 | COVERED |
| REQ-DIST-004 AC1 README 四要素 | README「从 Release 安装（macOS）」：下载 dmg → 拖入 /Applications（Translocation）→ Settings 批准（macOS 15+ 无右键打开）→ 批准后启动；附「发布新版本」（npm run release -- 1.1.0，gh 已认证，仅 main） | 文档审查项（REFLECT 人工） | COVERED（文档） |

#### 父代理验证结论（2026-08-02）

- E2E：父代理亲自复跑 `versionDisplay.test.cjs` → **3/3 全绿**（rebuild:electron 后；每用例约 1.2s）。
- PRD 对齐子代理：`ALIGNED`，无缺口。观察项（留 REFLECT）：PRD §6.1 步骤 6 锚点措辞（"当前 v1.0.0，最新 v1.1.0"）与签核 REQ AC2 措辞（"发现新版本 v1.1.0"）不冲突（版本行同时可见）；`settings.about` i18n 死键待清理；静默检查事件在 Settings 未挂载时丢弃为设计意图（手动按钮是兜底触点）。
- 重构后复验：`0a2d008`（[refactor]：statusFromResult 提取 + checking 派生态 + 订阅简化 + 样式常量）后父代理重跑 → 3/3 绿，diff 仅 Settings.jsx、行为保持。
- **Slice 3: complete**（`2d3b3fc`..`0a2d008`，tests green 3/3，PRD alignment passed）
- **Slice 3: refactor pass done**（`0a2d008`，tests green，no rollback）

## 最终验证（父代理，2026-08-02）

- 全套单测（`npm run rebuild:node` 后，排除 feishuChannel/nestedExecution 两个真实网络挂死文件）：**421/0 全绿**。
- 全套 E2E：见 QA 报告（/qa-runner 或本记录附注）。
- 业务测试汇总：REQ-DIST-001 CLI 7/7、REQ-DIST-002 API 7/7、REQ-DIST-002/003/004 E2E 3/3 = **17/17**。
- commits：`932ef5c` [test] harness 修复（用户批准）、`ca78f7f`/`78aaa97`/`b19b99a` S1、`878e6e5`/`a26c81a`/`1e8aecd` S2、`2d3b3fc`/`0a2d008` S3 + 各 [docs] 记录 commit。
- 遗留（REFLECT 人工验收/后续）：REQ-DIST-004 AC3 真实发布+另一台机器全流程；PRD §6.1 产物名锚点同步真实 forge 命名；检查更新状态区视觉呈现（纯审美）；GAP-3（resolveArtifacts 真实命名分支 / AC5 auth 失败分支）补测建议；i18n 死键清理；release 命令一次真实发版体验。

### 全套 E2E 回归（父代理，2026-08-02，4 轮）

| 轮次 | 结果 | 失败 |
|---|---|---|
| 1 | 115/116 | sourcesPage.test.cjs:93（tag 编辑器时序） |
| 2 | 115/116 | agentTypes.test.cjs:68（REQ-WORKSPACE-012 搜索时序） |
| 3 | 115/116 | sourcesPage.test.cjs:93（同上） |
| 4 | **116/116 全绿** | — |

- 两个失败用例**隔离重跑均通过**（sourcesPage 6/6、agentTypes 5/5）；agentTypes 搜索 1 例为 2026-07-29-multi-agent-skills BUG-003 已记录的 pre-existing 时序 flake。
- 判定：与本 story 改动无关（失败路径均不触及本 story 的 CLI/main/preload/Settings 变更；i18n 仅新增 settings.* 键不影响 sources.* 键；主进程仅新增 additive IPC + 8s 后异步静默检查）。
- 本 story 的 3 个 E2E 用例在全部 4 轮中均为绿。
