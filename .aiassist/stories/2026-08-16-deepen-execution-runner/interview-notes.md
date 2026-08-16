# 需求洞察笔记 — ExecutionRunner 深化

> 2026-08-16 · 来源：/improve-codebase-architecture 评审候选 #1（Top recommendation）grilling
> 报告存档：`.aiassist/global/architecture-reviews/architecture-review-2026-08-16.html`

## 痛点（初衷）

「如何运行一次执行」的知识无属主：run options 三处手工拼装且已漂移，执行上下文
重置有双机制互为补丁，没有单一测试 seam。

## 实证摩擦点（走查收集）

| # | 摩擦 | 位置 | 实证 |
|---|---|---|---|
| 1 | run options 拼装三处复制 | taskService.js:391-395（debugFlow）、665-668（executeTask）、487-498（invokeSubflowImpl） | debug 合成 `debug-<uuid>` parentExecutionId（指向不存在的行）；invokeSubflowImpl 无 generation 守卫；debug 不收集产物/不写通知 |
| 2 | 双失效机制 | taskService.js:44-59（clearExecutionQueue = generation+1 + 换队列 + destroy + 5s drain 轮询）、592/599/673/710/729（executeTask 4 处 generation 检查） | 同一「执行上下文已重置」语义两套机制互为补丁 |
| 3 | 250ms 观察睡眠 | taskService.js:14、596 | 每次生产执行先睡 250ms 保证「createTask 后立即 GET 见 queued」；契约成本不可见 |
| 4 | schedule 经 eventBus 一跳 | schedulerService.js:27 → server.js:151 接线 → taskService.js:1118 | 全链唯一订阅者，删 bus 不损失解耦 |
| 5 | debug 子树落孤儿行 | invokeSubflowImpl 子行 INSERT（451）不受 debug 顶层控制 | debug 顶层不落行，子树照落（trigger=subflow + 不存在的父 id），UI 见孤儿执行 |
| 6 | 子日志冒泡写父行 | taskService.js:696-704 | 子 flow 的 logs 写父 logs 列，node id 是子 flow 的（父子可都有 "n1"）；execution:completed 事件 payload 无父子字段；已确认无契约测试锁定现状 |
| 7 | 测试 seam 依赖模块级变量 + dynamic import | taskService.js:32-40（setAgentExecutorForTests/setChannelAdapterForTests） | ~4 个测试文件重度使用（artifacts 19 处、linkCapture/dailyDigest 各 9 处、nestedExecution 5 处） |

## 10 项决议（三轮 grilling，全部按推荐落定）

**第一轮**（收编范围/触发入口/debug 语义/观察窗）：
1. 生命周期全收编：runner 拥有队列 + generation + 单一 reset()
2. 触发入口并入：submit（3 个入队触发）+ runOnce（debug/subflow 直跑）
3. debug 描述符参数化：与生产同一条代码路径，差异显式表达
4. 250ms 观察窗保留并显式化：submit 路径的接口语义，入队触发专属

**第二轮**（schedule 一跳/嵌套收编/debug 子树/reset 语义）：
5. schedule 直调 submit，删 eventBus 一跳与 server.js:151 接线
6. 嵌套全修复：子执行走 runOnce（守卫覆盖）、子日志写子行、事件补父子字段（additive）
7. debug 全链路零落库：persist:false 传播到子树，合成 parentExecutionId 废止
8. reset 有界等待：20ms 轮询 + 5s 上限，可 await，保证不写已重置 DB

**第三轮**（模块形状/交付形态）：
9. 独立模块 + 直调：src/services/executionRunner.js；入口直调；test seam 迁入；
   taskService 保留 executeTask/createTask 兼容转发
10. 记 ADR 沉淀：ADR-028 已落盘（`.aiassist/global/adr/ADR-028-execution-runner.md`）

## 关键事实核查记录

- 三条拼装路径、clearExecutionQueue 双机制、250ms 睡眠位置：已读源码逐行确认
- agentAdapter 静默 mock / permissionBridge 轮询 / feishuSend shim：为其他候选验证，非本 story
- schedule/手动/通道三入口均汇聚 createTask（天然单一漏斗）
- executionLog.test.js 对 queued 是轮询断言，不依赖 250ms 睡眠本身

## 留给后续阶段的问题（tech-design 深潜）

- runOnce 描述符字段精确集（trigger/persist/artifacts/notify + 边界）
- submit/runOnce/reset 签名与返回契约细节
- executionQueue 文件级组织（独立模块由 runner 持有 vs 折入）
- collectArtifacts / addExecutionLog 等助手归属
- 观察窗时长是否参数化（移动块）
