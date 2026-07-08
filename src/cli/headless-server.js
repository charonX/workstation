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

function shutdown() {
  cleanup();
  ctx.server.close(() => process.exit(0));
}

function cleanup() {
  unregisterServerRecord(owner);
}
