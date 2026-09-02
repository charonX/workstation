// REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-006
// REQ-VERSION: v1-hash:d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9
// CAPABILITY-TRACE: file-preview
// ENTITY-TRACE: file-preview-panel
// EXPECTED-TRACE: prd.md §6.3 块2 rows 1-2, §6.2 围栏行/SVG行上文（仅行内 code 识别）, §10.5 决策3, ADR-042 决策4
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// seam：聊天路径识别与分发纯模块
// src/renderer/components/assistant/filePathRecognition.js（先例：mdLinkDispatch.js
// 自 JSX 内联提取的纯函数 seam）。契约两个导出：
//   isPreviewableFilePath(text) → boolean
//     形态规则（REQ-006 AC2）：含路径分隔符（/ 或 \）且尾段含扩展名，且无空格、无 URL scheme。
//   dispatchFilePathClick(text, { projectId, openWithPath, notifyNoRoot }) → "preview" | "no-root" | "not-a-path"
//     点击分发（REQ-006 AC4）：识别命中且有 projectId → openWithPath(projectId, text) 原样透传；
//     无 projectId（非项目空间会话）→ notifyNoRoot() 提示 E5，不发请求；非路径 → 全不触。
// 围栏不识别（REQ-006 AC3）是渲染层接线（行内 code 分支才调用本模块），由 E2E 闭合，
// 见 e2e/filePreview.test.cjs「代码围栏内路径不转为可点击链接」。

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../../../../../src/renderer/components/assistant/filePathRecognition.js").catch(() => null);
assert.ok(
  mod,
  "seam 未就绪：src/renderer/components/assistant/filePathRecognition.js 尚未实现（REQ-PREVIEW-006，prd.md §10.2 聊天路径分发模块）"
);
const { isPreviewableFilePath, dispatchFilePathClick } = mod;

describe("REQ-PREVIEW-006 AC1/AC2：路径形态识别正反矩阵", () => {
  it("正例：含分隔符且尾段有扩展名 → 识别为本地路径", () => {
    // EXPECTED-TRACE: prd.md §6.1 流A 步骤1（`docs/guide.md` 渲染为可点击链接样式）
    for (const text of [
      "docs/guide.md",
      "src/auth.js",
      "a/b/c.txt",
      "docs\\guide.md", // Windows 分隔符同规（REQ-006 AC2：/ 或 \）
      "./README.md",
      "/proj/docs/guide.md", // 根内绝对路径允许（§10.4 接口2 输入行），形态判定不区分
    ]) {
      assert.equal(isPreviewableFilePath(text), true, `应识别：${text}`);
    }
  });

  it("反例：空格 / URL scheme / 无分隔符 / 无扩展名 → 不识别", () => {
    // EXPECTED-TRACE: requirements.md REQ-PREVIEW-006 AC2 反例行（推导自 §10.5 决策3 形态规则）
    for (const text of [
      "a b/c.txt", // 含空格
      "https://x.com/a.md", // 有 scheme，归 MdLink http 路径（ADR-042 决策4 边界）
      "http://x.com/a.md",
      "readme", // 无扩展名无分隔符
      "file.txt", // 有扩展名但无路径分隔符
      "docs/", // 有分隔符但尾段无扩展名
      "docs/guide", // 有分隔符但尾段无扩展名
    ]) {
      assert.equal(isPreviewableFilePath(text), false, `不应识别：${text}`);
    }
  });
});

describe("REQ-PREVIEW-006 AC4：点击分发", () => {
  function makeBridges(projectId) {
    const calls = { openWithPath: [], notifyNoRoot: 0 };
    return {
      calls,
      bridges: {
        projectId,
        openWithPath: (pid, p) => calls.openWithPath.push([pid, p]),
        notifyNoRoot: () => { calls.notifyNoRoot += 1; },
      },
    };
  }

  it("项目空间会话：点击 `docs/guide.md` → openWithPath(projectId, 原样路径)", () => {
    // EXPECTED-TRACE: prd.md §6.3 块2 row 1（点击后路径参数按根解析——相对路径原样透传，主进程解析）
    const { calls, bridges } = makeBridges("p1");
    const action = dispatchFilePathClick("docs/guide.md", bridges);
    assert.equal(action, "preview");
    assert.deepEqual(calls.openWithPath, [["p1", "docs/guide.md"]]);
    assert.equal(calls.notifyNoRoot, 0);
  });

  it("非项目空间会话（无 projectId）：点击 → notifyNoRoot（E5），不发 openWithPath", () => {
    // EXPECTED-TRACE: prd.md §8 E5 行（非项目空间会话触发 → 提示「当前会话无项目空间」）
    const { calls, bridges } = makeBridges(null);
    const action = dispatchFilePathClick("docs/guide.md", bridges);
    assert.equal(action, "no-root");
    assert.equal(calls.notifyNoRoot, 1);
    assert.deepEqual(calls.openWithPath, []);
  });

  it("非路径文本：两桥函数均零调用", () => {
    const { calls, bridges } = makeBridges("p1");
    const action = dispatchFilePathClick("hello world", bridges);
    assert.equal(action, "not-a-path");
    assert.deepEqual(calls.openWithPath, []);
    assert.equal(calls.notifyNoRoot, 0);
  });
});
