// src/renderer/components/project/PermissionConfigTab.jsx
// PI 权限配置页签（REQ-AGENT-059~068 UI 面，2026-08-10-pi-permission-config-ui
// Slice 3）。管理区项目详情弹窗「权限配置」页签：
// - 继承视图（可视化模式）：全局基底（只读，来自 GET rules 的 global 值，标注
//   「出厂默认」）+ 项目值（跟随全局 / allow-ask 切换 / 覆盖高亮「项目已改」）；
//   bash 高危族按 family 分组；path/外部目录列表编辑器；authorizerChain 链编辑
//   （数组整体替换语义，ADR-022）；yoloMode/debugLog 等开关组；
// - JSON 高级模式：项目配置 JSON 全文编辑（原样提交，校验后落盘）；
// - 面板状态 ↔ 项目 JSON 视图转换（tech-design §4.3/§6.6）：覆盖项写入、
//   跟随全局项不写（= 删除语义）、rules 之外的键（permission 面内自定义
//   surface/pattern，schema 合法）从原 project JSON 保留——顶层未知键由服务端
//   保存校验拦截（400，裁决 A：防 gotgenes 运行时整集 fail-closed）。
//
// 数据流：GET /api/projects/:id/permission → {global, project, merged, rules[],
// projectInvalid}；PUT body = 面板生成/JSON 原样的项目 JSON → {saved, mtime}；
// 400 → {code:"E-PERMISSION-INVALID", issues:[{path,message}]} 显示错误条。
// projectInvalid=true（E6，2026-08-11 人裁决落地）：项目配置文件已损坏（JSON.parse
// 失败）→ 显示坏文件提示而非「未配置」空态，按全局默认展示，保存即覆盖修复。
//
// 文案按中文原型直写（E2E 断言契约先例，Assistant.jsx 同款；en-US 直译入
// REFLECT）。locator 契约（E2E）：[data-perm-mode='vis'|'json'] /
// [data-testid='perm-empty-state'] / [data-testid='perm-create-btn'] /
// [data-testid='perm-save-btn'] / [data-rule-row='<key>'] / [data-perm-seg] /
// [data-override-badge] / [data-testid='perm-error-banner'] /
// [data-testid='perm-json-editor'] / [data-testid='perm-saved-hint'] /
// [data-global-cell]（全局默认列 cell）/ [data-testid='perm-invalid-banner']。

import { useCallback, useEffect, useMemo, useState } from "react";
import { getProjectPermission, putProjectPermission } from "../../api/projects.js";
import "./PermissionConfigTab.css";

// ================= 视图转换纯函数（tech-design §4.3，导出供自验 harness 断言） =================

// 规则 key → 字段路径 segments。规则 key 形如 "permission.<surface>.<pattern>"
// （pattern 可含点/空格，如 "permission.bash.rm *"、"permission.task list"（标量
// surface 带空格）、"permission.path.*"）或顶层键（"yoloMode" 等）。正则限定
// surface 不含点：map-entry 的 pattern 部分原样保留（含点安全）。
export function segmentsOf(key) {
  const m = /^permission\.([^.]+)\.(.*)$/.exec(key);
  if (m) return ["permission", m[1], m[2]];
  return key.split(".");
}

function getAt(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

// 删除字段路径；空容器级联删除（"permission.bash" 清空后连 permission.bash 一起
// 删——最小覆盖集形态，ADR-022 取消覆盖=删除）。
function deleteAt(obj, segments) {
  if (!obj || typeof obj !== "object") return;
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    delete obj[head];
    return;
  }
  const child = obj[head];
  if (child && typeof child === "object") {
    deleteAt(child, rest);
    if (Object.keys(child).length === 0) delete obj[head];
  }
}

function setAt(obj, segments, value) {
  let cur = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!cur[seg] || typeof cur[seg] !== "object") cur[seg] = {};
    cur = cur[seg];
  }
  cur[segments[segments.length - 1]] = value;
}

