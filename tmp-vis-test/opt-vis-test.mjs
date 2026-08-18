import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<select data-testid="s"><option value="a">Alpha</option><option value="b">Beta</option></select>`);
const opt = page.locator("[data-testid='s'] option").filter({ hasText: /beta/i }).first();
console.log("visible(closed select):", await opt.isVisible());
console.log("count:", await page.locator("[data-testid='s'] option").count());
// with size attribute
await page.setContent(`<select data-testid="s" size="4"><option value="a">Alpha</option><option value="b">Beta</option></select>`);
console.log("visible(size=4):", await (page.locator("[data-testid='s'] option").filter({hasText:/beta/i}).first()).isVisible());
await browser.close();
