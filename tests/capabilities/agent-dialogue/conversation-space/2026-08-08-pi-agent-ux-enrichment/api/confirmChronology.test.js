// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-030
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: BUG-008

// BUG-008 回归：确认卡按时间序内联于消息流（UX 参照 ux/assistant.html——确认卡
// 是消息数组内的一项，请求时点位置原地置灰），不再作为独立分组追加在消息列表
// 末尾「永久跟随底部」（生产观感事故 2026-08-09：已处理卡钉在最新回复之后的
// 底部位置，用户：「一直在这个位置，很奇怪」）。
//
// REQ-AGENT-030 标准 3「卡片保留在历史中」语义 = 留在请求时点的历史位置
// （稍后点击仍有效）；标准 4「已处理置灰」= 原地标注，而非迁移到底部。
//
// 断言（渲染层消息流归并契约）：
// 1. seam 存在：chronology.js 导出 mergeChronological（纯函数，MessageList 消费）；
// 2. 历史交错：t1/t3 消息 + t2 确认卡 → 卡居中（不再追加底部）；
// 3. 已处理卡早于后续消息 → 保持历史位置（本 bug 核心）；
// 4. pending 卡时间最新 → 末尾（当前可操作性不回归）；
// 5. 缺 createdAt 的项（live 兜底）→ 稳定序不崩（降级语义：置前保持原相对序）；
// 6. 工具块（startedAt epoch ms）与 ISO createdAt 混排正确。
//
// seam：src/renderer/components/assistant/chronology.js（纯 JS 零 JSX，node 可导入）。

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const ISO = (s) => `2026-08-10T${s}.000Z`;

async function loadChronology() {
  const mod = await import("../../../../../../src/renderer/components/assistant/chronology.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/renderer/components/assistant/chronology.js 尚未实现（BUG-008）");
  assert.equal(typeof mod.mergeChronological, "function", "chronology.js 应导出 mergeChronological(messages, confirmations)");
  return mod;
}

describe("BUG-008 回归：确认卡按时间序内联消息流", () => {
  it("用例 2：t1/t3 消息 + t2 确认卡 → 卡居中（历史交错）", async () => {
    // Arrange
    const { mergeChronological } = await loadChronology();
    const messages = [
      { id: "m1", role: "user", createdAt: ISO("10:00:01") },
      { id: "m3", role: "assistant", createdAt: ISO("10:00:03") },
    ];
    const confirmations = [{ confirmId: "c2", createdAt: ISO("10:00:02"), status: "approved" }];
    // Act
    const merged = mergeChronological(messages, confirmations);
    // Assert：卡内联于请求时点（修复前：卡作为独立分组追加在消息之后）。
    assert.deepEqual(
      merged.map((e) => `${e.kind}:${e.item.id ?? e.item.confirmId}`),
      ["message:m1", "confirm:c2", "message:m3"],
      `确认卡应按 createdAt 内联。实际: ${JSON.stringify(merged.map((e) => [e.kind, e.item.id ?? e.item.confirmId]))}`
    );
  });

  it("用例 3：已处理卡早于后续消息 → 保持历史位置（不再钉在底部）", async () => {
    // Arrange：生产症状形态——卡已 approved，其后又有多轮对话。
    const { mergeChronological } = await loadChronology();
    const messages = [
      { id: "m1", role: "user", createdAt: ISO("10:00:01") },
      { id: "m2", role: "assistant", createdAt: ISO("10:00:05") },
      { id: "m3", role: "assistant", createdAt: ISO("10:00:09") },
    ];
    const confirmations = [{ confirmId: "c1", createdAt: ISO("10:00:02"), status: "approved" }];
    // Act
    const merged = mergeChronological(messages, confirmations);
    // Assert
    assert.deepEqual(
      merged.map((e) => `${e.kind}:${e.item.id ?? e.item.confirmId}`),
      ["message:m1", "confirm:c1", "message:m2", "message:m3"],
      "done 卡必须沉回历史位置（用户观感「一直在这个位置」= 实现把卡追加末尾跟随底部）"
    );
  });

  it("用例 4：pending 卡时间最新 → 末尾（可操作性不回归）", async () => {
    // Arrange
    const { mergeChronological } = await loadChronology();
    const messages = [
      { id: "m1", role: "user", createdAt: ISO("10:00:01") },
      { id: "m2", role: "assistant", createdAt: ISO("10:00:02") },
    ];
    const confirmations = [{ confirmId: "c9", createdAt: ISO("10:00:10"), status: "pending" }];
    // Act
    const merged = mergeChronological(messages, confirmations);
    // Assert：新挂起卡自然落底部（标准 3「稍后点击仍有效」的操作入口不藏起来）。
    assert.deepEqual(merged.map((e) => `${e.kind}:${e.item.id ?? e.item.confirmId}`), [
      "message:m1",
      "message:m2",
      "confirm:c9",
    ]);
  });

  it("用例 5：缺 createdAt 的项 → 稳定序不崩（降级置前，原相对序保持）", async () => {
    // Arrange：live 兜底——历史消息恒有 createdAt；live 项修复后补齐，缺失形态防御。
    const { mergeChronological } = await loadChronology();
    const messages = [
      { id: "m1", role: "user" }, // 无 createdAt
      { id: "m2", role: "assistant", createdAt: ISO("10:00:02") },
    ];
    const confirmations = [{ confirmId: "c1", createdAt: ISO("10:00:01"), status: "pending" }];
    // Act
    const merged = mergeChronological(messages, confirmations);
    // Assert：无时间戳项置前（-Infinity），其余按序；不得抛错/吞项。
    assert.equal(merged.length, 3);
    assert.deepEqual(merged.map((e) => `${e.kind}:${e.item.id ?? e.item.confirmId}`), [
      "message:m1",
      "confirm:c1",
      "message:m2",
    ]);
  });

  it("用例 6：工具块（startedAt epoch ms）与 ISO createdAt 混排正确", async () => {
    // Arrange：工具块不落历史但 live 会话内与确认卡共存（BUG-006 事故现场形态）。
    const { mergeChronological } = await loadChronology();
    const t1 = Date.parse(ISO("10:00:01"));
    const t3 = Date.parse(ISO("10:00:03"));
    const messages = [
      { id: "m1", role: "user", createdAt: ISO("10:00:00") },
      { kind: "tool", id: "t1", startedAt: t1, status: "running" },
      { kind: "tool", id: "t3", startedAt: t3, status: "running" },
    ];
    const confirmations = [{ confirmId: "c2", createdAt: ISO("10:00:02"), status: "pending" }];
    // Act
    const merged = mergeChronological(messages, confirmations);
    // Assert：epoch ms 与 ISO 混合可比——卡按真实时序插入两工具块之间。
    assert.deepEqual(merged.map((e) => `${e.kind}:${e.item.id ?? e.item.confirmId}`), [
      "message:m1",
      "message:t1",
      "confirm:c2",
      "message:t3",
    ]);
  });
});