// GET rules → 面板覆盖态初始化：projectOverridden 的规则值全部进入 overrides
//（面板未改动的行保存时原样写回 → permission 面内自定义字段自动保留）。
export function overridesFromRules(rules) {
  const overrides = {};
  for (const rule of rules ?? []) {
    if (rule.projectOverridden && rule.value !== null && rule.value !== undefined) {
      overrides[rule.key] = rule.value;
    }
  }
  return overrides;
}

// 面板状态 → 项目 JSON（保存 payload）：
// 1. 原 project JSON 为底；2. 删除 rules 认识的键（面板整体重建）；3. 合入面板
// 覆盖值（跟随全局的键不在 overrides → 不写 = 删除语义）。rules 之外的键
// （permission 面内自定义 surface/pattern 之外不存在——buildRules 覆盖 merged
// permission 全键；顶层 $schema 等）保留原样。
export function buildProjectJson(rules, originalProject, overrides) {
  const payload =
    originalProject && typeof originalProject === "object" && !Array.isArray(originalProject)
      ? JSON.parse(JSON.stringify(originalProject))
      : {};
  const known = new Set((rules ?? []).map((r) => r.key));
  for (const rule of rules ?? []) deleteAt(payload, segmentsOf(rule.key));
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!known.has(key)) continue;
    setAt(payload, segmentsOf(key), value);
  }
  return payload;
}

// JSON 模式文本 → 面板覆盖态（json → vis 切换时重新推导；未知键自然忽略，
// 由 originalProject 保留）。
export function overridesFromProjectJson(rules, projectJson) {
  const overrides = {};
  for (const rule of rules ?? []) {
    const value = getAt(projectJson, segmentsOf(rule.key));
    if (value !== undefined) overrides[rule.key] = value;
  }
  return overrides;
}

// ================= 分组（family → 组名/顺序，对齐 UX 原型组形态） =================

const GROUP_ORDER = [
  "destructive-fs",
  "privilege-escalation",
  "redirect",
  "pipe-to-shell",
  "process",
  "file-permission",
  "disk",
  "git-force-push",
  "global-install",
  "bash",
  "tool",
  "path",
  "external_directory",
  "chain",
  "未分组",
];

const GROUP_TITLES = {
  "destructive-fs": "删除文件",
  "privilege-escalation": "提权与系统操作",
  redirect: "重定向 / 管道",
  "pipe-to-shell": "管道到 Shell",
  process: "进程管理",
  "file-permission": "文件权限",
  disk: "磁盘操作",
  "git-force-push": "强制推送",
  "global-install": "全局安装",
  bash: "bash 命令",
  tool: "工具级裁决",
  path: "path 白名单",
  external_directory: "外部目录",
  chain: "授权链与开关",
  "未分组": "未分组",
};

const GROUP_DESCS = {
  "destructive-fs": "rm / rmdir / mv · 高危",
  "privilege-escalation": "sudo / chmod / chown / dd / mkfs",
  process: "kill / pkill",
  "file-permission": "chmod / chown",
  disk: "dd / mkfs",
  "git-force-push": "git push --force",
  "global-install": "npm / pnpm / yarn -g",
  tool: "read/write/edit/… 允许或询问",
  path: "允许直接访问的路径",
  external_directory: "项目目录外的访问面",
  chain: "authorizerChain · yoloMode · debugLog · …",
};

function groupOrderOf(family) {
  const idx = GROUP_ORDER.indexOf(family);
  return idx === -1 ? GROUP_ORDER.length : idx;
}

export function groupRules(rules) {
  const groups = new Map();
  for (const rule of rules ?? []) {
    const family = rule.family || "未分组";
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push(rule);
  }
  return [...groups.entries()]
    .sort((a, b) => groupOrderOf(a[0]) - groupOrderOf(b[0]))
    .map(([family, list]) => ({ family, rules: list }));
}

// ================= 展示小工具 =================

function formatValue(value) {
  if (value === "allow") return "允许 allow";
  if (value === "ask") return "询问 ask";
  if (typeof value === "boolean") return value ? "开" : "关";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "（空）";
  if (value === undefined || value === null) return "—";
  return String(value);
}

