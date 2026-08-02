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
