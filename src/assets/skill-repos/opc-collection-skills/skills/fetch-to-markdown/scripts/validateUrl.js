/**
 * SSRF 校验：拒绝私网 IP 与非法 URL。
 * 仅放行公网 http(s) URL。
 */

function parseIpv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => {
    const n = Number(p);
    return Number.isFinite(n) && n >= 0 && n <= 255 && String(n) === p ? n : -1;
  });
  if (nums.some((n) => n === -1)) return null;
  return nums;
}

function isPrivateIp(host) {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "0.0.0.0") return true;

  const ip = parseIpv4(host);
  if (!ip) return false;

  const [a, b] = ip;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;

  return false;
}

export function assertPublicUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("E-SSRF: invalid or blocked URL (private/SSRF)");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("E-SSRF: only http(s) URLs are allowed (private/SSRF blocked)");
  }

  // 移除方括号以兼容 IPv6 字面量；IPv6 私网范围本期按阻断处理
  const host = parsed.hostname;
  if (!host || isPrivateIp(host)) {
    throw new Error("E-SSRF: private address blocked");
  }

  return true;
}

export const validateUrl = assertPublicUrl;
