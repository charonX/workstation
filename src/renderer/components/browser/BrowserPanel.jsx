// src/renderer/components/browser/BrowserPanel.jsx
// 内置浏览器面板（REQ-BROWSER-001/003/004，story 2026-08-24-embedded-browser，
// UX 参照 ux/browser-panel.html）：会话区右侧栏，宽度 token --ch-right-panel-width。
//
// 形态（ADR-039 方向 B：WebContentsView 主进程托管）：
// - 本组件只渲染面板 chrome（导航键/地址栏/外链/收起）、agent 控制指示条、
//   错误页/崩溃页/空态——**视口占位区不渲染网页内容**，真实画面由主进程
//   WebContentsView 按 bounds 直接绘制到窗口对应位置；
// - 布局真相持有（PRD §10.2）：视口占位区 ResizeObserver → rAF 节流 →
//   opc.browser.sendBounds（主进程哑执行）；收起/错误页/崩溃页时推 visible=false
//   （隐藏原生视图但 webContents 保活，E6：隐藏而非错位遮挡）；
// - 地址栏：协议白名单前置校验（PRD §10.2；normalize 真源在主进程，本组件只做
//   scheme 级拦截）→ opc.browser.navigate（main 固定 source="user"）；
//   E-BROWSER-BAD-URL → 地址栏内联提示（红边 + 提示行，UX omnibox-hint）；
// - 事件消费（opc.browser.onEvent）：panel-request-open 展开 / navigated 回显地址栏
//   + agent 来源显示控制指示 / crashed 崩溃页 / load-failed 错误页 /
//   agent-control-revoked 指示消失；
// - 后退/前进：本期 disabled 占位（UX 原型即 disabled；WebContentsView 导航历史
//   由 Chromium 管，webContents.navigationHistory 接线需扩 §10.4 接口 5 通道表，
//   记录为已知偏差）。
//
// 共享状态：开合/链接导航请求经 browserPanelStore（模块级总线）——本组件与
// ChatView 头部按钮、MarkdownRenderer 链接不互为父子（REQ-BROWSER-004）。

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  closeBrowserPanel,
  openBrowserPanel,
  useBrowserPanelOpen,
  useBrowserPendingNav,
} from "./browserPanelStore.js";
import { hasForbiddenScheme } from "../../../shared/urlScheme.js";
import "./browser.css";

// 协议白名单前置校验：hasForbiddenScheme 来自共享真源 src/shared/urlScheme.js
// （与主进程 normalizeBrowserUrl 的 scheme 判定同规——「host:端口」不算显式协议，
// 避免 localhost:3000 被误判；javascript:/file: 等裸 scheme 在此拦截，
// 主进程 will-navigate 兜底重定向链）。

