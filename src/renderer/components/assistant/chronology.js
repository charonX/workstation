// src/renderer/components/assistant/chronology.js
// 消息流时间序归并（BUG-008 / REQ-AGENT-030「内联高危确认卡」 + UX 参照
// ux/assistant.html——确认卡 = 消息数组内的一项，请求时点位置原地置灰）。
//
// 修复前：MessageList 把 confirmations 作为独立分组渲染在 messages 之后——所有
// 确认卡追加在消息流末尾「永久跟随底部」（已处理卡钉在最新回复之下，用户观感
// 「一直在这个位置，很奇怪」）。REQ-AGENT-030 标准 3「卡片保留在历史中」语义 =
// 留在请求时点的历史位置（稍后点击仍有效）；标准 4 置灰 = 原地标注。
//
// 纯函数零 JSX（node 可导入——api 层契约测试直接断言归并序）。
//
// 时间戳来源（混排可比）：
// - 历史消息/确认卡：createdAt ISO 串（agent_sessions JSONL / agent_confirmations 行）；
// - live 工具块：startedAt（epoch ms，reduceToolEvent 创建）；
// - 缺失兜底：-Infinity 置前 + 原数组相对序（稳定降级，不吞项不抛错）。

function tsOf(item) {
  if (typeof item?.createdAt === "string" && item.createdAt !== "") {
    const t = Date.parse(item.createdAt);
    if (Number.isFinite(t)) return t;
  }
  if (typeof item?.startedAt === "number" && Number.isFinite(item.startedAt)) {
    return item.startedAt;
  }
  return null;
}

// mergeChronological(messages, confirmations) → Array<{ kind, item, ts }>
// kind = "message"（含工具块——渲染层按 item.kind === "tool" 分流）| "confirm"。
export function mergeChronological(messages = [], confirmations = []) {
  const wrapped = [
    ...messages.map((item, seq) => ({ kind: "message", item, ts: tsOf(item), seq })),
    ...confirmations.map((item, i) => ({ kind: "confirm", item, ts: tsOf(item), seq: messages.length + i })),
  ];
  wrapped.sort((a, b) => (a.ts ?? -Infinity) - (b.ts ?? -Infinity) || a.seq - b.seq);
  return wrapped;
}
