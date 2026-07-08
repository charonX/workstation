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

const entities = {
  settings,
  project,
  flow,
  schedule,
  task,
  skill,
  dashboard
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
      "opc-workstation skill install --source npm --identifier some-skill",
      "opc-workstation settings set --language zh-CN"
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

  if (!entityName || !entities[entityName]) {
    return fail({ error: "NOT_IMPLEMENTED", message: `Entity not implemented: ${entityName || "(none)"}` }, 1);
  }

  const entity = entities[entityName];
  const handler = action ? entity[action] : (entity.default || entity.stats);

  if (typeof handler !== "function") {
    return fail({ error: "NOT_IMPLEMENTED", message: `Command not implemented: ${rawArgs.join(" ")}` }, 1);
  }

  try {
    const result = await handler(flags);
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
