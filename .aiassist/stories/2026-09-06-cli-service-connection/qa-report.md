# QA 报告 — 2026-09-06-cli-service-connection

## 1. 验证概况
- **Story ID**：`2026-09-06-cli-service-connection`
- **意图**：本机 CLI 服务连接管理与环境检测（Claude / Codex / Crawl4AI）
- **验证时间**：2026-09-06
- **结论**：**PASS**，所有 10 个需求项均通过严格业务测试验证，全量回归无破坏，可安全进入 `/reflect`。

---

## 2. 单元与接口测试（Unit & API Tests）
- **结果**：PASS
- **业务测试覆盖（7 个套件，36 个测试用例）**：
  1. `api/cliRegistry.test.js`：6/6 passed（内置清单顺序、字段规范与未知 ID 处理）
  2. `api/cliProbe.test.js`：7/7 passed（本机探测、ENOENT 优雅降级、超时 5s、短缓存 60s、并发限流 ≤4、渠道更新检测、网络失败 unknown 降级）
  3. `api/cliServiceConfig.test.js`：7/7 passed（未安装禁止开启 409、全局禁用禁止项目启用 409、超时范围 10-600s、两层启用有效配置、env 正则校验、secretStore 加密与脱敏、全量替换语义）
  4. `api/cliHttpApi.test.js`：5/5 passed（`GET /api/cli-services` 列表与 golden values、`?refresh=1` 强制重探、`PUT /:id` 配置更新与 404/400、`PUT /:id/projects/:pid` 409）
  5. `cli/cliServiceCommand.test.js`：4/4 passed（`list --json`、`probe <id>`、`env set / list` 脱敏保护、`enable <id>` 错误退出码与 stderr 报错）
  6. `api/cliSkillSync.test.js`：3/3 passed（3 个内置 SKILL.md 一次性规范、启用软链收敛与 `listLinkedSkillPaths` 收编、自建同名 Skill 优先保护）
  7. `api/cliExecutionWiring.test.js`：4/4 passed（`policyRules` 出厂规则 ask、项目层未启用 deny 覆盖、`buildConfigMessage` 单点解密快照注入、worker 环境变量安全合并）
- **全量回归测试**：
  - 命令：`npm run test:unit`
  - 结果：**1233 passed / 0 failed**（298 suites, duration ~88.9s）
  - 策略配平：`node scripts/gen-agent-policy.mjs --check` 一致，无漂移（exit 0）
  - 静态检查：`npx oxlint` 0 errors, 0 warnings

---

## 3. E2E 测试（Playwright UI Tests）
- **结果**：PASS
- **命令**：`npx playwright test tests/capabilities/plugin-management/cli-service/2026-09-06-cli-service-connection/e2e/cliServicesPage.test.cjs`
- **用例明细（4/4 passed, 耗时 1.5s）**：
  1. `导航至 /cli-services 页面并展示 3 个内置清单服务行`：PASS
  2. `未安装的条目显示安装指引，且全局启用开关处于禁用（disabled）状态`：PASS
  3. `检测到新版本可用时展示更新提示徽标`：PASS
  4. `点击顶部刷新按钮触发带 ?refresh=1 的重新探测`：PASS
- **Flaky 测试**：0 个，连续多次运行稳定通过。

---

## 4. 运行时浏览器验证
- **状态**：SKIPPED
- **说明**：本 story 属于后台服务与管理区工具管理扩展，用户在 DOMAIN-MODEL 阶段已确认跳过 UX 探索，页面直接仿 `Mcp.jsx` 结构体系，无独立 `ux/` 原型工件。

---

## 5. 需求可追溯性验证清单（Requirements Matrix）

| REQ-ID | 需求名称 | 对应测试 Seam | 验证状态 |
|---|---|---|---|
| REQ-CLI-SERVICE-001 | 内置 CLI 清单注册表与数据结构 | `cliRegistry.test.js` | PASS |
| REQ-CLI-SERVICE-002 | 本机环境实时探测与短缓存 | `cliProbe.test.js` | PASS |
| REQ-CLI-SERVICE-003 | 分发渠道最新版本查询与更新检测 | `cliProbe.test.js` | PASS |
| REQ-CLI-SERVICE-004 | CLI 服务配置持久化与两层启用 | `cliServiceConfig.test.js` + `cliHttpApi.test.js` | PASS |
| REQ-CLI-SERVICE-005 | 环境变量配置加密存储与安全回显 | `cliServiceConfig.test.js` + `cliHttpApi.test.js` | PASS |
| REQ-CLI-SERVICE-006 | CLI 服务管理页列表呈现与交互 | `cliServicesPage.test.cjs` | PASS |
| REQ-CLI-SERVICE-007 | 内置 Skill 自动收敛与项目链接（真 SKILL.md 缝） | `cliSkillSync.test.js` | PASS |
| REQ-CLI-SERVICE-008 | session-config 快照解密注入与 worker 环境变量合并 | `cliExecutionWiring.test.js` | PASS |
| REQ-CLI-SERVICE-009 | 出厂权限策略与项目层覆盖规则静态生成 | `cliExecutionWiring.test.js` | PASS |
| REQ-CLI-SERVICE-010 | 产品 CLI cli-service 命令族 | `cliServiceCommand.test.js` | PASS |

---

## 6. 不稳定测试与缺陷
- **不稳定测试（Flaky）**：无。
- **未闭环缺陷（Open Bugs）**：0 个。

---

## 7. 结论与建议
- [x] **可进入 `/reflect`（无 open bugs，QA 全绿）**
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 建议调用 `/bug`
