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

（父代理验证结论由父代理在本节后追加）
