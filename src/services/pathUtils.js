import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Shared filesystem path helpers for service modules. These are deliberately
// free of service-level concerns (settings, registry) so any service can use
// them without import cycles.

export function expandTilde(inputPath) {
  if (typeof inputPath !== "string") return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

// Resolve symlinks as far as possible even when the path (or its tail) does
// not exist yet. /tmp-style symlinked prefixes (macOS /var -> /private/var)
// must not defeat prefix/containment checks.
export function realpathBestEffort(targetPath) {
  let current = targetPath;
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  try {
    return path.join(fs.realpathSync(current), ...missing);
  } catch {
    return targetPath;
  }
}

// Case-normalized comparison base (macOS/Windows case-insensitive volumes).
export function comparisonKey(targetPath) {
  return realpathBestEffort(targetPath).toLowerCase();
}

export function isInsideOrEqual(candidate, base) {
  return candidate === base || candidate.startsWith(base + path.sep);
}
