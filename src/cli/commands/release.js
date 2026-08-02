// release 发布命令（REQ-DIST-001）—— dev-time 发布者工具。
//
// ADR-012 第 4 条（对 ADR-001 的例外）：release 命令绕过本地 HTTP server，
// 纯本地执行（bump → npm run make → git commit/push → gh release create），
// 不暴露在产品 API 上（renderer 无调用方）。因此本命令不依赖 ensureServer/stopManagedServer。
//
// 执行顺序（严格）：
//   1. 版本格式校验（进程内，dry-run 同样致命）
//   2. 分支校验（真实 git 只读，先于任何 package.json 读取——测试 cwd 可能无 package.json）
//   3. 版本递增校验（进程内，dry-run 跳过；读 process.cwd()/package.json 的真实项目版本）
//   4. 打包 npm run make（结果记录，失败不致命，由第 5/6 步决定）
//   5. tag 防重（仅当 make 失败时执行 gh release view）
//   6. 产物校验（fs 检查 out/ 目录存在性）
//   7. gh 认证前置（gh auth status）
//   8. bump package.json（保留原字符串用于回滚）
//   9. git commit + push（任一步失败 → 逐字节回滚 package.json）
//   10. gh release create
//   11. gh release upload 资产
//   12. 返回 { url }
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

  // 4. 打包。结果记录，失败不致命——由第 5/6 步决定中止与否。
  const make = await exec("npm run make");

  // 5. tag 防重（仅当 make 失败时执行）。
  if (!make.ok) {
    const view = await exec(`gh release view ${tag}`);
    if (view.ok) {
      throw releaseError("E_RELEASE_TAG_EXISTS", `tag ${tag} 已存在，请更换版本号或先删除已有 Release`);
    }
  }

  // 6. 产物校验（fs 检查 out/ 目录存在性；文件名由 forge make 配置保证）。
  if (!fs.existsSync(path.join(cwd, "out"))) {
    throw releaseError("E_RELEASE_BUILD_FAILED", "打包失败：out/ 产物缺失");
  }

  // 7. gh 认证前置。
  const auth = await exec("gh auth status");
  if (!auth.ok) {
    throw releaseError("E_RELEASE_GH_AUTH", "gh CLI 未认证或不可用，请先运行 gh auth login");
  }

  // 8. bump package.json（保留原字符串用于失败回滚）。
  const pkgPath = path.join(process.cwd(), "package.json");
  const original = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(original);
  pkg.version = normalized;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // 9. git commit + push。任一步失败 → 逐字节恢复原 package.json → E_RELEASE_GIT_FAILED。
  const commit = await exec(`git add package.json && git commit -m "release ${tag}"`);
  if (!commit.ok) {
    fs.writeFileSync(pkgPath, original);
    throw releaseError("E_RELEASE_GIT_FAILED", `git 提交失败，版本变更已回滚：${commit.stderr}`);
  }
  const push = await exec("git push");
  if (!push.ok) {
    fs.writeFileSync(pkgPath, original);
    throw releaseError("E_RELEASE_GIT_FAILED", `git 推送失败，版本变更已回滚：${push.stderr}`);
  }

  // 10. 创建 Release（设计注记：未直接测试路径，错误码取最贴近的 E_RELEASE_BUILD_FAILED）。
  const created = await exec(`gh release create ${tag}`);
  if (!created.ok) {
    throw releaseError("E_RELEASE_BUILD_FAILED", `gh release create 失败：${created.stderr}`);
  }

  // 11. 上传资产。
  const upload = await exec(
    `gh release upload ${tag} out/Workstation-${normalized}.dmg out/Workstation-${normalized}.zip`
  );
  if (!upload.ok) {
    throw releaseError("E_RELEASE_BUILD_FAILED", `gh release upload 失败：${upload.stderr}`);
  }

  // 12. 返回 Release URL。
  return { url: created.stdout.trim() };
}
