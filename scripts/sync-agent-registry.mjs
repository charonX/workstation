#!/usr/bin/env node
// Syncs src/services/agentRegistry.json from the pinned vercel-labs/skills
// upstream agent registry (src/agents.ts). Build-time tool only — the runtime
// never calls the upstream library (ADR-011).
//
// Mechanism (tech-design D3 / "Registry 快照机制"):
//   1. Obtain upstream agents.ts (pinned GitHub raw tag, or --source <file>).
//   2. Evaluate it under a sentinel environment matrix: HOME=/sentinel/home
//      plus one run per whitelisted env var set to a unique sentinel value.
//      TypeScript is executed via Node's native type stripping (node >= 22.18),
//      so no bundler is needed; `import type` lines are erased, which is why
//      src/types.ts is never required at evaluation time. The only runtime
//      dependency of agents.ts, xdg-basedir, is shimmed in a temp node_modules
//      mirroring xdg-basedir@5.1.0 semantics exactly (see XDG_SHIM below).
//   3. Diff the evaluated globalSkillsDir values across cells to derive the
//      template form (`~` for the home dir) and the per-agent env whitelist
//      (globalEnvDeps). An env var is only accepted when it cleanly replaces
//      the leading home-rooted segment (upstream pattern:
//      `process.env.V?.trim() || join(home, '.x')`); any other shape aborts
//      the sync for human review.
//   4. Write the snapshot only after every check passes. Any failure exits
//      non-zero and leaves the existing snapshot untouched.
//
// Usage:
//   node scripts/sync-agent-registry.mjs                 # fetch pinned upstream
//   node scripts/sync-agent-registry.mjs --source <file> # evaluate a local agents.ts (no network)
//   node scripts/sync-agent-registry.mjs --version <v>   # override recorded upstream version
//
// Requires node >= 22.18 (unflagged TypeScript type stripping) and a POSIX
// HOME-driven homedir (macOS/Linux build machines).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PINNED_UPSTREAM_VERSION = "1.5.20";
const UPSTREAM_AGENTS_URL = `https://raw.githubusercontent.com/vercel-labs/skills/v${PINNED_UPSTREAM_VERSION}/src/agents.ts`;
const SNAPSHOT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/services/agentRegistry.json"
);

const SENTINEL_HOME = "/sentinel/home";
const ENV_SENTINEL_PREFIX = "/sentinel/env/";

// Whitelisted env vars the upstream registry reads (research §5). XDG_CONFIG_HOME
// reaches the values through the xdg-basedir shim; the rest are read directly.
const ENV_WHITELIST = [
  "XDG_CONFIG_HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "VIBE_HOME",
  "HERMES_HOME",
  "AUTOHAND_HOME",
  "GROK_HOME",
  "APPDATA",
  "FLATPAK_XDG_CONFIG_HOME",
];

// Mirrors xdg-basedir@5.1.0 (the only runtime import of upstream agents.ts).
// agents.ts uses `xdgConfig ?? join(home, '.config')`; the shim must therefore
// resolve to env.XDG_CONFIG_HOME || join(homedir(), '.config').
const XDG_SHIM_PACKAGE = JSON.stringify({
  name: "xdg-basedir",
  version: "5.1.0",
  type: "module",
  main: "index.js",
  exports: "./index.js",
});
const XDG_SHIM_INDEX = `import os from 'node:os';
import path from 'node:path';

const homeDirectory = os.homedir();
const { env } = process;

export const xdgConfig = env.XDG_CONFIG_HOME ||
  (homeDirectory ? path.join(homeDirectory, '.config') : undefined);
`;

