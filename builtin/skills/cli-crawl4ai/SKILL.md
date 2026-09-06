---
name: cli-crawl4ai
description: Crawl4AI 网页抓取与数据提取命令行工具调用规范，用于一次性网页爬取与分析
version: 1.0.0
category: cli-service
---

# Crawl4AI CLI (cli-crawl4ai)

## 定位与概述
Crawl4AI 是高性能开源网页爬虫与大模型友好型数据提取工具（PyPI 包 `crawl4ai`），对应本机主命令 `crwl`。
本技能为 Agent 提供调用 `crwl` 命令行工具的规范指导，协助高效提取网页内容、转换为 Markdown 或 JSON 结构化数据。

## 命令与参数规范
- 主执行命令：`crwl`
- 一次性提取参数：
  - `crwl "<url>"`：爬取指定 URL 并输出 Markdown 内容。
  - `-o, --output <file>`：指定输出文件路径。
  - `--format <format>`：指定输出格式（`markdown`, `json`）。
- 示例：
  ```bash
  crwl "https://example.com"
  ```

## 一次性调用规范（重要纪律）
1. **严格禁止交互式会话**：严禁启动持续阻塞或交互式终端会话。Agent 必须通过命令行参数发起一次性任务爬取，命令完成抓取并输出内容后立即退出。
2. **遵守调用超时约束**：网页爬取受目标站点网络延迟影响，CLI 服务配置了单次调用超时时间（默认 120 秒，可配置范围 10-600 秒）。若目标站点响应过慢导致超时将被杀进程，请合理设置爬取目标。
3. **资源节约与幂等**：优先定向提取有效页面，避免无边界深度爬取；结果通过标准输出直接回传或写入指定输出文件。
