// REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-010, REQ-PREVIEW-004
// REQ-VERSION: v1-hash:d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9
// CAPABILITY-TRACE: file-preview
// ENTITY-TRACE: file-preview-panel
// EXPECTED-TRACE: prd.md §6.3 块2 row2/块3 row1/块5, §7.1 rows 1-2, §8 E1-E6, §10.4 接口1/2 全部 golden values, ADR-042 决策3
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false
//
// seam：HTTP API（ADR-042 决策1，CLI/curl 可复验）——
//   GET /api/agent/files/read?projectId&path   （prd.md §10.4 接口2）
//   GET /api/agent/files/list?projectId&dir    （prd.md §10.4 接口1）
// 真实依赖：真实文件系统 fixture（临时目录）+ 真实项目注册（POST /api/projects
// 写入 localPath，与生产 registry 同源）；不 mock fs。
// 错误响应契约：HTTP >= 400 且 body.error = E-PREVIEW-* 错误码（§8 错误表）；
// 其中 list dir="../" → 400 为 §10.4 接口1 锚定状态码。

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const ONE_MB = 1024 * 1024; // 1,048,576 B（§6.3 块5：上限含本数）

let serverCtx, baseUrl, rootDir, outsideDir, projectId;

async function getJson(urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function readUrl(p) {
  return `/api/agent/files/read?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(p)}`;
}
function listUrl(dir) {
  return `/api/agent/files/list?projectId=${encodeURIComponent(projectId)}&dir=${encodeURIComponent(dir)}`;
}

function rawGet(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: urlPath,
        method: "GET",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let body = null;
          try {
            body = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  // —— 真实 fs fixture（§10.4 接口1/2 样例的超集；接口1 根目录 golden 逐条对应）——
  // root/
  //   .git/config            ┐
  //   node_modules/pkg/x.js  │ 噪音目录（硬编码清单：.git/node_modules/dist）
  //   dist/bundle.js         ┘
  //   docs/guide.md          "# Title"
  //   docs/spec.pdf          二进制扩展名
  //   docs/icon.svg          SVG（ADR-042 决策3 拒收）
  //   docs/logo.png          PNG 头字节（图片白名单）
  //   docs/LICENSE           无扩展名 UTF-8 文本
  //   docs/bin.dat           非 UTF-8 字节
  //   docs/big-ok.md         1,048,576 B（边界内）
  //   docs/big-too.md        1,048,577 B（边界外 1 字节）
  //   docs/evil-link         符号链接 → ../outside.txt（根外逃逸）
  //   empty-dir/
  //   src/auth.js            "const x = 1;"
  //   README.md              "# readme"
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-outside-"));
  rootDir = path.join(outsideDir, "proj");
  fs.mkdirSync(path.join(rootDir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, ".git", "config"), "[core]");
  fs.mkdirSync(path.join(rootDir, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "node_modules", "pkg", "x.js"), "x");
  fs.mkdirSync(path.join(rootDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "dist", "bundle.js"), "b");
  fs.mkdirSync(path.join(rootDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "docs", "guide.md"), "# Title");
  fs.writeFileSync(path.join(rootDir, "docs", "spec.pdf"), "%PDF-1.4 fake");
  fs.writeFileSync(path.join(rootDir, "docs", "icon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  fs.writeFileSync(path.join(rootDir, "docs", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  fs.writeFileSync(path.join(rootDir, "docs", "LICENSE"), "MIT license text");
  fs.writeFileSync(path.join(rootDir, "docs", "bin.dat"), Buffer.from([0x89, 0xff, 0xfe, 0x00, 0x01]));
  fs.writeFileSync(path.join(rootDir, "docs", "big-ok.md"), "a".repeat(ONE_MB));
  fs.writeFileSync(path.join(rootDir, "docs", "big-too.md"), "a".repeat(ONE_MB + 1));
  fs.mkdirSync(path.join(rootDir, "empty-dir"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "src", "auth.js"), "const x = 1;");
  fs.writeFileSync(path.join(rootDir, "README.md"), "# readme");
  fs.writeFileSync(path.join(outsideDir, "outside.txt"), "secret");
  fs.symlinkSync(path.join(outsideDir, "outside.txt"), path.join(rootDir, "docs", "evil-link"));

  serverCtx = await startServer({ port: 0 });
  baseUrl = serverCtx.baseUrl;
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "fp-fixture", localPath: rootDir }),
  });
  const body = await res.json();
  assert.ok(res.status === 200 || res.status === 201, `setup：创建项目应 2xx，实际 ${res.status}：${JSON.stringify(body)}`);
  projectId = body.id ?? body.project?.id;
  assert.ok(projectId, "setup：项目创建应返回 id");
});

