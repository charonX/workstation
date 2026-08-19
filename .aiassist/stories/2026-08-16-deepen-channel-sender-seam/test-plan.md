# 测试计划（Test Plan）— 2026-08-16-deepen-channel-sender-seam

> 对应 REQ：[`requirements.md`](./requirements.md) (v1)
> 生成时间：2026-08-19

---

## 1. 测试文件与覆盖映射

| REQ-ID | 覆盖断言 / 场景 | Seam 类型 | 测试文件路径 |
|---|---|---|---|
| **REQ-FLOW-054** | AC1/AC2/AC3: variables 中彻底移除 `_channelManager`，变量注册表纯净化 | API / 源码断言 | `tests/capabilities/flow-orchestration/execution/2026-08-16-deepen-channel-sender-seam/api/channelSenderSeam.test.js` |
| **REQ-FLOW-055** | AC1: 源码移除 `_channelManager` 与 dynamic import<br>AC2: 有 messageId 走 reply<br>AC3: 无 messageId 走 send<br>AC4: 记录 outputVariables<br>AC5: 缺失上下文或空内容 skipped | Public 函数 | `tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-channel-sender-seam/api/feishuSendExecutor.test.js` |
| **REQ-FLOW-056** | AC1: 默认组装 `services.channelSender`<br>AC2: `setTestChannelSender` 注入 mock 生效<br>AC3: 子流程继承 Seam<br>AC4: reset 清理 | Public 函数 / Runner Seam | `tests/capabilities/flow-orchestration/execution/2026-08-16-deepen-channel-sender-seam/api/channelSenderSeam.test.js` |
| **REQ-FLOW-057** | AC1: 缺失 `services.channelSender` 受控错误<br>AC2: 底层异常捕获并输出日志 | Public 函数 | `tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-channel-sender-seam/api/feishuSendExecutor.test.js` |

## 2. 人工验收（REFLECT）

*本 story 为无 UI 的纯内部架构接缝重构，所有行为均由自动化测试完整覆盖，无人工仅视觉验收项。*

## 3. 测试运行说明

```bash
# 运行本次 story 的契约测试
node --test tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-channel-sender-seam/api/feishuSendExecutor.test.js
node --test tests/capabilities/flow-orchestration/execution/2026-08-16-deepen-channel-sender-seam/api/channelSenderSeam.test.js
```
