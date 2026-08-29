#!/usr/bin/env node
import { argv, exit, stderr, stdout } from "node:process";
import { ensureServer, stopManagedServer } from "./server.js";
import * as settings from "./commands/settings.js";
import * as project from "./commands/project.js";
import * as flow from "./commands/flow.js";
import * as schedule from "./commands/schedule.js";
import * as task from "./commands/task.js";
import * as skill from "./commands/skill.js";
import * as dashboard from "./commands/dashboard.js";
import * as notify from "./commands/notify.js";
import * as source from "./commands/source.js";
import * as channel from "./commands/channel.js";
import * as browser from "./commands/browser.js";
import * as plugin from "./commands/plugin.js";
import * as mcp from "./commands/mcp.js";
import { release } from "./commands/release.js";

const entities = {
  settings,
  project,
  flow,
  schedule,
  task,
  skill,
  dashboard,
  notify,
  source,
  channel,
  browser,
  plugin,
  mcp
};

function parseArgs(args) {
  const globalFlags = { pretty: false, json: false, help: false };
  const positional = [];
  const flags = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--pretty") {
      globalFlags.pretty = true;
    } else if (arg === "--json") {
      globalFlags.json = true;
    } else if (arg === "--help" || arg === "-h") {
      globalFlags.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  return { globalFlags, positional, flags };
}

function printHelp() {
  const help = {
    usage: "opc-workstation <entity> <action> [flags]",
    entities: Object.keys(entities),
    globalFlags: ["--json", "--pretty", "--help"],
    examples: [
      "opc-workstation project create --name \"Hot News\" --local-path ~/workspace/hot-news",
      "opc-workstation project list --q hot",
      "opc-workstation flow create --name Fetch --project-id p1",
      "opc-workstation schedule create --project-id p1 --flow-id f1 --cron \"0 8 * * *\"",
      "opc-workstation task run --project-id p1 --flow-id f1",
      "opc-workstation skill install --source git --identifier https://github.com/owner/repo",
      "opc-workstation project skill link <project-id> <slug> <skillName>",
      "opc-workstation settings set --language en-US"
    ]
  };
  return help;
}

async function main() {
  const rawArgs = argv.slice(2);
  const { globalFlags, positional, flags } = parseArgs(rawArgs);

  if (rawArgs.length === 0 || globalFlags.help) {
    output(printHelp(), globalFlags.pretty);
    return exit(0);
  }

  const [entityName, action, ...rest] = positional;

  // release 命令 special-case：`release <version> [--dry-run]` 中 action 位是版本号，
  // 不适用 `<entity> <action>` 分发（release 不是 entities 中的实体）。
  // ADR-012 第 4 条：release 是 dev-time 发布者工具，绕过本地 HTTP server（ADR-001 的例外），
  // 纯本地执行（bump → npm run make → git commit/push → gh release create），
  // 因此不需要 ensureServer / stopManagedServer。
  if (entityName === "release") {
    const version = positional[1];
    if (!version) {
      return fail({ error: "E_RELEASE_INVALID_VERSION", message: "缺少版本参数" }, 1);
    }
    try {
      // run/cwd 不传：release 的默认值即 createDefaultRun(process.cwd()) / process.cwd()，行为一致。
      const result = await release(version, { dryRun: flags["dry-run"] === true });
      output(result, globalFlags.pretty);
    } catch (err) {
      return fail({ error: err.code || "INTERNAL_ERROR", message: err.message }, 1);
    }
    return exit(0);
  }

  if (!entityName || !entities[entityName]) {
    return fail({ error: "NOT_IMPLEMENTED", message: `Entity not implemented: ${entityName || "(none)"}` }, 1);
  }

  const entity = entities[entityName];
  const camelAction = action ? action.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : action;
  const handler = camelAction ? entity[camelAction] : (entity.default || entity.stats);

  if (typeof handler !== "function") {
    return fail({ error: "NOT_IMPLEMENTED", message: `Command not implemented: ${rawArgs.join(" ")}` }, 1);
  }

  try {
    const result = await handler(flags, rest);
    output(result, globalFlags.pretty);
  } catch (err) {
    const status = err.status || 0;
    const isBusinessError = status >= 400 && status < 500;
    const code = isBusinessError ? 1 : 2;
    const data = err.data || { error: "INTERNAL_ERROR", message: err.message };
    return fail(data, code);
  } finally {
    if (!globalFlags["keep-server"]) {
      try {
        await stopManagedServer();
      } catch {
        // Ignore shutdown errors.
      }
    }
  }

  return exit(0);
}

function output(data, pretty) {
  const text = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  stdout.write(text + "\n");
}

function fail(data, code) {
  stderr.write(JSON.stringify(data) + "\n");
  exit(code);
}

main();
