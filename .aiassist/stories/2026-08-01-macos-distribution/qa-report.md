# QA 报告 — 2026-08-01-macos-distribution

> 日期：2026-08-02　执行：/qa-runner（父代理亲自执行，非子代理）
> Story：macOS 分发（GitHub Release 发布 + 应用内检查更新）　REQ：REQ-DIST-001~004

## 单元测试

- **结果：PASS**（421/0）
- 命令：`npm run rebuild:node && NODE_ENV=test node --test --test-timeout=20000 $(find tests/capabilities -type f \( -path '*/api/*.test.js' -o -path '*/cli/*.test.js' \) ! -path '*feishuChannel*' ! -path '*nestedExecution*')`
- 说明：本 story 业务测试 14/14 绿（CLI release 7 + API checkUpdates 7）。全套 421 用例零失败。
- **环境注记**：`feishuChannel.test.js`（12 用例）与 `nestedExecution.test.js`（6 用例）在本沙箱因真实网络调用挂死被排除（`--test-timeout=20000` 下仍无法完成）；二者与本 story 改动无任何文件交集，正常网络环境下可跑。此前 BUG-002 记录的 imRouting AC4 / dailyDigest 2 条 pre-existing 失败在 `rebuild:node` 后未复现（原为原生模块 ABI 问题）。

## E2E/UITests

- **结果：PASS**（116/116）
- 命令：`npm run rebuild:electron && npx playwright test --retries=2`（QA 正式轮，**未触发任何重试**）
- 本 story 用例 3/3 绿：REQ-DIST-003 版本号可见非空 / REQ-DIST-002 AC8 检查按钮点击后状态区可见 / REQ-DIST-004 AC2 引导文案（含 System Settings、Privacy & Security、/Applications）
- Playwright 产物：无失败，无 trace/screenshot 产出
- **回归历史**（含 BUILD 阶段 4 轮 + 本 QA 轮共 5 轮）：3 轮 116/116 干净；2 轮各有 1 个 pre-existing 时序 flake（见下「不稳定测试」）

## 运行时浏览器验证

- **状态：SKIPPED**（story 无 `ux/` 目录；本会话未配置 Chrome DevTools MCP）
- 替代证据：E2E 基于真实 Electron app（Vite dev + 主进程 + IPC 全链路）断言 UI 结构/交互存在性，覆盖 Runtime 验证的 DOM 层。

## Coverage

- **状态：SKIPPED / N-A**（项目未配置 c8/istanbul coverage 脚本与阈值）
- 未覆盖 seams（已记录 build-progress.md GAP-3，建议后续 /test-author 或 /bug 补）：
  - `resolveArtifacts` 真实命名分支（签核测试只覆盖回退分支）
  - release `gh auth status` 失败分支（E_RELEASE_GH_AUTH）
  - 启动静默检查调度器/事件通道
  - IPC 层 repository 解析降级路径

## 手动验证

- 环境：macOS 桌面应用（E2E 已启动真实 Electron 实例覆盖核心流程）
- 结果：**核心 UI 流程由 E2E 覆盖**；真实发布 + 另一台机器「下载 → Settings 批准 → 启动」全流程为 **REFLECT 人工验收项（REQ-DIST-004 AC3）**——发布前置已确认就绪（gh 已登录 charonX、main 分支、v0.1.0 tag 不存在；`--dry-run` 预检 4 项校验全过）

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| `sourcesPage.test.cjs:93`（REQ-SRC-003 tag 编辑器，2026-07-19 非本 story） | 全量轮次中 2/5 轮超时（5s 内 "AI" chip 未渲染），隔离重跑 6/6 通过，QA 正式轮通过 | 已知 pre-existing 时序 flake（load 敏感）；不阻断本 story；建议后续单独跟踪 |
| `agentTypes.test.cjs:68`（REQ-WORKSPACE-012 搜索，2026-07-29 非本 story） | 全量轮次中 1/5 轮超时，隔离重跑 5/5 通过 | 2026-07-29 BUG-003 已记录的同款 pre-existing 时序 flake；不阻断本 story |

## 结论

- [x] **可进入 `/reflect`**（无 open bugs，QA 全绿：单测 421/0 + E2E 116/116，本 story 业务测试 17/17）
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug`

## 备注（供 /reflect 输入）

- REFLECT 人工验收项：REQ-DIST-004 AC3 真实发布 + 另一台机器全流程；release 命令真实发版体验；检查更新状态区视觉呈现（纯审美）。
- 待同步：PRD §6.1 产物名锚点（`Workstation-<v>` → forge 实际命名，README 已同步，PRD 待同步）。
- 2 个 pre-existing flake 建议在后续 story 中作为独立项处理（不阻塞本 story）。

## AC3 真实发布补充（REFLECT 阶段，2026-08-02）

- **REQ-DIST-004 AC3 已部分完成**：真实发布 v0.1.0 成功（Release 含 dmg + zip 两资产；main 版本 0.1.0）。发布过程中验证：GAP-4 失败中止+回滚路径真实有效（首次 make 失败未产生 tag/Release）；发现并修复 resolveArtifacts 深度缺陷（forge 7 makeDir=out/make/，[bugfix] commit）。剩余人工项：另一台 macOS 下载→批准→启动。
- **发布后回归**：resolveArtifacts 修复后签核测试 7/7 仍绿（fallback 路径不受影响）。
