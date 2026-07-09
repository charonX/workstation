# 可观测性检查清单

本清单用于 `/tech-design` 和 `/review --stage=code` 中涉及生产代码、外部依赖、关键路径的实现。

## 设计原则

- [ ] 先写下 on-call 会问的 2–4 个问题
- [ ] 每个信号映射到这些问题
- [ ] metrics 说明"有问题"，traces 说明"在哪"，logs 说明"为什么"

## 结构化日志

- [ ] 日志结构化（JSON），有稳定 event name
- [ ] 每条日志携带 correlation/request ID
- [ ] correlation ID 在每次 outbound 调用和异步边界传播
- [ ] 日志级别一致：`error` = 需要人介入；`warn` = 降级但已处理；`info` = 重要业务事件；`debug` = 生产关闭
- [ ] 日志中无 secrets、token、密码、未脱敏 PII
- [ ] 外部服务调用只记录元数据：端点、状态、延迟、重试次数、脱敏标识

## 指标

- [ ] 每个端点和外部依赖有 RED：Rate、Errors、Duration
- [ ] 每个资源（队列、连接池、主机）有 USE：Utilization、Saturation、Errors
- [ ] 延迟用 histogram，可查询 p50/p95/p99
- [ ] label 来自小固定集合，无用户 ID、邮箱、原始 URL、错误消息等无界值
- [ ] 状态码按类分组（`5xx` 而非 `503`）

## 分布式追踪

- [ ] OpenTelemetry（或等价物）在服务启动时初始化
- [ ] HTTP/gRPC/DB 客户端自动埋点
- [ ] trace context 在每次 outbound 调用传播（W3C traceparent）
- [ ] 异步边界（队列消息）携带 trace 元数据
- [ ] 手动 span 只包含有意义的内部工作单元
- [ ] span attributes 中无 secrets/PII

## 告警

- [ ] 告警基于症状（错误率、p99 延迟、队列年龄），而非原因（CPU、磁盘）
- [ ] 每个告警可操作；"忽略即可自愈"的告警应删除
- [ ] 每个告警链接到 runbook：含义、首条查询、升级路径
- [ ] 阈值有 SLO 或历史数据支撑，不是猜测
- [ ] 只分两级：page（用户可见，立即处理）和 ticket（降级，本周处理）

## Dashboard

- [ ] 服务健康 dashboard：错误率、延迟 p99、流量、饱和度
- [ ] 依赖健康面板：每个服务的错误率和延迟
- [ ] dashboard 能回答 on-call 问题
- [ ] 默认时间范围合理（1h–6h）

## 发布前门禁

- [ ] 结构化日志已流入日志聚合
- [ ] 每个新端点和依赖的 RED metrics 在 dashboard 可见
- [ ] 至少一个 symptom-based 告警已配置、已测试、有 runbook
- [ ] 一个请求可端到端追踪
- [ ] on-call 知道 runbook 位置

---

来源：改编自 `reference/agent-skills/references/observability-checklist.md`。
