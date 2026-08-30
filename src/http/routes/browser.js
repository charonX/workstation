// src/http/routes/browser.js
// 浏览器面板 HTTP 端点（REQ-BROWSER-001/003/005，ADR-039；story 2026-08-24-embedded-browser）：
// worker 工具面（toolAdapter，Slice 2 接入）与渲染进程地址栏共用的真实边界（ADR-001 通道）。
// 端点（server.js 剥掉 /api/ 后 resource="browser"，subPath 形如 ["navigate"]/["cookies"]）：
//   - POST /api/browser/navigate   {url, expand?} → {ok,url,title} / {ok:false,error:{code,reason}}
//     （source 由通道决定、忽略请求体：HTTP 面一律 "agent"——security review 2026-08-30：
//     信任请求体 source 会让本机任意进程以 source:"user" 解除 agentControlRevoked，
//     削弱「一键停止控制」刹车语义；user 来源只来自渲染进程 IPC，main.js
//     opc-browser-navigate handler 固定 source:"user"）
//   - POST /api/browser/read       {} → {ok,url,title,text,elements,truncated}
//   - POST /api/browser/scroll     {dx?,dy?} → {ok,scrollX,scrollY}
//   - GET|POST /api/browser/screenshot {} → {ok,path,width,height}
//   - GET  /api/browser/state      — → {ok,open,url,title,agentControl,agentControlRevoked,crashed}
//   - POST /api/browser/control    {action:"stop-agent-control"} → {ok,agentControlRevoked}
//   - POST /api/browser/bounds     {x,y,width,height,visible} → {ok,open}
//   - GET|DELETE /api/browser/cookies?domain=&name= → {ok,domain,cookieString,cookies} / {ok,deletedCount}
// 错误码契约（PRD §8）：E-BROWSER-BAD-URL / E-BROWSER-DENIED / E-BROWSER-NAV-FAILED /
// E-BROWSER-NOT-READY / E-BROWSER-CRASHED / E-BROWSER-BAD-DOMAIN——一律 HTTP 200 + ok:false
// （业务错误语义，对齐工具面 JSON 回执先例；仅未知异常走 500 INTERNAL_ERROR）。
// 日志脱敏收口（REQ-BROWSER-005 标准 7）：本路由层不落任何 cookie 值/cookieString 日志；
// cookieString 明文只存在于 HTTP 响应体（ADR-001 单机通道），值类日志一律 NAME=<redacted>。

export async function handleBrowser(req, res, body, subPath = [], context = {}) {
  const { getBrowserViewManager } = context;
  const manager = getBrowserViewManager?.();
  if (!manager) return notFound(res);

  const action = subPath[0];

  try {
    if (action === "navigate" && req.method === "POST") {
      // source 由通道决定（见文件头）：HTTP 面忽略请求体 source，一律按 agent 处理
      return ok(res, await manager.navigate({
        url: body?.url,
        source: "agent",
        expand: body?.expand === true,
      }));
    }

    if (action === "read" && req.method === "POST") {
      return ok(res, await manager.read({ source: "agent" }));
    }

    if (action === "scroll" && req.method === "POST") {
      return ok(res, await manager.scroll({
        source: "agent",
        dx: Number(body?.dx) || 0,
        dy: Number(body?.dy) || 0,
      }));
    }

    if (action === "screenshot" && (req.method === "GET" || req.method === "POST")) {
      return ok(res, await manager.screenshot({ source: "agent" }));
    }

    if (action === "state" && req.method === "GET") {
      return ok(res, manager.getState());
    }

    if (action === "control" && req.method === "POST") {
      if (body?.action !== "stop-agent-control") {
        return ok(res, { ok: false, error: { code: "E-BROWSER-BAD-ACTION" } });
      }
      return ok(res, manager.stopAgentControl());
    }

    if (action === "bounds" && req.method === "POST") {
      return ok(res, manager.setBounds({
        x: Number(body?.x) || 0,
        y: Number(body?.y) || 0,
        width: Number(body?.width) || 0,
        height: Number(body?.height) || 0,
        visible: body?.visible !== false,
      }));
    }

    if (action === "cookies" && (req.method === "GET" || req.method === "DELETE")) {
      // 查询串为真源（body 在 GET 下为空对象；DELETE 同走 query）
      const q = req.url ? new URL(req.url, "http://localhost") : null;
      const domain = q?.searchParams.get("domain") ?? "";
      const name = q?.searchParams.get("name") ?? undefined;
      if (req.method === "GET") {
        return ok(res, await manager.getCookies({ domain, name: name || undefined }));
      }
      return ok(res, await manager.deleteCookies({ domain }));
    }

    // dev/test-only seam：业务测试经 HTTP 种分区 Cookie（测试文件注释约定「实现提供测试
    // seam（分区 session.cookies.set）」，PRD §10.4 接口4 测试留白）。仅 NODE_ENV=test 可达，
    // 其余环境 404——生产不开 Cookie 写入面（REQ-BROWSER-005 安全边界：凭据唯一来源=面板内真实登录）。
    if (action === "_test" && subPath[1] === "seed-cookies" && req.method === "POST") {
      if (process.env.NODE_ENV !== "test") return notFound(res);
      return ok(res, await manager._seedCookiesForTest(body));
    }

    return notFound(res);
  } catch (err) {
    // 业务错误（带契约 code）→ 200 + {ok:false, error:{code, reason}}（工具面回执同构）
    if (err?.code && String(err.code).startsWith("E-BROWSER-")) {
      const error = { code: err.code };
      if (err.reason) error.reason = err.reason;
      return ok(res, { ok: false, error });
    }
    throw err; // 未知异常上抛 → server.js 500 兜底
  }
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
}
