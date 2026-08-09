// fetch 黑洞注入缝（agentModelResolveLocal.test.js 专用）：
// 经 node --import 注入真实 worker 子进程，拦截全局 fetch——
// 命中 pi.dev 远程模型目录请求 → 记录到 OPC_TEST_FETCH_LOG 指定文件并永不 resolve
// （模拟本机 pi.dev 黑洞：TCP 通、零字节响应）；其余请求原样放行。
// BUG-001 根因实证：pi.dev 不可达时该请求无 signal/超时兜底，靠 undici
// headersTimeout 300s 才解脱——本缝把「等 300s」换成「永久悬挂 + 留痕」，
// 使回归测试确定性复现（不依赖真实网络状态）。
const logFile = process.env.OPC_TEST_FETCH_LOG;
if (logFile) {
  const { appendFileSync } = await import("node:fs");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    const href = String(url);
    if (href.includes("pi.dev")) {
      try {
        appendFileSync(logFile, href + "\n");
      } catch { /* noop */ }
      return new Promise(() => {}); // 黑洞：永不 resolve/reject
    }
    return originalFetch(url, options);
  };
}
