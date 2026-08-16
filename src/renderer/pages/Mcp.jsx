// src/renderer/pages/Mcp.jsx
// 管理区「MCP」页（REQ-AGENT-084 MCP server 配置 CRUD + 项目启用 UI 面 +
// AC7 工具探测，BUG-013 从插件页拆出）。
//
// UX 参照：ux/mcp-page.html（BUG-013 定稿 2026-08-16）。结构契约以 data-testid 锚定：
//   mcp-page / mcp-add-button / mcp-form-modal / mcp-name-input / mcp-type-seg /
//   mcp-command-input / mcp-args-input / mcp-url-input / mcp-auth-seg /
//   mcp-token-input / mcp-form-submit / mcp-row-<name> / mcp-global-toggle /
//   mcp-project-toggle（pill）→ mcp-project-pop（.pop-row .switch）/ mcp-edit-button /
//   mcp-tools-button / mcp-tools-modal / mcp-tools-table / mcp-tools-error-text。
//
// 默认权限区（BUG-014，REQ-AGENT-087 默认层）：mcp-perm-defaults / mcp-perm-row /
// mcp-perm-verdict / mcp-perm-server-select / mcp-perm-tool-select /
// mcp-perm-new-verdict / mcp-perm-add-submit / mcp-perm-freeform-input /
// mcp-perm-freeform-toggle——用户级默认权限在此编辑（存 workstation DB，
// 对所有项目生效，新会话生效）；项目页 mcp 族为覆盖层。录入 = 共享选择器
// McpRulePicker（server 下拉 → 探测拉工具下拉；手填 glob 高级入口）。
//
// 数据面：GET/POST/PUT/DELETE /api/mcp、GET /api/mcp?project=<id>（项目感知，BUG-012）、
// POST /api/mcp/:name/{project-enable,global-enabled}、GET /api/mcp/:name/tools（AC7）。
//
// 工具探测（AC7）：行内「工具」→ 直连 server 拉 tools/list 弹窗展示（名称+描述）；
// 添加/编辑保存后自动连接拉取；连接失败弹窗内呈「连接失败 + 详情」。

import { useCallback, useEffect, useState } from "react";
import {
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  setMcpGlobalEnabled,
  setMcpProjectEnabled,
  listMcpTools,
  getMcpPermissionDefaults,
  putMcpPermissionDefaults,
} from "../api/plugins.js";
import { getProjects } from "../api/projects.js";
import McpRulePicker from "../components/mcp/McpRulePicker.jsx";
// 样式与插件页同源（区块卡/表格/pill/popover/switch/弹窗均为同一套类）。
import "./Plugins.css";

const VERDICTS = ["allow", "ask", "deny"];

