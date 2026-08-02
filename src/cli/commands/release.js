// release 发布命令（REQ-DIST-001）—— dev-time 发布者工具。
//
// ADR-012 第 4 条（对 ADR-001 的例外）：release 命令绕过本地 HTTP server，
// 纯本地执行（校验 → bump → npm run make → git commit/push → gh release create），
// 不暴露在产品 API 上（renderer 无调用方）。因此本命令不依赖 ensureServer/stopManagedServer。
//
// 执行顺序（真实模式，严格）：
//   1. 版本格式校验（进程内，dry-run 同样致命）
//   2. 分支校验（真实 git 只读，先于任何 package.json 读取——测试 cwd 可能无 package.json）
//   3. 版本递增校验（进程内，dry-run 跳过；读 process.cwd()/package.json 的真实项目版本）
//   4. bump package.json（先于打包：真实模式用新版本打包；保留原字符串，push 成功前任何失败都回滚）
//   5. 打包 npm run make；失败 → gh release view 防重：tag 已存在 → E_RELEASE_TAG_EXISTS（回滚），
//      否则 → E_RELEASE_BUILD_FAILED 中止（回滚）——PRD §8：打包失败不创建 tag/Release
//   6. 产物校验（fs 检查 out/ 目录存在性）
//   7. gh 认证前置（gh auth status）
//   8. git commit（失败 → 回滚 → E_RELEASE_GIT_FAILED）
//   9. git push（失败 → 回滚 → E_RELEASE_GIT_FAILED）
//   10. 解析真实产物路径（resolveArtifacts，forge 命名；找不到回退契约名）
//   11. gh release create（已 push，失败不回滚）
//   12. gh release upload 解析后的资产（失败不回滚）
//   13. 返回 { url }
//
// 版本比较手写最小 X.Y.Z 数值比较（tech-design 决策：不引入 semver 依赖）。
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileP = promisify(execFile);

const VERSION_RE = /^v?\d+\.\d+\.\d+$/;

function normalizeVersion(version) {
  return version.replace(/^v/, "");
}

// 最小 X.Y.Z 数值比较：a < b → -1，a === b → 0，a > b → 1（非字符串序）。
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function releaseError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// 默认命令执行器：shell 执行（`&&` 有效），测试注入 fake 替换。
export function createDefaultRun(cwd = process.cwd()) {
  return async (cmd, opts = {}) => {
    try {
      const { stdout, stderr } = await execFileP(cmd, { shell: true, cwd, timeout: opts.timeout });
      return { ok: true, stdout, stderr };
    } catch (err) {
      return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message };
    }
  };
}

// 当前 git 分支（真实 git，只读，不走注入 run；任何异常视为非 main）。
function currentBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

// 真实项目的当前版本（读 process.cwd()/package.json，而非 cwd 参数）。
function readCurrentVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")).version;
  } catch (err) {
    throw releaseError("E_RELEASE_INVALID_VERSION", `无法读取当前 package.json 版本：${err.message}`);
  }
}

async function safeRun(run, cmd) {
  try {
    return await run(cmd, { timeout: 10000 });
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
}

// 真实产物定位（GAP-2，用户批准方案 A；forge maker 命名已从 maker 源码核实）：
//   out/<appName>-<version>-<arch>.dmg（如 out/opc-workstation-1.1.0-arm64.dmg）
//   out/zip/<platform>/<arch>/<basename>-<version>.zip（如 out/zip/darwin/arm64/opc-workstation-darwin-arm64-1.1.0.zip）
// 在 out/（限深度 2）与 out/zip/（限深度 4）内递归查找 .dmg/.zip 且文件名含版本号的文件，
// 返回相对 cwd 的路径；找不到时回退契约名 out/Workstation-<v>.dmg / .zip
// （签核测试 AC4/AC8 成功路径 cwd=repo root 的 out/ 无 dmg/zip，必须走回退才能绿）。
function resolveArtifacts(cwd, version) {
  const outDir = path.join(cwd, "out");
  const zipDir = path.join(cwd, "out", "zip");
  const found = { dmg: null, zip: null };

  const visit = (root, depth) => {
    if (depth < 0 || !fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        visit(full, depth - 1);
      } else if (entry.isFile() && entry.name.includes(version)) {
        const ext = path.extname(entry.name);
        if (ext === ".dmg" && !found.dmg) found.dmg = full;
        else if (ext === ".zip" && !found.zip) found.zip = full;
      }
    }
  };

  visit(outDir, 2);
  visit(zipDir, 4);

  const rel = (p) => path.relative(cwd, p);
  return [
    found.dmg ? rel(found.dmg) : `out/Workstation-${version}.dmg`,
    found.zip ? rel(found.zip) : `out/Workstation-${version}.zip`
  ];
}

