// src/agent/sessionLifecycle.js
// 会话生命周期模块（tech-design 接口 1；PRD B1/B2/B3/B4，REQ-AGENT-035/036/037/039）。
//
// 从 worker.js 抽取的会话注册表 + 活跃时间戳 + 淘汰调度：
// - 三触发淘汰：TTL（idle 1h，sweep 60s）/ LRU（上限 50，注册时执行）/ 同组单活
//   （evictGroupPeers，冷却同组其他非流式会话）；
// - 流式/队列豁免：entry.streaming || entry.queued 时三触发均豁免；组冷却命中
//   流式/队列中会话 → 标记延迟淘汰（pendingEvictions），流结束立即执行（不等 TTL）；
//   TTL/LRU 豁免会话流结束后回归候选集合（sweep 再次判定）；
// - 淘汰副作用经 onEvict(key, entry) 回调由调用方（worker）执行——本模块零自身
//   副作用（不 dispose、不发 IPC、不清辅助 Map）；模块自身仅维护内部状态：
//   注册表、活跃时间、tombstone 集合（接口 3 判别依据）、延迟淘汰标记；
// - 幂等：重复淘汰同 key no-op；未知 key 的 touch/evictGroupPeers 静默 no-op
//   （消息乱序容忍，tech-design 接口 1 业务错误行）。
//
// 关键裁决（signoff 1/3/4/5/7/8/9 + REQ-AGENT-035 标准 2/7）：
// - TTL = 1h（3_600_000ms）；LRU 上限 = 50（maxSessions 可注入测试）；sweep = 60s 语义；
// - keySecrets 不随单会话淘汰清理（keyRef 级共享缓存）——本模块根本不持有它；
//   confirmAcks/permissionDecisions 同理不随淘汰清理（30s/10min 超时兜底自然释放）；
// - tombstone 只含「本运行内活着且被正常淘汰」的 key；remove()（/reset/重建）清
//   tombstone（旧世代不得经 evicted 判别复活）；register()（懒恢复）清 tombstone。

const TTL_MS = 60 * 60 * 1000; // 1 小时（D5 拍板）
export const DEFAULT_TTL_MS = TTL_MS;
export const DEFAULT_MAX_SESSIONS = 50; // LRU 上限（D5 拍板）
export const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000; // sweep 周期（D5 默认提议）

// spaceKey 文档化语法（ADR-016）分组纯函数（REQ-AGENT-037 标准 1 语料）：
//   feishu:<chatId>            → 自身（飞书各 chat 天然单会话，无组规则）
//   ui:copilot:<sid>           → "ui:copilot"（通用空间全组单热；与项目组同一规则）
//   ui:project:<pid>:<sid>     → "ui:project:<pid>"（项目组）
//   畸形 key                   → 自身（无-op 兜底，不抛错）
export function groupOf(spaceKey) {
  const key = String(spaceKey);
  if (key.startsWith("ui:copilot:")) return "ui:copilot";
  const project = /^ui:project:([^:]+):/.exec(key);
  if (project) return `ui:project:${project[1]}`;
  return key;
}

