// REQ-TRACE: 2026-08-24-embedded-browser/REQ-BROWSER-004
// REQ-VERSION: v2-hash:1b26fe9dc10d23ac1d650a76dd952f2458c3492d4981e96c435e9fc819d7b622
// CAPABILITY-TRACE: embedded-browser
// ENTITY-TRACE: browser-panel
// EXPECTED-TRACE: prd.md §6.3 块4 rows 1-3（块内编号）, §10.2 MarkdownRenderer 模块行
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true（2026-08-28 assertion signoff，见 signoff.md）
//
// 2026-08-30 review 阻塞项补测（REQ-004 AC2/AC3 行为断言）：E2E 只断言菜单结构不点
// 「在系统浏览器打开」（真实唤起系统浏览器不可自动化），openExternal 被调用且参数正确
// 这一行为契约由本组件测试闭合——seam 为 MdLink 分发纯模块
// src/renderer/components/assistant/mdLinkDispatch.js（自 JSX 内联提取，行为零变化），
// mock 桥函数（openPanel/openExternal）断言调用与参数。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchLink,
  resolveLinkAction,
} from "../../../../../../src/renderer/components/assistant/mdLinkDispatch.js";

function makeBridges() {
  const calls = { openPanel: [], openExternal: [] };
  return {
    calls,
    openPanel: (href) => calls.openPanel.push(href),
    openExternal: (href) => calls.openExternal.push(href),
  };
}

describe("REQ-BROWSER-004 聊天链接面板集成（mdLinkDispatch 分发契约）", () => {
  it("AC1：http(s) 链接默认动作 → openPanel(href)，不触 openExternal（锚点 §6.3 块4 row1）", () => {
    // EXPECTED-TRACE: prd.md §6.3 块4 row 1（点击 → 面板打开并加载 https://a.b/c，非系统浏览器）
    const { calls, openPanel, openExternal } = makeBridges();
    const action = dispatchLink("https://a.b/c", { openPanel, openExternal });
    assert.equal(action, "panel");
    assert.deepEqual(calls.openPanel, ["https://a.b/c"]);
    assert.deepEqual(calls.openExternal, []);

    // http 同规（白名单 = http/https 两协议）
    const b = makeBridges();
    assert.equal(dispatchLink("http://a.b/c", b), "panel");
    assert.deepEqual(b.calls.openPanel, ["http://a.b/c"]);
  });

  it("AC2：action=external（在系统浏览器打开）→ 以相同 href 调 openExternal 一次，不触 openPanel（锚点 §6.3 块4 row2）", () => {
    // EXPECTED-TRACE: prd.md §6.3 块4 row 2（系统浏览器入口调用 shell.openExternal(<url>)，面板状态不变）
    const { calls, openPanel, openExternal } = makeBridges();
    const action = dispatchLink("https://a.b/c", { action: "external", openPanel, openExternal });
    assert.equal(action, "external");
    assert.deepEqual(calls.openExternal, ["https://a.b/c"]); // 一次且参数为相同 href
    assert.deepEqual(calls.openPanel, []);
  });

  it("AC3：mailto: 等非 http(s) 链接 passthrough——两桥函数均零调用（锚点 §6.3 块4 row3）", () => {
    // EXPECTED-TRACE: prd.md §6.3 块4 row 3（mailto:a@b.c 不触发面板导航、不拦截，保持系统默认处理）
    for (const href of ["mailto:a@b.c", "tel:+123", "ftp://x/y", "file:///etc/passwd", "javascript:alert(1)"]) {
      const { calls, openPanel, openExternal } = makeBridges();
      assert.equal(resolveLinkAction(href), "passthrough");
      assert.equal(dispatchLink(href, { openPanel, openExternal }), "passthrough");
      assert.deepEqual(calls.openPanel, []);
      assert.deepEqual(calls.openExternal, []);
    }
  });
});
