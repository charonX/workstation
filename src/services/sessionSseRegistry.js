// src/services/sessionSseRegistry.js
// 有状态 SSE 订阅注册表（ADR-030 / story 2026-08-16-deepen-session-domain 稳定块 4）：
// 从 src/http/routes/agentSessions.js 逐字节剪切收编——createSseSubscriptionRegistry()
// 工厂产出 per-instance 实例（实例私有挂起 Map，模块级全局消亡，ADR-030 决策 7 唯一
// 有意内部变更），三方法：
//   - createSubscription(res, spaceKey)：收编现 createSseSubscription——会话句柄
//     "session-event" 原样转发为 data: <json>\n\n 帧（≤256KB 截断契约由 agentService
//     源头 enforceSizeLimit 保证，本层不二次截断——confirmation-pending 等非文本事件
//     无 content/delta 载体，二次截断会丢字段）；轮次边界 text_start 由本层宣告
//     （imRouter stream_start 同型先例：worker 未映射 PI turn_start/turn_end，边界由
//     触发层宣告）：每轮首个文本事件（text_delta/text_end）前补发 text_start，
//     text_end 后重置——UI 渲染层据此开新气泡；心跳 = 15s 注释帧（": keep-alive"，
//     裁决 11 允许辅助事件交错；测试客户端解析跳过空 data 帧）；客户端断开
//     （res close/error/写失败）→ 摘除监听 + 清心跳 + 挂起集自移除，服务不崩；
//     重连可再建（REQ-AGENT-028 标准 5 端点侧语义）；
//   - registerPending(spaceKey, sub)：挂起登记（Set 去重天然；sub.detach 自移除）——
//     收编 handleGetEvents 无句柄 else 分支；
//   - attachPending(spaceKey, svc)：收编现 attachPendingSseSubs + peekSession——
//     句柄创建后补挂接，无挂起/无句柄为 no-op（幂等，无条件调用安全）。
// Slice 3 路由瘦身时路由内旧副本删除并改经 context.getSseRegistry() 消费本实例。

import { subscribe } from "./eventBus.js";

export function createSseSubscriptionRegistry() {
  // 挂起订阅注册表：spaceKey → Set<sub>。events 连接先于首条消息打开时，agentService
  // 会话句柄尚不存在（句柄由 handlePostMessage 的 createSession 创建）——先挂起，
  // 句柄创建后经 attachPending 补挂接。sub.detach 时自行从注册表移除。
  const pendingSseSubs = new Map();

  // 会话句柄窥探（挂起订阅挂接 / events 既有句柄直接挂接共用）：服务未接线或句柄
  // 未创建 → null。getSession 为同步返回既有句柄，不触发惰性创建（ADR-009：打开
  // events 连接不启动 agent 子进程）。
  function peekSession(svc, spaceKey) {
    return svc?.getSession ? svc.getSession(spaceKey) : null;
  }

  // 会话句柄创建后挂接挂起订阅（handlePostMessage 在 createSession 之后调用）：
  // 事件从下一轮起持续收流（SSE 只推增量、不做事件回溯，F2）。spaceKey 无挂起
  // 订阅时为 no-op（常态路径）。server.js 接线复用（确认回调建句柄后同型挂接——
  // assistantConfirm「稍后处理」场景的流式回投）。
  function attachPending(spaceKey, svc) {
    const subs = pendingSseSubs.get(spaceKey);
    if (!subs || subs.size === 0) return;
    const session = peekSession(svc, spaceKey);
    if (!session) return;
    for (const sub of subs) sub.attach(session); // attach 不增删本集合 → 直接迭代
    pendingSseSubs.delete(spaceKey);
  }

  // 挂起登记（events 连接无既有句柄分支）：sub.detach 时自移除（见 createSubscription
  // detach 内的挂起集自清理）。Set 去重天然——同 sub 重复登记不产生重复项。
  function registerPending(spaceKey, sub) {
    let subs = pendingSseSubs.get(spaceKey);
    if (!subs) {
      subs = new Set();
      pendingSseSubs.set(spaceKey, subs);
    }
    subs.add(sub);
  }

  // SSE 订阅构造（挂起/挂接两用）：连接状态 + 事件转发 + 轮次边界宣告 + 心跳 +
  // 断开清理收敛一处；对调用方仅暴露 attach/detach 两个动作。行为语义见模块头
  // 注释（端点契约）。
  function createSubscription(res, spaceKey) {
    const HEARTBEAT_MS = 15 * 1000;
    let session = null;
    let attached = false;
    let detached = false;
    let textStarted = false; // 当前轮次是否已宣告 text_start（text_end 后重置）
    let heartbeat = null;

    const writeFrame = (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        sub.detach(); // 写失败（连接已死）→ 摘除，服务不崩
      }
    };

    // Slice 4（REQ-AGENT-030）：confirmation-pending 事件通道——confirmationService
    // 对 ui:* 空间新建挂起行发布（eventBus，按空间前缀分流），本连接按 spaceKey
    // 过滤转发（字段 = 裁决 11：confirmId/operation/description；sessionKey 仅订阅
    // 侧过滤用，不出现在事件帧）。与 handle 事件互不干扰（confirmation-pending
    // 非文本事件，不参与轮次边界宣告）；SSE 只推增量（事件发布时连接不在 → 丢失，
    // 渲染层以 GET /api/agent/confirmations 全量对齐——F3「卡片留历史」数据源）。
    const unsubscribePending = subscribe("confirmation-pending", (payload) => {
      if (detached || !payload || payload.sessionKey !== spaceKey) return;
      const { sessionKey: _sessionKey, ...pending } = payload;
      writeFrame({ type: "confirmation-pending", ...pending });
    });

    const onEvent = (ev) => {
      if (detached || !ev || typeof ev.type !== "string") return;
      if (ev.type === "text_start") {
        textStarted = true;
      } else if (!textStarted && (ev.type === "text_delta" || ev.type === "text_end")) {
        // 轮次边界宣告：首个文本事件前补发 text_start（裁决 11 子序列头）。
        textStarted = true;
        writeFrame({ type: "text_start" });
      }
      if (ev.type === "text_end") textStarted = false; // 轮次结束，下一轮重新宣告
      writeFrame(ev);
    };

    const sub = {
      attach(s) {
        if (detached) return;
        session = s;
        attached = true;
        session.on("session-event", onEvent);
      },
      // Slice 8（REQ-AGENT-058）：路由层补推帧（git 分支状态随连接建立推送；
      // 写失败 → detach，与心跳同一容错语义）。
      pushFrame: (ev) => writeFrame(ev),
      detach() {
        if (detached) return;
        detached = true;
        unsubscribePending(); // 摘除 confirmation-pending 订阅（eventBus 回调先查 detached，幂等）
        if (heartbeat) clearInterval(heartbeat);
        if (attached && session) session.off("session-event", onEvent);
        const subs = pendingSseSubs.get(spaceKey);
        if (subs) {
          subs.delete(sub);
          if (subs.size === 0) pendingSseSubs.delete(spaceKey);
        }
        try {
          res.end();
        } catch {
          // 响应已结束/已销毁：忽略。
        }
      },
    };

    res.on("close", () => sub.detach());
    res.on("error", () => sub.detach());
    heartbeat = setInterval(() => {
      if (detached) return;
      try {
        res.write(": keep-alive\n\n");
      } catch {
        sub.detach();
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.(); // 心跳不阻塞进程退出（node --test 生命周期）

    return sub;
  }

  return { createSubscription, registerPending, attachPending };
}
