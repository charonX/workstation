// src/renderer/pages/Plugins.jsx
// 管理区「插件」页（REQ-AGENT-083 插件管理 UI）。
// BUG-013（2026-08-16，req-gap 就地补全）：MCP server 管理拆出为独立页
// src/renderer/pages/Mcp.jsx（#/mcp，导航项位于技能之下），本页只留扩展插件。
//
// UX 参照：ux/plugins-page.html（已定稿 2026-08-13；BUG-013 起只留扩展插件）。
// 结构契约以 data-testid 锚定：
//   [data-testid='plugins-page'] / plugin-add-button / plugin-add-modal /
//   plugin-source-type / plugin-source-input / plugin-source-error /
//   plugin-safety-note / plugin-row-<name> / plugin-row-error（.error-detail）/
//   plugin-project-toggle（pill）→ plugin-project-pop（.pop-row .switch）/
//   plugin-add-submit / plugin-remove-button。
//
// 数据面：GET/POST /api/plugins、POST /api/plugins/:name/project-enable、
// DELETE /api/plugins/:source。
// 内置 pi-mcp-adapter 行由 HTTP 层合成（scope=global / builtin=true / 不可停用），
// UI 直接渲染、不提供移除/停用。
//
// 形态对齐既有「技能」页（Skills.jsx）：page-header + 区块卡表格。

import { useCallback, useEffect, useState } from "react";
import {
  listPlugins,
  addPlugin,
  removePlugin,
  setPluginProjectEnabled,
} from "../api/plugins.js";
import { getProjects } from "../api/projects.js";
import "./Plugins.css";

// 来源串 → 徽标/来源名（npm: / git: / 本地绝对路径）。
function sourceKind(source) {
  if (typeof source !== "string") return "local";
  if (source.startsWith("npm:")) return "npm";
  if (source.startsWith("git:")) return "git";
  return "local";
}

const SOURCE_META = {
  npm: { label: "包名", ph: "pi-git-checkpoint 或 pi-git-checkpoint@1.4.0", hint: "将从 npm registry 安装到插件库（agentHome/npm/）" },
  git: { label: "仓库地址", ph: "github.com/user/repo 或 git:git@github.com:user/repo@v1", hint: "将克隆到插件库（agentHome/git/），@ref 锁定版本" },
  local: { label: "本地路径", ph: "/absolute/path/to/extension", hint: "只登记不拷贝，按路径直接加载" },
};

