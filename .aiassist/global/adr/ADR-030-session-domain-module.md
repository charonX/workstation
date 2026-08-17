# ADR-030：会话领域收编 sessionDomain + per-instance SSE 注册表——依赖方向回正

- 状态：已接受
- 日期：2026-08-17
- 相关 REQ：—（/improve-codebase-architecture 候选 #4 触发；story 2026-08-16-deepen-session-domain）

## 上下文

架构评审（2026-08-16，候选 #4）走查会话子系统发现：**会话领域逻辑住在路由层，
依赖方向倒置，seam 泄漏到调用者**。

- **928 行路由模块承载会话领域**：`src/http/routes/agentSessions.js` 内聚了
  历史投影（`projectMessagesFromJsonl`）、分页（`paginateMessages`）、空间 key
  解析（`uiGroupPrefixFor` 等，ADR-016 语法）、SSE 订阅注册表（模块级
  `pendingSseSubs` Map）、附件规则（`attachmentsError`）、config 装配
  （`buildSessionConfig`）——纯函数无直测 seam，只能透 HTTP 端到端打。
- **server.js 反向 import 路由内部函数**：`server.js:26` 从路由 import
  `buildSessionConfig`/`attachPendingSseSubs` 以复用领域逻辑（确认回调回投
  :217-226、懒解析接线 :369）——下层模块向上层路由取知识，方向倒置。
- **SSE 注册表被三层之外的三处外部驱动**：模块级全局 Map 由 server.js 两处 +
  路由 handlePostMessage 一处共同读写；同进程多 server 实例（测试常态）共享
  同一份挂起状态，跨实例泄漏（挂起 sub 持有已死连接的 res，属潜在缺陷）。
- **测试可见面事实核查**（2026-08-17）：10 个既有测试文件中 8 个仅把路由文件
  当 seam 存在性门（动态 import + HTTP 驱动），唯一直接使用的导出名是
  `projectMessagesFromJsonl`；另有 feishuReadonly.test.js 静态读路由源码断言
  不含 sendCard/channelManager/cardRenderer（无飞书消息桥，REQ-AGENT-034）。

## 决策

1. **新建 `src/services/sessionDomain.js`（领域函数域：无内部可变状态、不持有
   连接；含只读 I/O——读 JSONL/DB/settings）**：收编
   config 装配、历史投影/分页、空间 key 解析、附件规则、`gitStateForSpace`
   （会话元数据投影）。函数签名与语义逐字节保持（PRD §6.3 锚点为 golden values）。
2. **新建 `src/services/sessionSseRegistry.js`（有状态域）**：
   `createSseSubscriptionRegistry()` 工厂 → 实例三方法
   `createSubscription(res, spaceKey)`（收编订阅生命周期：事件转发/轮次边界
   text_start 宣告/15s 心跳/confirmation-pending 过滤/detach 自清理）、
   `registerPending(spaceKey, sub)`、`attachPending(spaceKey, svc)`（无挂起或
   无既有句柄为 no-op，幂等）。server.js 持有一个实例（`_opcSseRegistry`
   惰性工厂同型），两处驱动点直调实例；路由经 context 袋新增
   `getSseRegistry` 拿同一实例。**模块级全局 Map 消亡**——注册表随 server
   实例走，同进程多实例隔离。
3. **纯/有状态两文件拆分**（而非单文件）：与 sessionStore/confirmationService
   粒度一致；execution-runner runner+queue 先例；纯函数单测不加载 SSE 机制。
4. **路由瘦身为纯转发（~928 → ~600 行，上限 650 含注释余量）**：保留两个导出
   handler、端点函数、admission 编排（404/writeHead/session-git 首帧/attach-or-pend
   五行编排——HTTP 关切留路由）、列表拼装五函数（HTTP presentation 编排就近）、
   `messageTextError`（HTTP 输入校验）、web 杂务；**仅 re-export
   `projectMessagesFromJsonl`**（测试唯一实际使用名，最小兼容面）。
   （2026-08-17 review 算术复核：搬走 ~300-330 行后留存 ~600，原 ~300 目标
   不可行——除非把端点组再拆出路由，超出本 story 边界；人拍板重定阈值 ≤650。）
5. **server.js 依赖方向回正**：领域函数从 domain/registry 模块 import；
   handler 仍从路由 import（server → route 为正常分层）。
6. **依赖方向静态可验**：新增静态 seam 测试（读源码断言 import 方向：
   domain/registry 不得 import routes/；server.js 不得从路由 import 领域
   函数）——feishuReadonly 同款先例，方向回正从设计纪律升级为机器可验。
7. **行为字节级不变**：HTTP API/SSE 帧序列/错误契约/附件校验短路顺序全部
   现状保全；搬迁方式为逐字节剪切，不重写。有意内部变更仅一项：注册表
   per-instance 消除同进程跨 server 实例的挂起状态泄漏（HTTP 契约不可见）。

## 后果

- 投影/分页/key 解析/附件规则获得直接单测 seam；registry 三方法可实例级单测
  （stub svc/res，真实 eventBus）。
- 路由文件 ~600 行纯转发，读代码的人一眼看到端点表。
- 既有测试零改动全绿是硬约束（兼容面 = 文件存在 + `projectMessagesFromJsonl`
  re-export + HTTP 行为）。
- 同进程多 server 实例的 SSE 挂起状态不再共享——测试隔离改善；若有测试隐性
  依赖旧泄漏会变红（判定为 test-gap，大概率无）。
- 与 `2026-08-16-deepen-db-per-path-cache` 的边界：本 story 不动 sessionStore
  接口与 DB 访问方式，且先行落地（结构搬迁先定，冲突面最小）。

## 替代方案

- **最小搬迁（只搬 buildSessionConfig）**：只消灭最刺眼的反向 import，投影仍
  无直测、注册表仍全局——初衷只解 1/3，否决。
- **注册表保持模块级全局只换住处**：接线最省，但「三处外部驱动」只换行号，
  "registry travels with instance" 不落实，否决（若实施期注入面被证失控，
  可降级为此方案，需人拍板并在 signoff 记录降级理由）。
- **单文件 sessionDomain.js 全收**：少一个文件但纯函数与活连接状态混住、
  ~600 行，与仓库模块粒度不一致，否决。

## 相关文件

- `src/http/routes/agentSessions.js`（928 → ~600 行瘦身）
- `src/http/server.js`（import 改向 + registry 实例持有 + context 袋扩展）
- `src/services/sessionDomain.js`（新增）
- `src/services/sessionSseRegistry.js`（新增）
- PRD：`.aiassist/stories/2026-08-16-deepen-session-domain/prd.md` §10
- 关联：ADR-009（events 连接不惰性启动 agent）、ADR-016（ui 空间 key 语法）、
  ADR-026（会话模型配置解析单点）、ADR-028（execution-runner 同批深化先例）、
  ADR-029（turnEventPipeline 同批深化——createSubscription「不二次截断」正依赖
  其 256KB limitSize 单真源决策；注册表统一清理模式同源）
