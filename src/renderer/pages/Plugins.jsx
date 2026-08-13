// src/renderer/pages/Plugins.jsx
// 管理区「插件」页（REQ-AGENT-083 插件管理 UI + REQ-AGENT-084 MCP 表单 UI 面）。
//
// UX 参照：ux/plugins-page.html（已定稿 2026-08-13）。结构契约以 data-testid 锚定：
//   [data-testid='plugins-page'] / plugin-add-button / plugin-add-modal /
//   plugin-source-type / plugin-source-input / plugin-source-error /
//   plugin-safety-note / plugin-row-<name> / plugin-row-error（.error-detail）/
//   plugin-project-toggle（pill）→ plugin-project-pop（.pop-row .switch）/
//   plugin-add-submit / plugin-remove-button / mcp-add-button / mcp-form-modal /
//   mcp-name-input / mcp-type-seg / mcp-command-input / mcp-args-input /
//   mcp-url-input / mcp-auth-seg / mcp-form-submit / mcp-row-<name> /
//   mcp-global-toggle。
//
// 数据面：GET/POST /api/plugins、GET/POST/DELETE /api/mcp、POST
// /api/plugins/:name/project-enable、POST /api/mcp/:name/{project-enable,global-enabled}。
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
  listMcpServers,
  addMcpServer,
  removeMcpServer,
  setMcpGlobalEnabled,
  setMcpProjectEnabled,
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
  const [mcpServers, setMcpServers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // 项目启用映射：{ [name]: Set<projectId> }（插件/MCP 共用结构，按 type 分存）。
  const [pluginProjectMap, setPluginProjectMap] = useState({});
  const [mcpProjectMap, setMcpProjectMap] = useState({});

  // 行内项目 popover 打开态（当前打开的插件/MCP 名）。
  const [openPluginPop, setOpenPluginPop] = useState(null);
  const [openMcpPop, setOpenMcpPop] = useState(null);

  // 添加插件弹窗。
  const [addPluginOpen, setAddPluginOpen] = useState(false);
  const [pluginSourceType, setPluginSourceType] = useState("npm");
  const [pluginSource, setPluginSource] = useState("");
  const [pluginAddError, setPluginAddError] = useState(null);
  const [pluginAdding, setPluginAdding] = useState(false);

  // 添加 MCP 弹窗。
  const [addMcpOpen, setAddMcpOpen] = useState(false);
  const [mcpForm, setMcpForm] = useState({
    name: "",
    type: "stdio",
    command: "",
    args: "",
    env: "",
    url: "",
    auth: "none",
    headers: "",
  });
  const [mcpFormError, setMcpFormError] = useState(null);
  const [mcpSaving, setMcpSaving] = useState(false);

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
  const buildProjectMaps = useCallback(async (projList) => {
    const pMap = {};
    const mMap = {};
    for (const proj of projList) {
      try {
        const [pRows, mRows] = await Promise.all([
          listPlugins(proj.id),
          listMcpServers(),
        ]);
        for (const row of pRows ?? []) {
          if (row.builtin) continue;
          if (row.enabled) {
            (pMap[row.name] ??= new Set()).add(proj.id);
          }
        }
        for (const row of mRows ?? []) {
          if (row.enabled) {
            (mMap[row.name] ??= new Set()).add(proj.id);
          }
        }
      } catch {
        // 单项目拉取失败不阻塞整体——计数可能少算该项目的启用态。
      }
    }
    setPluginProjectMap(pMap);
    setMcpProjectMap(mMap);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pluginRows, mcpRows, projList] = await Promise.all([
        listPlugins(),
        listMcpServers(),
        loadProjects(),
      ]);
      const pluginsArr = Array.isArray(pluginRows) ? pluginRows : [];
      const mcpArr = Array.isArray(mcpRows) ? mcpRows : [];
      setPlugins(pluginsArr);
      setMcpServers(mcpArr);
      await buildProjectMaps(projList);
    } catch (err) {
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [loadProjects, buildProjectMaps]);

  useEffect(() => {
    reload();
  }, [reload]);

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

  // ---------- 添加 MCP ----------
  const openAddMcp = () => {
    setMcpForm({ name: "", type: "stdio", command: "", args: "", env: "", url: "", auth: "none", headers: "" });
    setMcpFormError(null);
    setAddMcpOpen(true);
  };

  const handleMcpSave = async () => {
    const body = {
      name: mcpForm.name.trim(),
      type: mcpForm.type,
      enabled: true,
    };
    if (mcpForm.type === "stdio") {
      body.command = mcpForm.command.trim();
      body.args = mcpForm.args
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const env = parseKeyValueLines(mcpForm.env);
      if (env !== null) body.env = env;
    } else {
      body.url = mcpForm.url.trim();
      body.auth = mcpForm.auth;
      const headers = parseKeyValueLines(mcpForm.headers);
      if (headers !== null) body.headers = headers;
    }
    setMcpSaving(true);
    setMcpFormError(null);
    try {
      await addMcpServer(body);
      setAddMcpOpen(false);
      await reload();
    } catch (err) {
      setMcpFormError(err?.message || String(err));
    } finally {
      setMcpSaving(false);
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

  const toggleMcpProject = async (name, projectId) => {
    const enabled = !(mcpProjectMap[name]?.has(projectId) ?? false);
    try {
      await setMcpProjectEnabled(name, projectId, enabled);
      setMcpProjectMap((prev) => {
        const next = { ...prev };
        const set = new Set(prev[name] ?? []);
        if (enabled) set.add(projectId);
        else set.delete(projectId);
        if (set.size === 0) delete next[name];
        else next[name] = set;
        return next;
      });
    } catch {
      // 静默失败。
    }
  };

  const toggleMcpGlobal = async (server) => {
    try {
      await setMcpGlobalEnabled(server.name, !server.enabled);
      await reload();
    } catch {
      // 静默失败。
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

  const handleRemoveMcp = async (server) => {
    try {
      await removeMcpServer(server.name);
      await reload();
    } catch {
      // 静默失败。
    }
  };

  const pluginCount = (name) => pluginProjectMap[name]?.size ?? 0;
  const mcpCount = (name) => mcpProjectMap[name]?.size ?? 0;

  return (
    <div className="page plugins-page" data-testid="plugins-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">插件</h1>
          <div className="page-sub">PI agent 扩展与 MCP 服务 · 集中安装，按项目启用</div>
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

      {/* ============ ① 扩展插件清单 ============ */}
      <div className="plugin-section section">
        <div className="section-head">
          <span className="section-title">扩展插件</span>
          <span className="section-desc">npm / git / 本地路径 · 真相 = pi 全局设置</span>
        </div>
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
                          onClick={() => setOpenPluginPop(openPluginPop === p.name ? null : p.name)}
                        >
                          {count > 0 ? `${count} 个项目 ▸` : "未启用 ▸"}
                        </button>
                        {openPluginPop === p.name && (
                          <div className="toggle-pop open" data-testid="plugin-project-pop">
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

      {/* ============ ② MCP 服务清单 ============ */}
      <div className="plugin-section section">
        <div className="section-head">
          <span className="section-title">MCP 服务</span>
          <span className="section-desc">配置存 workstation · 新会话生效 · 调用全程过权限面</span>
          <button className="btn btn-secondary" data-testid="mcp-add-button" onClick={openAddMcp}>
            添加 MCP 服务
          </button>
        </div>
        <table className="plugin-table" data-testid="mcp-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>端点</th>
              <th>全局开关</th>
              <th>项目启用</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mcpServers.map((s) => (
              <tr key={s.name} data-testid={`mcp-row-${s.name}`} className="plugin-row">
                <td className="name-cell">{s.name}</td>
                <td><span className={`badge badge-${s.type === "http" ? "git" : "local"}`}>{s.type}</span></td>
                <td className="mono">{endpointText(s)}</td>
                <td>
                  <span
                    className={`switch${s.enabled ? " on" : ""}`}
                    data-testid="mcp-global-toggle"
                    onClick={() => toggleMcpGlobal(s)}
                  />
                </td>
                <td className="toggle-cell">
                  <button
                    type="button"
                    className={`toggle-pill${mcpCount(s.name) > 0 ? " on" : ""}`}
                    data-testid="mcp-project-toggle"
                    onClick={() => setOpenMcpPop(openMcpPop === s.name ? null : s.name)}
                  >
                    {mcpCount(s.name) > 0 ? `${mcpCount(s.name)} 个项目 ▸` : "未启用 ▸"}
                  </button>
                  {openMcpPop === s.name && (
                    <div className="toggle-pop open" data-testid="mcp-project-pop">
                      <div className="pop-title">按项目启用</div>
                      {projects.map((proj) => (
                        <div key={proj.id} className="pop-row" onClick={() => toggleMcpProject(s.name, proj.id)}>
                          <span className="proj">{proj.name}</span>
                          <span className={`switch${mcpProjectMap[s.name]?.has(proj.id) ? " on" : ""}`} />
                        </div>
                      ))}
                      {projects.length === 0 && <div className="pop-title">无项目</div>}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn-tertiary danger" onClick={() => handleRemoveMcp(s)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
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

      {/* ============ 添加 MCP 服务弹窗（stdio / http 类型切换） ============ */}
      {addMcpOpen && (
        <div className="modal-overlay" data-testid="mcp-form-modal" onClick={() => setAddMcpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2 className="modal-title">添加 MCP 服务</h2>
              <button type="button" className="icon-btn" onClick={() => setAddMcpOpen(false)} aria-label="close">✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>名称（库内唯一）</label>
                <input
                  data-testid="mcp-name-input"
                  placeholder="local-db"
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>连接类型</label>
                <div className="seg" data-testid="mcp-type-seg">
                  <button
                    type="button"
                    className={mcpForm.type === "stdio" ? "active" : ""}
                    data-type="stdio"
                    onClick={() => setMcpForm({ ...mcpForm, type: "stdio", command: "", args: "", env: "" })}
                  >
                    stdio（本地命令）
                  </button>
                  <button
                    type="button"
                    className={mcpForm.type === "http" ? "active" : ""}
                    data-type="http"
                    onClick={() => setMcpForm({ ...mcpForm, type: "http", url: "", headers: "" })}
                  >
                    HTTP（远程服务）
                  </button>
                </div>
              </div>

              {mcpForm.type === "stdio" && (
                <>
                  <div className="field">
                    <label>启动命令</label>
                    <input
                      data-testid="mcp-command-input"
                      className="mono"
                      placeholder="npx"
                      value={mcpForm.command}
                      onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>参数（每行一个）</label>
                    <textarea
                      data-testid="mcp-args-input"
                      className="mono"
                      rows="2"
                      placeholder="-y\n@modelcontextprotocol/server-sqlite"
                      value={mcpForm.args}
                      onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>环境变量（KEY=VALUE，每行一条）</label>
                    <textarea
                      data-testid="mcp-env-input"
                      className="mono"
                      rows="2"
                      placeholder="DB_PATH=./data/app.db"
                      value={mcpForm.env}
                      onChange={(e) => setMcpForm({ ...mcpForm, env: e.target.value })}
                    />
                  </div>
                </>
              )}

              {mcpForm.type === "http" && (
                <>
                  <div className={`field${mcpFormError ? " invalid" : ""}`}>
                    <label>服务 URL</label>
                    <input
                      data-testid="mcp-url-input"
                      className="mono"
                      placeholder="https://example.com/mcp"
                      value={mcpForm.url}
                      onChange={(e) => {
                        setMcpForm({ ...mcpForm, url: e.target.value });
                        setMcpFormError(null);
                      }}
                    />
                    <span className="err">{mcpFormError}</span>
                  </div>
                  <div className="field">
                    <label>认证</label>
                    <div className="seg" data-testid="mcp-auth-seg">
                      {["none", "bearer", "oauth"].map((a) => (
                        <button
                          key={a}
                          type="button"
                          className={mcpForm.auth === a ? "active" : ""}
                          onClick={() => setMcpForm({ ...mcpForm, auth: a })}
                        >
                          {a === "none" ? "无" : a === "bearer" ? "Bearer Token" : "OAuth"}
                        </button>
                      ))}
                    </div>
                    <span className="hint">Bearer token 存系统凭据库；OAuth 授权链接将在对话中呈现（见 oauth-present 原型）</span>
                  </div>
                  <div className="field">
                    <label>请求头（KEY=VALUE，每行一条，可选）</label>
                    <textarea
                      data-testid="mcp-headers-input"
                      className="mono"
                      rows="2"
                      placeholder="X-Team-Id=core"
                      value={mcpForm.headers}
                      onChange={(e) => setMcpForm({ ...mcpForm, headers: e.target.value })}
                    />
                  </div>
                </>
              )}

              {mcpFormError && mcpForm.type === "stdio" && (
                <div className="form-error" style={{ color: "var(--ch-error)", fontSize: "var(--ch-text-xs)" }}>
                  {mcpFormError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setAddMcpOpen(false)}>取消</button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="mcp-form-submit"
                onClick={handleMcpSave}
                disabled={mcpSaving}
              >
                {mcpSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// KEY=VALUE 多行解析：非法行 → null（交给服务端校验报错）。
function parseKeyValueLines(text) {
  const obj = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) return null;
    obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return obj;
}

function endpointText(s) {
  if (s.type === "http") return s.url ? `${s.url}${s.auth && s.auth !== "none" ? ` · ${s.auth}` : ""}` : "—";
  return [s.command, ...(Array.isArray(s.args) ? s.args : [])].filter(Boolean).join(" ");
}
