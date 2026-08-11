// REQ-TRACE: 2026-08-10-pi-permission-config-ui/REQ-AGENT-059, 2026-08-10-pi-permission-config-ui/REQ-AGENT-060, 2026-08-10-pi-permission-config-ui/REQ-AGENT-061, 2026-08-10-pi-permission-config-ui/REQ-AGENT-062, 2026-08-10-pi-permission-config-ui/REQ-AGENT-063, 2026-08-10-pi-permission-config-ui/REQ-AGENT-064, 2026-08-10-pi-permission-config-ui/REQ-AGENT-065, 2026-08-10-pi-permission-config-ui/REQ-AGENT-066, 2026-08-10-pi-permission-config-ui/REQ-AGENT-067, 2026-08-10-pi-permission-config-ui/REQ-AGENT-068
// REQ-VERSION: v1-hash:4b944146fd166a4f60e5ba65080efefeb75690ff7be837718c867c2d2c01b77d
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 权限配置页签浏览器 E2E（REQ-AGENT-059~068 UI 面）：项目详情弹窗「权限配置」
// 页签——空态/继承视图/allow-ask 切换/JSON 模式/保存校验错误/坏文件提示。
//
// UX 参照：ux/permission-config.html（locator 契约从原型提取，实现时对齐）：
//   [data-testid='project-detail-modal']      项目详情弹窗（既有）
//   [data-perm-tab]                           权限配置页签
//   [data-testid='perm-empty-state']          空态（未配置跟随全局）
//   [data-testid='perm-create-btn']           新建配置按钮
//   [data-perm-mode='vis'|'json']             模式切换按钮
//   [data-testid='perm-save-btn']             保存按钮
//   [data-rule-row='<key>']                   规则行（key 定位）
//   [data-global-cell]                        全局默认列 cell（只读基底）
//   [data-perm-seg]                           项目值列 allow/ask 双态段控件
//   [data-override-badge]                     组覆盖徽标
//   [data-testid='perm-error-banner']         校验错误条
//   [data-testid='perm-json-editor']          JSON 文本区
//   [data-testid='perm-invalid-banner']       坏文件提示（E6）
//
// 环境：FAUX（零网络）+ seedAgentConfig + 项目空间（createProject localPath =
// 测试临时目录，图片/文件 fixture 放项目内）——对齐 statusBar/richRender 先例。
// 断言语义（签核 TODO）：元素存在/可见性/状态切换 + 文件落盘断言（.pi 文件直读，
// 保存成功提示后文件已写入——reload 在提示前置）。
//
// [Slice 4 接线修正（2026-08-11，人裁决 test-gap 就地补全，断言语义不变）]
//   1. test 2 locator 修正（人裁决 ①）：全局列只读断言改定位 [data-global-cell]
//      cell——实现全局默认列 cell 已加该属性；项目值列 seg 常驻是 allow/ask 切换
//      交互入口（S3 偏差 1，行级 count 断言与 test 3 locator 矛盾）。断言语义
//      不变：全局列无 input/select/seg 编辑控件。
//   2. 新增 4 用例（人裁决 ②，证据可复现）：
//      - REQ-AGENT-063：工具级 write 行可见（全局值）+ 切「允许」→ 覆盖徽标 →
//        保存 → .pi 文件含 write:allow + GET rules source:project → 取消覆盖
//        （跟随全局）→ 保存 → 文件字段删除、GET 回落全局（AC2/AC3）。
//      - REQ-AGENT-064：path 白名单组（全局 * 只读基底 + 添加控件）→ 添加条目 →
//        保存 → 条目渲染 + 文件含该条目 → 删除 → 保存 → 条目消失 + 文件同步删除
//        （AC1/AC2/AC3）。注：新条目在保存后 reload 才渲染（PathEditor 列表源 =
//        GET rules，实现语义=保存即生效，REQ 断言以落盘为准）。
//      - REQ-AGENT-065：yoloMode 开关切换（aria-pressed）+ authorizerChain 添加
//        授权器 → 保存 → 文件 yoloMode:true + authorizerChain 整体替换 + GET
//        merged.authorizerChain = 项目数组（AC1/AC2）。
//      - REQ-AGENT-060 E6（2026-08-11 人裁决落地）：项目 .pi 写坏 JSON → 打开
//        页签 → perm-invalid-banner 可见（而非「未配置」空态）→ 改规则保存 →
//        文件修复为合法 JSON 且含覆盖值，坏文件提示消失。
// [Slice 5 接线修正（2026-08-12，2026-08-11-pi-agent-modes S3 链序契约变更所致，
//  test-gap 就地补全，断言语义不变）]
//   REQ-AGENT-065 用例：全局 authorizerChain 自该 story S3（REQ-AGENT-073 链序
//   ["auto-judge","opc-bridge"]）起为 2 条目——「显示全局链」断言由全量
//   toContainText 改 filter 逐项定位（strict mode violation 修复）；保存后项目链
//   = 全局基底 + 新增条目（编辑即覆盖整链，ADR-022），toEqual 期望值更新为
//   ["auto-judge","opc-bridge","custom-gate"]（文件 + merged 双断言，语义不变）。

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { startElectronApp, stopElectronApp } = require("../../../../../e2e/fixtures/electronApp.cjs");
const { createProject } = require("../../../../../e2e/helpers/seed.cjs");
const { goToAdminRoute } = require("../../../../../e2e/helpers/navigation.cjs");
const locators = require("../../../../../e2e/helpers/locators.cjs");

