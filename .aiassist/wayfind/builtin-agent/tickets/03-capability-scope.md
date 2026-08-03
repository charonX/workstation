# 03 — 对话 agent 的 MVP 能力边界划到哪条线？

- **Type**: grilling
- **Mode**: HITL
- **Status**: resolved
- **Blocks**:
- **Blocked by**: 06

## Question

对话 agent 第一版能做什么？最小闭环是"下发任务 + 流式输出 + 查执行状态"，但这需要划清：

- **只读能力**：查执行状态/历史（"了解项目正在进行的任务"）——覆盖哪些实体（execution / project / flow / schedule）？
- **写能力**：创建任务 / 触发 flow / 改 schedule——"下发任务"的具体语义是复用现有 Task（channel 绑定 → createTask）还是对话 agent 直接驱动？
- **MVP 划线**：哪些做、哪些明确不做（如编辑 flow 图、安装 skill）？

## Resolution

2026-08-02 用户拍板：

1. **工具面 = B 全量管理**：除 release 外全部 CLI 命令给 agent（task/flow/project/schedule/skill/source/channel/settings/notify/dashboard）。匹配"能力越大越好"，安全靠 CLI 保险层（06）+ 高危确认；story 内分 slices 实现。
2. **高危规则化**：删除类（source delete、skill remove）、配置变更类（settings set、channel bind/credentials、schedule create/toggle）、流程取消类 → 卡片二次确认；下发（task run）/查询类直跑。实现形态：CLI 层确认钩子（保险层，后续可扩展命令白名单）。
3. **明确不做（MVP）**：release 命令不给 agent；UI copilot 不做 flow 图编辑（形态仍在迷雾）。
4. **备注/未确认**：①"取消执行"命令（CLI 目前无此能力）未被确认纳入 MVP——**已由 08 决议闭环（2026-08-02）：MVP 不提供取消执行能力**；②"定位-执行两步流"（agent 先查 flow/project 再 run）作设计惯例记录，由工具面自然涌现。