export default function BrowserPanel() {
  const { t } = useTranslation();
  const open = useBrowserPanelOpen();
  const pendingNav = useBrowserPendingNav();

  // currentUrl = 最近一次成功导航的规范化 URL（地址栏回显/重试/外链/崩溃重载的输入）；
  // inputValue = 地址栏受控值；dirty = 用户正在编辑（导航事件不回显覆盖）。
  const [currentUrl, setCurrentUrl] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [hint, setHint] = useState("");
  const [agentBar, setAgentBar] = useState(false);
  // viewState: "empty"（无页面）| "page"（原生视图绘制中）| "error" | "crash"
  const [viewState, setViewState] = useState("empty");
  const [errorReason, setErrorReason] = useState("");

  const viewportRef = useRef(null);
  const inputRef = useRef(null);
  const handledNavSeqRef = useRef(0);
  const lastAttemptRef = useRef(""); // 导航失败重试的原始输入
  const boundsRef = useRef({ raf: 0, lastKey: "" });
  // 事件回调读最新状态的镜像（onEvent 订阅只挂一次，避免闭包陈旧）。
  const stateRef = useRef({ currentUrl: "", dirty: false, viewState: "empty" });
  stateRef.current = { currentUrl, dirty, viewState };

  // —— 导航（地址栏 Enter / 重试 / 刷新 / 崩溃重载 / 链接点击 共用）——
  const navigateTo = useCallback(
    async (raw) => {
      const value = String(raw ?? "").trim();
      if (!value || !window.opc?.browser?.navigate) return;
      lastAttemptRef.current = value;
      setHint("");
      if (hasForbiddenScheme(value)) {
        setHint(t("browser.httpOnly"));
        return;
      }
      setDirty(false);
      try {
        const res = await window.opc.browser.navigate({ url: value });
        if (res?.ok) {
          // 成功：清错误/崩溃态（原生视图重新接管视口）；地址栏回显规范化 URL——
          // 提交即接受回显（用户刚提交的输入被规范化是期望行为，E2E 锚点：
          // example.com → "https://example.com/"）；navigated 事件同向到达，幂等。
          setViewState("page");
          if (typeof res.url === "string" && res.url) {
            setCurrentUrl(res.url);
            setInputValue(res.url);
          }
        } else if (res?.error?.code === "E-BROWSER-BAD-URL") {
          // E1：白名单外/无主机 → 地址栏内联提示（导航未发生，无 load-failed 事件）
          setHint(t("browser.invalidUrl"));
        }
        // E-BROWSER-NAV-FAILED 等：错误页由 load-failed 事件驱动（覆盖 agent 来源）。
      } catch {
        // invoke 失败（主进程未就绪）：静默，下帧/重试兜底
      }
    },
    [t]
  );

  // —— 链接点击等外部「打开并导航」请求（REQ-BROWSER-004；seq 去重）——
  useEffect(() => {
    if (!pendingNav || pendingNav.seq === handledNavSeqRef.current) return;
    handledNavSeqRef.current = pendingNav.seq;
    navigateTo(pendingNav.url);
  }, [pendingNav, navigateTo]);

  // —— 初始状态同步（挂载时对齐主进程：URL 回显/控制指示/崩溃态/重载后恢复展开）——
  useEffect(() => {
    let disposed = false;
    window.opc?.browser
      ?.getState?.()
      .then((s) => {
        if (disposed || !s) return;
        if (typeof s.url === "string" && s.url) {
          setCurrentUrl(s.url);
          setInputValue((prev) => (stateRef.current.dirty ? prev : s.url));
          setViewState((prev) => (prev === "empty" ? "page" : prev));
        }
        if (s.agentControl && !s.agentControlRevoked) setAgentBar(true);
        if (s.crashed) setViewState("crash");
        if (s.open) openBrowserPanel(); // 渲染进程重载后恢复展开（初次启动 open=false → 保持收起）
        // agent expand 对账兜底（Slice 3 E2E 实证修复）：agent navigate expand=true
        // 先于本组件挂载/订阅完成时 panel-request-open 事件被静默丢弃——expandPending
        // 是主进程持有的可恢复状态，挂载时发现即展开；清除由展开后的 open=true
        // bounds 推送捎带（主进程 setBounds 闭环），无需新增 IPC。
        if (s.expandPending) openBrowserPanel();
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  // —— 主进程事件消费（PRD §10.4 接口 5：opc-browser-event）——
  useEffect(() => {
    if (!window.opc?.browser?.onEvent) return undefined;
    return window.opc.browser.onEvent((ev) => {
      if (!ev || typeof ev.type !== "string") return;
      if (ev.type === "panel-request-open") {
        // agent 工具 expand 意图（流程 B 步骤 2）：面板自动展开
        openBrowserPanel();
      } else if (ev.type === "navigated") {
        if (typeof ev.url === "string" && ev.url) {
          setCurrentUrl(ev.url);
          if (!stateRef.current.dirty) setInputValue(ev.url);
        }
        setViewState("page");
        if (ev.source === "agent") setAgentBar(true); // 流程 B 步骤 3：控制中指示
        else if (ev.source === "user") setAgentBar(false); // 手动导航 = 收回并归还控制
      } else if (ev.type === "load-failed") {
        // E2：面板内错误页（reason 透传 Chromium ERR_*）
        setErrorReason(typeof ev.reason === "string" && ev.reason ? ev.reason : "ERR_FAILED");
        setViewState("error");
      } else if (ev.type === "crashed") {
        setViewState("crash"); // E4：崩溃页 + 重新加载按钮
      } else if (ev.type === "agent-control-revoked") {
        setAgentBar(false);
      }
      // cookie-updated：本面板暂无 Cookie 状态展示面（流程 D 登录由 Chromium 原生持久化）
    });
  }, []);

  // —— 布局真相推送：ResizeObserver + rAF 节流 → sendBounds（§10.2 渲染进程持有）——
  // 视口占位区（chrome 条以下）的 window 客户区坐标 = WebContentsView 目标 bounds。
  // visible=false：收起 / 错误页 / 崩溃页（原生视图隐藏保活，React 层接管该区域）。
  const viewportActive = viewState === "empty" || viewState === "page";
  useEffect(() => {
    const bridge = window.opc?.browser;
    if (!bridge?.sendBounds) return undefined;
    if (!open) {
      bridge.sendBounds({ x: 0, y: 0, width: 0, height: 0, visible: false });
      boundsRef.current.lastKey = "";
      return undefined;
    }
    const push = () => {
      const el = viewportRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const payload = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
        visible: viewportActive && r.width > 0 && r.height > 0,
      };
      const key = JSON.stringify(payload);
      if (key === boundsRef.current.lastKey) return; // 去重：同值不重复推
      boundsRef.current.lastKey = key;
      bridge.sendBounds(payload);
    };
    const schedule = () => {
      if (boundsRef.current.raf) return;
      boundsRef.current.raf = requestAnimationFrame(() => {
        boundsRef.current.raf = 0;
        push();
      });
    };
    const el = viewportRef.current;
    const ro = new ResizeObserver(schedule);
    if (el) ro.observe(el);
    window.addEventListener("resize", schedule);
    schedule(); // 展开/状态切换后首帧即推（视口就绪前不 attach 由主进程保证）
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (boundsRef.current.raf) cancelAnimationFrame(boundsRef.current.raf);
      boundsRef.current.raf = 0;
    };
  }, [open, viewportActive]);

  // 展开后地址栏聚焦（流程 A 步骤 1 验收锚点）
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSubmit = useCallback(() => {
    navigateTo(inputValue);
  }, [navigateTo, inputValue]);

  const handleRetry = useCallback(() => {
    navigateTo(lastAttemptRef.current || currentUrl);
  }, [navigateTo, currentUrl]);

  const handleReload = useCallback(() => {
    if (currentUrl) navigateTo(currentUrl);
  }, [navigateTo, currentUrl]);

  const handleStopControl = useCallback(() => {
    setAgentBar(false); // 乐观隐藏（agent-control-revoked 事件同向到达，幂等）
    window.opc?.browser?.stopAgentControl?.().catch(() => {});
  }, []);

  const handleOpenExternal = useCallback(() => {
    if (currentUrl) window.opc?.openExternal?.(currentUrl);
  }, [currentUrl]);

  if (!open) return null;

  const schemeLock = currentUrl.startsWith("https:") ? "🔒" : "▢";

  return (
    <section className="browser-panel" data-testid="browser-panel">
      {/* 面板头：导航键 + 全圆角地址栏 + 外链/收起（UX bp-chrome） */}
      <div className="bp-chrome">
        {/* 后退/前进本期 disabled 占位（UX 原型即 disabled；navigationHistory
            接线需扩 §10.4 接口 5 通道表——已知偏差，见 build-progress） */}
        <button type="button" className="bp-nav-btn" title={t("browser.back")} disabled>
          ‹
        </button>
        <button type="button" className="bp-nav-btn" title={t("browser.forward")} disabled>
          ›
        </button>
        <button
          type="button"
          className="bp-nav-btn"
          title={t("browser.reload")}
          disabled={!currentUrl}
          onClick={handleReload}
        >
          ⟳
        </button>
        <div className={`bp-omnibox${hint ? " error" : ""}`}>
          <span className="bp-scheme-lock">{schemeLock}</span>
          <input
            ref={inputRef}
            data-testid="omnibox"
            value={inputValue}
            placeholder={t("browser.omniboxPlaceholder")}
            spellCheck={false}
            onChange={(e) => {
              setInputValue(e.target.value);
              setDirty(true);
              setHint("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            onBlur={() => {
              // 放弃编辑：回显当前 URL（E2E 锚点：导航后地址栏=规范化 URL）
              setDirty(false);
              setHint("");
              setInputValue(stateRef.current.currentUrl);
            }}
          />
        </div>
        <button
          type="button"
          className="bp-nav-btn"
          title={t("browser.openExternal")}
          disabled={!currentUrl}
          onClick={handleOpenExternal}
        >
          ↗
        </button>
        <button
          type="button"
          className="bp-nav-btn"
          title={t("browser.collapse")}
          onClick={closeBrowserPanel}
        >
          ✕
        </button>
      </div>
      {/* E1 地址栏内联提示（UX omnibox-hint） */}
      {hint && <div className="bp-omnibox-hint">{hint}</div>}

      {/* agent 控制中指示条（稳定块 3）：含「停止控制」 */}
      {agentBar && (
        <div className="bp-agent-bar" data-testid="agent-control-bar">
          <span className="bp-agent-dot" />
          <span>{t("browser.agentControl")}</span>
          <button
            type="button"
            className="bp-agent-stop"
            data-testid="stop-agent-control"
            onClick={handleStopControl}
          >
            {t("browser.stopControl")}
          </button>
        </div>
      )}

      {/* 视口占位区：网页画面由主进程 WebContentsView 按 bounds 绘制；
          本区域只承载空态/错误页/崩溃页（错误/崩溃时原生视图 visible=false 让位） */}
      <div className="bp-viewport" ref={viewportRef}>
        {viewState === "empty" && (
          <div className="bp-empty">
            <span>{t("browser.emptyHint")}</span>
          </div>
        )}
        {viewState === "error" && (
          <div className="bp-error" data-testid="nav-error-page">
            <div className="bp-error-code">{errorReason}</div>
            <div className="bp-error-title">{t("browser.navErrorTitle")}</div>
            <button type="button" className="bp-error-retry" onClick={handleRetry}>
              {t("browser.retry")}
            </button>
          </div>
        )}
        {viewState === "crash" && (
          <div className="bp-error" data-testid="crash-page">
            <div className="bp-error-code">E-BROWSER-CRASHED</div>
            <div className="bp-error-title">{t("browser.crashTitle")}</div>
            <div className="bp-error-desc">{t("browser.crashDesc")}</div>
            <button
              type="button"
              className="bp-error-retry"
              data-testid="crash-reload"
              onClick={handleReload}
            >
              {t("browser.reloadPage")}
            </button>
          </div>
        )}
      </div>

      {/* 底栏：当前 URL + 分区标记（UX bp-statusbar） */}
      <div className="bp-statusbar">
        <span className="bp-status-url">{currentUrl || "—"}</span>
        <span className="bp-status-partition">partition: persist:browser</span>
      </div>
    </section>
  );
}