after(async () => {
  if (serverCtx) await stopServer(serverCtx);
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

describe("REQ-PREVIEW-010 AC1：read 正常路径 golden values", () => {
  it("docs/guide.md（# Title）→ kind=markdown + content 原样 + size=7 + mtimeMs", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口2 样例行「正常 md」
    const { status, body } = await getJson(readUrl("docs/guide.md"));
    assert.equal(status, 200);
    assert.equal(body.kind, "markdown");
    assert.equal(body.content, "# Title");
    assert.equal(body.size, 7);
    assert.equal(typeof body.mtimeMs, "number");
    assert.ok(body.mtimeMs > 0);
  });

  it("src/auth.js → kind=code + language=javascript + content 原样", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口2 样例行「正常 code」
    const { status, body } = await getJson(readUrl("src/auth.js"));
    assert.equal(status, 200);
    assert.equal(body.kind, "code");
    assert.equal(body.language, "javascript");
    assert.equal(body.content, "const x = 1;");
  });

  it("docs/logo.png → kind=image 且不带 content（面板走接口4 取 blob）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口2 输出行（kind="image" 不带 content）
    const { status, body } = await getJson(readUrl("docs/logo.png"));
    assert.equal(status, 200);
    assert.equal(body.kind, "image");
    assert.ok(!("content" in body), "image kind 不携带 content 字段");
  });
});

describe("REQ-PREVIEW-010 AC2：1MB 上限边界（含本数）", () => {
  it("size=1,048,576 B → 200 正常返回内容", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5（1,048,576 B 正常读取）
    const { status, body } = await getJson(readUrl("docs/big-ok.md"));
    assert.equal(status, 200);
    assert.equal(body.size, ONE_MB);
    assert.equal(body.content.length, ONE_MB);
  });

  it("size=1,048,577 B → E-PREVIEW-TOO-LARGE 且不含内容", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块5 / §10.4 接口2「边界 1MB」行（1,048,577 B → E3 拒读）
    const { status, body } = await getJson(readUrl("docs/big-too.md"));
    assert.ok(status >= 400);
    assert.equal(body.error, "E-PREVIEW-TOO-LARGE");
    assert.ok(!("content" in body), "拒读不返回内容（§8 E3：不读内容）");
  });
});

describe("REQ-PREVIEW-010 AC3：根约束（normalize + realpath 双检）", () => {
  it("../outside.txt → E-PREVIEW-OUTSIDE-ROOT，不触达磁盘内容", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块2 row2 / §10.4 接口2「异常越界」行
    const { status, body } = await getJson(readUrl("../outside.txt"));
    assert.ok(status >= 400);
    assert.equal(body.error, "E-PREVIEW-OUTSIDE-ROOT");
    assert.ok(!("content" in body));
  });

  it("符号链接逃逸（docs/evil-link → 根外）→ 同码拒绝（realpath 双检）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口2「异常越界」行（含符号链接逃逸，realpath 双检）
    const { status, body } = await getJson(readUrl("docs/evil-link"));
    assert.ok(status >= 400);
    assert.equal(body.error, "E-PREVIEW-OUTSIDE-ROOT");
  });
});

describe("REQ-PREVIEW-010 AC4：类型判定", () => {
  it("spec.pdf → E-PREVIEW-UNSUPPORTED", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口2「异常类型」行
    const { status, body } = await getJson(readUrl("docs/spec.pdf"));
    assert.ok(status >= 400);
    assert.equal(body.error, "E-PREVIEW-UNSUPPORTED");
  });

  it("SVG → E-PREVIEW-UNSUPPORTED（白名单对齐附件清单，ADR-042 决策3）", async () => {
    // EXPECTED-TRACE: prd.md §6.2 SVG 行 / §10.4 接口2「异常类型」行（REQ-PREVIEW-004 AC2）
    const { status, body } = await getJson(readUrl("docs/icon.svg"));
    assert.ok(status >= 400);
    assert.equal(body.error, "E-PREVIEW-UNSUPPORTED");
  });

  it("无扩展名但 UTF-8 可解码（LICENSE）→ kind=code（plaintext 兜底）", async () => {
    // EXPECTED-TRACE: prd.md §10.3 流A 步骤3（其余扩展名/无扩展名 → UTF-8 嗅探可解码 → code，plaintext 兜底）
    const { status, body } = await getJson(readUrl("docs/LICENSE"));
    assert.equal(status, 200);
    assert.equal(body.kind, "code");
    assert.equal(body.content, "MIT license text");
    // EXPECTED-TRACE: prd.md §10.5 决策6（未识别语言 → plaintext 兜底）
    assert.equal(body.language, "plaintext");
  });

  it("非 UTF-8 二进制（bin.dat）→ E-PREVIEW-UNSUPPORTED", async () => {
    // EXPECTED-TRACE: prd.md §7.1 row2（UTF-8 可解码才进入文本类预览；PDF 字节流 → E4）
    const { status, body } = await getJson(readUrl("docs/bin.dat"));
    assert.ok(status >= 400);
    assert.equal(body.error, "E-PREVIEW-UNSUPPORTED");
  });
});

