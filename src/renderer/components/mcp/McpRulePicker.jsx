// src/renderer/components/mcp/McpRulePicker.jsx
// MCP 权限规则录入选择器（BUG-014，REQ-AGENT-087 默认层注记「录入选择器两页同构」）：
// server 下拉（已配置清单，GET /api/mcp）→ 选中探测拉工具下拉（probeTools，含
// 「*（全部工具）」）→ 三态裁决 → 提交 server:tool 规则；保留手填 glob 高级入口
//（freeform-toggle 切换，探测失败的 server 亦可手填——UX 参照 broken-svc 演示分支）。
//
// 调用方：
//   MCP 页默认权限区（Mcp.jsx）：testidPrefix="mcp-perm"，className="perm-add"
//   项目页 mcp 族（McpPermissionGroup.jsx）：testidPrefix="perm-rule"，className="new-rule open"
// testid 契约（REQ-AGENT-087 注记）：<prefix>-server-select / <prefix>-tool-select /
// <prefix>-add-submit / <prefix>-freeform-toggle；freeform 输入框 testid 两页不同
//（mcp-perm-freeform-input vs perm-rule-input——沿用既有签核锚点），由 freeformTestid 传入。

import { useEffect, useRef, useState } from "react";
import { listMcpServers, listMcpTools } from "../../api/plugins.js";

const VERDICTS = ["allow", "ask", "deny"];

export default function McpRulePicker({ className, testidPrefix, freeformTestid, onSubmit, onCancel, onError }) {
  const [servers, setServers] = useState([]);
  const [server, setServer] = useState("");
  const [tools, setTools] = useState([]);
  const [tool, setTool] = useState("*");
  const [probeError, setProbeError] = useState(null);
  const [freeform, setFreeform] = useState(false);
  const [freeformText, setFreeformText] = useState("");
  const [verdict, setVerdict] = useState("ask");
  const probeSeq = useRef(0);

  useEffect(() => {
    listMcpServers()
      .then((rows) => setServers(Array.isArray(rows) ? rows : []))
      .catch(() => setServers([]));
  }, []);

  const pickServer = async (name) => {
    setServer(name);
    setTool("*");
    setTools([]);
    setProbeError(null);
    if (!name) return;
    // 陈旧响应丢弃（快速切换 server 时旧探测后回不得覆盖新选择）。
    const seq = ++probeSeq.current;
    try {
      const res = await listMcpTools(name);
      if (probeSeq.current !== seq) return;
      setTools(Array.isArray(res?.tools) ? res.tools : []);
    } catch (err) {
      if (probeSeq.current !== seq) return;
      // 连接失败不阻断录入——呈提示，可切手填 glob。
      setProbeError(err?.message || String(err));
    }
  };

  const submit = () => {
    let pattern;
    if (freeform) {
      pattern = freeformText.trim();
      if (!pattern.includes(":")) {
        onError?.("规则须为 server:tool 形态，如 local-db:query_*");
        return;
      }
    } else {
      if (!server) {
        onError?.("请先选择 server");
        return;
      }
      pattern = `${server}:${tool || "*"}`;
    }
    onError?.(null);
    onSubmit(pattern, verdict);
    setFreeformText("");
  };

  return (
    <div className={`${className ?? ""}${freeform ? " freeform-on" : ""}`.trim()}>
      <select
        data-testid={`${testidPrefix}-server-select`}
        value={server}
        onChange={(e) => pickServer(e.target.value)}
      >
        <option value="">选择 server…</option>
        {servers.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        data-testid={`${testidPrefix}-tool-select`}
        value={tool}
        onChange={(e) => setTool(e.target.value)}
      >
        <option value="*">*（全部工具）</option>
        {tools.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>
      <input
        className="freeform"
        data-testid={freeformTestid}
        placeholder="手填 server:tool glob，如 local-db:query_*"
        value={freeformText}
        onChange={(e) => setFreeformText(e.target.value)}
      />
      <div className="verdict-seg" data-testid={`${testidPrefix}-new-verdict`}>
        {VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            data-v={v}
            className={verdict === v ? "active" : ""}
            onClick={() => setVerdict(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <button type="button" className="btn-tertiary" data-testid={`${testidPrefix}-add-submit`} onClick={submit}>
        添加
      </button>
      {onCancel && (
        <button type="button" className="btn-tertiary" onClick={onCancel}>
          取消
        </button>
      )}
      <button
        type="button"
        className="freeform-toggle"
        data-testid={`${testidPrefix}-freeform-toggle`}
        onClick={() => setFreeform((v) => !v)}
      >
        {freeform ? "返回选择器" : "手填 glob"}
      </button>
      {probeError && !freeform && (
        <span className="picker-probe-error">连接失败：{probeError}（可手填 glob）</span>
      )}
    </div>
  );
}