export default function Mcp() {
  const [mcpServers, setMcpServers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // 项目启用映射：{ [name]: Set<projectId> }。
  const [mcpProjectMap, setMcpProjectMap] = useState({});

  // 行内项目 popover 打开态 + fixed 视口定位（BUG-009：逃逸卡片 overflow 裁剪）。
  const [openMcpPop, setOpenMcpPop] = useState(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });

  const togglePop = (name) => (e) => {
    if (openMcpPop === name) {
      setOpenMcpPop(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setPopPos({ top: r.bottom + 6, left: r.left });
    setOpenMcpPop(name);
  };

  // 添加/编辑 MCP 弹窗（editingMcp 非空 = 编辑模式，REQ-084 CRUD-U，BUG-008）。
  const [addMcpOpen, setAddMcpOpen] = useState(false);
  const [editingMcp, setEditingMcp] = useState(null);
  const [mcpForm, setMcpForm] = useState({
    name: "",
    type: "stdio",
    command: "",
    args: "",
    env: "",
    url: "",
    auth: "none",
    token: "",
    headers: "",
  });
  const [mcpFormError, setMcpFormError] = useState(null);
  const [mcpSaving, setMcpSaving] = useState(false);

  // 工具清单弹窗（AC7）：toolsOpen 非空 = 打开的 server 名。
  const [toolsName, setToolsName] = useState(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState(null);
  const [toolsList, setToolsList] = useState([]);

  // 默认权限（BUG-014）：permRules = { pattern: verdict }（插入序），即改即存
  //（GET → 本地 mutate → PUT 全量替换）。
  const [permRules, setPermRules] = useState({});
  const [permMsg, setPermMsg] = useState(null);

  const loadPermDefaults = useCallback(async () => {
    try {
      const res = await getMcpPermissionDefaults();
      setPermRules(res?.rules && typeof res.rules === "object" ? res.rules : {});
    } catch (err) {
      setPermMsg(err?.message || String(err));
    }
  }, []);

  useEffect(() => {
    loadPermDefaults();
  }, [loadPermDefaults]);

  const putDefaults = async (next) => {
    setPermMsg(null);
    try {
      const res = await putMcpPermissionDefaults(next);
      setPermRules(res?.rules && typeof res.rules === "object" ? res.rules : next);
    } catch (err) {
      setPermMsg(err?.message || String(err));
    }
  };

  const addDefaultRule = (pattern, verdict) => putDefaults({ ...permRules, [pattern]: verdict });
  const setDefaultVerdict = (pattern, verdict) => putDefaults({ ...permRules, [pattern]: verdict });
  const deleteDefaultRule = (pattern) => {
    const next = { ...permRules };
    delete next[pattern];
    putDefaults(next);
  };

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
  // BUG-012：必须带 proj.id——无参拿到的是全局开关，会冒充项目启用态。
  const buildProjectMap = useCallback(async (projList) => {
    const mMap = {};
    for (const proj of projList) {
      try {
        const mRows = await listMcpServers(proj.id);
        for (const row of mRows ?? []) {
          if (row.enabled) {
            (mMap[row.name] ??= new Set()).add(proj.id);
          }
        }
      } catch {
        // 单项目拉取失败不阻塞整体——计数可能少算该项目的启用态。
      }
    }
    setMcpProjectMap(mMap);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [mcpRows, projList] = await Promise.all([listMcpServers(), loadProjects()]);
      setMcpServers(Array.isArray(mcpRows) ? mcpRows : []);
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
      if (!e.target.closest(".toggle-cell")) setOpenMcpPop(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // ---------- 工具探测（AC7） ----------
  const openTools = async (name) => {
    setToolsName(name);
    setToolsLoading(true);
    setToolsError(null);
    setToolsList([]);
    try {
      const res = await listMcpTools(name);
      setToolsList(Array.isArray(res?.tools) ? res.tools : []);
    } catch (err) {
      setToolsError(err?.message || String(err));
    } finally {
      setToolsLoading(false);
    }
  };

  // ---------- 添加/编辑 MCP ----------
  const openAddMcp = () => {
    setEditingMcp(null);
    setMcpForm({ name: "", type: "stdio", command: "", args: "", env: "", url: "", auth: "none", token: "", headers: "" });
    setMcpFormError(null);
    setAddMcpOpen(true);
  };

  // 回填行数据；name 主键只读；token 永不回填（已签：API 不回显明文），留空 = 保留。
  const openEditMcp = (server) => {
    const kvLines = (obj) =>
      obj && typeof obj === "object"
        ? Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("\n")
        : "";
    setEditingMcp(server);
    setMcpForm({
      name: server.name,
      type: server.type,
      command: server.command ?? "",
      args: Array.isArray(server.args) ? server.args.join("\n") : "",
      env: kvLines(server.env),
      url: server.url ?? "",
      auth: server.auth ?? "none",
      token: "",
      headers: kvLines(server.headers),
    });
    setMcpFormError(null);
    setAddMcpOpen(true);
  };

  const handleMcpSave = async () => {
    const body = { type: mcpForm.type };
    // 新增模式才送 name/enabled；编辑模式 name 是路径主键，enabled 开关不碰。
    if (!editingMcp) {
      body.name = mcpForm.name.trim();
      body.enabled = true;
    }
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
      // BUG-006：bearer token 加密存凭据库（服务端 secretStore），表单提交后不回显
      // BUG-008：编辑模式 token 留空 = 保留原 token（不送字段），填写 = 轮换
      if (mcpForm.auth === "bearer" && (!editingMcp || mcpForm.token.trim() !== "")) {
        body.token = mcpForm.token.trim();
      }
      const headers = parseKeyValueLines(mcpForm.headers);
      if (headers !== null) body.headers = headers;
    }
    setMcpSaving(true);
    setMcpFormError(null);
    try {
      const savedName = editingMcp ? editingMcp.name : body.name;
      if (editingMcp) {
        await updateMcpServer(editingMcp.name, body);
      } else {
        await addMcpServer(body);
      }
      setAddMcpOpen(false);
      setEditingMcp(null);
      await reload();
      // AC7：保存后自动连接拉取工具（失败呈弹窗错误态，不影响保存结果）。
      openTools(savedName);
    } catch (err) {
      setMcpFormError(err?.message || String(err));
    } finally {
      setMcpSaving(false);
    }
  };

  // ---------- 项目启用 / 全局开关 / 删除 ----------
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

  const handleRemoveMcp = async (server) => {
    try {
      await removeMcpServer(server.name);
      await reload();
    } catch {
      // 静默失败。
    }
  };

  const mcpCount = (name) => mcpProjectMap[name]?.size ?? 0;

  return (
    <div className="page plugins-page" data-testid="mcp-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">MCP 服务</h1>
          <div className="page-sub">配置存 workstation · 新会话生效 · 调用全程过权限面</div>
        </div>
        <button className="btn btn-primary" data-testid="mcp-add-button" onClick={openAddMcp}>
          添加 MCP 服务
        </button>
      </div>

      {loadError && (
        <div className="card" style={{ borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>{loadError}</div>
        </div>
      )}

      {loading && <p className="loading-text">加载中…</p>}

      {/* ============ MCP 服务清单 ============ */}
      <div className="plugin-section section">
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
                    onClick={togglePop(s.name)}
                  >
                    {mcpCount(s.name) > 0 ? `${mcpCount(s.name)} 个项目 ▸` : "未启用 ▸"}
                  </button>
                  {openMcpPop === s.name && (
                    <div className="toggle-pop open" data-testid="mcp-project-pop" style={popPos}>
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
                  <button type="button" className="btn-tertiary" data-testid="mcp-tools-button" onClick={() => openTools(s.name)}>
                    工具
                  </button>
                  <button type="button" className="btn-tertiary" data-testid="mcp-edit-button" onClick={() => openEditMcp(s)}>
                    编辑
                  </button>
                  <button type="button" className="btn-tertiary danger" onClick={() => handleRemoveMcp(s)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ============ 默认权限（BUG-014：用户级默认层，对所有项目生效；项目页为覆盖） ============ */}
      <div className="plugin-section section" data-testid="mcp-perm-defaults">
        <div className="section-head">
          <span className="section-title">默认权限</span>
          <span className="section-desc">对所有项目生效 · 项目权限页可做覆盖 · 未匹配默认 ask · 新会话生效</span>
        </div>
        <table className="plugin-table">
          <thead>
            <tr>
              <th>规则（server:tool）</th>
              <th>裁决</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {Object.entries(permRules).map(([pattern, verdict]) => (
              <tr key={pattern} data-testid="mcp-perm-row">
                <td className="mono">{pattern}</td>
                <td>
                  <div className="verdict-seg" data-testid="mcp-perm-verdict">
                    {VERDICTS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        data-v={v}
                        className={verdict === v ? "active" : ""}
                        onClick={() => setDefaultVerdict(pattern, v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn-tertiary danger" onClick={() => deleteDefaultRule(pattern)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <McpRulePicker
          className="perm-add"
          testidPrefix="mcp-perm"
          freeformTestid="mcp-perm-freeform-input"
          onSubmit={addDefaultRule}
          onError={setPermMsg}
        />
        {permMsg && <div className="perm-msg">{permMsg}</div>}
        <div className="perm-hint">
          规则 = server:tool glob · 选择工具时自动探测 server（连接失败的 server 可手填）· 项目覆盖在项目权限页编辑并高亮
        </div>
      </div>

      {/* ============ 添加/编辑 MCP 服务弹窗（stdio / http 类型切换） ============ */}
      {addMcpOpen && (
        <div className="modal-overlay" data-testid="mcp-form-modal" onClick={() => setAddMcpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2 className="modal-title">{editingMcp ? "编辑 MCP 服务" : "添加 MCP 服务"}</h2>
              <button type="button" className="icon-btn" onClick={() => setAddMcpOpen(false)} aria-label="close">✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>名称（库内唯一）</label>
                <input
                  data-testid="mcp-name-input"
                  placeholder="local-db"
                  value={mcpForm.name}
                  disabled={!!editingMcp}
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
                    <span className="hint">Bearer token 加密存系统凭据库（不明文落库）；OAuth 授权链接将在对话中呈现（见 oauth-present 原型）</span>
                  </div>
                  {mcpForm.auth === "bearer" && (
                    <div className="field">
                      <label>Bearer Token</label>
                      <input
                        data-testid="mcp-token-input"
                        type="password"
                        className="mono"
                        placeholder={editingMcp ? "留空 = 保持原 token 不变；填写 = 轮换" : "粘贴 token，保存后不再回显"}
                        value={mcpForm.token}
                        onChange={(e) => setMcpForm({ ...mcpForm, token: e.target.value })}
                      />
                      <span className="hint">加密存储于系统凭据库（macOS Keychain）；保存/列表均不回显明文</span>
                    </div>
                  )}
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

      {/* ============ 工具清单弹窗（AC7：直连拉取，名称+描述） ============ */}
      {toolsName && (
        <div className="modal-overlay" data-testid="mcp-tools-modal" onClick={() => setToolsName(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2 className="modal-title">{toolsName} 的工具</h2>
              <button type="button" className="icon-btn" onClick={() => setToolsName(null)} aria-label="close">✕</button>
            </div>
            <div className="modal-body">
              {toolsLoading && <p className="loading-text">正在连接 server 拉取工具…</p>}
              {toolsError && (
                <div className="field invalid">
                  <span className="err" style={{ display: "block" }} data-testid="mcp-tools-error-text">
                    {toolsError}
                  </span>
                </div>
              )}
              {!toolsLoading && !toolsError && (
                toolsList.length > 0 ? (
                  <table className="plugin-table" data-testid="mcp-tools-table">
                    <thead>
                      <tr><th>工具</th><th>描述</th></tr>
                    </thead>
                    <tbody>
                      {toolsList.map((t) => (
                        <tr key={t.name}>
                          <td className="name-cell mono">{t.name}</td>
                          <td>{t.description || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="desc">该 server 未暴露工具</p>
                )
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setToolsName(null)}>关闭</button>
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
