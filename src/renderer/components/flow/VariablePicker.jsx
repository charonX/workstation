import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getUpstreamVariableGroups } from "./upstreamVariables.js";

/**
 * Variable picker (REQ-FLOW-022): dropdown listing upstream variables
 * grouped by node. Selecting an entry calls onSelect(fullName); the
 * caller decides the insertion format (`n1.x` vs `{{n1.x}}`).
 */
export default function VariablePicker({ nodes, edges, currentNodeId, onSelect }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const groups = useMemo(
    () => getUpstreamVariableGroups(nodes, edges, currentNodeId),
    [nodes, edges, currentNodeId]
  );

  return (
    <div className="variable-picker" data-testid="variable-picker">
      <button
        type="button"
        className="btn btn-secondary variable-picker-toggle"
        data-testid="insert-variable-button"
        onClick={() => setOpen((value) => !value)}
      >
        {t("flowEditor.insertVariable")}
      </button>
      {open && (
        <div className="variable-picker-dropdown" data-testid="variable-picker-dropdown">
          {groups.length === 0 ? (
            <div className="variable-picker-empty">
              {t("flowEditor.noUpstreamVariables")}
            </div>
          ) : (
            groups.map((group) => (
              <div className="variable-picker-group" key={group.nodeId}>
                <div className="variable-picker-group-title">{group.nodeName}</div>
                {group.variables.map((variable) => (
                  <button
                    type="button"
                    key={variable.fullName}
                    className="variable-picker-item"
                    onClick={() => {
                      onSelect(variable.fullName);
                      setOpen(false);
                    }}
                  >
                    <span className="variable-picker-name">{variable.name}</span>
                    <span className="variable-picker-type">{variable.type}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
