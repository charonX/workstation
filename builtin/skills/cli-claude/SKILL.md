---
name: cli-claude
description: Claude Code 命令行工具调用规范，用于代码分析、重构与一次性编程任务执行
version: 1.0.0
category: cli-service
---

# Claude Code CLI (cli-claude)

## 定位与概述
Claude Code 是 Anthropic 官方提供的命令行编程辅助工具（npm 包 `@anthropic-ai/claude-code`），对应本机主命令 `claude`。
本技能为 Agent 提供调用 `claude` 命令行工具的规范指导，协助完成代码探索、分析与自动化编程任务。

## 命令与参数规范
- 主执行命令：`claude`
- 一次性非交互执行参数：
  - `-p, --print <prompt>`：以非交互模式执行 prompt，输出结果到标准输出后立即退出。
  - `--output-format <format>`：指定输出格式（如 `text` 或 `json`）。
- 示例：
  ```bash
  claude -p "检查当前目录下的 package.json 依赖是否存在过时版本"
  ```

## 一次性调用规范（重要纪律）
1. **严格禁止交互式会话**：严禁直接运行裸命令 `claude` 或打开交互式 REPL 会话。Agent 必须通过 `-p` 等命令行参数发起一次性任务调用，任务执行完毕后进程必须立即退出并返回结果。
2. **遵守调用超时约束**：CLI 服务配置了单次调用超时时间（默认 120 秒，可配置范围 10-600 秒）。若命令执行超过限制将被系统强制终止（SIGTERM → SIGKILL），请确保一次性任务颗粒度适中。
3. **输出规范**：依赖标准输出（stdout）和标准错误（stderr）获取结果，输出会被安全截断保护系统内存。
