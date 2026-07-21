# 测试计划 — 2026-07-19-media-production-line

> 本计划由 `/test-author` 生成。
> 触发原因：2026-07-21 BUG 阶段回流，新增稳定块 12「飞书消息触发节点（`feishuMessage`）」。
> 对应 `requirements.md` v1.2，hash `aeebbee331c0863144ca7b891e8faf8da12fde2bfbceb0ad525049febf3f1d48`。
> 变更摘要：attempt-3 将 `feishuMessage` 触发节点输出从 `url/sender/messageId` 改为 `text/sender/messageId`；IM 路由不再解析 URL，由下游 skill/agent 从 `text` 中自行提取。

---

## 新增/变更 REQ 一览

| REQ-ID | 标题 | 能力/实体 | seam 类型 | 测试文件 | 签核状态 |
|---|---|---|---|---|---|
| REQ-FLOW-031 | 飞书消息触发节点 | flow-orchestration / flow-engine | API + E2E | `tests/capabilities/flow-orchestration/flow-engine/2026-07-19-media-production-line/api/feishuMessageNode.test.js`<br>`tests/capabilities/flow-orchestration/flow-engine/2026-07-19-media-production-line/e2e/feishuMessageNode.test.cjs` | ⏳ 待签核 |
| REQ-CHANNEL-002 | IM 接收、去重与路由 | channel-integration / channel | API（扩展） | `tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/imRouting.test.js` | ⏳ 待重新签核 |
| REQ-TPL-001 | 模板实例化 | collection-pipeline / template | API（扩展） | `tests/capabilities/collection-pipeline/template/2026-07-19-media-production-line/api/templates.test.js` | ⏳ 待重新签核 |

其余 22 个 REQ 维持原签核不变，测试文件未修改。

---

## REQ-FLOW-031 测试覆盖

### API 测试 `feishuMessageNode.test.js`

| 验收标准 | 测试方法 | 关键断言 |
|---|---|---|
| AC3：`feishuMessage` 节点视为 trigger-like，注入变量覆盖 defaultValue | 调用 `flowEngine.run()`，传入含 `feishuMessage` + agent 的 flow 与注入变量 | agent prompt 中包含注入后的 text/sender/messageId |
| AC3：未注入变量使用 defaultValue；注入 falsy 值也应覆盖 | 调用 `flowEngine.run()`，仅注入部分变量并注入空字符串 | 空字符串覆盖非空默认值；未注入变量保留默认值 |
| AC4：`validateNodeList` 接受固定结构 | 直接调用 `flowService.validateNodeList` | 不抛错 |
| AC4：缺少固定输出变量时报错 | 构造缺少 `messageId` 的节点 | 抛出含 `messageId` 的错误 |
| AC4：固定输出变量类型非 string 时报错 | 构造 `messageId` type=number 的节点 | 抛出类型错误 |

### E2E 测试 `feishuMessageNode.test.cjs`

| 验收标准 | 测试方法 | 关键断言 |
|---|---|---|
| AC1：NodePalette Trigger 分组提供 `Feishu Message` 节点 | Playwright 打开 Flow Editor，点击 palette | 画布出现节点，文案可见 |
| AC2：配置面板固定展示 text/sender/messageId 且不可删除 | 选中节点，查看 properties panel | 三个变量可见；删除按钮不可见；可修改 defaultValue 并保存 |
| AC2/AC5：保存后类型与固定输出保持不变 | 通过 API seed 含 `feishuMessage` 的 flow，刷新打开 | 三个固定变量仍可见 |

---

## REQ-CHANNEL-002 测试变更

原 `imRouting.test.js` 已覆盖去重、绑定路由、无绑定、draft/已删 flow 分支。本次变更：

| 新增/变更 | 测试方法 | 关键断言 |
|---|---|---|
| AC2 增加节点存在性校验；路由层不再解析 URL | `createProjectFlow` 默认生成含 `feishuMessage` 节点的 flow；命中绑定后创建执行 | 执行创建成功；注入变量为 text/sender/messageId |
| AC3 变更：任意文本消息（无 URL）也入队 | 发送不含 URL 的文本消息 | 回复排队位置；创建 trigger=channel 执行 |
| AC4 新增：绑定 flow 缺少 `feishuMessage` 节点 | 创建无 `feishuMessage` 节点的 flow 并绑定，发送消息 | 回复配置异常提示；写「通道状态」通知；不创建执行 |

---

## REQ-TPL-001 测试变更

原 `templates.test.js` 已覆盖模板列表、实例化生成 draft flow、channel_bindings、force、CLI。本次扩展：

| 新增/变更 | 测试方法 | 关键断言 |
|---|---|---|
| AC1：链接速存模板首节点为 `feishuMessage` | instantiate 链接速存模板后查询 flow | 节点 type=`feishuMessage`，固定输出 text/sender/messageId |
| AC4：模板生成的 flow 能正确合并 IM 注入变量 | 用模板生成 flow 的 publishedNodeList 调用 `flowEngine.run()` | agent prompt 能引用注入的 text |

---

## HTML UX 原型映射

本 story 的 UX 原型位于 `.aiassist/stories/2026-07-19-media-production-line/ux/`，包含：

- `sources.html` → 内容源管理 UI（REQ-SRC-003，原签核）
- `notifications.html` → 通知中心 UI（REQ-NOTIFY-002，原签核）
- `settings-channel.html` → Settings 飞书通道区块（REQ-CHANNEL-001，原签核）
- `execution-detail.html` → Executions 产物 tab（REQ-FLOW-030，原签核）

新增 `feishuMessage` 节点暂无独立 HTML 原型；UI 行为通过现有 Flow Editor E2E 覆盖（基于 `triggerConfig.test.cjs` 模式）。REFLECT 阶段可依据实际实现与 Flow Editor 既有风格做观感验收。

---

## 留给 REFLECT 人工验收的内容

- Flow Editor 中 `feishuMessage` 节点图标、文案、密度等纯视觉表现（无独立 HTML 原型，以现有设计系统为准）。

---

## 未覆盖风险

- `feishuMessage` 节点 UI 缺少独立 HTML 原型，E2E 中的 locators 可能在 BUILD 阶段需调整；已在测试文件中使用 `// TODO: HUMAN ASSERTION` 标记待确认文案/locator。
- 链接速存模板结构变化后，原 `imRouting.test.js` AC6 生产路径测试需确保 flow 含 `feishuMessage` 节点（已通过 `createProjectFlow` 默认添加）。
