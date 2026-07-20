import { startServer } from "../http/server.js";
import { unregisterServerRecord, readServerInfoRaw, takeoverExistingServer } from "../serverRegistry.js";

const owner = String(process.env.OPC_SERVER_OWNER || process.ppid || process.pid);

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function maybeTakeoverExistingServer() {
  const records = readServerInfoRaw();
  for (const record of records) {
    if (record.owner !== owner) continue;
    if (record.pid === process.pid) continue;
    if (!record.port || !isProcessAlive(record.pid)) continue;
    await takeoverExistingServer({ port: record.port, pid: record.pid, timeoutMs: 5000 });
  }
}

await maybeTakeoverExistingServer();
const ctx = await startServer({ reset: false, owner });

// Once the HTTP server closes for any reason (including a remote shutdown request),
// clean up the registry and exit the headless process.
ctx.server.on("close", () => {
  cleanup();
  process.exit(0);
});

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
