// src/renderer/components/project/McpPermissionGroup.jsx
// 权限配置「MCP 工具」规则族（REQ-AGENT-087 UI 面）。
//
// UX 参照：ux/permission-mcp-group.html（已定稿 2026-08-13；BUG-014 就地补全
// 2026-08-16）。结构契约锚点：
//   [data-testid='perm-family-mcp']      族分组（与 bash/read 族同构，三态裁决）
//   [data-testid='perm-rule-row']        规则行（pattern = server:tool glob）
//   [data-testid='perm-rule-verdict']    allow/ask/deny 三态切换（button[data-v]）
//   [data-testid='perm-rule-add'] / [data-testid='perm-rule-add-submit']
//   项目覆盖高亮（.override-tag「项目已改」）
//   BUG-014 录入选择器：perm-rule-server-select / perm-rule-tool-select /
//   perm-rule-freeform-toggle / perm-rule-input（手填 glob 高级入口，默认隐藏）
//
// 出厂零预置规则（signoff D4）：`permission.mcp = { "*": "ask" }` 是族默认（族头
// 「未匹配默认 ask」），不是规则行——规则行只列用户规则（项目覆盖层写入的
// server:tool glob）。数据面已由 permissionConfigService.buildRules 跳过默认 `*`。
//
// BUG-014（REQ-AGENT-087 默认层注记）：本族语义 = 项目覆盖——用户级默认权限在
// 「MCP」页编辑（存 workstation DB），经视图层合并进规则行 global 值
//（行 global = 用户默认，无默认则出厂 ask）；本页写入即项目覆盖，命中即高亮
// 「项目已改」。录入从手填 input 升级为共享选择器 McpRulePicker（server 下拉 →
// 探测拉工具下拉；手填 glob 降为高级入口）。
//
// 双模式：
// - projectId 给定（权限配置页签/项目档位）：自管理持久化——新增/切换裁决/删除
//   → PUT /api/projects/:id/permission 即保存并 reload，不依赖面板顶部 Save 按钮
//   （E2E 契约：规则行三态切换刷新后持久）。每次保存后经 onSaved(projectConfig)
//   通知父面板更新 originalProject，避免父面板保存（buildProjectJson 不删除/不
//   重写 permission.mcp.*）时冲掉本组已保存的规则。
// - projectId 为空（#/workspace 页面级呈现，未绑定项目）：纯本地状态（规则行
//   增改删仅内存，不落库）——满足 E2E 呈现契约；真实编辑在项目权限配置页签完成。

import { useCallback, useEffect, useMemo, useState } from "react";
import { getProjectPermission, putProjectPermission } from "../../api/projects.js";
import McpRulePicker from "../mcp/McpRulePicker.jsx";
import "./PermissionConfigTab.css";

const VERDICTS = ["allow", "ask", "deny"];