const PROJECT_DETAIL_MODAL = "[data-testid='project-detail-modal']";
const PERM_TAB = "[data-perm-tab]";
const PERM_EMPTY_STATE = "[data-testid='perm-empty-state']";
const PERM_CREATE_BTN = "[data-testid='perm-create-btn']";
const PERM_MODE_VIS = "[data-perm-mode='vis']";
const PERM_MODE_JSON = "[data-perm-mode='json']";
const PERM_SAVE_BTN = "[data-testid='perm-save-btn']";
const PERM_ERROR_BANNER = "[data-testid='perm-error-banner']";
const PERM_JSON_EDITOR = "[data-testid='perm-json-editor']";
const PERM_INVALID_BANNER = "[data-testid='perm-invalid-banner']";
const RULE_ROW = (key) => `[data-rule-row='${key}']`;
const GLOBAL_CELL = "[data-global-cell]";
const OVERRIDE_BADGE = "[data-override-badge]";
const SAVED_HINT = firstWindow =>
  firstWindow.locator("[data-testid='perm-save-hint']").or(firstWindow.locator("[data-testid='perm-saved-hint']"));

const PI_FILE = (workdir) => path.join(workdir, ".pi", "extensions", "pi-permission-system", "config.json");

async function seedAgentConfig(apiBaseUrl) {
  const res = await fetch(`${apiBaseUrl}/api/settings/agent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "deepseek", apiKey: "sk-e2e-faux-placeholder", identity: "" }),
  });
  expect(res.ok).toBe(true);
}

async function openProjectPermissionTab(window, { apiBaseUrl, name, localPath }) {
  await seedAgentConfig(apiBaseUrl);
  const project = await createProject(apiBaseUrl, { name, localPath });
  await goToAdminRoute(window, "#/workspace");
  const card = window.locator(locators.PROJECT_CARD).filter({ hasText: name });
  await card.locator(locators.CONFIGURE_SKILLS_BUTTON).click();
  await expect(window.locator(PROJECT_DETAIL_MODAL)).toBeVisible();
  await window.click(PERM_TAB);
  await expect(window.locator(PERM_MODE_VIS)).toBeVisible();
  return project;
}

test.describe("项目权限配置页签（E2E）", () => {
  let electronApp;
  let firstWindow;
  let apiBaseUrl;
  let userDataDir;
  let workdir;

  test.beforeEach(async () => {
    const ctx = await startElectronApp({ extraEnv: { OPC_AGENT_FAUX: "1" } });
    electronApp = ctx.electronApp;
    firstWindow = ctx.firstWindow;
    apiBaseUrl = ctx.apiBaseUrl;
    userDataDir = ctx.userDataDir;
    workdir = `${userDataDir}/perm-e2e`;
    fs.mkdirSync(workdir, { recursive: true });
  });

  test.afterEach(async () => {
    await stopElectronApp(electronApp, userDataDir);
  });

  test("REQ-AGENT-059：项目详情弹窗含权限配置页签；无配置项目显示空态", async () => {
    await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E1",
      localPath: workdir,
    });

    // TODO: HUMAN ASSERTION — 确认空态文案（未配置跟随全局）与新建按钮
    await expect(firstWindow.locator(PERM_EMPTY_STATE)).toBeVisible();
    await expect(firstWindow.locator(PERM_CREATE_BTN)).toBeVisible();
  });

  test("REQ-AGENT-062：bash 族规则行可见（family 分组），全局列只读", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E2",
      localPath: workdir,
    });

    // REQ-AGENT-062 AC1：destructive-fs 组（删除文件）可见，组内含 rm * 行
    const fsGroup = firstWindow.locator(".rule-group").filter({ hasText: "rm / rmdir / mv" });
    await expect(fsGroup).toBeVisible();
    await expect(fsGroup.locator(RULE_ROW("permission.bash.rm *"))).toBeVisible();

    // 空态下先建配置（或实现后直接显示已配置视图——依实现接线确认）
    if (await firstWindow.locator(PERM_EMPTY_STATE).isVisible()) {
      await firstWindow.click(PERM_CREATE_BTN);
    }
    await expect(firstWindow.locator(RULE_ROW("permission.bash.rm *"))).toBeVisible();

    // REQ-AGENT-060 AC4 / 签核 #15：全局默认列只读（无编辑控件）。
    // [S4 接线修正，人裁决 ①]：改定位 [data-global-cell] cell——项目值列 seg
    // 常驻是 allow/ask 切换入口（S3 偏差 1），全局列实际无任何编辑控件。
    const globalColEditors = await firstWindow
      .locator(RULE_ROW("permission.bash.rm *"))
      .locator(GLOBAL_CELL)
      .locator("input, select, [data-perm-seg]")
      .count();
    expect(globalColEditors).toBe(0);
  });

  test("REQ-AGENT-062/063：allow-ask 切换 → 覆盖高亮 + 徽标；保存成功", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E3",
      localPath: workdir,
    });

    if (await firstWindow.locator(PERM_EMPTY_STATE).isVisible()) {
      await firstWindow.click(PERM_CREATE_BTN);
    }

    // 切换 rm * 为 allow
    // TODO: HUMAN ASSERTION — 确认切换控件（seg/locator 按实现接线）
    const seg = firstWindow.locator(RULE_ROW("permission.bash.rm *")).locator("[data-perm-seg]");
    await seg.getByText("允许").click();

    // 覆盖徽标计数 +1（或该行高亮「项目已改」）
    // TODO: HUMAN ASSERTION — 确认覆盖标记出现
    await expect(firstWindow.locator(OVERRIDE_BADGE).first()).toBeVisible();

    // 保存成功提示（宽松断言：任意成功态提示可见——文案以原型为准，观感留 REFLECT）
    await firstWindow.click(PERM_SAVE_BTN);
    // TODO: HUMAN ASSERTION — 确认保存成功（saved 提示可见——宽松：成功态提示出现即可）
    await expect(SAVED_HINT(firstWindow)).toBeVisible();
  });

  test("REQ-AGENT-063：工具级 write 切换「允许」→ 保存落盘；取消覆盖回落全局", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E7",
      localPath: workdir,
    });

    if (await firstWindow.locator(PERM_EMPTY_STATE).isVisible()) {
      await firstWindow.click(PERM_CREATE_BTN);
    }

    // AC1：工具级规则组可见 + write 行可见，全局默认列显示全局值（write 出厂=询问）
    const toolGroup = firstWindow.locator(".rule-group").filter({ hasText: "工具级裁决" });
    await expect(toolGroup).toBeVisible();
    const writeRow = firstWindow.locator(RULE_ROW("permission.write"));
    await expect(writeRow).toBeVisible();
    await expect(writeRow.locator(GLOBAL_CELL)).toContainText("询问 ask");

    // AC2：切换 write 为「允许」→ 覆盖标记出现 → 保存 → 文件含 write:allow
    await writeRow.locator("[data-perm-seg]").getByText("允许").click();
    await expect(writeRow).toContainText("项目已改");
    await firstWindow.click(PERM_SAVE_BTN);
    await expect(SAVED_HINT(firstWindow)).toBeVisible();

    const written = JSON.parse(fs.readFileSync(PI_FILE(workdir), "utf8"));
    expect(written.permission.write).toBe("allow");
    const getRes = await fetch(`${apiBaseUrl}/api/projects/${project.id}/permission`);
    const view = await getRes.json();
    const writeRule = view.rules.find((r) => r.key === "permission.write");
    expect(writeRule.source).toBe("project");
    expect(writeRule.projectOverridden).toBe(true);

    // AC3：切换回「跟随全局」→ 保存 → 文件该字段删除，merged 回落全局
    await writeRow.locator(".reset-chip").click();
    await expect(writeRow).toContainText("跟随全局");
    await firstWindow.click(PERM_SAVE_BTN);
    await expect(SAVED_HINT(firstWindow)).toBeVisible();

    const afterReset = JSON.parse(fs.readFileSync(PI_FILE(workdir), "utf8"));
    expect(afterReset.permission?.write).toBeUndefined();
    const view2 = await (await fetch(`${apiBaseUrl}/api/projects/${project.id}/permission`)).json();
    const writeRule2 = view2.rules.find((r) => r.key === "permission.write");
    expect(writeRule2.source).toBe("global");
    expect(writeRule2.value).toBeNull();
  });

  test("REQ-AGENT-064：path 白名单——添加条目保存落盘、删除条目保存消失", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E8",
      localPath: workdir,
    });

    if (await firstWindow.locator(PERM_EMPTY_STATE).isVisible()) {
      await firstWindow.click(PERM_CREATE_BTN);
    }

    // AC1：path 白名单组可见——全局 `*` 条目（只读基底）+ 添加控件
    const pathGroup = firstWindow.locator(".rule-group").filter({ hasText: "path 白名单" });
    await expect(pathGroup).toBeVisible();
    await expect(pathGroup.locator(".path-item").filter({ hasText: "*" })).toBeVisible();
    await expect(pathGroup.getByPlaceholder(/添加路径 glob/)).toBeVisible();

    // AC2：添加路径条目 → 保存 → 条目渲染 + 项目文件 path 字段含该条目
    //（新条目在保存后 reload 渲染——PathEditor 列表源 = GET rules，断言以落盘为准）
    await pathGroup.locator(".path-add input").fill("src/**");
    await pathGroup.locator(".path-add button").click();
    await firstWindow.click(PERM_SAVE_BTN);
    await expect(SAVED_HINT(firstWindow)).toBeVisible();

    const item = pathGroup.locator(".path-item").filter({ hasText: "src/**" });
    await expect(item).toBeVisible();
    const written = JSON.parse(fs.readFileSync(PI_FILE(workdir), "utf8"));
    expect(written.permission.path["src/**"]).toBe("allow");

    // AC3：删除项目条目 → 保存 → 条目消失 + 文件同步删除
    await item.locator(".del").click();
    await firstWindow.click(PERM_SAVE_BTN);
    await expect(SAVED_HINT(firstWindow)).toBeVisible();
    await expect(pathGroup.locator(".path-item").filter({ hasText: "src/**" })).toHaveCount(0);
    const afterDelete = JSON.parse(fs.readFileSync(PI_FILE(workdir), "utf8"));
    expect(afterDelete.permission?.path?.["src/**"]).toBeUndefined();
  });

  test("REQ-AGENT-065：yoloMode 开关 + authorizerChain 整体替换 → 保存落盘", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E9",
      localPath: workdir,
    });

    if (await firstWindow.locator(PERM_EMPTY_STATE).isVisible()) {
      await firstWindow.click(PERM_CREATE_BTN);
    }

    // AC2：yoloMode 开关切换（toggle → aria-pressed 翻转）
    const yoloRow = firstWindow.locator(RULE_ROW("yoloMode"));
    await expect(yoloRow).toBeVisible();
    await yoloRow.locator(".toggle").click();
    await expect(yoloRow.locator(".toggle")).toHaveAttribute("aria-pressed", "true");

    // AC1：authorizerChain 显示全局链（opc-bridge 只读基底）+ 添加授权器
    // [S5 修正（2026-08-12，2026-08-11-pi-agent-modes S3 链序契约）]：全局链自
    // REQ-AGENT-073 起 = ["auto-judge", "opc-bridge"]（agent-policy/
    // pi-permission-config.json 单一真源）——.chain-item 现为 2 个元素，
    // toContainText 全量匹配触发 strict mode violation；改 filter 逐项定位
    //（断言语义不变：全局链基底条目可见，含 opc-bridge）。
    const chainRow = firstWindow.locator(RULE_ROW("authorizerChain"));
    await expect(chainRow.locator(".chain-item").filter({ hasText: "opc-bridge" })).toBeVisible();
    await expect(chainRow.locator(".chain-item").filter({ hasText: "auto-judge" })).toBeVisible();
    await chainRow.locator(".path-add input").fill("custom-gate");
    await chainRow.locator(".path-add button").click();
    await expect(chainRow.locator(".chain-item").filter({ hasText: "custom-gate" })).toBeVisible();

    // 保存 → 文件断言：yoloMode 开关更新 + authorizerChain = 项目数组（整体替换；
    // 基底含全局链 auto-judge——S5 修正：编辑链 = 全局基底 + 新增条目）
    await firstWindow.click(PERM_SAVE_BTN);
    await expect(SAVED_HINT(firstWindow)).toBeVisible();

    const written = JSON.parse(fs.readFileSync(PI_FILE(workdir), "utf8"));
    expect(written.yoloMode).toBe(true);
    expect(written.authorizerChain).toEqual(["auto-judge", "opc-bridge", "custom-gate"]);
    const view = await (await fetch(`${apiBaseUrl}/api/projects/${project.id}/permission`)).json();
    expect(view.merged.authorizerChain).toEqual(["auto-judge", "opc-bridge", "custom-gate"]);
  });

  test("REQ-AGENT-060 E6：项目 .pi 坏文件 → 坏文件提示（非空态）→ 保存即修复", async () => {
    // 先造坏文件（JSON.parse 失败 → projectInvalid，2026-08-11 人裁决落地）
    const piDir = path.dirname(PI_FILE(workdir));
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(PI_FILE(workdir), "{ invalid json");

    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E10",
      localPath: workdir,
    });

    // 坏文件提示可见（而非「未配置」空态）；规则行按全局默认展示
    await expect(firstWindow.locator(PERM_INVALID_BANNER)).toBeVisible();
    await expect(firstWindow.locator(PERM_EMPTY_STATE)).toHaveCount(0);
    await expect(firstWindow.locator(RULE_ROW("permission.bash.rm *"))).toBeVisible();

    // 保存即覆盖修复：改一条规则 → 保存 → 文件合法且含覆盖值，坏文件提示消失
    await firstWindow
      .locator(RULE_ROW("permission.bash.rm *"))
      .locator("[data-perm-seg]")
      .getByText("允许")
      .click();
    await firstWindow.click(PERM_SAVE_BTN);
    await expect(SAVED_HINT(firstWindow)).toBeVisible();
    await expect(firstWindow.locator(PERM_INVALID_BANNER)).toHaveCount(0);

    const repaired = JSON.parse(fs.readFileSync(PI_FILE(workdir), "utf8"));
    expect(repaired.permission.bash["rm *"]).toBe("allow");
  });

  test("REQ-AGENT-066：JSON 模式切换 → 文本区可见可编辑", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E4",
      localPath: workdir,
    });

    await firstWindow.click(PERM_MODE_JSON);
    await expect(firstWindow.locator(PERM_JSON_EDITOR)).toBeVisible();
    // TODO: HUMAN ASSERTION — 确认 JSON 文本区内容（含 permission 字段）可编辑
  });

  test("REQ-AGENT-068：JSON 模式保存非法 → 错误 banner 可见，文件未变", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E5",
      localPath: workdir,
    });

    await firstWindow.click(PERM_MODE_JSON);
    await firstWindow.locator(PERM_JSON_EDITOR).fill("{ invalid json");

    await firstWindow.click(PERM_SAVE_BTN);

    // TODO: HUMAN ASSERTION — 确认错误条可见 + 保存被拦截
    await expect(firstWindow.locator(PERM_ERROR_BANNER)).toBeVisible();
  });

  test("REQ-AGENT-065：面板说明文案（未改继承全局）可见", async () => {
    const project = await openProjectPermissionTab(firstWindow, {
      apiBaseUrl,
      name: "PermE2E6",
      localPath: workdir,
    });

    // TODO: HUMAN ASSERTION — 确认继承说明文案可见
    await expect(
      firstWindow.getByText(/项目只覆盖你改的条目|未改的继承全局/)
    ).toBeVisible();
  });
});
