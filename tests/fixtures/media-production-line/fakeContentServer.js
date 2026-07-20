// 测试夹具：fake 内容源 HTTP server（链接速存抓取目标）。
// 支撑 REQ-COLL-002（场景 B 抓取成功/404/超时分支）、REQ-COLL-003（SSRF 反向用例）。
//
// 路由表可在运行时增改；支持固定状态码、响应体与人为延迟（模拟超时）。
// 这是测试基础设施，可完整使用；不是产品代码骨架。

import http from "node:http";

/**
 * @param {object} [routes] 初始路由：{ "/page": {status?: number, body?: string, delayMs?: number} }
 * @returns {Promise<{
 *   port: number,
 *   baseUrl: string,
 *   urlFor: (routePath: string) => string,
 *   setRoute: (routePath: string, route: {status?: number, body?: string, delayMs?: number}) => void,
 *   requestedPaths: string[],
 *   stop: () => Promise<void>
 * }>}
 */
export async function startFakeContentServer(routes = {}) {
  const table = new Map(Object.entries(routes));
  const requestedPaths = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    requestedPaths.push(url.pathname);
    const route = table.get(url.pathname) || { status: 404, body: "fake content: not found" };
    const { status = 200, body = "", delayMs = 0 } = route;

    const respond = () => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    };
    if (delayMs > 0) {
      // 人为延迟：配合抓取侧短超时制造超时分支。
      setTimeout(respond, delayMs);
    } else {
      respond();
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    baseUrl,
    requestedPaths,
    urlFor(routePath) {
      return `${baseUrl}${routePath}`;
    },
    setRoute(routePath, route) {
      table.set(routePath, route);
    },
    stop() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