export default function McpPermissionGroup({ projectId, onSaved }) {
  const [view, setView] = useState(null);
  const [localRows, setLocalRows] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [closed, setClosed] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) {
      setView({ rules: [] });
      return;
    }
    try {
      const data = await getProjectPermission(projectId);
      setView(data);
      setLoadError(null);
    } catch (err) {
      setView({ rules: [] });
      setLoadError(err?.message || String(err));
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const rows = useMemo(() => {
    if (!projectId) return localRows;
    const out = [];
    for (const rule of view?.rules ?? []) {
      if (rule.family === "mcp") {
        out.push({
          key: rule.key,
          pattern: rule.readable,
          global: rule.global,
          value: rule.value,
          overridden: rule.projectOverridden,
        });
      }
    }
    return out;
  }, [projectId, view, localRows]);

  const effectiveVerdict = (row) => (row.overridden ? row.value : (row.global ?? "ask"));

  // 基础配置 = 当前项目文件原样（GET view.project），叠加本组改动后 PUT 落盘。
  const baseConfig = () =>
    view?.project && typeof view.project === "object" && !Array.isArray(view.project)
      ? JSON.parse(JSON.stringify(view.project))
      : {};

  const save = async (config) => {
    if (saving || !projectId) return;
    setSaving(true);
    setMsg(null);
    try {
      await putProjectPermission(projectId, config);
      await reload();
      onSaved?.(config);
    } catch (err) {
      setMsg(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const withMcp = (config, mutate) => {
    const next = config;
    next.permission = next.permission && typeof next.permission === "object" ? next.permission : {};
    next.permission.mcp =
      next.permission.mcp && typeof next.permission.mcp === "object" ? next.permission.mcp : {};
    mutate(next.permission.mcp);
    return next;
  };

  // BUG-014：录入校验在选择器内完成（picker 形态拼接 / freeform 校验含「:」）。
  const handleAdd = (p, verdict) => {
    if (!projectId) {
      setLocalRows((prev) => [
        ...prev,
        { key: `permission.mcp.${p}`, pattern: p, global: undefined, value: verdict, overridden: true },
      ]);
    } else {
      const config = withMcp(baseConfig(), (mcp) => {
        mcp[p] = verdict;
      });
      save(config);
    }
    setNewOpen(false);
    setMsg(null);
  };

  const setVerdict = (row, verdict) => {
    if (row.overridden && verdict === row.value) return;
    if (!projectId) {
      setLocalRows((prev) =>
        prev.map((r) => (r.key === row.key ? { ...r, value: verdict, overridden: true } : r))
      );
      return;
    }
    const config = withMcp(baseConfig(), (mcp) => {
      if (verdict === row.global) {
        delete mcp[row.pattern];
      } else {
        mcp[row.pattern] = verdict;
      }
    });
    save(config);
  };

  const deleteRule = (row) => {
    if (!projectId) {
      setLocalRows((prev) => prev.filter((r) => r.key !== row.key));
      return;
    }
    const config = withMcp(baseConfig(), (mcp) => {
      delete mcp[row.pattern];
    });
    save(config);
  };

  if (loadError) {
    return (
      <div className="mcp-family-load-error" data-testid="perm-family-mcp">
        MCP 规则加载失败：{loadError}
      </div>
    );
  }
  if (!view) {
    return <p className="perm-loading">加载中…</p>;
  }

  return (
    <div className={`family mcp-family${closed ? " closed" : " open"}`} data-testid="perm-family-mcp">
      <div
        className="family-head"
        role="button"
        aria-expanded={!closed}
        onClick={() => setClosed((v) => !v)}
      >
        <span className="family-caret">▸</span>
        <span className="family-name">MCP 工具</span>
        <span className="family-surface">mcp</span>
        <span className="family-default">
          规则 = <span className="pattern">server:tool</span> glob · 未匹配默认 <strong>ask</strong>
        </span>
      </div>
      {!closed && (
        <div className="family-rules">
          <table className="mcp-rules-table">
            <thead>
              <tr>
                <th>规则（server:tool）</th>
                <th>裁决</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const active = effectiveVerdict(row);
                return (
                  <tr key={row.key} data-testid="perm-rule-row">
                    <td>
                      {row.overridden && <span className="override-dot" title="项目已覆盖" />}
                      <span className="pattern">{row.pattern}</span>
                      {row.overridden && <span className="override-tag">项目已改</span>}
                    </td>
                    <td>
                      <div className="verdict-seg" data-testid="perm-rule-verdict">
                        {VERDICTS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            data-v={v}
                            className={active === v ? "active" : ""}
                            onClick={() => setVerdict(row, v)}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="btn-tertiary danger" onClick={() => deleteRule(row)}>
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && !newOpen && (
            <div className="mcp-empty-hint">暂无规则——未匹配任何规则的 MCP 调用默认 ask。</div>
          )}

          {newOpen && (
            <McpRulePicker
              className="new-rule open"
              testidPrefix="perm-rule"
              freeformTestid="perm-rule-input"
              onSubmit={handleAdd}
              onCancel={() => {
                setNewOpen(false);
                setMsg(null);
              }}
              onError={setMsg}
            />
          )}

          <div className="add-row">
            <button type="button" className="btn-tertiary" data-testid="perm-rule-add" onClick={() => setNewOpen(true)}>
              + 添加规则
            </button>
          </div>
          {msg && <div className="path-msg">{msg}</div>}
          <div className="mcp-hint">
            默认权限在「MCP」页编辑（对所有项目生效）；本页规则为<strong>项目覆盖</strong>，命中即高亮「项目已改」；未匹配默认 ask。
          </div>
        </div>
      )}
    </div>
  );
}