describe("REQ-PREVIEW-010 AC5：无解析根 / 不存在", () => {
  it("无效 projectId → E-PREVIEW-NO-ROOT", async () => {
    // EXPECTED-TRACE: prd.md §8 E5 行（非项目空间/无效 projectId → 无解析根）
    const res = await fetch(`${baseUrl}/api/agent/files/read?projectId=no-such-project&path=docs/guide.md`);
    const body = await res.json();
    assert.ok(res.status >= 400);
    assert.equal(body.error, "E-PREVIEW-NO-ROOT");
  });

  it("ghost.md → E-PREVIEW-NOT-FOUND", async () => {
    // EXPECTED-TRACE: prd.md §8 E2 行（路径不存在）
    const { status, body } = await getJson(readUrl("docs/ghost.md"));
    assert.ok(status >= 400);
    assert.equal(body.error, "E-PREVIEW-NOT-FOUND");
  });
});

describe("REQ-PREVIEW-010 AC6：list 目录列举 golden values", () => {
  it("根目录：噪音目录不出现；目录在前、同类按 name 排序", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口1 样例行「正常」+ §6.3 块3 row1
    // （fixture 为锚点超集：根多出 docs/、empty-dir/，规则同——目录在前 localeCompare，噪音隐藏）
    const { status, body } = await getJson(listUrl(""));
    assert.equal(status, 200);
    assert.deepEqual(
      body.entries.map((e) => [e.name, e.type]),
      [
        ["docs", "dir"],
        ["empty-dir", "dir"],
        ["src", "dir"],
        ["README.md", "file"],
      ]
    );
    const readme = body.entries.find((e) => e.name === "README.md");
    assert.equal(typeof readme.size, "number", "文件条目带 size（接口1 输出契约）");
  });

  it("子目录 list(dir=\"docs\")：目录在前 + 同类 localeCompare 有序", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口1 输出行（排序规则）
    const { status, body } = await getJson(listUrl("docs"));
    assert.equal(status, 200);
    const names = body.entries.map((e) => e.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, sorted, "同类按 name localeCompare 排序");
  });

  it("空目录 → entries=[]", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口1 样例行「边界」
    const { status, body } = await getJson(listUrl("empty-dir"));
    assert.equal(status, 200);
    assert.deepEqual(body.entries, []);
  });

  it("dir=\"../\" → 400 E-PREVIEW-OUTSIDE-ROOT", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口1 样例行「异常」（锚定 400 状态码）
    const { status, body } = await getJson(listUrl("../"));
    assert.equal(status, 400);
    assert.equal(body.error, "E-PREVIEW-OUTSIDE-ROOT");
  });

  it("dir 不存在 → E-PREVIEW-NOT-FOUND；dir 指向文件 → E-PREVIEW-NOT-FOUND", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口1 业务错误行（dir 不存在或非目录）
    const a = await getJson(listUrl("no-such-dir"));
    assert.ok(a.status >= 400);
    assert.equal(a.body.error, "E-PREVIEW-NOT-FOUND");
    const b = await getJson(listUrl("README.md"));
    assert.ok(b.status >= 400);
    assert.equal(b.body.error, "E-PREVIEW-NOT-FOUND");
  });

  // —— 安全守卫（review 2026-09-03，BUG-001：/api/agent/files/* 本地回环防护与 CORS 收紧）——
  it("伪造 Host（evil.com，DNS rebinding 形态）→ 403 且无 ACAO 头（锚点 §10.7 / BUG-001）", async () => {
    // REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-010
    // CAPABILITY-TRACE: file-preview
    // ENTITY-TRACE: file-preview-panel
    // EXPECTED-TRACE: prd.md §10.7（仅允许本地 loopback 访问，非 loopback Host 403 且不输出 ACAO）
    const r = await rawGet(readUrl("README.md"), { host: "evil.com" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "FORBIDDEN");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  });

  it("伪造跨源 Origin（https://evil.example）→ 403 且无 ACAO 头（锚点 §10.7 / BUG-001）", async () => {
    // REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-010
    // CAPABILITY-TRACE: file-preview
    // ENTITY-TRACE: file-preview-panel
    // EXPECTED-TRACE: prd.md §10.7（跨源 Origin 请求一律 403 阻断）
    const r = await rawGet(readUrl("README.md"), { origin: "https://evil.example" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "FORBIDDEN");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  });

  it("Sec-Fetch-Site: cross-site / cross-origin → 403 且无 ACAO 头（锚点 §10.7 / BUG-001）", async () => {
    // REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-010
    // CAPABILITY-TRACE: file-preview
    // ENTITY-TRACE: file-preview-panel
    // EXPECTED-TRACE: prd.md §10.7（Sec-Fetch-Site 跨站请求一律 403 阻断）
    const r = await rawGet(listUrl(""), { "sec-fetch-site": "cross-site" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "FORBIDDEN");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  });

  it("本机合法请求（Host=127.0.0.1、无 Origin）→ 正常 200 且响应无 ACAO: * 头（锚点 §10.7 / BUG-001）", async () => {
    // REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-010
    // CAPABILITY-TRACE: file-preview
    // ENTITY-TRACE: file-preview-panel
    // EXPECTED-TRACE: prd.md §10.7（本机合法请求放行，且不输出 ACAO: * 避免被外源 fetch 窃听）
    const r = await rawGet(readUrl("README.md"));
    assert.equal(r.status, 200);
    assert.equal(r.body.kind, "markdown");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  });
});
