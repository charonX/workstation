import { useCallback, useEffect, useState } from "react";
import {
  listCliServices,
  updateCliService,
  setCliServiceProjectEnabled,
  getCliServiceProjectEnablements,
} from "../api/cliServices.js";
import { getProjects } from "../api/projects.js";
import "./Plugins.css";

const ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

export default function CliServices() {
  const [services, setServices] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // 项目启用映射：{ [serviceId]: Set<projectId> }
  const [projectMap, setProjectMap] = useState({});

  // 行内项目 popover 打开态与坐标
  const [openPop, setOpenPop] = useState(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });

  // 配置弹窗状态
  const [configService, setConfigService] = useState(null);
  const [timeoutSec, setTimeoutSec] = useState(120);
  const [envPairs, setEnvPairs] = useState([]);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState(null);

  const loadProjects = useCallback(async () => {
    try {
      const data = await getProjects();
      const list = Array.isArray(data) ? data : [];
      setProjects(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [res, , enablementsRes] = await Promise.all([
        listCliServices(),
        loadProjects(),
        getCliServiceProjectEnablements().catch(() => ({ enablements: {} })),
      ]);
      if (res?.services && Array.isArray(res.services)) {
        setServices(res.services);
      }
      const rawMap = enablementsRes?.enablements || {};
      const mMap = {};
      for (const [serviceId, pids] of Object.entries(rawMap)) {
        mMap[serviceId] = new Set(pids);
      }
      setProjectMap(mMap);
    } catch (err) {
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [loadProjects]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 后台版本轮询：若有已安装但最新版本尚未查回（unknown）的条目，静默轮询刷新（上限 3 次）
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (pollCount >= 3) return;
    const hasPendingVersion = services.some(
      (s) => s.installed && (s.latestVersion === "unknown" || !s.latestVersion)
    );
    if (!hasPendingVersion) return;

    const timer = setTimeout(async () => {
      try {
        const res = await listCliServices();
        if (res?.services && Array.isArray(res.services)) {
          setServices(res.services);
        }
      } catch {
        // 静默失败
      } finally {
        setPollCount((c) => c + 1);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [services, pollCount]);

  // 点击弹层外部关闭
  useEffect(() => {
    const onDocClick = (e) => {
      if (!e.target.closest(".toggle-cell")) setOpenPop(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // 重新探测刷新
  const handleRefresh = async () => {
    setRefreshing(true);
    setLoadError(null);
    setPollCount(0);
    try {
      const res = await listCliServices({ refresh: true });
      if (res?.services && Array.isArray(res.services) && res.services.length > 0) {
        setServices(res.services);
      }
    } catch (err) {
      setLoadError(err?.message || String(err));
    } finally {
      setRefreshing(false);
    }
  };

  // 全局启用切换
  const handleToggleGlobal = async (service) => {
    if (!service.installed) return;
    const nextEnabled = !service.enabled;
    try {
      await updateCliService(service.id, { enabled: nextEnabled });
      setServices((prev) =>
        prev.map((s) => (s.id === service.id ? { ...s, enabled: nextEnabled } : s))
      );
    } catch (err) {
      setLoadError(err?.message || String(err));
    }
  };

  // 项目启用 Popover 开关
  const togglePop = (serviceId) => (e) => {
    if (openPop === serviceId) {
      setOpenPop(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setPopPos({ top: r.bottom + 6, left: r.left });
    setOpenPop(serviceId);
  };

  // 项目启用切换
  const toggleProject = async (serviceId, projectId) => {
    const s = services.find((item) => item.id === serviceId);
    if (!s || !s.installed || !s.enabled) return;

    const currentEnabled = projectMap[serviceId]?.has(projectId) ?? false;
    const nextEnabled = !currentEnabled;
    try {
      await setCliServiceProjectEnabled(serviceId, projectId, nextEnabled);
      setProjectMap((prev) => {
        const next = { ...prev };
        const set = new Set(prev[serviceId] ?? []);
        if (nextEnabled) set.add(projectId);
        else set.delete(projectId);
        if (set.size === 0) delete next[serviceId];
        else next[serviceId] = set;
        return next;
      });
    } catch (err) {
      setLoadError(err?.message || String(err));
    }
  };

  // 打开配置弹窗
  const openConfigModal = (service) => {
    setConfigService(service);
    setTimeoutSec(service.timeoutSec || 120);
    setEnvPairs([]);
    setConfigError(null);
  };

  const addEnvPair = () => {
    setEnvPairs((prev) => [...prev, { key: "", value: "" }]);
  };

  const updateEnvPair = (index, field, val) => {
    setEnvPairs((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: val } : p))
    );
  };

  const removeEnvPair = (index) => {
    setEnvPairs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveConfig = async () => {
    if (!configService) return;
    const timeout = Number.parseInt(timeoutSec, 10);
    if (Number.isNaN(timeout) || timeout < 10 || timeout > 600) {
      setConfigError("超时时间必须为 10 至 600 秒之间的整数");
      return;
    }

    const env = {};
    for (const pair of envPairs) {
      const trimmedKey = pair.key.trim();
      const trimmedVal = pair.value.trim();
      if (!trimmedKey && !trimmedVal) continue;
      if (!ENV_KEY_REGEX.test(trimmedKey) || trimmedKey.length > 128) {
        setConfigError(`环境变量 KEY "${trimmedKey}" 格式无效，必须全大写字母、数字或下划线且不能以数字开头`);
        return;
      }
      if (!trimmedVal || trimmedVal.length > 4096) {
        setConfigError(`环境变量 "${trimmedKey}" 的值不能为空且长度不能超过 4096 字符`);
        return;
      }
      env[trimmedKey] = trimmedVal;
    }

    setConfigSaving(true);
    setConfigError(null);
    try {
      const updatePayload = { timeoutSec: timeout };
      if (Object.keys(env).length > 0) {
        updatePayload.env = env;
      }
      await updateCliService(configService.id, updatePayload);
      setConfigService(null);
      await reload();
    } catch (err) {
      setConfigError(err?.message || String(err));
    } finally {
      setConfigSaving(false);
    }
  };

  return (
    <div className="page plugins-page" data-testid="cli-services-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">CLI 服务</h1>
          <div className="page-sub">
            内置命令行工具集成 · 自动收敛 Skill 软链 · 统一执行超时与凭据管理
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="refresh-probe-button"
          onClick={handleRefresh}
          disabled={refreshing || loading}
        >
          {refreshing ? "探测中…" : "重新探测"}
        </button>
      </div>

      {loadError && (
        <div className="card" style={{ borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>
            {loadError}
          </div>
        </div>
      )}

      <div className="plugin-section section">
        <div className="section-head">
          <span className="section-title">内置服务清单</span>
          <span className="section-desc">已注册的命令行工具及其本机安装与版本状态</span>
        </div>
        <table className="plugin-table" data-testid="cli-services-table">
          <thead>
            <tr>
              <th>服务名称</th>
              <th>命令</th>
              <th>状态 / 版本</th>
              <th>全局开关</th>
              <th>项目启用</th>
              <th style={{ textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && services.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                    padding: "32px",
                    color: "var(--ch-text-secondary)",
                  }}
                >
                  加载中…
                </td>
              </tr>
            ) : (
              services.map((service) => {
                const projCount = projectMap[service.id]?.size ?? 0;
                const isInstalled = Boolean(service.installed);
                const commandName =
                  service.command || (service.id === "crawl4ai" ? "crwl" : service.id);

                return (
                  <tr
                    key={service.id}
                    data-testid={`cli-service-row-${service.id}`}
                    data-installed={String(isInstalled)}
                    className={`plugin-row ${!isInstalled ? "row-disabled" : ""}`}
                    style={{ opacity: isInstalled ? 1 : 0.85 }}
                  >
                    <td className="name-cell">
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                        <span>{service.displayName || service.id}</span>
                        {service.updateAvailable && (
                          <span
                            className="badge badge-warning"
                            data-testid="update-badge"
                            style={{
                              fontSize: "11px",
                              padding: "1px 6px",
                              borderRadius: "10px",
                              color: "var(--ch-warning, #d97706)",
                              backgroundColor: "var(--ch-warning-soft, rgba(245, 158, 11, 0.15))",
                              border: "1px solid var(--ch-warning, #d97706)",
                            }}
                          >
                            可更新至 {service.latestVersion}
                          </span>
                        )}
                      </div>
                      {!isInstalled && service.installHint && (
                        <div
                          data-testid="install-hint"
                          className="install-hint"
                          style={{
                            fontSize: "var(--ch-text-xs)",
                            color: "var(--ch-text-tertiary)",
                            marginTop: "4px",
                          }}
                        >
                          安装指引：<code className="mono">{service.installHint}</code>
                        </div>
                      )}
                    </td>
                    <td className="mono">{commandName}</td>
                    <td>
                      {isInstalled ? (
                        <span className="badge badge-ok">
                          v{service.version || "已安装"}
                        </span>
                      ) : service.probeError ? (
                        <span
                          className="badge badge-warning"
                          data-testid="probe-error-badge"
                          title={service.probeError}
                        >
                          检测失败
                        </span>
                      ) : (
                        <span className="badge badge-error">未安装</span>
                      )}
                    </td>
                    <td>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          cursor: isInstalled ? "pointer" : "not-allowed",
                        }}
                      >
                        <input
                          type="checkbox"
                          data-testid="global-enable-switch"
                          disabled={!isInstalled}
                          checked={Boolean(service.enabled && isInstalled)}
                          onChange={() => handleToggleGlobal(service)}
                          style={{ cursor: isInstalled ? "pointer" : "not-allowed" }}
                        />
                        <span style={{ fontSize: "var(--ch-text-xs)", color: "var(--ch-text-secondary)" }}>
                          {service.enabled && isInstalled ? "已启用" : "已禁用"}
                        </span>
                      </label>
                    </td>
                    <td className="toggle-cell">
                      <button
                        type="button"
                        className={`toggle-pill${projCount > 0 ? " on" : ""}`}
                        data-testid="cli-service-project-toggle"
                        onClick={togglePop(service.id)}
                        disabled={!isInstalled || !service.enabled}
                        style={{
                          cursor: !isInstalled || !service.enabled ? "not-allowed" : "pointer",
                          opacity: !isInstalled || !service.enabled ? 0.6 : 1,
                        }}
                      >
                        {projCount > 0 ? `${projCount} 个项目 ▸` : "未启用 ▸"}
                      </button>
                      {openPop === service.id && (
                        <div
                          className="toggle-pop open"
                          data-testid="cli-service-project-pop"
                          style={popPos}
                        >
                          <div className="pop-title">按项目启用</div>
                          {projects.map((proj) => {
                            const isProjEnabled =
                              projectMap[service.id]?.has(proj.id) ?? false;
                            return (
                              <div
                                key={proj.id}
                                className="pop-row"
                                onClick={() => toggleProject(service.id, proj.id)}
                              >
                                <span className="proj">{proj.name}</span>
                                <span
                                  className={`switch${isProjEnabled ? " on" : ""}`}
                                />
                              </div>
                            );
                          })}
                          {projects.length === 0 && (
                            <div className="pop-title">暂无项目</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn-tertiary"
                        data-testid="cli-service-config-button"
                        onClick={() => openConfigModal(service)}
                      >
                        配置
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 配置弹窗 */}
      {configService && (
        <div
          className="modal-overlay"
          data-testid="cli-service-config-modal"
          onClick={() => setConfigService(null)}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: "540px" }}
          >
            <div className="modal-header">
              <h2 className="modal-title">配置 {configService.displayName}</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setConfigService(null)}
                aria-label="close"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {configError && (
                <div
                  className="card"
                  style={{
                    borderColor: "var(--ch-error)",
                    marginBottom: "var(--ch-space-3)",
                  }}
                >
                  <div
                    className="card-body"
                    style={{ color: "var(--ch-error)", padding: "var(--ch-space-2)" }}
                  >
                    {configError}
                  </div>
                </div>
              )}

              <div className="field">
                <label>超时时间（秒，10–600）</label>
                <input
                  type="number"
                  min="10"
                  max="600"
                  data-testid="cli-service-timeout-input"
                  value={timeoutSec}
                  onChange={(e) => setTimeoutSec(e.target.value)}
                />
              </div>

              <div className="field">
                <label>已配置的环境变量键</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {configService.envKeys && configService.envKeys.length > 0 ? (
                    configService.envKeys.map((k) => (
                      <span
                        key={k}
                        className="badge badge-local mono"
                        style={{ padding: "2px 8px" }}
                      >
                        {k} (已安全加密)
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: "var(--ch-text-xs)", color: "var(--ch-text-tertiary)" }}>
                      暂未配置环境变量
                    </span>
                  )}
                </div>
              </div>

              <div className="field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label>更新 / 新增环境变量</label>
                  <button
                    type="button"
                    className="btn-tertiary"
                    onClick={addEnvPair}
                    style={{ color: "var(--ch-accent)" }}
                  >
                    + 添加变量
                  </button>
                </div>
                <div className="hint" style={{ marginBottom: "6px" }}>
                  密钥由密钥库加密存储，提交后仅显示 KEY。全量更新模式。
                </div>
                {envPairs.map((pair, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginBottom: "6px",
                      alignItems: "center",
                    }}
                  >
                    <input
                      placeholder="KEY (如 API_KEY)"
                      className="mono"
                      value={pair.key}
                      onChange={(e) => updateEnvPair(idx, "key", e.target.value)}
                      style={{ width: "40%" }}
                    />
                    <input
                      placeholder="VALUE"
                      type="password"
                      value={pair.value}
                      onChange={(e) => updateEnvPair(idx, "value", e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn-tertiary danger"
                      onClick={() => removeEnvPair(idx)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="modal-footer"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--ch-space-2)",
                padding: "var(--ch-space-3) var(--ch-space-4)",
                borderTop: "1px solid var(--ch-border)",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfigService(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="cli-service-config-submit"
                onClick={handleSaveConfig}
                disabled={configSaving}
              >
                {configSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
