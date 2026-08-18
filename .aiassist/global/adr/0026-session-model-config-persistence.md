# ADR-026：会话级模型配置持久化 + provider-change 热更新

- 状态：已接受
- 日期：2026-08-12
- 相关 REQ：待结晶（2026-08-12-conversation-toolbar-ext B3/B4）

## 上下文

模型配置从「全局单 provider」升级为「多 provider 条目 + 全局默认组合」。用户可在
对话区工具栏做**会话级**模型切换，契约要求：**历史保留、只影响后续消息**。

现有机制冲突：`rebuildSession`（settings 级 provider/key 变更时触发）会换代
sessionRef（JSONL 世代 +1）——换代即丢历史（新 JSONL 从空文件开始），且水合/懒恢复
路径（agentService 水合循环）按全局 `agentCfg.provider` 装配 session-config，会话
没有自己的 provider 状态。若会话级切换只做运行时内存态，worker 重启/懒恢复后会话
会静默回到全局默认——违反「切换影响后续消息」的语义。

## 决策

1. **会话级 provider/model 持久化到 `agent_sessions` 表（SQLite 为真相）**：
   新增 `provider`、`model` 两列（TEXT NULL，迁移补列，旧行 NULL → 默认组合）；
   provider-change 成功回写；水合/懒恢复按行读取重装 session-config。
2. **切换走 provider-change 最小集热更新 IPC，不走 rebuildSession 换代**：
   `{type:"provider-change", sessionKey, provider, model, keyRef, apiKey}` →
   worker `resolveModel` 替换该会话 modelObj（下一条 prompt 生效，进行中操作不受
   影响）；keyRef 换代（generation +1）但 sessionRef 不动；key 一次注入仅内存
   （同 session-config 安全语义）。对齐 mode-change IPC 先例（ADR-023 同源机制）。

## 后果

- 会话级切换与 settings 级重建（换代）两条路径边界清晰：会话内切换永远不丢历史；
  settings 级 provider 条目变更不触发会话重建（条目是配置源，不是会话绑定）。
- 条目被删除的会话：水合/重装时按 provider 查条目失败 → 回落默认组合 + 提示（E12）。
- 新增 DB 列与迁移（对齐 title 列先例，2026-08-06 ADR-016 补列先例）。
- worker 侧新增 provider-change 处理分支；createSessionDecide 的 modelObj 来源改为
  defaultJudge（ADR-023 的 auto-judge link 解耦，另见 PRD §10.3 数据流 5）。

## 替代方案

- **复用 rebuildSession 换代**：实现最省，但换代 = 丢历史，违反「历史保留」契约——否决。
- **内存态 + 重启回落默认**：worker 重启/懒恢复后会话静默回默认，语义断裂——否决。
- **JSONL 头恢复 provider**：主进程需解析 JSONL（打破「SQLite 为真相」），且世代
  换代时头过时——否决。

## 相关文件

- `src/services/agentService.js`（水合/懒恢复、provider-change 分发、keyRef/generation）
- `src/agent/worker.js`（provider-change 处理、resolveModel 替换）
- `src/db.js`（agent_sessions 补列迁移）
- `src/services/settingsService.js`（providers 条目数据模型）
