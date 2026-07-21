---
name: topic-daily-digest
description: 按主题从内容源收集条目并合成日报 markdown
version: 0.1.0
author: opc-workstation
category: Collection
tags:
  - digest
  - daily
  - topic
  - collection
  - markdown
dependencies:
  - fetch-to-markdown
---

# topic-daily-digest

按指定主题从已登记的内容源中收集条目，合成一份结构化日报 markdown。用于「定时日报」flow。

## 使用方式

由 agent 节点调用。输入变量：

- `topic`：日报主题，例如 `AI 科技动态`。
- `tag`（可选）：按内容源 tag 筛选来源，默认与主题相同。
- `outputPath`（可选）：写入的日报文件路径，默认 `outputs/daily/<date>-<topic>.md`。

输出产物：

- `outputs/daily/<date>-<topic>.md`，frontmatter 包含 `topic`、`sources`、`generatedAt`。
- 正文条目引用登记内容源的 URL，含一句摘要与原文链接。

## 内容来源

以 `opc-workstation source list --tag <tag> --enabled` 查询启用内容源，按登记源聚合为主。agent 围绕主题的自主搜索仅作补充，不进验收。

## 默认版块

- 头条：3–5 条
- 新工具：3–5 条
- 研究进展：3–5 条
- 观点：3–5 条

各条包含一句摘要 + 原文链接。

## 错误状态

- `E-AGENT-FAILED`：agent 执行失败（重试耗尽），不落盘半成品。
