// 双区导航辅助（2026-08-06 T-8 适配，2026-08-02-ui-copilot）。
//
// 背景：REQ-AGENT-026 AC1（已签核）将应用默认落地切到会话区 #/assistant——管理区
// 左导（nav-settings 等）与顶栏（topbar-*）只在管理区壳（screen-admin，ADR-018
// 双区模型）内存在。既有 E2E 套件「启动后直接点击管理区导航/断言初始管理页」的
// 用例全部红（tech-design 风险表已预警；红因 = 启动落地，非管理区壳改动）。
//
// 适配方式（照 builtin-agent 先例「导航适配，断言语义不变」）：测试内直接 goto
// 目标旧路由（hash 路由）——ADR-018：直接访问旧路由以管理区壳呈现、页面本体
// 不变（assistantNav AC5 已验证）。断言语义一律不改。
//
// @param {import('@playwright/test').Page} page   Electron firstWindow
// @param {string} route  hash 路由（含前导 #，如 "#/settings" / "#/flows"）
module.exports = {
  async goToAdminRoute(page, route) {
    const base = page.url().split("#")[0];
    await page.goto(`${base}${route}`);
  },
};
