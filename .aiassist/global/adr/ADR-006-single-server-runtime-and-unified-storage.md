# ADR-006: 单 server 运行时与统一本地存储

- **状态**: 已接受
- **日期**: 2026-07-19
- **相关 story**: 2026-07-19-media-production-line
- **相关 REQ**: 待结晶（调度接通 / headless 持久化 / 飞书通道）

## 背景

收集管线 story 引入两个常驻能力：**调度器**（cron 触发 flow，随 server 生命周期注册）和**飞书通道**（出方向 WebSocket 长连接）。系统存在两种运行时：Electron App（DB 在 `userData/data.db`）与 CLI 拉起的 headless server（原默认 `:memory:`，PRD 改为落盘）。

若允许两种运行时并存：两个 server 各自持有调度器与长连接，cron 会**双触发**（日报写两遍）；飞书集群投递随机落一边；且两个 DB 文件导致 App 看不到 headless 的执行记录。

## 决策

1. **任一时刻全系统单 server**。App 与常驻 headless 不并存：App 启动时若 `serverRegistry` 发现既有 server 存活，执行 shutdown 握手**顶替**，接管注册表、调度器与飞书通道；App 退出不自动留 headless，无人值守由用户显式 `opc-workstation server start`。
2. **统一 DB 路径** `~/.opc-workstation/data.db`：App 与 headless 共用同一文件；`:memory:` 仅供测试显式传入；App 原 `userData/data.db` 数据做一次性迁移。
3. 定时触发只在 server 运行期间有效，**错过的触发不补偿**。

## 替代方案

1. **双实例共存**：双库双调度双触发，飞书投递随机落点，直接推死。拒绝。
2. **通道与调度只在 App**：headless 无人值守时无法触发定时日报、无法发飞书，违反 story 验收场景。拒绝。
3. **App 复用既有 headless server（不顶替）**：App 变成纯查看器，main 进程不起 server；但"App 关闭后 headless 是否继续"语义复杂，且违背用户"App 是我的主工作台"的心智。拒绝。

## 影响

- `db.js` 默认路径变更；Electron main 启动流程增加"发现-顶替"握手；`serverRegistry` 增加 shutdown 协议。
- 调度器、飞书通道等所有"随 server 生命周期"的模块获得唯一宿主假设，实现大幅简化。
- 用户数据从 `userData/data.db` 迁移到 `~/.opc-workstation/data.db`，需要迁移逻辑与回滚考虑。
- 逆转成本：高。顶替协议、统一路径与迁移逻辑一旦上线，改回双实例需要重做数据拆分语义。

## 相关文件

- `.aiassist/stories/2026-07-19-media-production-line/tech-design.md`
- `.aiassist/stories/2026-07-19-media-production-line/prd.md`（稳定块 2）
- `src/db.js`、`src/serverRegistry.js`、`src/http/server.js`、`src/cli/server.js`
