import { startServer } from "../http/server.js";
import { registerServerRecord, unregisterServerRecord } from "./server.js";

const owner = process.env.OPC_SERVER_OWNER || process.ppid || process.pid;

const ctx = await startServer({ reset: false });
const port = ctx.server.address().port;
const pid = process.pid;

registerServerRecord(port, pid, owner);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", cleanup);

// Exit when the parent/owner process goes away so headless servers do not
// accumulate across test runs.
function watchOwner() {
  if (!owner) return;
  const interval = setInterval(() => {
    try {
      process.kill(Number(owner), 0);
    } catch {
      clearInterval(interval);
      shutdown();
    }
  }, 3000);
}
watchOwner();

function shutdown() {
  cleanup();
  ctx.server.close(() => process.exit(0));
}

function cleanup() {
  unregisterServerRecord(owner);
}
