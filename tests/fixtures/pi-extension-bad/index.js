// Fixture：坏插件——加载即抛错（REQ-AGENT-089 故障隔离 / REQ-AGENT-080 错误态行）。
throw new Error("fixture: extension load failure (intentional)");
