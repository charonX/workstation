// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-116
// REQ-VERSION: v2-hash:77f0f186fe65139c162d3db19364b93827432d5424fd502d067f24df71cbb28c
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 块5 附件锚点（E-ATTACH-* 四规则字面值/阈值 10 个与 10MB）+ §7.1 短路顺序
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-116：附件规则搬迁——attachmentsError 从 sessionDomain.js 直测。
// 四规则短路顺序：类型 → 数量 → 大小 → 路径；合法数组 → undefined。
// 常量随迁：IMAGE_MIME_TYPES（jpeg/png/gif/webp/bmp/heic/heif）、
// MAX_ATTACHMENTS=10、MAX_ATTACHMENT_BYTES=10MB。
// HTTP 面（400 + 错误封套）由既有 sessionMessage/imageAttachment 测试承载（AC4）。
//
// seam：src/services/sessionDomain.js 的 attachmentsError。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadDomain() {
  const mod = await import("../../../../../../src/services/sessionDomain.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/sessionDomain.js 尚未实现（REQ-AGENT-116，ADR-030）");
  assert.equal(typeof mod.attachmentsError, "function", "sessionDomain.js 应导出 attachmentsError(attachments)");
  return mod;
}

describe("REQ-AGENT-116 附件规则（sessionDomain 直测）", () => {
  let workdir;
  let imgPath;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-domain-att-"));
    imgPath = path.join(workdir, "ok.png");
    fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50]), "utf8");
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  const validAtt = () => ({ mimeType: "image/png", size: 1024, path: imgPath });

  it("AC1 类型规则：非白名单 mimeType → E-ATTACH-TYPE（字面值）", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块5 row 2
    assert.deepEqual(domain.attachmentsError([{ mimeType: "text/plain", size: 1, path: imgPath }]), {
      code: "E-ATTACH-TYPE",
      message: "仅支持图片（jpeg/png/gif/webp/bmp/heic/heif）",
    });
  });

  it("AC1 数量规则：11 个合法附件 → E-ATTACH-COUNT（阈值 10）", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块5 row 1
    const atts = Array.from({ length: 11 }, validAtt);
    assert.deepEqual(domain.attachmentsError(atts), {
      code: "E-ATTACH-COUNT",
      message: "每条消息最多附加 10 个文件",
    });
    // 边界：恰好 10 个 → 合法
    assert.equal(domain.attachmentsError(Array.from({ length: 10 }, validAtt)), undefined);
  });

  it("AC1 大小规则：单附件 10MB+1 → E-ATTACH-SIZE", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块5 row 3
    assert.deepEqual(
      domain.attachmentsError([{ mimeType: "image/png", size: 10 * 1024 * 1024 + 1, path: imgPath }]),
      { code: "E-ATTACH-SIZE", message: "图片过大（单图 ≤10MB）" }
    );
    // 边界：恰好 10MB → 合法
    assert.equal(
      domain.attachmentsError([{ mimeType: "image/png", size: 10 * 1024 * 1024, path: imgPath }]),
      undefined
    );
  });

  it("AC1 路径规则：文件不存在 → E-ATTACH-PATH", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块5 row 4
    assert.deepEqual(
      domain.attachmentsError([{ mimeType: "image/png", size: 1, path: path.join(workdir, "no-such.png") }]),
      { code: "E-ATTACH-PATH", message: "文件不存在" }
    );
  });

  it("AC2 合法数组 → undefined；字段类型异常按对应规则命中", async () => {
    const domain = await loadDomain();

    assert.equal(domain.attachmentsError([validAtt()]), undefined);
    // mimeType 非 string → 类型规则；size 非 number → 大小规则；path 非 string → 路径规则
    assert.equal(domain.attachmentsError([{ mimeType: 1, size: 1, path: imgPath }])?.code, "E-ATTACH-TYPE");
    assert.equal(domain.attachmentsError([{ mimeType: "image/png", size: "big", path: imgPath }])?.code, "E-ATTACH-SIZE");
    assert.equal(domain.attachmentsError([{ mimeType: "image/png", size: 1, path: 42 }])?.code, "E-ATTACH-PATH");
  });

  it("AC3 短路顺序：类型先于数量（同时违反 → E-ATTACH-TYPE）", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §7.1——类型 → 数量 → 大小 → 路径
    const atts = Array.from({ length: 11 }, () => ({ mimeType: "text/plain", size: 1, path: imgPath }));
    assert.equal(domain.attachmentsError(atts)?.code, "E-ATTACH-TYPE");
  });
});