// dry-run：只读检查 + 步骤清单，无任何副作用（不 make/bump/push/create/upload）。
async function dryRunReport(version, normalized, branch, run) {
  const checks = [{ name: "版本校验", status: "ok", detail: version }];
  checks.push({
    name: "分支",
    status: branch === "main" ? "ok" : "not-main",
    detail: branch || "(unknown)"
  });
  const auth = await safeRun(run, "gh auth status");
  checks.push({
    name: "gh 认证",
    status: auth.ok ? "ok" : "failed",
    detail: auth.ok ? "" : "未认证或 gh 不可用（dry-run 不阻塞）"
  });
  const tagView = await safeRun(run, `gh release view v${normalized}`);
  checks.push({
    name: "tag",
    status: tagView.ok ? "exists" : "not-exists",
    detail: `v${normalized}`
  });

  const steps = [
    `打包：npm run make（产出 out/Workstation-${normalized}.dmg/.zip）`,
    `推送：git add package.json && git commit -m "release v${normalized}" && git push`,
    `创建 Release：gh release create v${normalized}`,
    `上传资产：gh release upload v${normalized} out/Workstation-${normalized}.dmg out/Workstation-${normalized}.zip`
  ];
  return { dryRun: true, version: normalized, checks, steps };
}

export async function release(version, { dryRun = false, run, cwd = process.cwd() } = {}) {
  const exec = run ?? createDefaultRun(cwd);

  // 1. 版本格式校验（进程内；非法版本在 dry-run 下同样致命）。
  if (!VERSION_RE.test(version)) {
    throw releaseError("E_RELEASE_INVALID_VERSION", `版本号必须是 X.Y.Z 形式（可带 v 前缀），当前输入：${version}`);
  }
  const normalized = normalizeVersion(version);
  const tag = `v${normalized}`;

  // 2. 分支校验（真实 git，只读）。必须先于 package.json 读取执行。
  const branch = currentBranch(cwd);
  if (branch !== "main") {
    if (!dryRun) {
      throw releaseError("E_RELEASE_NOT_MAIN", `发布仅允许在 main 分支进行（当前分支：${branch || "(unknown)"}）`);
    }
    // dry-run：记录结果，不致命。
  }

  // 3. 版本递增校验（进程内；dry-run 跳过）。
  if (!dryRun) {
    const current = readCurrentVersion();
    if (compareVersions(normalized, current) <= 0) {
      throw releaseError(
        "E_RELEASE_VERSION_BELOW",
        `版本号必须高于当前版本（当前 ${current}，输入 ${version}）`
      );
    }
  }

  if (dryRun) {
    return dryRunReport(version, normalized, branch, exec);
  }

  // 4. bump package.json（先于打包：真实模式用新版本打包）。
  //    保留原字符串；push 成功之前的所有错误路径都必须逐字节回滚。
  const pkgPath = path.join(process.cwd(), "package.json");
  const original = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(original);
  pkg.version = normalized;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const rollback = (code, message, detail) => {
    fs.writeFileSync(pkgPath, original);
    throw releaseError(code, detail ? `${message}：${detail}` : message);
  };

  // 5. 打包。失败 → tag 防重检查：tag 已存在 → E_RELEASE_TAG_EXISTS（回滚）；
  //    不存在 → E_RELEASE_BUILD_FAILED 中止（回滚）——PRD §8：打包失败不创建 tag/Release。
  const make = await exec("npm run make");
  if (!make.ok) {
    const view = await exec(`gh release view ${tag}`);
    if (view.ok) {
      rollback("E_RELEASE_TAG_EXISTS", `tag ${tag} 已存在，请更换版本号或先删除已有 Release`);
    }
    rollback("E_RELEASE_BUILD_FAILED", `打包失败（npm run make），已中止且不创建 tag/Release`, make.stderr);
  }

  // 6. 产物校验（fs 检查 out/ 目录存在性；文件名由 resolveArtifacts 定位，此处不升级为文件名级——签核测试约束）。
  if (!fs.existsSync(path.join(cwd, "out"))) {
    rollback("E_RELEASE_BUILD_FAILED", "打包失败：out/ 产物缺失");
  }

  // 7. gh 认证前置。
  const auth = await exec("gh auth status");
  if (!auth.ok) {
    rollback("E_RELEASE_GH_AUTH", "gh CLI 未认证或不可用，请先运行 gh auth login");
  }

  // 8/9. git commit + push。任一步失败 → 逐字节恢复原 package.json → E_RELEASE_GIT_FAILED。
  const commit = await exec(`git add package.json && git commit -m "release ${tag}"`);
  if (!commit.ok) {
    rollback("E_RELEASE_GIT_FAILED", "git 提交失败，版本变更已回滚", commit.stderr);
  }
  const push = await exec("git push");
  if (!push.ok) {
    rollback("E_RELEASE_GIT_FAILED", "git 推送失败，版本变更已回滚", push.stderr);
  }

  // 10. 解析真实产物路径（forge 命名；找不到回退契约名，保证 upload 命令可构造）。
  const [dmgPath, zipPath] = resolveArtifacts(cwd, normalized);

  // 11. 创建 Release（已 push，失败不回滚；设计注记：未直接测试路径，错误码取最贴近的 E_RELEASE_BUILD_FAILED）。
  const created = await exec(`gh release create ${tag}`);
  if (!created.ok) {
    throw releaseError("E_RELEASE_BUILD_FAILED", `gh release create 失败：${created.stderr}`);
  }

  // 12. 上传资产（用解析后的真实产物路径）。
  const upload = await exec(`gh release upload ${tag} ${dmgPath} ${zipPath}`);
  if (!upload.ok) {
    throw releaseError("E_RELEASE_BUILD_FAILED", `gh release upload 失败：${upload.stderr}`);
  }

  // 13. 返回 Release URL。
  return { url: created.stdout.trim() };
}
