import React, { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

const PINNED = ["claude-code", "codex", "opencode", "cursor", "kimi-code-cli"];

/**
 * Agent type multi-select (REQ-WORKSPACE-012).
 *
 * Props:
 *   - value: string[] — currently selected agent keys
 *   - onChange: (next: string[]) => void
 *   - invalidKeys?: Set<string> — keys present in value but missing from the live
 *     registry (drift marker, REQ-WORKSPACE-013); rendered as a persistent
 *     option with an invalid badge and kept checked.
 *   - agents?: Array<{name, displayName, skillsDir}> — optional pre-fetched
 *     registry; when omitted the component fetches GET /api/agents on mount.
 */
export default function AgentTypeMultiSelect({ value = [], onChange, invalidKeys, agents }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [internalAgents, setInternalAgents] = useState(agents || null);

  useEffect(() => {
    if (agents) {
      setInternalAgents(agents);
      return;
    }
    let cancelled = false;
    fetch(`${window.opc?.apiBaseUrl || ""}/api/agents`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setInternalAgents(data);
      })
      .catch(() => {
        if (!cancelled) setInternalAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [agents]);

  const selected = useMemo(() => new Set(value), [value]);

  const { pinnedAgents, otherAgents } = useMemo(() => {
    if (!internalAgents) return { pinnedAgents: [], otherAgents: [] };
    const byName = new Map(internalAgents.map((a) => [a.name, a]));
    const pinnedList = PINNED.map((n) => byName.get(n)).filter(Boolean);
    const pinnedSet = new Set(pinnedList.map((a) => a.name));
    const rest = internalAgents
      .filter((a) => !pinnedSet.has(a.name))
      .slice()
      .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
    return { pinnedAgents: pinnedList, otherAgents: rest };
  }, [internalAgents]);

  const invalidOptions = useMemo(() => {
    if (!invalidKeys || invalidKeys.size === 0) return [];
    const known = new Set((internalAgents || []).map((a) => a.name));
    return [...invalidKeys]
      .filter((key) => !known.has(key))
      .map((key) => ({ name: key, displayName: key }));
  }, [invalidKeys, internalAgents]);

  const filterBy = (agent) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      agent.name.toLowerCase().includes(q) ||
      (agent.displayName || "").toLowerCase().includes(q)
    );
  };

  const filteredPinned = pinnedAgents.filter(filterBy);
  const filteredOthers = otherAgents.filter(filterBy);
  const filteredInvalid = invalidOptions.filter(filterBy);

  function toggle(key) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  }

  if (!internalAgents) {
    return <div className="agent-type-loading" data-testid="agent-type-multiselect">{t("projectForm.loadingAgents")}</div>;
  }

  return (
    <div className="agent-type-multiselect" data-testid="agent-type-multiselect">
      <input
        type="text"
        className="form-input agent-type-search"
        data-testid="agent-type-search-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("projectForm.agentSearchPlaceholder")}
      />

      {filteredPinned.length > 0 && (
        <div className="agent-type-group agent-type-pinned" data-testid="agent-type-pinned-group">
          <div className="agent-type-group-label">{t("projectForm.pinnedAgents")}</div>
          {filteredPinned.map((agent) => (
            <OptionRow
              key={agent.name}
              agent={agent}
              checked={selected.has(agent.name)}
              invalid={false}
              onToggle={() => toggle(agent.name)}
            />
          ))}
        </div>
      )}

      {filteredInvalid.length > 0 && (
        <div className="agent-type-group agent-type-invalid">
          <div className="agent-type-group-label">{t("projectForm.invalidAgents")}</div>
          {filteredInvalid.map((agent) => (
            <OptionRow
              key={agent.name}
              agent={agent}
              checked={selected.has(agent.name)}
              invalid
              onToggle={() => toggle(agent.name)}
            />
          ))}
        </div>
      )}

      {filteredOthers.length > 0 && (
        <div className="agent-type-group agent-type-others">
          <div className="agent-type-group-label">{t("projectForm.otherAgents")}</div>
          {filteredOthers.map((agent) => (
            <OptionRow
              key={agent.name}
              agent={agent}
              checked={selected.has(agent.name)}
              invalid={false}
              onToggle={() => toggle(agent.name)}
            />
          ))}
        </div>
      )}

      {filteredPinned.length + filteredOthers.length + filteredInvalid.length === 0 && (
        <div className="agent-type-empty">{t("projectForm.noAgentsFound")}</div>
      )}
    </div>
  );
}

function OptionRow({ agent, checked, invalid, onToggle }) {
  return (
    <label
      className={`agent-type-option ${invalid ? "agent-type-option--invalid" : ""}`}
      data-testid="agent-type-option"
      data-agent-name={agent.name}
    >
      <input type="checkbox" checked={!!checked} onChange={onToggle} />
      <span className="agent-type-option-main">
        <span className="agent-type-option-name">{agent.displayName || agent.name}</span>
        <span className="agent-type-option-key">{agent.name}</span>
      </span>
      {invalid && (
        <span className="agent-type-invalid-badge" data-testid="agent-type-invalid-badge">
          !
        </span>
      )}
    </label>
  );
}
