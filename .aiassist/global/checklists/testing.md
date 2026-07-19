# 测试模式检查清单

loop-workflow 中测试是契约。本清单用于 `/test-author`、`/tdd` 和 `/review --stage=code` 的 test-engineer 维度。

## 测试分层

- [ ] 小型测试（~80%）：纯逻辑、无 I/O、毫秒级
- [ ] 中型测试（~15%）：跨边界（API、DB、文件系统）、localhost
- [ ] 大型测试（~5%）：关键用户流程、E2E、性能基准

## 每个 REQ 的测试要求

- [ ] 每个 REQ-ID 至少有一个自动化测试
- [ ] 测试文件头部有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`
- [ ] 测试按 `tests/capabilities/<capability>/<entity>/<story-id>/` 组织
- [ ] 关键预期值来自人/真实 JSON/已签标准，而非代码输出
- [ ] 边界/错误 case 已覆盖
- [ ] 无 `// TODO: HUMAN ASSERTION` 占位

## 测试结构

- [ ] 使用 Arrange-Act-Assert
- [ ] 测试名是句子，描述行为：`user can create project with valid name`
- [ ] 一个概念一个测试，不堆叠断言
- [ ] DAMP over DRY：测试可读性优先于避免重复

## 测试替身

按优先级选择：

1. 真实实现（最高置信度）
2. Fake（内存版依赖）
3. Stub（返回固定数据）
4. Mock（验证调用，谨慎使用）

只在边界处 mock：外部 API、数据库、文件系统、邮件发送等。

## 前端测试

- [ ] 组件测试覆盖关键元素存在性
- [ ] 交互状态变化（loading/empty/error/success/disabled）有测试
- [ ] 导航/路由跳转有测试
- [ ] 数据绑定正确渲染有测试
- [ ] 删除/重命名 UI 元素时，同步检查并更新引用它的 E2E 测试与 locators
- [ ] 纯视觉审美判断才留给 REFLECT 人工验收

## Playwright E2E

- [ ] `playwright.config.ts` 已配置 `baseURL`、`retries`、`workers`、`trace`、`screenshot`
- [ ] 测试使用 locator（`getByRole`、`getByTestId`、`getByLabel`）而非裸 CSS selector
- [ ] 文案定位必须限定在目标容器内，避免跨组件匹配（如 `palette.getByText("Execution")`）
- [ ] 每个 E2E 测试只验证一个用户流程/概念
- [ ] 测试数据已隔离（独立用户/fixture/数据库重置）
- [ ] API 调用已用 `page.route` 或真实后端隔离
- [ ] CI 中已安装 Playwright 浏览器二进制
- [ ] 失败时自动生成 trace 和 screenshot 并作为产物上传
- [ ] E2E 数量符合测试金字塔（E2E 占比 ~5%，只覆盖关键路径）

## 桌面应用 / Electron 测试

- [ ] 修改 main 进程代码后，集成测试/E2E 前确认应用已重启，renderer HMR 不代表主进程已更新
- [ ] 文件系统副作用（symlink、目录、文件写入）在 API 测试中断言实际路径与状态
- [ ] 删除实体时同步断言相关文件/链接已被清理
- [ ] main 进程与 renderer 的边界用 Playwright Electron E2E 或 renderer public API 覆盖

## 反模式

| 反模式 | 问题 | 修复 |
|---|---|---|
| 测试实现细节 | 重构后行为未变但测试失败 | 测输入输出 |
| 滥用 snapshot | 没人 review diff | 断言具体值 |
| 共享可变状态 | 测试互相污染 | 每个测试独立 setup/teardown |
| 全 mock | 测试通过但生产崩溃 | 优先真实实现/Fake |
| 跳过测试让 CI 通过 | 隐藏真实 bug | 修复或删除 |

---

来源：改编自 `reference/agent-skills/references/testing-patterns.md` 与 `references/definition-of-done.md`。
