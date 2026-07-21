---
name: feishu-doc-sync
description: 将 markdown 产物同步创建为飞书云文档
version: 0.1.0
author: opc-workstation
category: Collection
tags:
  - feishu
  - docx
  - sync
  - collection
  - markdown
dependencies: []
---

# feishu-doc-sync

将本地 markdown 产物同步创建为飞书云文档，并生成可分享的文档链接。作为文件落盘后的可选沉淀副本。

## 使用方式

由 agent 节点或执行终态投递调用。输入：

- `markdownPath`：本地 markdown 文件路径。
- `title`：飞书文档标题。

输出：

- 飞书云文档 URL（`https://xxx.feishu.cn/docx/xxx`）。

## 行为约定

- 调用飞书 OpenAPI：`blocks/convert` → 创建文档 → 开启 `tenant_readable` 链接分享。
- 文档同步失败不阻塞文件落盘；调用方应降级为仅文件 + 飞书文字消息。
- 需要项目已配置飞书凭据（App ID / App Secret）。

## 错误状态

- `E-DOC-SYNC-FAILED`：convert / create / permission 任一步失败。