export function createSessionLifecycle({
  now = Date.now,
  onEvict = null,
  maxSessions = DEFAULT_MAX_SESSIONS,
  onWarn = null,
} = {}) {
  const sessions = new Map(); // sessionKey → entry（entry 为 worker 侧会话句柄，含
  // 可被本模块读写的 streaming/queued 流式豁免标记与 lastActiveAt/lastTouchAt）
  const tombstones = new Set(); // 本运行亲手淘汰的 key（接口 3 判别依据）
  const pendingEvictions = new Set(); // 组冷却命中的流式/队列中会话 → 流结束立即淘汰
  let previousSweepTime = -Infinity; // 上一次 sweep 的时钟值（首 sweep = 远古）

  function evict(key, entry) {
    if (!sessions.has(key)) return; // 幂等：重复淘汰同 key no-op
    sessions.delete(key);
    pendingEvictions.delete(key);
    tombstones.add(key);
    if (onEvict) onEvict(key, entry);
  }

  // 注册（首建 / 懒恢复重注册 / provider-key 变更重建后的新注册）。
  // 覆盖注册：清 tombstone（懒恢复：会话回到可服务集合）与延迟淘汰标记。
  // 注意：register 自身不冷却同组（同组单活由调用方在活动到达时显式调
  // evictGroupPeers——035 标准 1 语义：同组多会话可并存于注册表，仅活动触发冷却）。
  function register(key, entry) {
    tombstones.delete(key);
    pendingEvictions.delete(key);
    const t = now();
    entry.lastActiveAt = t;
    sessions.set(key, entry);
    // LRU 上限（REQ-AGENT-036 标准 1/2）：超限淘汰最久未活动的非流式会话；
    // 候选全部豁免 → 让位（新会话照常创建，E5 诊断经 onWarn）。
    if (sessions.size > maxSessions) {
      const candidates = [];
      for (const [k, e] of sessions) {
        if (k === key) continue; // 新会话自身永不作为 LRU 牺牲品（刚注册，属最新活动）
        if (e.streaming || e.queued) continue;
        candidates.push([k, e]);
      }
      if (candidates.length === 0) {
        if (onWarn) {
          onWarn(
            `[E5] LRU 上限让位：候选会话全部处于流式/队列豁免，上限暂时让位（size=${sessions.size}/${maxSessions}，豁免会话流结束后回归淘汰集合）`
          );
        }
      } else {
        // 最久未活动优先；lastActiveAt 相同 → 先注册者先汰（Map 插入序稳定）。
        candidates.sort((a, b) => (a[1].lastActiveAt ?? 0) - (b[1].lastActiveAt ?? 0));
        evict(candidates[0][0], candidates[0][1]);
      }
    }
  }

  // 活动刷新（prompt 开始 / 流式事件 / 工具事件，REQ-AGENT-035 标准 1）：
  // 刷新 lastActiveAt；活动亦取消延迟淘汰标记（会话重新热起来不再被组冷却追偿）。
  // 未知 key → 静默 no-op（消息乱序容忍）。
  // clearPending 区分活动来源（2026-08-08 PRD 对齐修复 M1）：
  // - true（默认）：用户新活动（prompt 到达 / session-config 到达）→ 用户回来了，
  //   清延迟淘汰标记（不再被组冷却追偿）；
  // - false：会话自身流式/工具事件（worker forwardEvent）→ 仅刷新 lastActiveAt，
  //   不清 pending——组冷却的延迟淘汰必须保留到流结束，否则流式事件 touch 会在
  //   首个流式事件后清掉标记、流结束不再淘汰，组内双热并存（违反 PRD F3「组内
  //   热会话数恒 ≤1」与 REQ-AGENT-037 标准 3）。
  function touch(key, { clearPending = true } = {}) {
    const entry = sessions.get(key);
    if (!entry) return;
    const t = now();
    entry.lastActiveAt = t;
    entry.lastTouchAt = t;
    if (clearPending) pendingEvictions.delete(key);
  }

  // 同组单活（REQ-AGENT-037 标准 2/3/4）：key K 有活动到达（session-config/prompt）
  // 时冷却同组其他会话；组内流式/队列中会话标记延迟淘汰（流结束立即执行）。
  // 跨组不互汰；未知 key → 静默 no-op（组内无同组者自然 no-op）。
  function evictGroupPeers(key) {
    const group = groupOf(key);
    // 直接迭代 Map 活迭代器：evict 删除未访问项时迭代器自动跳过，安全。
    for (const [k, entry] of sessions) {
      if (k === key) continue;
      if (groupOf(k) !== group) continue;
      if (entry.streaming || entry.queued) {
        pendingEvictions.add(k); // 流式豁免：标记延迟，流结束立即淘汰（不等 TTL）
      } else {
        evict(k, entry);
      }
    }
  }

  // 周期扫描（worker 每 60s 调一次；时钟注入，测试可推进）：
  // 1) 组冷却延迟淘汰：pendingEvictions 中已非流式/队列的会话立即淘汰（不等 TTL）；
  // 2) TTL 淘汰：lastActiveAt 超 1h 且非流式/队列中的会话。
  //    保护窗口语义：自上次 sweep 以来有活动（touch）的会话本周期豁免——
  //    生产 60s sweep 下与「age > TTL 即汰」等价（活动周期内 age < 60s ≪ TTL），
  //    仅对延迟/异常的大间隔 sweep 提供「最近活动过」的宽容（035 标准 1 签核语义：
  //    被 touch 者保留、仅未活动者被汰）。
  function sweep() {
    const t = now();
    for (const key of pendingEvictions) {
      const entry = sessions.get(key);
      if (!entry) {
        pendingEvictions.delete(key);
        continue;
      }
      if (!entry.streaming && !entry.queued) evict(key, entry); // 流结束立即淘汰
    }
    for (const [key, entry] of sessions) {
      if (entry.streaming || entry.queued) {
        // 流式/队列豁免（TTL/LRU 回归候选）。E1 诊断（PRD §8）：流式/队列中会话
        // 被纳入淘汰候选 → 豁免延迟（正常保护分支，记诊断日志；格式仿 [E5]）。
        // 仅对真正超窗（idle > TTL）的豁免会话记日志——60s sweep 周期下对一切
        // 流式会话逐周期刷屏无诊断价值，「命中候选」以实际超窗为准。
        const idle = t - (entry.lastActiveAt ?? t);
        if (idle > TTL_MS && onWarn) {
          onWarn(
            `[E1] 流式/队列中会话被纳入淘汰候选，豁免延迟：session=${key}（idle=${idle}ms > TTL=${TTL_MS}ms，流结束回归淘汰集合）`
          );
        }
        continue;
      }
      const idle = t - (entry.lastActiveAt ?? t);
      if (idle > TTL_MS && (entry.lastTouchAt === undefined || entry.lastTouchAt < previousSweepTime)) {
        evict(key, entry);
      }
    }
    previousSweepTime = t;
  }

  // 显式移除（/reset、重建路径）：不触发 onEvict（非淘汰）；清 tombstone 与延迟
  // 标记（旧世代不得复活，REQ-AGENT-035 标准 6 非 tombstone 判别侧）。
  function remove(key) {
    tombstones.delete(key);
    pendingEvictions.delete(key);
    sessions.delete(key);
  }

  function get(key) {
    return sessions.get(key);
  }

  function has(key) {
    return sessions.has(key);
  }

  function size() {
    return sessions.size;
  }

  // tombstone 集合（接口 3 判别依据；Slice 3 主进程 evicted 重投使用）。
  function tombstonedKeys() {
    return [...tombstones];
  }

  // worker 内部使用（shutdown 全量 dispose 遍历）；非契约面。
  function entries() {
    return [...sessions.entries()];
  }

  return {
    register,
    touch,
    evictGroupPeers,
    sweep,
    remove,
    get,
    has,
    size,
    tombstonedKeys,
    entries,
    maxSessions, // 公开上限（036 标准 3 断言默认 50）
  };
}
