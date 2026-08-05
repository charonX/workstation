// BUG-001（code-defect，REQ-AGENT-017 验收标准 3 优雅降级）：主进程 stdio EPIPE 防护。
//
// 根因：Electron 主进程经 dev launcher 以管道挂接 stdio 启动；管道读端关闭后，
// console.* 写动作触发 stdio 流 'error'(EPIPE)。Electron 修补的 stdio 流无默认
// 容错，无 'error' 监听器 → uncaughtException → 主进程崩溃弹窗（飞书消息 →
// routeToAgent 失败处理路径 console.error 实证）。系统 Node v24 内核对 stdio
// EPIPE 默认容错，Electron 运行时不容错——日志通道故障永不应成为未捕获异常源。
//
// 用法：作为进程入口的第一个 import（副作用即安装），先于其它模块的 import 期
// 日志生效——与 src/main/bootstrap-env.js 同模式（ESM 按序求值）：
//   import "../stdioGuard.js";   // 必须是第一行 import
//
// 同时导出 installStdioErrorGuard() 供测试与显式调用；幂等（WeakSet 按句柄去重），
// 流可注入以便测试。

const guarded = new WeakSet();

export function installStdioErrorGuard({ stdout = process.stdout, stderr = process.stderr } = {}) {
  for (const stream of [stdout, stderr]) {
    if (!stream || typeof stream.on !== "function" || guarded.has(stream)) continue;
    guarded.add(stream);
    stream.on("error", (err) => {
      // EPIPE = 管道读端已关闭（终端/launcher 退出）。吞掉：进程存活优先于日志送达。
      // 其余 stdio 错误同理——日志是尽力投递，不得致命；此处理器内绝不二次记录
      // （stderr 可能正是断开的那个，再写即再次 EPIPE）。
      void err;
    });
  }
}

// 模块顶层即装：入口文件以首个 import 引入本模块时，防护先于其它模块的
// import 期 console.* 生效（幂等，测试进程内重复 import 无副作用叠加）。
installStdioErrorGuard();