// allow/ask 双态段控件（[data-perm-seg]；E2E 契约：按钮文案「允许」「询问」）。
function Seg({ value, onChange }) {
  return (
    <span className="seg" data-perm-seg>
      <button
        type="button"
        className={value === "allow" ? "on" : ""}
        onClick={() => onChange("allow")}
      >
        允许
      </button>
      <button
        type="button"
        className={value === "ask" ? "on" : ""}
        onClick={() => onChange("ask")}
      >
        询问
      </button>
    </span>
  );
}

function Toggle({ on, onToggle }) {
  return (
    <button
      type="button"
      className={`toggle${on ? " on" : ""}`}
      aria-pressed={on}
      onClick={onToggle}
    />
  );
}

// path/外部目录列表编辑器（全局条目只读基底 + 项目条目可删除 + 添加；重复/空
// 条目就地提示，PRD §7）。
function PathEditor({ family, rules, overrides, onSet, onReset }) {
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState(null);
  const patternRules = rules.filter((r) => r.type === "map-entry");
  const add = () => {
    const v = input.trim();
    if (!v) {
      setMsg("条目为空");
      return;
    }
    if (patternRules.some((r) => r.readable === v)) {
      setMsg(`条目重复：${v}`);
      return;
    }
    onSet(`permission.${family}.${v}`, "allow");
    setInput("");
    setMsg(null);
  };
  return (
    <div className="path-editor">
      <div className="path-list">
        {patternRules.map((r) => {
          const overridden = Object.hasOwn(overrides, r.key);
          return (
            <div key={r.key} className={`path-item${overridden ? " path-item--override" : ""}`}>
              <code>{r.readable}</code>
              {overridden && r.value !== "allow" && (
                <span className="path-val">{formatValue(r.value)}</span>
              )}
              {overridden && (
                <button
                  type="button"
                  className="del"
                  title="删除此条目（回到跟随全局）"
                  onClick={() => onReset(r.key)}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        {patternRules.length === 0 && <div className="path-empty">无条目</div>}
      </div>
      <div className="path-add">
        <input
          value={input}
          placeholder={family === "path" ? "添加路径 glob，如 src/** 或 /tmp/build-*" : "添加外部目录路径"}
          onChange={(e) => {
            setInput(e.target.value);
            setMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" onClick={add}>
          添加
        </button>
      </div>
      {msg && <div className="path-msg">{msg}</div>}
      <div className="rule-desc">全局默认：<code>*</code> 全部允许（read/ls 类）。项目未覆盖时跟随。</div>
    </div>
  );
}

// 数组字段列表编辑器（authorizerChain/piInfrastructureReadPaths；整体替换语义，
// ADR-022：编辑即覆盖整链；未覆盖时展示全局链 + 跟随全局标记）。
function ListEditor({ items, overridden, onSet, onReset, placeholder }) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (!v || items.includes(v)) return;
    onSet([...items, v]);
    setInput("");
  };
  return (
    <div className="list-editor">
      <div className="chain-row">
        {items.length === 0 && <span className="chain-empty">（空）</span>}
        {items.map((item, i) => (
          <span key={`${item}-${i}`} className="chain-item">
            {i > 0 && <span className="arrow">→</span>}
            <code>{item}</code>
            {overridden && (
              <button
                type="button"
                className="del"
                title="移除链条目"
                onClick={() => onSet(items.filter((x) => x !== item))}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="path-add">
        <input
          value={input}
          placeholder={placeholder ?? "添加条目"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" onClick={add}>
          添加
        </button>
      </div>
      {overridden && (
        <button type="button" className="reset-chip" onClick={onReset}>
          ↩ 跟随全局
        </button>
      )}
    </div>
  );
}

// 规则行（全局默认只读列 + 项目值列 + 覆盖标记列；[data-rule-row='<key>']）。
function RuleRow({ rule, overridden, effective, onSet, onReset }) {
  let editor;
  if (rule.type === "switch") {
    editor = <Toggle on={effective === true} onToggle={() => onSet(!effective)} />;
  } else if (rule.type === "array") {
    editor = (
      <ListEditor
        items={Array.isArray(effective) ? effective : []}
        overridden={overridden}
        onSet={(items) => onSet(items)}
        onReset={onReset}
        placeholder={rule.key === "authorizerChain" ? "添加授权器，如 opc-bridge" : "添加路径"}
      />
    );
  } else if (typeof rule.global === "number") {
    editor = (
      <input
        type="number"
        className="num-input"
        value={effective ?? ""}
        onChange={(e) => onSet(Number(e.target.value))}
      />
    );
  } else {
    editor = <Seg value={overridden ? effective : null} onChange={onSet} />;
  }
  return (
    <div className={`rule-row${overridden ? " row-overridden" : ""}`} data-rule-row={rule.key}>
      <div className="rule-name">
        <code>{rule.readable}</code>
        <div className="rule-desc">{rule.label}</div>
      </div>
      <div data-global-cell>
        <div className="col-label">全局默认</div>
        <div className="global-val">
          <span className="pill">{formatValue(rule.global)}</span>
          <span className="pill-tag">出厂默认</span>
        </div>
      </div>
      <div>
        <div className="col-label">项目值</div>
        <div className="project-val">
          {editor}
          <span className="val-side">
            {overridden ? (
              <button type="button" className="reset-chip" onClick={onReset}>
                ↩ 跟随全局
              </button>
            ) : (
              <span className="inherit-mark">跟随全局</span>
            )}
          </span>
        </div>
      </div>
      <div className="row-state">
        {overridden ? <span className="overridden-mark">项目已改</span> : ""}
      </div>
    </div>
  );
}

// 规则分组（组头 + 覆盖徽标 + 折叠）。
function RuleGroup({ group, overrides, onSet, onReset }) {
  const [closed, setClosed] = useState(false);
  const overrideCount = group.rules.filter((r) => Object.hasOwn(overrides, r.key)).length;
  const isListSurface = group.family === "path" || group.family === "external_directory";
  return (
    <div className={`rule-group${closed ? " closed" : ""}`}>
      <div
        className="group-head"
        onClick={() => setClosed((v) => !v)}
        role="button"
        aria-expanded={!closed}
      >
        <span className="chevron">▼</span>
        <span className="gname">
          {GROUP_TITLES[group.family] ?? group.family}
          {GROUP_DESCS[group.family] && <span className="rule-desc"> · {GROUP_DESCS[group.family]}</span>}
        </span>
        {overrideCount > 0 && (
          <span className="override-badge" data-override-badge>
            {overrideCount} 项已覆盖
          </span>
        )}
      </div>
      {!closed && (
        <div className="group-body">
          {isListSurface ? (
            <PathEditor
              family={group.family}
              rules={group.rules}
              overrides={overrides}
              onSet={onSet}
              onReset={onReset}
            />
          ) : (
            group.rules.map((rule) => (
              <RuleRow
                key={rule.key}
                rule={rule}
                overridden={Object.hasOwn(overrides, rule.key)}
                effective={Object.hasOwn(overrides, rule.key) ? overrides[rule.key] : rule.global}
                onSet={(value) => onSet(rule.key, value)}
                onReset={() => onReset(rule.key)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ================= 组件 =================

export default function PermissionConfigTab({ projectId }) {
  const [view, setView] = useState(null); // GET 响应 {global, project, merged, rules[]}
  const [loadError, setLoadError] = useState(null);
  const [mode, setMode] = useState("vis"); // "vis" | "json"
  const [jsonText, setJsonText] = useState(null); // JSON 模式文本（null = 未进入过）
  const [overrides, setOverrides] = useState({}); // 面板覆盖态：key → 覆盖值
  const [originalProject, setOriginalProject] = useState(null); // 视图转换保留底（rules 之外键）
  const [created, setCreated] = useState(false); // 已进入已配置态（新建配置点击/已有文件/坏文件）
  const [dirty, setDirty] = useState(false);
  const [savedHint, setSavedHint] = useState(null);
  const [error, setError] = useState(null); // {message, issues}
  const [saving, setSaving] = useState(false);

  const rules = view?.rules ?? [];

  const applyView = useCallback((data) => {
    setView(data);
    setOriginalProject(data.project);
    setOverrides(overridesFromRules(data.rules));
    // 坏文件（projectInvalid=true，E6）：进入已配置态（显示规则行 + 保存入口，
    // 保存即覆盖修复），而非「未配置」空态——空态只属于真正的未配置。
    setCreated(data.project !== null || data.projectInvalid === true);
    setJsonText(null);
    setDirty(false);
    setSavedHint(null);
    setError(null);
  }, []);

  const reload = useCallback(async () => {
    const data = await getProjectPermission(projectId);
    applyView(data);
  }, [projectId, applyView]);

  useEffect(() => {
    let disposed = false;
    setView(null);
    setLoadError(null);
    getProjectPermission(projectId)
      .then((data) => {
        if (disposed) return;
        applyView(data);
      })
      .catch((err) => {
        if (disposed) return;
        setLoadError(err?.message || String(err));
      });
    return () => {
      disposed = true;
    };
  }, [projectId, applyView]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setSavedHint(null);
    setError(null);
  }, []);

  const applyOverrides = useCallback(
    (updater) => {
      setOverrides((prev) => (typeof updater === "function" ? updater(prev) : updater));
      markDirty();
    },
    [markDirty]
  );

  const setRuleValue = useCallback(
    (key, value) => applyOverrides((prev) => ({ ...prev, [key]: value })),
    [applyOverrides]
  );

  const resetRule = useCallback(
    (key) =>
      applyOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      }),
    [applyOverrides]
  );

  const groups = useMemo(() => groupRules(rules), [rules]);

  // 模式切换：vis → json 从面板状态生成文本（所见即所存）；json → vis 解析文本
  // 重新推导面板覆盖态（非法 JSON 停留在 JSON 模式并提示，防数据丢失）。
  const switchToJson = useCallback(() => {
    if (mode === "json") return;
    setJsonText(JSON.stringify(buildProjectJson(rules, originalProject, overrides), null, 2));
    setMode("json");
    setError(null);
  }, [mode, rules, originalProject, overrides]);

  const switchToVis = useCallback(() => {
    if (mode === "vis") return;
    if (jsonText !== null) {
      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        setError({ message: `JSON 语法错误：${e.message}`, issues: [] });
        return; // 留在 JSON 模式
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError({ message: "配置必须是 JSON 对象", issues: [] });
        return;
      }
      setOverrides(overridesFromProjectJson(rules, parsed));
      setOriginalProject(parsed);
      setError(null);
    }
    setMode("vis");
  }, [mode, jsonText, rules]);

  const handleCreate = useCallback(() => {
    setCreated(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setError(null);
    setSavedHint(null);
    let payload;
    if (mode === "json") {
      try {
        payload = JSON.parse(jsonText);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("配置必须是 JSON 对象");
        }
      } catch (e) {
        setError({ message: `JSON 语法错误：${e.message}`, issues: [] });
        return;
      }
    } else {
      payload = buildProjectJson(rules, originalProject, overrides);
    }
    setSaving(true);
    try {
      await putProjectPermission(projectId, payload);
      await reload(); // 先刷新继承视图（applyView 会清 savedHint——提示后置）
      setSavedHint("已保存，规则已生效");
      setDirty(false);
    } catch (err) {
      setError({
        message: err?.message || String(err),
        issues: Array.isArray(err?.issues) ? err.issues : [],
      });
    } finally {
      setSaving(false);
    }
  }, [saving, mode, jsonText, rules, originalProject, overrides, projectId, reload]);

  if (loadError) {
    return (
      <div className="perm-load-error" data-testid="perm-error-banner">
        权限配置加载失败：{loadError}
      </div>
    );
  }
  if (!view) {
    return <p className="perm-loading">加载中…</p>;
  }

  return (
    <div className="perm-body" data-testid="permission-config-tab">
      {/* 顶栏：模式切换 + 状态提示 + 保存 */}
      <div className="perm-toolbar">
        <div className="mode-switch">
          <button
            type="button"
            className={`mode-btn${mode === "vis" ? " active" : ""}`}
            data-perm-mode="vis"
            onClick={switchToVis}
          >
            可视化
          </button>
          <button
            type="button"
            className={`mode-btn${mode === "json" ? " active" : ""}`}
            data-perm-mode="json"
            onClick={switchToJson}
          >
            JSON
          </button>
        </div>
        {dirty && <span className="dirty-hint">● 有未保存的更改</span>}
        {savedHint && (
          <span className="saved-hint" data-testid="perm-saved-hint">
            ✓ {savedHint}
          </span>
        )}
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="save-btn"
          data-testid="perm-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {/* 校验错误条（400 E-PERMISSION-INVALID issues 定位） */}
      {error && (
        <div className="error-banner" data-testid="perm-error-banner">
          <span className="err-head">保存被拦截：</span>
          <div className="err-body">
            <div className="err-msg">{error.message}</div>
            {Array.isArray(error.issues) && error.issues.length > 0 && (
              <ul className="err-issues">
                {error.issues.map((issue, idx) => (
                  <li key={idx}>
                    <code>{issue.path}</code> {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* 坏文件提示（E6，projectInvalid=true）：文件被外部改坏 → 按全局默认展示 +
          提示（区别于「未配置」空态），保存即覆盖修复（保存入口始终可用）。 */}
      {view.projectInvalid && (
        <div className="invalid-banner" data-testid="perm-invalid-banner">
          配置文件已损坏，已按全局默认处理——重新保存可修复
        </div>
      )}

      {/* ============ 可视化模式（继承视图） ============ */}
      {mode === "vis" && (
        <div className="vis-mode">
          {!created && (
            <div className="empty-state" data-testid="perm-empty-state">
              <div className="big">未配置，全部跟随全局</div>
              <div className="small">
                此项目尚未创建权限配置。创建后将生成{" "}
                <code>.pi/extensions/pi-permission-system/config.json</code>，保存即生效。
              </div>
              <button type="button" className="create-btn" data-testid="perm-create-btn" onClick={handleCreate}>
                新建配置
              </button>
            </div>
          )}

          {groups.map((group) => (
            <RuleGroup
              key={group.family}
              group={group}
              overrides={overrides}
              onSet={setRuleValue}
              onReset={resetRule}
            />
          ))}

          <div className="footnote">
            项目只覆盖你改的条目，未改的继承全局——保存时只写入改动字段，取消覆盖（跟随全局）即从项目文件删除该字段。
            <br />
            JSON 高级模式中手写的 <b>permission 面内</b> 自定义字段（自定义 surface/pattern）不会被面板保存冲掉；
            顶层未知键会被保存校验拦截（400，防止运行侧权限整体失效）。
          </div>
        </div>
      )}

      {/* ============ JSON 高级模式 ============ */}
      {mode === "json" && (
        <div className="json-mode">
          <div className="custom-field-note">
            <b>ℹ 自定义字段保护</b>：面板无法识别的 <b>permission 面内</b> 字段（自定义
            surface/pattern）将保留在文件中，切换可视化保存不会被冲掉；<b>顶层未知键</b>{" "}
            会被保存校验拦截（400，防运行侧整集 fail-closed）。
          </div>
          <textarea
            className="json-editor"
            data-testid="perm-json-editor"
            spellCheck="false"
            value={jsonText ?? JSON.stringify(buildProjectJson(rules, originalProject, overrides), null, 2)}
            onChange={(e) => {
              setJsonText(e.target.value);
              markDirty();
            }}
          />
        </div>
      )}
    </div>
  );
}