function fail(message) {
  console.error(`sync-agent-registry: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { source: null, version: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source") {
      args.source = argv[++i];
    } else if (argv[i] === "--version") {
      args.version = argv[++i];
    } else {
      fail(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

async function obtainUpstreamSource(sourceFile) {
  if (sourceFile) {
    try {
      return fs.readFileSync(sourceFile, "utf-8");
    } catch (err) {
      fail(`cannot read --source file ${sourceFile}: ${err.message}`);
    }
  }
  let res;
  try {
    res = await fetch(UPSTREAM_AGENTS_URL);
  } catch (err) {
    fail(`cannot fetch pinned upstream ${UPSTREAM_AGENTS_URL}: ${err.message}`);
  }
  if (!res.ok) {
    fail(`cannot fetch pinned upstream ${UPSTREAM_AGENTS_URL}: HTTP ${res.status}`);
  }
  return res.text();
}

// Evaluates agents.ts inside a child process whose environment is fully
// controlled: HOME points at the sentinel home, every whitelisted env var is
// removed, and `extraEnv` applies the current matrix cell. Returns a map of
// agent key -> { name, displayName, skillsDir, globalSkillsDir(string|null) }.
function evaluateAgents(agentsUrl, extraEnv) {
  const evalSource = `const mod = await import(${JSON.stringify(agentsUrl)});
const out = {};
for (const [key, cfg] of Object.entries(mod.agents)) {
  out[key] = {
    name: cfg.name,
    displayName: cfg.displayName,
    skillsDir: cfg.skillsDir,
    globalSkillsDir: cfg.globalSkillsDir === undefined ? null : cfg.globalSkillsDir,
  };
}
process.stdout.write(JSON.stringify(out));
`;
  const env = { ...process.env, HOME: SENTINEL_HOME };
  delete env.NODE_OPTIONS;
  for (const name of ENV_WHITELIST) delete env[name];
  Object.assign(env, extraEnv);
  let out;
  try {
    out = execFileSync(process.execPath, ["--input-type=module", "-e", evalSource], {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // execFileSync's message already carries the command output (parse errors included).
    fail(`upstream evaluation failed (env ${JSON.stringify(extraEnv)}): ${err.message}`);
  }
  try {
    return JSON.parse(out);
  } catch (err) {
    fail(`upstream evaluation returned malformed output: ${err.message}`);
  }
  return null; // unreachable
}

// Derives { globalSkillsDir(template|null), globalEnvDeps } for one agent from
// the sentinel matrix. Fails loudly on any shape the derivation cannot express
// (tech-design: 提取失败 → 非零退出，不生成半成品).
function deriveTemplate(key, baseline, cells) {
  const baseVal = baseline[key].globalSkillsDir;
  const deps = ENV_WHITELIST.filter(
    (name) => cells[name][key] && cells[name][key].globalSkillsDir !== baseVal
  );
  if (baseVal === null) {
    if (deps.length > 0) {
      fail(`${key}: globalSkillsDir is undefined at baseline but env ${deps.join(",")} defines it — unsupported shape`);
    }
    return { globalSkillsDir: null, globalEnvDeps: [] };
  }
  const template = baseVal.startsWith(SENTINEL_HOME)
    ? `~${baseVal.slice(SENTINEL_HOME.length)}`
    : baseVal;
  for (const name of deps) {
    const cellVal = cells[name][key].globalSkillsDir;
    const sentinelEnv = `${ENV_SENTINEL_PREFIX}${name}`;
    if (typeof cellVal !== "string" || !cellVal.startsWith(sentinelEnv)) {
      fail(`${key}: env ${name} effect is not a clean config-root replacement (got ${cellVal})`);
    }
    const suffix = cellVal.slice(sentinelEnv.length);
    if (!baseVal.endsWith(suffix)) {
      fail(`${key}: env ${name} changes more than the leading root segment`);
    }
    const replacedPrefix = baseVal.slice(0, baseVal.length - suffix.length);
    if (!replacedPrefix.startsWith(`${SENTINEL_HOME}/`)) {
      fail(`${key}: env ${name} replaces a non-home-rooted prefix — human review needed`);
    }
    const rel = replacedPrefix.slice(SENTINEL_HOME.length + 1);
    if (rel === "" || rel.includes("/")) {
      fail(`${key}: env ${name} replaces a multi-segment root (${rel}) — human review needed`);
    }
  }
  return { globalSkillsDir: template, globalEnvDeps: deps };
}

function validateEntry(key, entry) {
  if (!/^[a-z0-9-]+$/.test(entry.name) || entry.name !== key) {
    fail(`agent key/name must be kebab-case and match: ${key} vs ${entry.name}`);
  }
  if (!entry.displayName) fail(`${key}: displayName is required`);
  if (!entry.skillsDir || path.isAbsolute(entry.skillsDir) || entry.skillsDir.includes("~")) {
    fail(`${key}: skillsDir must be a project-relative path without ~: ${entry.skillsDir}`);
  }
  if (entry.globalSkillsDir !== null && entry.globalSkillsDir.includes("~") && !entry.globalSkillsDir.startsWith("~")) {
    fail(`${key}: template ~ may only appear at the start: ${entry.globalSkillsDir}`);
  }
}

function printDiff(previous, next) {
  if (!previous) {
    console.log("sync-agent-registry: no previous snapshot; full snapshot written");
    return;
  }
  const prevByName = new Map(previous.agents.map((a) => [a.name, a]));
  const nextByName = new Map(next.agents.map((a) => [a.name, a]));
  const added = next.agents.filter((a) => !prevByName.has(a.name)).map((a) => a.name);
  const removed = previous.agents.filter((a) => !nextByName.has(a.name)).map((a) => a.name);
  const changed = next.agents
    .filter((a) => prevByName.has(a.name) && JSON.stringify(prevByName.get(a.name)) !== JSON.stringify(a))
    .map((a) => a.name);
  console.log(
    `sync-agent-registry: diff vs previous — added [${added.join(", ")}], removed [${removed.join(", ")}], changed [${changed.join(", ")}]`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version ?? (args.source ? "unknown-source" : PINNED_UPSTREAM_VERSION);
  const source = await obtainUpstreamSource(args.source);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-agent-sync-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "agents.ts"), source);
    const shimDir = path.join(tmpDir, "node_modules", "xdg-basedir");
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(path.join(shimDir, "package.json"), XDG_SHIM_PACKAGE);
    fs.writeFileSync(path.join(shimDir, "index.js"), XDG_SHIM_INDEX);

    const agentsUrl = pathToFileURL(path.join(tmpDir, "agents.ts")).href;
    const cells = { baseline: evaluateAgents(agentsUrl, {}) };
    for (const name of ENV_WHITELIST) {
      cells[name] = evaluateAgents(agentsUrl, { [name]: `${ENV_SENTINEL_PREFIX}${name}` });
    }

    const baseline = cells.baseline;
    const keys = Object.keys(baseline).sort();
    if (keys.length === 0) fail("upstream agents table is empty");

    const agents = keys.map((key) => {
      const entry = baseline[key];
      const { globalSkillsDir, globalEnvDeps } = deriveTemplate(key, baseline, cells);
      const snapshotEntry = {
        name: entry.name,
        displayName: entry.displayName,
        skillsDir: entry.skillsDir,
        globalSkillsDir,
        globalEnvDeps,
        universal: entry.skillsDir === ".agents/skills",
      };
      validateEntry(key, snapshotEntry);
      return snapshotEntry;
    });

    const snapshot = {
      version,
      syncedAt: new Date().toISOString().slice(0, 10),
      agents,
    };

    let previous = null;
    try {
      previous = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8"));
    } catch {
      // No previous snapshot (first run) — nothing to diff against.
    }
    // Write only after every evaluation and validation above has passed; any
    // failure exits non-zero before this point and preserves the old snapshot.
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
    printDiff(previous, snapshot);
    console.log(`sync-agent-registry: wrote ${agents.length} agents (upstream ${version}) -> ${SNAPSHOT_PATH}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err.message));
