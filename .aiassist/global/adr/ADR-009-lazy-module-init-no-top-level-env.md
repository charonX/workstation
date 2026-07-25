# ADR-009: 模块惰性初始化，禁止顶层读 env/磁盘

- **状态**: 已接受
- **日期**: 2026-07-24
- **相关 story**: 2026-07-19-media-production-line (BUG-007/009)
- **触发**: BUG-007（bootstrap-env 作为第一个 import 仍无法修复跨重启凭据丢失）、BUG-009（vite 打包把 bootstrap 代码排在 static import 之后）

## 背景

ESM static import 被引擎 hoist，模块顶层代码按 import 图深度优先执行。Electron main 进程中需要先设 `process.env.OPC_WORKSTATION_CONFIG_DIR` / `DB_PATH`，再让业务模块加载——但：

1. 源码层面可以靠 `import "./bootstrap-env.js"` 作为第一个 import 保证顺序
2. **vite/rollup 打包后**，bootstrap-env 被内联在 bundle 中部，其他 chunk 的 static import 被提升到 bundle 顶部深度优先执行，bootstrap 反而在后面
3. 结果：settingsService 顶层 `let settings = readSettings()` 在 env 设置之前运行，读默认目录，保存时写到正确目录，跨重启数据"消失"

## 决策

**所有服务层模块禁止在顶层读 `process.env`、读磁盘、开 DB、建网络连接**。改为惰性初始化：

```js
// BAD — runs at module load, before env may be set
let settings = readSettings();

// GOOD — lazy, runs on first call (env is guaranteed set by then)
let settings = null;
function ensureLoaded() {
  if (settings === null) settings = readSettings();
}
export function loadSettings() { ensureLoaded(); return { ...settings }; }
```

已在 `settingsService.js` 落地，未来新增模块（cache、connection pool、config loader）一律遵循。

db.js 的 `getDb()` 本身已是惰性（内部维护 `let db = null`，首次调用才打开），符合本模式。

## 后果

- **正面**：与 bundler 重排、import hoisting、动态 import、测试环境都兼容；启动顺序不再脆弱。
- **负面**：需要多写一次 `ensureLoaded()` 守卫；顶层常量如果依赖 env 要改为 getter。
- **替代方案（被否决）**：
  - 靠"第一个 import bootstrap-env"——vite 打包后失效（BUG-009 实证）
  - 单独的二进制启动脚本设 env——对 CLI `node cli/opc-workstation.js` 不友好
  - 把 env 设置提前到 package.json `electron .` 之前——不可能（main 进程必须先 import electron 才能拿到 userData 路径）
