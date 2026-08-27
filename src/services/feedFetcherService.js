import { get as getSource, resolveSourceFeedUrl } from "./contentSourceService.js";

function parseError(message, code = "E-FEED-PARSE-FAILED", status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function cleanCdataAndEntities(str) {
  if (typeof str !== "string") return "";
  let text = str.trim();
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  text = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return text.trim();
}

function extractTag(xml, tagNames) {
  const tags = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const tag of tags) {
    const regex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, "i");
    const match = xml.match(regex);
    if (match && match[1] !== undefined) {
      return cleanCdataAndEntities(match[1]);
    }
  }
  return "";
}

function extractLink(xml) {
  // Try <link href="..."/> format (Atom style)
  const hrefMatch = xml.match(/<(?:[a-zA-Z0-9_-]+:)?link[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  if (hrefMatch && hrefMatch[1]) {
    return hrefMatch[1].trim();
  }
  // Try <link>...</link> format (RSS style)
  return extractTag(xml, ["link"]);
}

function extractAuthor(xml) {
  // Try <author><name>...</name></author>
  const authorBlockMatch = xml.match(/<author[^>]*>([\s\S]*?)<\/author>/i);
  if (authorBlockMatch) {
    const name = extractTag(authorBlockMatch[1], ["name"]);
    if (name) return name;
    return cleanCdataAndEntities(authorBlockMatch[1]);
  }
  return extractTag(xml, ["author", "creator"]);
}

function normalizeDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch {
    // Ignore date parse errors
  }
  return dateStr;
}

export function parseFeedXml(xmlText) {
  if (typeof xmlText !== "string" || xmlText.trim().length === 0) {
    throw parseError("Feed XML 内容为空");
  }

  const trimmed = xmlText.trim();
  const isRss = /<rss[\s>]/i.test(trimmed) || /<channel[\s>]/i.test(trimmed);
  const isAtom = /<feed[\s>]/i.test(trimmed);

  if (!isRss && !isAtom) {
    throw parseError("订阅源返回格式无效，非合法 RSS 或 Atom 规范");
  }

  const items = [];

  if (isRss) {
    const itemMatches = trimmed.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    for (const itemXml of itemMatches) {
      const title = extractTag(itemXml, ["title"]);
      const link = extractLink(itemXml);
      const pubDate = normalizeDate(extractTag(itemXml, ["pubDate", "date", "published", "updated"]));
      const content = extractTag(itemXml, ["encoded", "description", "summary", "content"]);
      const author = extractAuthor(itemXml);

      items.push({
        title: title || "无标题",
        link: link || "",
        pubDate: pubDate || new Date().toISOString(),
        content: content || "",
        author: author || ""
      });
    }
  } else if (isAtom) {
    const entryMatches = trimmed.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const entryXml of entryMatches) {
      const title = extractTag(entryXml, ["title"]);
      const link = extractLink(entryXml);
      const pubDate = normalizeDate(extractTag(entryXml, ["updated", "published", "date"]));
      const content = extractTag(entryXml, ["content", "summary", "description"]);
      const author = extractAuthor(entryXml);

      items.push({
        title: title || "无标题",
        link: link || "",
        pubDate: pubDate || new Date().toISOString(),
        content: content || "",
        author: author || ""
      });
    }
  }

  return items;
}

export async function fetchFeed(url, { accessKey } = {}) {
  if (!url || typeof url !== "string") {
    throw parseError("URL 不能为空", "E-FEED-URL-INVALID");
  }

  const headers = {
    "User-Agent": "OPC-Workstation/0.2.0 (FeedFetcher)",
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*"
  };

  if (accessKey && typeof accessKey === "string" && accessKey.trim() !== "") {
    headers["Authorization"] = `Bearer ${accessKey.trim()}`;
  }

  let resp;
  try {
    resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(25000)
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.message?.includes("aborted due to timeout")) {
      throw parseError("抓取请求超时（超过 25 秒），请检查目标源或 RSSHub 实例是否可正常访问上游平台", "E-FEED-TIMEOUT", 504);
    }
    throw parseError(`抓取失败: ${err.message}`, "E-FEED-NETWORK-FAILED", 500);
  }

  if (!resp.ok) {
    throw parseError(`订阅源响应异常 (HTTP ${resp.status})`, `HTTP_${resp.status}`, resp.status);
  }

  const text = await resp.text();
  const items = parseFeedXml(text);

  return {
    ok: true,
    count: items.length,
    items
  };
}

export async function fetchContentSource(sourceId) {
  const source = getSource(sourceId);
  if (!source) {
    throw parseError("内容源不存在", "E-SRC-NOT-FOUND", 404);
  }

  const resolved = resolveSourceFeedUrl(source);
  try {
    return await fetchFeed(resolved.url, { accessKey: resolved.accessKey });
  } catch (err) {
    if (err.code === "E-FEED-TIMEOUT" || err.status === 504) {
      if (source.type === "bilibili") {
        err.message = "抓取超时（超过 25 秒）：B 站对服务器请求启用了反爬拦截。提示：请在自建 RSSHub 服务端环境变量（docker-compose 或 .env）中配置 BILIBILI_COOKIE（填入 SESSDATA 与 bili_jct）以解除访问限制。";
      } else if (source.type === "x") {
        err.message = "抓取超时（超过 25 秒）：X/Twitter 接口响应超时。提示：请检查自建 RSSHub 服务端的 Twitter 访问凭据/Cookies 配置及外网代理。";
      } else if (source.type === "wechat") {
        err.message = "抓取超时（超过 25 秒）：微信公众号服务响应超时。提示：请检查自建 RSSHub 端的微信数据源插件配置。";
      }
    }
    throw err;
  }
}
