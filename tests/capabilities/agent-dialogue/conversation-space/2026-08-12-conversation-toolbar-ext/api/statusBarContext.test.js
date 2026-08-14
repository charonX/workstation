// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-105
// REQ-VERSION: v5-hash:98fd8e7b5e422ebb499f737b00421a4db397895794664dd5e6bfea1c492398a2
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true（expected 值人签：恒定两位小数，BUG-003 分类确认 2026-08-14）

// 上下文用量百分比两位小数（REQ-AGENT-105，v0.7 / BUG-003 req-gap 补全）。
//
// 背景：StatusBar contextText 直拼 pi SDK 全精度 percent（实证 5041/262144×100 =
// 1.9222259521484375% → UI 原样显示）；assistant-rich.html 参照整数格式（6%）被人
// 拍板推翻为恒定两位小数。数据源（SDK 全精度）不变，仅展示层格式化。
//
// seam：format.js 导出 contextText / meterWidth 纯函数（从 StatusBar.jsx 抽取——
// JSX 文件 node 不可直接 import，REQ-105 补此 seam）；本文件直接 import 断言。

import { describe, it } from "node:test";
import assert from "node:assert/strict";

async function loadFormatSeam() {
  const mod = await import("../../../../../../src/renderer/components/assistant/format.js").catch(() => null);
  assert.ok(mod?.contextText, "seam 未就绪：format.js 未导出 contextText（REQ-AGENT-105）");
  assert.ok(mod?.meterWidth, "seam 未就绪：format.js 未导出 meterWidth（REQ-AGENT-105）");
  return mod;
}

describe("REQ-AGENT-105 上下文用量百分比两位小数", () => {
  it("标准 1：全精度 percent → 两位小数（1.9222259521484375 → 1.92%）", async () => {
    const { contextText } = await loadFormatSeam();
    const out = contextText({ tokens: 5041, contextWindow: 262144, percent: 1.9222259521484375 });
    assert.equal(out, "5k / 262.1k tokens · 1.92%");
  });

  it("标准 2：整数 percent → 恒定两位小数（6 → 6.00%，不去尾零）", async () => {
    const { contextText } = await loadFormatSeam();
    const out = contextText({ tokens: 12000, contextWindow: 200000, percent: 6 });
    assert.equal(out, "12k / 200k tokens · 6.00%");
  });

  it("标准 3：percent null/NaN → 不显示百分比段；全缺 → 占位（既有语义回归）", async () => {
    const { contextText } = await loadFormatSeam();
    // 压缩后 tokens/percent null：仅 tokens/contextWindow 段在也不显示百分比
    const onlyTokens = contextText({ tokens: 5041, contextWindow: 262144, percent: null });
    assert.equal(onlyTokens, "5k / 262.1k tokens");
    assert.ok(!onlyTokens.includes("%"), "percent null 不得显示 %");
    const nanPercent = contextText({ tokens: 5041, contextWindow: 262144, percent: NaN });
    assert.ok(!nanPercent.includes("%"), "percent NaN 不得显示 %");
    // 全缺 → 占位
    assert.equal(contextText(null), "—");
    assert.equal(contextText({}), "—");
  });

  it("标准 4：meterWidth 行为不变（全精度 percent 驱动 + 0-100 clamp）", async () => {
    const { meterWidth } = await loadFormatSeam();
    assert.equal(meterWidth({ percent: 1.9222259521484375 }), "1.9222259521484375%", "仪表宽度保持全精度");
    assert.equal(meterWidth({ percent: 120 }), "100%", "超界 clamp 100");
    assert.equal(meterWidth({ percent: -5 }), "0%", "负值 clamp 0");
    assert.equal(meterWidth(null), "0%", "缺失 → 0");
    assert.equal(meterWidth({ percent: null }), "0%", "null → 0");
  });
});