export default function Plugins() {
  const [plugins, setPlugins] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // 项目启用映射：{ [name]: Set<projectId> }。
  const [pluginProjectMap, setPluginProjectMap] = useState({});

  // 行内项目 popover 打开态 + fixed 视口定位（BUG-009：逃逸卡片 overflow 裁剪）。
  const [openPluginPop, setOpenPluginPop] = useState(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });

  const togglePop = (name) => (e) => {
    if (openPluginPop === name) {
      setOpenPluginPop(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setPopPos({ top: r.bottom + 6, left: r.left });
    setOpenPluginPop(name);
  };

  // 添加插件弹窗。
  const [addPluginOpen, setAddPluginOpen] = useState(false);
  const [pluginSourceType, setPluginSourceType] = useState("npm");
  const [pluginSource, setPluginSource] = useState("");
  const [pluginAddError, setPluginAddError] = useState(null);
  const [pluginAdding, setPluginAdding] = useState(false);

  // 拉取项目清单（popover 行 + 项目启用计数）。
  const loadProjects = useCallback(async () => {
    try {
      const data = await getProjects();
      setProjects(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }, []);

  // 对每个项目拉项目感知清单，构建 name → enabled project id 集合。
  const buildProjectMap = useCallback(async (projList) => {
    const pMap = {};
    for (const proj of projList) {
      try {
        const pRows = await listPlugins(proj.id);
        for (const row of pRows ?? []) {
          if (row.builtin) continue;
          if (row.enabled) {
            (pMap[row.name] ??= new Set()).add(proj.id);
          }
        }
      } catch {
        // 单项目拉取失败不阻塞整体——计数可能少算该项目的启用态。
      }
    }
    setPluginProjectMap(pMap);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pluginRows, projList] = await Promise.all([listPlugins(), loadProjects()]);
      setPlugins(Array.isArray(pluginRows) ? pluginRows : []);
      await buildProjectMap(projList);
    } catch (err) {
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [loadProjects, buildProjectMap]);

  useEffect(() => {
    reload();
  }, [reload]);

  // BUG-009：点击弹层外关闭 popover（对齐 UX 参照 click-away 行为）。
  useEffect(() => {
    const onDocClick = (e) => {
      if (!e.target.closest(".toggle-cell")) setOpenPluginPop(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // ---------- 添加插件 ----------
  const openAddPlugin = () => {
    setPluginSourceType("npm");
    setPluginSource("");
    setPluginAddError(null);
    setAddPluginOpen(true);
  };

  const handlePluginAdd = async () => {
    const source = pluginSource.trim();
    if (!source) {
      setPluginAddError("请输入插件来源");
      return;
    }
    setPluginAdding(true);
    setPluginAddError(null);
    try {
      await addPlugin(source);
      setAddPluginOpen(false);
      await reload();
    } catch (err) {
      // 失败：弹窗内 plugin-source-error 显示，弹窗不关（E1/E2）。
      setPluginAddError(err?.message || String(err));
    } finally {
      setPluginAdding(false);
    }
  };

  // ---------- 项目启用 ----------
  const togglePluginProject = async (name, projectId) => {
    const enabled = !(pluginProjectMap[name]?.has(projectId) ?? false);
    try {
      await setPluginProjectEnabled(name, projectId, enabled);
      setPluginProjectMap((prev) => {
        const next = { ...prev };
        const set = new Set(prev[name] ?? []);
        if (enabled) set.add(projectId);
        else set.delete(projectId);
        if (set.size === 0) delete next[name];
        else next[name] = set;
        return next;
      });
    } catch {
      // 静默失败（后端业务错误，如未全局安装）——保持现状。
    }
  };

  // ---------- 移除 ----------
  const handleRemovePlugin = async (p) => {
    try {
      await removePlugin(p.source);
      await reload();
    } catch {
      // 静默失败。
    }
  };

  const pluginCount = (name) => pluginProjectMap[name]?.size ?? 0;

  return (
    <div className="page plugins-page" data-testid="plugins-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">插件</h1>
          <div className="page-sub">PI agent 扩展 · 集中安装，按项目启用</div>
        </div>
        <button className="btn btn-primary" data-testid="plugin-add-button" onClick={openAddPlugin}>
          添加插件
        </button>
      </div>

      {loadError && (
        <div className="card" style={{ borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>{loadError}</div>
        </div>
      )}

      {loading && <p className="loading-text">加载中…</p>}

      {/* ============ 扩展插件清单 ============ */}
      <div className="plugin-section section">
        <table className="plugin-table" data-testid="plugin-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>来源</th>
              <th>版本</th>
              <th>状态</th>
              <th>项目启用</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plugins.map((p) => {
              if (p.builtin) {
                return (
                  <tr key={p.name} data-testid={`plugin-row-${p.name}`} className="plugin-row plugin-row--builtin">
                    <td className="name-cell">
                      {p.name}
                      <span className="sub mono">{p.source}</span>
                    </td>
                    <td><span className="badge badge-npm">npm</span></td>
                    <td className="mono">{p.version || "—"}</td>
                    <td>
                      <span className="badge badge-ok">内置</span>{" "}
                      <span className="desc">随应用发布，不可停用</span>
                    </td>
                    <td><span className="desc">—（由 MCP 服务启用控制）</span></td>
                    <td />
                  </tr>
                );
              }
              const isError = !!p.error;
              const count = pluginCount(p.name);
              return (
                <tr
                  key={p.name}
                  data-testid={isError ? "plugin-row-error" : `plugin-row-${p.name}`}
                  className={`plugin-row${isError ? " row-error" : ""}`}
                >
                  <td className="name-cell">
                    {p.name}
                    <span className="sub mono">{p.source}</span>
                  </td>
                  <td><span className={`badge badge-${sourceKind(p.source)}`}>{sourceKind(p.source)}</span></td>
                  <td className="mono">{p.version || "—"}</td>
                  <td>
                    {isError ? (
                      <>
                        <span className="badge badge-error">加载失败</span>
                        <div className="error-detail">{p.name}: {p.error}</div>
                      </>
                    ) : (
                      <span className="badge badge-ok">正常</span>
                    )}
                  </td>
                  <td className="toggle-cell">
                    {isError ? (
                      <span className="desc">不可用</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`toggle-pill${count > 0 ? " on" : ""}`}
                          data-testid="plugin-project-toggle"
                          onClick={togglePop(p.name)}
                        >
                          {count > 0 ? `${count} 个项目 ▸` : "未启用 ▸"}
                        </button>
                        {openPluginPop === p.name && (
                          <div className="toggle-pop open" data-testid="plugin-project-pop" style={popPos}>
                            <div className="pop-title">按项目启用（写入项目 .pi/settings.json）</div>
                            {projects.map((proj) => (
                              <div
                                key={proj.id}
                                className="pop-row"
                                onClick={() => togglePluginProject(p.name, proj.id)}
                              >
                                <span className="proj">{proj.name}</span>
                                <span className={`switch${pluginProjectMap[p.name]?.has(proj.id) ? " on" : ""}`} />
                              </div>
                            ))}
                            {projects.length === 0 && <div className="pop-title">无项目</div>}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn-tertiary danger"
                      data-testid="plugin-remove-button"
                      onClick={() => handleRemovePlugin(p)}
                    >
                      移除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ============ 添加插件弹窗（含 M2 安全告知） ============ */}
      {addPluginOpen && (
        <div className="modal-overlay" data-testid="plugin-add-modal" onClick={() => setAddPluginOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2 className="modal-title">添加插件</h2>
              <button type="button" className="icon-btn" onClick={() => setAddPluginOpen(false)} aria-label="close">✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>来源类型</label>
                <div className="seg" data-testid="plugin-source-type">
                  {["npm", "git", "local"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={pluginSourceType === t ? "active" : ""}
                      data-type={t}
                      onClick={() => setPluginSourceType(t)}
                    >
                      {t === "npm" ? "npm 包" : t === "git" ? "git 仓库" : "本地路径"}
                    </button>
                  ))}
                </div>
              </div>
              <div className={`field${pluginAddError ? " invalid" : ""}`}>
                <label>{SOURCE_META[pluginSourceType].label}</label>
                <input
                  data-testid="plugin-source-input"
                  placeholder={SOURCE_META[pluginSourceType].ph}
                  value={pluginSource}
                  onChange={(e) => {
                    setPluginSource(e.target.value);
                    setPluginAddError(null);
                  }}
                />
                <span className="hint">{SOURCE_META[pluginSourceType].hint}</span>
                <span className="err" data-testid="plugin-source-error">{pluginAddError}</span>
              </div>
              <div className="safety-note" data-testid="plugin-safety-note">
                <span className="icon">⚠</span>
                <span>
                  插件是第三方代码，加载后拥有<strong>完全系统权限</strong>（可读写文件、执行命令）。请确认来源可信。安装后其工具调用仍受项目权限配置与模式档位管控。
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setAddPluginOpen(false)}>取消</button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="plugin-add-submit"
                onClick={handlePluginAdd}
                disabled={pluginAdding}
              >
                {pluginAdding ? "安装中…" : "安装"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
