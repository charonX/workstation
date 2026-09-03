// src/renderer/components/preview/previewImageBlobs.js
// 文件预览面板图片 blob 生产桥（REQ-PREVIEW-004，PRD §10.4 接口 4 消费侧）。
//
// 设计约束：filePreviewStore 的 imageBlobs seam 是**同步**签名
// （create(projectId, path) → url、revoke(url)），而真实 fetch 是异步——
// 本桥采用「缓存 + 订阅」：
// - create(projectId, path)：同步确保条目存在并启动 fetchProjectImage，
//   返回当前已就绪 URL（首次为 null）；同 key 且已就绪 → 返回缓存 URL 并
//   后台重取一次（SSE modified / 断线重连 refresh 路径对齐最新字节，
//   完成后换新 URL、revoke 旧 URL、通知订阅者）。
// - revoke(url)：与 store 的 close/切换/refresh 换绑调用对称——命中当前条目
//   即 URL.revokeObjectURL + 清缓存（不泄漏，REQ-004 AC3）。
//   命中判定除 current.url 外还认「最近一次 create 同步返回给 store 的 URL」
//   （entry.handed）：后台重取换新后 store 持有的仍是旧 URL，close 时按旧 URL
//   revoke 也必须释放整个条目（revoke 其 current blob URL），否则新 URL 永不回收；
//   反之 store 已经再次 create 采纳新 URL 后顺带 revoke 的旧 URL（handed 已更新）
//   不命中——旧 URL 桥内已自行 revoke，此处安全 no-op，不误杀在用品目。
// - subscribe/peek：面板图片视图（React 子组件）订阅就绪 URL 渲染 <img>
//   （MdImage 的 effect 模式是参照）。
//
// 单条目缓存（同一时刻至多一个预览图片——store 单例一次只开一个文件），
// create 换 key 即 dispose 旧条目，生命周期闭合无累积泄漏。

import { fetchProjectImage } from "../../api/agentSessions.js";

function keyOf(projectId, path) {
  return `${projectId}\n${path}`;
}

export function createPreviewImageBlobs() {
  let current = null; // { key, url, handed, pending, listeners: Set }

  function dispose(entry) {
    if (entry.url) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch {
        // revoke 失败不影响后续流程
      }
    }
    // 通知订阅者 URL 已失效（面板渲染空态，不留已 revoke 的 URL 在 <img> 上）
    for (const fn of [...entry.listeners]) {
      try {
        fn(null);
      } catch {
        // 监听器异常不传染其余订阅者
      }
    }
    entry.listeners.clear();
  }

  function startFetch(entry, projectId, path) {
    entry.pending = true;
    fetchProjectImage(projectId, path)
      .then((blob) => {
        if (current !== entry) return; // 陈旧条目（已换 key/dispose）→ 丢弃
        const url = URL.createObjectURL(blob);
        const prev = entry.url;
        entry.url = url;
        entry.pending = false;
        // 后台重取换新：旧 URL 指向旧字节，revoke 防泄漏（订阅者已收到新 URL）
        if (prev && prev !== url) {
          try {
            URL.revokeObjectURL(prev);
          } catch {
            // 同上
          }
        }
        for (const fn of [...entry.listeners]) {
          try {
            fn(url);
          } catch {
            // 监听器异常不传染其余订阅者
          }
        }
      })
      .catch(() => {
        if (current === entry) entry.pending = false; // 失败：保持无 URL（面板维持加载态）
      });
  }

  // store seam（同步）：首次返回 null（store.imageUrl 为 null 属预期——错误页不消费它，
  // 图片视图经 subscribe 拿就绪 URL）。
  function create(projectId, path) {
    const key = keyOf(projectId, path);
    if (!current || current.key !== key) {
      if (current) dispose(current);
      current = { key, url: null, handed: null, pending: false, listeners: new Set() };
      startFetch(current, projectId, path);
      return null;
    }
    if (current.url) {
      // 缓存命中（refresh 路径）：后台重取对齐最新字节，同步先返回当前 URL
      if (!current.pending) startFetch(current, projectId, path);
      // handed = store 视角的当前句柄：close 时 store 按它 revoke，桥须认它释放条目
      current.handed = current.url;
      return current.url;
    }
    return null; // 首次 fetch 进行中
  }

  function revoke(url) {
    // 命中当前 URL 或 store 最近拿到的句柄（后台换新后的旧 URL）→ 释放整个条目
    if (!url || !current || (current.url !== url && current.handed !== url)) return;
    dispose(current);
    current = null;
  }

  // 面板图片视图订阅：就绪即回调（含立即回放在就绪 URL）；返回退订函数。
  function subscribe(projectId, path, fn) {
    if (!current || current.key !== keyOf(projectId, path)) return () => {};
    const entry = current;
    entry.listeners.add(fn);
    if (entry.url) {
      try {
        fn(entry.url);
      } catch {
        // 订阅者异常不影响桥状态
      }
    }
    return () => entry.listeners.delete(fn);
  }

  function peek(projectId, path) {
    return current && current.key === keyOf(projectId, path) ? current.url : null;
  }

  return { create, revoke, subscribe, peek };
}
