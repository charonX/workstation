#!/usr/bin/env node
/**
 * 一键导入 BestBlogs 文章类 RSS 订阅源到 opc-workstation 内容源。
 * 数据来源： https://github.com/ginobefun/BestBlogs/blob/main/BestBlogs_RSS_Articles.opml
 *
 * 使用方式：
 *   node scripts/import-bestblogs-articles.mjs
 *
 * 行为：
 * - 抓取 OPML 并解析 <outline text="..." xmlUrl="..." />
 * - 每个 outline 创建一个 type=rss 的内容源
 * - name 使用 text 属性，tags 固定为 ["BestBlogs"]
 * - 遇到同名已存在源（E-SRC-DUP）自动跳过
 * - 创建结束后停止由 ensureServer 启动的托管 server
 */

import { ensureServer, stopManagedServer } from "../src/cli/server.js";

const OPML_URL =
  "https://raw.githubusercontent.com/ginobefun/BestBlogs/main/BestBlogs_RSS_Articles.opml";
const TAG = "BestBlogs";

function parseOutlines(opml) {
  const outlines = [];
  const re = /<outline\b([^>]*)>/g;
  let m;
  while ((m = re.exec(opml)) !== null) {
    const attrs = m[1];
    const textMatch = /text="([^"]*)"/.exec(attrs);
    const urlMatch = /xmlUrl="([^"]*)"/.exec(attrs);
    if (textMatch && urlMatch) {
      outlines.push({
        name: textMatch[1].trim(),
        url: urlMatch[1].trim(),
      });
    }
  }
  return outlines;
}

function sanitizeName(name) {
  // 内容源 name 限制 1-64 字符，直接截断并去除首尾空白。
  return name.trim().slice(0, 64);
}

async function main() {
  console.log(`Fetching OPML: ${OPML_URL}`);
  const opmlRes = await fetch(OPML_URL);
  if (!opmlRes.ok) {
    throw new Error(`Failed to fetch OPML: ${opmlRes.status} ${opmlRes.statusText}`);
  }
  const opml = await opmlRes.text();
  const outlines = parseOutlines(opml);
  console.log(`Parsed ${outlines.length} RSS outlines.`);

  const server = await ensureServer();
  console.log(`Using server at ${server.baseUrl}`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, outline] of outlines.entries()) {
    const name = sanitizeName(outline.name);
    const config = outline.url;

    try {
      const res = await fetch(`${server.baseUrl}/api/content-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: "rss", config, tags: [TAG] }),
      });
      if (res.status === 201) {
        created++;
      } else if (res.status === 409) {
        skipped++;
      } else {
        const data = await res.json().catch(() => ({}));
        console.error(
          `[${index + 1}/${outlines.length}] Failed: ${name} (${data.error || res.status})`
        );
        failed++;
      }
    } catch (err) {
      console.error(`[${index + 1}/${outlines.length}] Error: ${name} — ${err.message}`);
      failed++;
    }
  }

  console.log("\nImport summary:");
  console.log(`  Total:   ${outlines.length}`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);

  await stopManagedServer();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
