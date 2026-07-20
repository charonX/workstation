// 测试夹具：fake 飞书开放平台 server（HTTP API 侧）。
// 支撑 REQ-CHANNEL-001/002/003/005、REQ-COLL-001/002 的通道集成测试。
//
// 这是测试基础设施（非产品代码）。已实现的部分：记录所有收到的请求、
// token 签发、消息 send/reply、docx convert/create/permission 三类端点、
// 凭据有效性开关、按端点注入失败。
//
// TODO(BUILD)：tech-design 风险表「WSClient domain 可指向 fake server」spike 成功后，
// 在本夹具上补 WS 长连接侧（接收 SDK 建连、向 adapter 推送 im.message.receive_v1 帧）。
// spike 失败则维持 adapter 接口 mock seam，本夹具仅覆盖 REST 侧。

import http from "node:http";

/**
 * 启动 fake 飞书 server。
 *
 * @param {object} [options]
 * @param {boolean} [options.credentialsValid=true] false 时 token 端点返回凭据无效（code=99991663），用于 E-CHANNEL-CRED 分支。
 * @returns {Promise<{
 *   port: number,
 *   baseUrl: string,
 *   received: {
 *     tokenRequests: Array<object>,
 *     sends: Array<{query: string, body: object}>,
 *     replies: Array<{messageId: string, body: object}>,
 *     docxConverts: Array<object>,
 *     docxCreates: Array<object>,
 *     permissionPatches: Array<{token: string, body: object}>,
 *     injectedMessages: Array<object>
 *   },
 *   setCredentialsValid: (valid: boolean) => void,
 *   failNext: (endpointPrefix: string, times?: number) => void,
 *   injectMessage: (message: object) => void,
 *   onInject: (cb: (message: object) => void) => void,
 *   stop: () => Promise<void>
 * }>}
 */
export async function startFakeFeishuServer(options = {}) {
  let credentialsValid = options.credentialsValid !== false;

  const received = {
    tokenRequests: [],
    sends: [],
    replies: [],
    docxConverts: [],
    docxCreates: [],
    permissionPatches: [],
    injectedMessages: []
  };

  // endpoint 前缀 -> 剩余失败次数
  const failures = new Map();
  const injectListeners = new Set();
  let messageSeq = 0;
  let docSeq = 0;

  function shouldFail(pathname) {
    // 最长前缀优先：/documents/blocks/convert 与 /documents 共存时各管各的。
    const matches = [...failures.entries()]
      .filter(([prefix, remaining]) => pathname.startsWith(prefix) && remaining > 0)
      .sort((a, b) => b[0].length - a[0].length);
    if (matches.length === 0) return false;
    const [prefix, remaining] = matches[0];
    failures.set(prefix, remaining - 1);
    return true;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;

    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = { _unparsed: raw }; }

      res.setHeader("Content-Type", "application/json");

      if (shouldFail(pathname)) {
        res.writeHead(500);
        res.end(JSON.stringify({ code: 500, msg: "fake feishu injected failure" }));
        return;
      }

      // 测试侧注入通道：模拟飞书云 → adapter 的入向消息（WS 帧的 HTTP 替身）。
      if (pathname === "/__inject" && req.method === "POST") {
        received.injectedMessages.push(body);
        for (const cb of injectListeners) {
          try { cb(body); } catch { /* 监听器错误不影响夹具 */ }
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (pathname === "/open-apis/auth/v3/tenant_access_token/internal" && req.method === "POST") {
        received.tokenRequests.push(body);
        if (!credentialsValid) {
          // 飞书凭据无效错误码（app_id/app_secret 不匹配）。
          res.writeHead(200);
          res.end(JSON.stringify({ code: 99991663, msg: "app access token invalid" }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "fake-tenant-token", expire: 7200 }));
        return;
      }

      if (pathname === "/open-apis/im/v1/messages" && req.method === "POST") {
        received.sends.push({ query: url.search, body });
        messageSeq += 1;
        res.writeHead(200);
        res.end(JSON.stringify({ code: 0, msg: "success", data: { message_id: `om_fake_${messageSeq}` } }));
        return;
      }

      const replyMatch = pathname.match(/^\/open-apis\/im\/v1\/messages\/([^/]+)\/reply$/);
      if (replyMatch && req.method === "POST") {
        received.replies.push({ messageId: replyMatch[1], body });
        messageSeq += 1;
        res.writeHead(200);
        res.end(JSON.stringify({ code: 0, msg: "success", data: { message_id: `om_fake_reply_${messageSeq}` } }));
        return;
      }

      if (pathname === "/open-apis/docx/v1/documents/blocks/convert" && req.method === "POST") {
        received.docxConverts.push(body);
        res.writeHead(200);
        res.end(JSON.stringify({ code: 0, msg: "ok", data: { blocks: [{ block_id: "fake_block_1" }] } }));
        return;
      }

      if (pathname === "/open-apis/docx/v1/documents" && req.method === "POST") {
        received.docxCreates.push(body);
        docSeq += 1;
        res.writeHead(200);
        res.end(JSON.stringify({
          code: 0,
          msg: "ok",
          data: { document: { document_id: `doc_fake_${docSeq}`, title: body.title || "" } }
        }));
        return;
      }

      const permMatch = pathname.match(/^\/open-apis\/drive\/v1\/permissions\/([^/]+)\/public$/);
      if (permMatch && req.method === "PATCH") {
        received.permissionPatches.push({ token: permMatch[1], body });
        res.writeHead(200);
        res.end(JSON.stringify({ code: 0, msg: "ok" }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ code: 404, msg: `fake feishu: no route for ${req.method} ${pathname}` }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    received,
    setCredentialsValid(valid) { credentialsValid = valid; },
    /**
     * 让匹配 endpointPrefix 的下 times 次请求返回 500（重试/降级分支用）。
     * 例：failNext("/open-apis/im/v1/messages", 2) → send 连续失败 2 次后恢复。
     */
    failNext(endpointPrefix, times = 1) {
      failures.set(endpointPrefix, (failures.get(endpointPrefix) || 0) + times);
    },
    /** 注入一条入向 IM 消息（im.message.receive_v1 的夹具等价物）。 */
    injectMessage(message) {
      received.injectedMessages.push(message);
      for (const cb of injectListeners) {
        try { cb(message); } catch { /* 同上 */ }
      }
    },
    /** 注册注入消息监听器（adapter WS seam 接通后由测试或 harness 桥接）。 */
    onInject(cb) { injectListeners.add(cb); },
    stop() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
