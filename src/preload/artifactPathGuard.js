import fs from "node:fs";
import path from "node:path";

/**
 * Verify that an artifact path stays inside the project root.
 *
 * - projectRoot and artifactPath must be non-empty strings.
 * - Relative artifact paths are resolved against projectRoot.
 * - The resolved path must be equal to, or a child of, projectRoot.
 * - Symbolic links are resolved with fs.realpathSync and must also remain
 *   inside projectRoot.
 * - Any validation error or traversal attempt returns false (no exceptions).
 *
 * @param {string} projectRoot
 * @param {string} artifactPath
 * @returns {boolean}
 */
export function isArtifactPathAllowed(projectRoot, artifactPath) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return false;
  if (typeof artifactPath !== "string" || artifactPath.length === 0) return false;

  try {
    // Normalize the declared project root and resolve it to its real path
    // so symlink comparisons are stable (e.g. /var -> /private/var on macOS).
    const normalizedRoot = path.normalize(projectRoot);
    const realRoot = path.normalize(fs.realpathSync(projectRoot));

    // Resolve the artifact path relative to the project root if needed.
    let resolved;
    if (path.isAbsolute(artifactPath)) {
      resolved = path.normalize(artifactPath);
    } else {
      resolved = path.normalize(path.resolve(normalizedRoot, artifactPath));
    }

    // First-pass check using the declared root allows paths that share the
    // same symlink prefix as projectRoot (e.g. absolute paths under /var/...).
    if (!isInsideOrEqual(resolved, normalizedRoot)) return false;

    // Resolve symlinks when the target exists and re-check against the real
    // root; this blocks link-based escapes while still allowing not-yet-created
    // files.
    try {
      const realResolved = path.normalize(fs.realpathSync(resolved));
      if (!isInsideOrEqual(realResolved, realRoot)) return false;
    } catch (err) {
      if (err.code !== "ENOENT") return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isInsideOrEqual(child, parent) {
  if (child === parent) return true;
  // Ensure the child is a true descendant: parent path followed by a separator.
  // Special-case the filesystem root so that "/" does not become "//".
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(prefix);
}
