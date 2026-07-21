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

function parseIpv6(host) {
  // Expand compressed IPv6 to 8 groups of 16-bit hex.
  const lower = host.toLowerCase();
  let expanded = lower;
  if (lower.includes("::")) {
    const sides = lower.split("::");
    const left = sides[0] ? sides[0].split(":") : [];
    const right = sides[1] ? sides[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    expanded = [...left, ...Array(missing).fill("0"), ...right].join(":");
  }
  const groups = expanded.split(":");
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => {
    const n = parseInt(g, 16);
    return Number.isFinite(n) && n >= 0 && n <= 0xffff ? n : -1;
  });
  if (nums.some((n) => n === -1)) return null;
  return nums;
}

function isPrivateIp(host) {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "0.0.0.0") return true;

  const ip4 = parseIpv4(host);
  if (ip4) {
    const [a, b] = ip4;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  const ip6 = parseIpv6(host);
  if (ip6) {
    // ::1 loopback (and ::/128 all-zeros)
    if (ip6.every((n) => n === 0)) return true;
    if (ip6[0] === 0 && ip6[1] === 0 && ip6[2] === 0 && ip6[3] === 0 && ip6[4] === 0 && ip6[5] === 0 && ip6[6] === 0 && ip6[7] === 1) return true;
    // fe80::/10 link-local
    if ((ip6[0] & 0xffc0) === 0xfe80) return true;
    // fc00::/7 unique local
    if ((ip6[0] & 0xfe00) === 0xfc00) return true;

    // IPv4-mapped IPv6 ::ffff:<ipv4> (also covers ::ffff:0:0/96)
    if (ip6[0] === 0 && ip6[1] === 0 && ip6[2] === 0 && ip6[3] === 0 && ip6[4] === 0 && ip6[5] === 0xffff) {
      const mapped = [ip6[6] >> 8, ip6[6] & 0xff, ip6[7] >> 8, ip6[7] & 0xff];
      if (mapped.some((n) => n < 0 || n > 255)) return false;
      const [a, b] = mapped;
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
    }
  }

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

  // new URL().hostname 对 IPv6 字面量仍保留方括号，需剥离。
  // IPv6 私网范围本期按阻断处理。
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host || isPrivateIp(host)) {
    throw new Error("E-SSRF: private address blocked");
  }

  return true;
}

export const validateUrl = assertPublicUrl;
