#!/usr/bin/env node
// CLI stub for test-author phase. Implementer will replace with real CLI.
import { argv, exit, stderr, stdout } from "node:process";

const args = argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  stdout.write(JSON.stringify({
    usage: "opc-workstation <entity> <action> [flags]",
    entities: ["project", "flow", "schedule", "task", "skill", "settings"],
    globalFlags: ["--json", "--pretty", "--help"]
  }));
  exit(0);
}

stderr.write(JSON.stringify({
  error: "NOT_IMPLEMENTED",
  message: `Command not implemented: ${args.join(" ")}`
}));
exit(1);
