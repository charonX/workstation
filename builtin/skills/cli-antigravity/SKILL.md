---
name: cli-antigravity
description: Antigravity CLI 命令行工具调用规范，用于代码生成、分析与一次性编程任务执行
version: 1.0.0
category: cli-service
---

# Antigravity CLI (cli-antigravity)

## 定位与概述
Antigravity CLI 是 Google 提供的命令行编程辅助工具，对应本机主命令 `agy`。
本技能为 Agent 提供调用 `agy` 命令行工具的规范指导，协助完成代码探索、分析与自动化编程任务。

## 命令与参数规范
- 主执行命令：`agy`
- 一次性非交互执行参数：
  - `-p, --print <prompt>`：以非交互模式执行 prompt，输出结果到标准输出后立即退出。
  - `--output-format <format>`：指定输出格式（如 `text` 或 `json`）。
- 示例：
  ```bash
  agy -p "分析当前工程结构并给出优化建议"
  ```

## 一次性调用规范（重要纪律）
1. **严格禁止交互式会话**：严禁直接运行裸命令 `agy` 或进入交互式终端会话。Agent 必须通过 `-p` 等命令行参数发起一次性任务调用，任务执行完毕后进程必须立即退出并返回结果。
2. **遵守调用超时约束**：CLI 服务配置了单次调用超时时间（默认 120 秒，可配置范围 10-600 秒）。若命令执行超过限制将被系统强制终止（SIGTERM → SIGKILL），请确保一次性任务颗粒度适中。
3. **输出规范**：依赖标准输出（stdout）和标准错误（stderr）获取结果，输出会被安全截断保护系统内存。
4. **环境变量与凭据**：执行环境变量由系统安全快照按需注入，无需且严禁在命令行明文传递 API Key 或敏感凭据。
