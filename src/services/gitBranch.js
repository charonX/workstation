// src/services/gitBranch.js
// git 分支读取（REQ-AGENT-056 标准 3 / REQ-AGENT-058 标准 2；主进程侧）。
//
// 参考 pi footer-data-provider 语义（research/pi-usage-token-git.md 实证）：
// - 从 dir 向上逐级找 .git（项目目录可能是仓库根的子目录）；
// - 普通仓库：.git 为目录 → 读 .git/HEAD；
// - worktree 支持：.git 为文件（"gitdir: <path>"）→ 读指向的 gitdir/HEAD
//   （worktree 的 HEAD 是 per-worktree 的，分支判定同源）；
// - HEAD 内容 `ref: refs/heads/<name>` → { state: "branch", branch: <name> }；
//   其他内容（如 detached 时的 commit hash）→ { state: "detached" }；
// - 无 .git / 读取失败 → { state: "none" }。
//
// 零 git 子进程依赖（HEAD 直读，不 spawn git）；与图片白名单同源（主进程单一
// 权威，项目目录边界一致——tech-design 增量 v0.3 关键决策「git 读取位置」）。

import fs from "node:fs";
import path from "node:path";

/**
 * 从 dir 向上找到 .git 的 HEAD 文件绝对路径；非仓库 → null。
 * 同时支持普通仓库（.git 目录）与 worktree（.git 文件指向 gitdir）。
 */
export function findGitHeadPath(dir) {
  let current = dir;
  for (;;) {
    const gitPath = path.join(current, ".git");
    let stat = null;
    try {
      stat = fs.statSync(gitPath);
    } catch {
      // 不存在 → 向上一级继续。
    }
    if (stat) {
      try {
        if (stat.isFile()) {
          // worktree：`.git` 为 `gitdir: <path>` 文件 → HEAD 在指向的 gitdir 下
          // （commondir 仅影响共享元数据；per-worktree 的 HEAD 分支判定无需解析）。
          const content = fs.readFileSync(gitPath, "utf8").trim();
          if (content.startsWith("gitdir: ")) {
            const gitDir = path.resolve(current, content.slice("gitdir: ".length).trim());
            const headPath = path.join(gitDir, "HEAD");
            if (fs.existsSync(headPath)) return headPath;
          }
          return null;
        }
        if (stat.isDirectory()) {
          const headPath = path.join(gitPath, "HEAD");
          if (fs.existsSync(headPath)) return headPath;
          return null;
        }
      } catch {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 读目录所属 git 仓库的当前分支三态：
 * - { state: "branch", branch }：正常分支（HEAD = `ref: refs/heads/<name>`）；
 * - { state: "detached" }：分离 HEAD（HEAD 为 commit hash 等非 ref 内容）；
 * - { state: "none" }：非仓库 / 读取失败。
 */
export function readGitBranch(dir) {
  const headPath = findGitHeadPath(dir);
  if (!headPath) return { state: "none" };
  let head;
  try {
    head = fs.readFileSync(headPath, "utf8").trim();
  } catch {
    return { state: "none" };
  }
  const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  if (m) return { state: "branch", branch: m[1] };
  return { state: "detached" };
}
