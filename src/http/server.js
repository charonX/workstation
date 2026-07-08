// HTTP server stub for test-author phase. Implementer will replace with real server.
import http from "node:http";

export function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "NOT_IMPLEMENTED",
        message: `${req.method} ${req.url} not implemented`
      }));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

export function stopServer({ server }) {
  return new Promise((resolve) => server.close(resolve));
}
