// 主进程更新服务（REQ-DIST-002）：查询 GitHub 最新 release 并与当前版本比较。
//
// 纯 Node 模块，禁止 import electron——单元测试在无 Electron 环境直接 import 本模块。
// 导出：
//   checkForUpdates({ fetchImpl, getVersion, repo }) -> Promise<{
//     currentVersion, latestVersion|null, hasUpdate, error:{code,message}|null
//   }>
//   compareVersions(a, b) -> -1 | 0 | 1   （X.Y.Z 数值比较，非字符串序）
//
// 错误码契约：E_UPDATE_NO_RELEASE（仓库无 release）/ E_UPDATE_PARSE（tag 解析失败）
//             / E_UPDATE_CHECK_NETWORK（fetch 失败/超时）

// 匹配 GitHub release tag（可带 v 前缀），捕获组 1 = 规范化版本号。
const TAG_VERSION_RE = /^v?(\d+\.\d+\.\d+)$/;
// compareVersions 输入必须是纯 X.Y.Z（不带 v 前缀）。
const VERSION_RE = /^\d+\.\d+\.\d+$/;

// 检查更新请求超时（ms）。E2E 契约：点击检查更新后状态区 15 秒内必须出现结果。
const FETCH_TIMEOUT_MS = 5000;

const E_UPDATE_NO_RELEASE = "E_UPDATE_NO_RELEASE";
const E_UPDATE_PARSE = "E_UPDATE_PARSE";
const E_UPDATE_CHECK_NETWORK = "E_UPDATE_CHECK_NETWORK";

/**
 * 比较两个 X.Y.Z 版本号（数值比较，非字符串序）。
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1} a < b 为 -1；输入非法时返回 0（安全默认）。
 */
export function compareVersions(a, b) {
  const av = String(a);
  const bv = String(b);
  if (!VERSION_RE.test(av) || !VERSION_RE.test(bv)) return 0;
  const pa = av.split(".").map(Number);
  const pb = bv.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/**
 * 查询 GitHub 最新 release 并与当前版本比较（REQ-DIST-002）。
 *
 * 永不向上抛异常：网络失败/解析失败均以 error 字段返回，保证启动静默检查
 * 与服务层调用方（IPC handler）无需 try/catch。
 *
 * @param {object} options
 * @param {Function} options.fetchImpl - 注入的 fetch 实现（测试 stub；默认 fetch）。
 * @param {() => string} options.getVersion - 返回当前应用版本（不规范化）。
 * @param {{owner: string, repo: string}} options.repo - 仓库 owner/repo（由调用方解析）。
 * @returns {Promise<{currentVersion: string, latestVersion: string|null, hasUpdate: boolean, error: {code: string, message: string}|null}>}
 */
export async function checkForUpdates({ fetchImpl, getVersion, repo }) {
  const currentVersion = getVersion();
  try {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      // 仓库无 release（GitHub API 对无 release 仓库返回 404）
      return {
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        error: { code: E_UPDATE_NO_RELEASE, message: "仓库暂无发布版本" },
      };
    }
    const body = await res.json();
    const tagName = String(body?.tag_name ?? "");
    const match = TAG_VERSION_RE.exec(tagName);
    if (!match) {
      // tag 无法解析为版本（如 "nightly-build"）
      return {
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        error: { code: E_UPDATE_PARSE, message: `无法解析最新版本号：${tagName}` },
      };
    }
    const latestVersion = match[1];
    return {
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      error: null,
    };
  } catch (err) {
    // 网络失败/超时/响应解析失败：绝不向上抛
    return {
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      error: { code: E_UPDATE_CHECK_NETWORK, message: `检查更新失败：${err?.message ?? String(err)}` },
    };
  }
}
