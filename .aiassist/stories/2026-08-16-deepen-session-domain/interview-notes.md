# 访谈笔记 — 2026-08-16-deepen-session-domain

> 来源：architecture-review-2026-08-16 候选 #4 + 一轮 frontier 访谈（2026-08-17，五项 GUESS 全部确认，方向 A 拍板）。

## 核心问题

928 行的 `src/http/routes/agentSessions.js` 路由模块承载会话领域逻辑（历史投影/分页/spaceKey 解析/SSE 订阅注册表/附件规则/config 装配），`src/http/server.js:26` 反向 import 其 4 个内部函数（`handleAgentSessions`/`buildSessionConfig`/`attachPendingSseSubs`/`handleAgentLastMode`），SSE 注册表（模块级 `pendingSseSubs` Map）被三层之外的三处外部驱动。一句话痛点：**会话领域逻辑住在路由层，依赖方向倒置，seam 泄漏到调用者**。

## 用户画像

开发者本人：改会话语义要一处生效；历史投影/分页/key 解析需要直接单测 seam（不再只能透 HTTP 打）。

## 关键边界

1. **测试导入面是硬约束**：10 个既有测试文件从 `routes/agentSessions` import 4 个名字；实现者对业务测试只读 → 路由必须保留同名 re-export，零测试改动。
2. **依赖方向回正**：server.js 只 import domain 模块；route → domain 的 re-export 方向正确，不算 shim 反模式。
3. **SSE 注册表 per-instance**：工厂/实例由 server.js 持有注入路由与消息发送路径；模块级全局 Map 消亡；「三处外部驱动」变成「一个实例的三个注入点」。
4. **与 db-per-path-cache 的边界**：本 story 不动 DB 访问方式，sessionStore 接口照旧；连接缓存是隔壁 story 的事。本 story 先行（结构搬迁先落定，冲突面更小）。
5. **搬迁粒度**：五块全搬；`gitStateForSpace`/`peekSession` 等仅服务转发路径的辅助函数留在路由，被 domain 逻辑用到的才带走；路由只留转发 + 参数 decode + `sendJson`。

## 隐含假设

1. 既有 10 个测试文件全绿零改动是可达的（re-export 方案已对齐执行器 story 的「兼容转发保旧契约」先例）。
2. SSE 事件契约与 HTTP API 字节级不变（纯结构搬迁，无行为变更）。
3. 模块依赖图无环工具（engineering-lessons 已沉淀的手段）可用于证明方向回正。

## 矛盾/风险

1. **per-instance 注册表注入**是方案层最可能错的点（用户确认：若方向错，最可能错在这一块；初衷不太可能错）。
2. 与 `deepen-db-per-path-cache` 同文件交集：若隔壁 story 先动手且改了 agentSessions 的 store 调用方式，本 story 搬迁基线会漂 → 已通过「本 story 先行 + 不动 store 接口」对冲。
3. 928 行一次搬五块，diff 大；靠既有 10 个测试文件全绿 + 新增直测兜底。

## 候选方向

### 方向 A：五块全搬 + per-instance 注册表 + 路由 re-export 保测试面（评审 #4 字面落实）
- 适用场景：初衷的完整解法（依赖方向倒置 + seam 泄漏一次清零）。
- 主要取舍：diff 大；但方向回正、注册表归位、投影可直测一次做完，不留半截。
- 推荐度：**首选（已拍板）**

### 方向 B：最小搬迁——只搬 buildSessionConfig
- 只消灭最刺眼的反向 import；投影仍无直测、注册表仍是全局 Map，初衷只解 1/3。
- 推荐度：不推荐

### 方向 C：全搬但注册表保持模块级全局
- 少做注入改造；但「三处外部驱动」只换行号，评审的 "registry travels with instance" 没落实。
- 推荐度：备选（若 A 的注入面改动被证过大可退）

## 确认方向

最终确认的方向：**方向 A**（用户：「确认方向A」，2026-08-17）

确认意图：

- **Outcome**: 新建 session-domain 模块收编 config 装配/历史投影+分页/spaceKey 解析/SSE 注册表（per-instance）/附件规则；server.js 只 import domain 模块；路由降到 ~300 行纯转发 + 4 个旧名 re-export。
- **User**: 开发者（改会话语义一处生效；投影/key 解析可直测）。
- **Why now**: architecture-review 2026-08-16 候选 #4；execution-runner 已验证同批「深化」模式可行；趁早做，避免与 db-per-path-cache 在同一文件上纠缠加深。
- **Success**: ① server.js 不再 import 路由内部函数 ② 路由 ~300 行纯转发 ③ 投影/分页/key 解析有直测 ④ 既有 10 个测试文件零改动全绿 ⑤ SSE/HTTP 契约字节级不变 ⑥ 模块依赖图可证方向回正。
- **Constraint**: 实现者对业务测试只读——4 个旧导出名 + 导入路径不能断；本 story 不动 DB 访问方式（留给 db-per-path-cache）。
- **Out of scope**: SSE 事件契约/payload 变更；HTTP API 变更；sessionStore/DB 层改造；permission 链（隔壁 story）；`cardRenderer.js`（仅注释提及，无代码依赖）。

确认理由：五块全搬一次把初衷清零；re-export 保测试面是 execution-runner 已验证的兼容先例；per-instance 注册表落实评审 "registry travels with instance"。

## 最窄的切入点

先把 config 装配（`buildSessionConfig`）+ spaceKey 解析搬出去立起 domain 模块骨架和 server.js 依赖方向，再逐块搬投影/分页 → SSE 注册表（含注入改造）→ 附件规则；每块搬完跑既有 10 测试保绿。

## 待确认问题

- [x] 搬迁清单（五块全搬）— 已确认
- [x] SSE 注册表形态（per-instance 注入）— 已确认
- [x] 测试导入面（路由 re-export，零测试改动）— 已确认
- [x] 与 db-per-path-cache 边界（本 story 不动 store 接口、先行）— 已确认
- [x] 成功标准（六条）— 已确认
