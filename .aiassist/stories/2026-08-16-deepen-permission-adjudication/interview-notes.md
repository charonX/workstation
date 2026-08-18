# 访谈笔记 — 2026-08-16-deepen-permission-adjudication

> 故事 ID：`2026-08-16-deepen-permission-adjudication`  
> 评审来源：架构深化候选 #3（`.aiassist/global/architecture-reviews/architecture-review-2026-08-16.html`）  
> 关联 ADR：ADR-017（已打过 BUG-001/002 补丁）  

## 核心问题

1. **接缝散落与多跳传递**：一条 bash 确认链跨越 6 个模块 8 跳（`server.js`、`confirmationService`、`agentPolicy/permissionPolicy`、`authorizer bridge`、`worker tool_call hook` 等），职责不清。
2. **二次门控与隐式不变量**：`strict` 模式门控在 `server.js` 被二次实现；「唯一执行者（approve 决议不重复执行）」与「单一评估（pre-gate 预检不产生重复 ask）」仅靠注释和零散 if-else 维系，曾引发 BUG-001（命令双跑）与 BUG-002（重定向漏判）。
3. **降级脆弱性**：FS 工具在 gotgenes 回退路径或未知工具调用时存在零确认风险，缺乏统一的 fail-closed 安全兜底。

## 用户画像

- **系统核心/安全审计**：需要确保 agent 无论在哪个空间、触发哪种工具，权限拦截行为可预测、无死角、零二次执行风险。
- **业务/UI 调用方**：需要简洁的权限域接口，无需关注底层的挂起队列细节与多进程同步状态。

## 关键边界

1. **双端契约边界**：
   - **纯函数规则评估器（`permissionPolicy`）**：下沉为纯函数库，供 Worker 和主进程共享或直接调用，负责正则、命令拆解、重定向解析与策略匹配。
   - **主进程权限裁决域（`permissionAdjudicator`）**：负责管理挂起确认单生命周期、超时流转、裁决事件广播与决议状态下发。
2. **唯一执行者闭环**：主进程 approve 仅负责变更状态并向 Worker 发送允许执行的 Decision/Token，实际工具执行权 100% 收归 Worker 侧工具管线，杜绝主进程重复 execute。
3. **严格降级（Fail-Closed）**：任何未匹配明确 allow 规则的高危工具或降级环境，默认一律走 ask 挂起人工确认。
4. **队列封装收敛**：`confirmationService` 降级为 `permissionAdjudicator` 内部状态存储，外部（路由、UI、Feishu 适配器）统一与 `permissionAdjudicator` 交互。

## 隐含假设

1. 现有的策略文件格式 `pi-permission-config.json`（全局/项目两级）已满足业务需要，本次深化保持格式与语义完全向后兼容。
2. 前端确认卡 UI 与飞书卡片的事件字段与协议保持向后兼容，不改动交互体验。

## 候选方向

### 方向 A：提取 PermissionAdjudicator 独立领域模块 + 双端契约（首选）
- **适用场景**：彻底消除架构接缝，结构化固化四大安全不变量，统一管理生命周期与降级策略。
- **主要取舍**：需要梳理主/子进程及各个路由的引用点，改动范围覆盖权限链路全模块。
- **推荐度**：**首选**（对齐 ADR-028/029/030 前序深化标准）。

### 方向 B：仅主进程 Facade 封装（轻量）
- **适用场景**：仅快速清理 `server.js` 内的 `if-else`。
- **主要取舍**：未能解决 Worker 侧与降级路径的隐性接缝问题，容易复发 BUG-001/002。
- **推荐度**：不推荐。

## 确认方向

最终确认方向：**方向 A（PermissionAdjudicator 领域模块化 + 结构化四大安全不变量）**

确认意图：
- **Outcome**: 将权限裁决与确认执行管道收敛为独立的领域模块（`PermissionAdjudicator` + 双端契约），以结构化代码强制保障「单一评估、单一询问、唯一执行者、严格降级（Fail-Closed）」四大安全不变量，彻底消除跨 6 模块 8 跳与 `server.js` 二次实现的隐患。
- **User**: 平台开发者与系统安全性（确保 Agent 执行 CLI/FS/脚本工具时的拦截无漏洞、批准无双重执行）。
- **Why now**: 继 `execution-runner`、`turn-event-pipeline`、`session-domain` 之后的第 3 个架构深化 Story，彻底消除 ADR-017 / BUG-001 / BUG-002 暴露的接缝问题。
- **Success**:
  1. `server.js` 中移除所有权限二次门控与散落的 confirmation 胶水代码，统一由 `PermissionAdjudicator` 托管；
  2. `confirmationService` 收编为权限域内部队列，外部接口统一为权限域 API；
  3. 「唯一执行者」机制由状态机与 Token 闭环保障（主进程 resolve，Worker 放行执行，零双跑风险）；
  4. 遇到未匹配策略或降级模式时默认 Fail-Closed（进入 Ask 确认）；
  5. 既有所有 E2E、UI 确认卡与飞书确认流行为 100% 向后兼容。
- **Constraint**: 严格向后兼容 `pi-permission-config.json`（全局/项目策略配置）与确认卡数据协议。
- **Out of scope**:
  1. 不重写前端确认卡 UI 组件；
  2. 不涉及 sessionStore / 数据库多路径改造（归属 `deepen-db-per-path-cache`）；
  3. 不做全局服务容器重构（归属 `deepen-service-container`）。

确认理由：在前期深化经验（ADR-028/029/030）中，将隐式不变量与跨模块状态机显式抽取为领域模块，能大幅提升可测试性与系统健壮性。

## 最窄的切入点

1. 定义 `permissionPolicy` 纯函数评估接口（覆盖 bash、FS、脚本、重定向判定及 fail-closed 规则）。
2. 构建 `permissionAdjudicator` 领域工厂及生命周期状态机（封装挂起、裁决、超时、分发）。
3. 改造 Worker 侧 `AuthorizerBridge` 与 pre-gate 逻辑对接新裁决域。
4. 清理 `server.js` 与路由中的权限残留胶水代码。

## 待确认问题
- [x] 主/Worker 各司其职的双端契约结构已确认。
- [x] confirmationService 降级收编为内部机制已确认。
- [x] Fail-Closed 安全底线已确认。
