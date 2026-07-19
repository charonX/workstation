import { useRef } from "react";
import { useTranslation } from "react-i18next";
import VariablePicker from "./VariablePicker.jsx";
import { VARIABLE_TYPES } from "./validateFlowNodes.js";

// Node types refined by this story (REQ-FLOW-018~021): these render the
// per-type config fields plus the shared retries/onError section.
const REFINED_NODE_TYPES = ["trigger", "condition", "agent"];

// Legacy mock-adapter models plus the Claude Agent SDK model (tech-design §5.4).
const MODEL_OPTIONS = [
  { value: "codex", label: "Codex" },
  { value: "claude-code", label: "Claude Code" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
];

/**
 * Node properties panel for the Flow Editor.
 * Covers the three refined node types (trigger / condition / agent,
 * REQ-FLOW-018~021) and keeps the legacy field sets for the other types.
 * Edits are applied to canvas state immediately; persistence happens via
 * the editor-level Save button.
 */
export default function NodeConfigPanel({
  node,
  nodes,
  edges,
  onUpdateData,
  onUpdateConfig,
  onDelete,
}) {
  const { t } = useTranslation();

  if (!node) {
    return (
      <>
        <h2 className="properties-title">{t("flowEditor.nodeProperties")}</h2>
        <div className="properties-placeholder">{t("flowEditor.selectNode")}</div>
      </>
    );
  }

  const type = node.data?.type;
  const config = node.data?.config || {};
  const isRefinedType = REFINED_NODE_TYPES.includes(type);

  return (
    <>
      <h2 className="properties-title">{t("flowEditor.nodeProperties")}</h2>
      <div className="properties-form">
        <div className="form-group">
          <label className="form-label" htmlFor="node-name-input">
            {t("flowEditor.nodeName")}
          </label>
          <input
            id="node-name-input"
            type="text"
            className="form-input"
            data-testid="node-name-input"
            value={node.data?.label || ""}
            onChange={(e) => onUpdateData("label", e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="node-type-input">
            {t("flowEditor.nodeType")}
          </label>
          <input
            id="node-type-input"
            type="text"
            className="form-input"
            value={type || ""}
            readOnly
          />
        </div>
        {type !== "trigger" && (
          <div className="form-group">
            <label className="form-label" htmlFor="node-output-variable-input">
              {t("flowEditor.outputVariable")}
            </label>
            <input
              id="node-output-variable-input"
              type="text"
              className="form-input"
              data-testid="node-output-variable-input"
              value={
                type === "agent"
                  ? config.outputVariable || ""
                  : node.data?.outputVariable || ""
              }
              onChange={(e) =>
                type === "agent"
                  ? onUpdateConfig("outputVariable", e.target.value)
                  : onUpdateData("outputVariable", e.target.value)
              }
            />
          </div>
        )}

        {type === "trigger" && <TriggerFields config={config} onChange={onUpdateConfig} t={t} />}
        {type === "condition" && (
          <ConditionFields
            config={config}
            onChange={onUpdateConfig}
            nodes={nodes}
            edges={edges}
            nodeId={node.id}
            t={t}
          />
        )}
        {type === "agent" && (
          <AgentFields
            config={config}
            onChange={onUpdateConfig}
            nodes={nodes}
            edges={edges}
            nodeId={node.id}
            t={t}
          />
        )}
        {type === "forEach" && <ForEachFields config={config} onChange={onUpdateConfig} t={t} />}
        {type === "while" && <WhileFields config={config} onChange={onUpdateConfig} t={t} />}
        {type === "output" && <OutputFields config={config} onChange={onUpdateConfig} t={t} />}

        {isRefinedType && <ErrorHandlingFields config={config} onChange={onUpdateConfig} t={t} />}

        <button
          className="btn btn-danger"
          data-testid="node-delete-button"
          onClick={onDelete}
        >
          {t("flowEditor.deleteNode")}
        </button>
      </div>
    </>
  );
}

function TriggerFields({ config, onChange, t }) {
  const variables = Array.isArray(config.outputVariables) ? config.outputVariables : [];
  const setVariables = (next) => onChange("outputVariables", next);
  const updateVariable = (index, patch) =>
    setVariables(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  return (
    <div className="form-group variables-editor" data-testid="trigger-variables-editor">
      <span className="form-label">{t("flowEditor.variables")}</span>
      {variables.map((variable, index) => (
        <div className="variable-row" data-testid="variable-row" key={index}>
          <label className="form-label" htmlFor={`variable-name-${index}`}>
            {t("flowEditor.variableName")}
          </label>
          <input
            id={`variable-name-${index}`}
            type="text"
            className="form-input"
            data-testid="variable-name-input"
            value={variable.name || ""}
            onChange={(e) => updateVariable(index, { name: e.target.value })}
          />
          <label className="form-label" htmlFor={`variable-type-${index}`}>
            {t("flowEditor.variableType")}
          </label>
          <select
            id={`variable-type-${index}`}
            className="form-input"
            data-testid="variable-type-select"
            value={variable.type || "string"}
            onChange={(e) => updateVariable(index, { type: e.target.value })}
          >
            {VARIABLE_TYPES.map((variableType) => (
              <option key={variableType} value={variableType}>
                {variableType}
              </option>
            ))}
          </select>
          <label className="form-label" htmlFor={`variable-default-${index}`}>
            {t("flowEditor.defaultValue")}
          </label>
          <input
            id={`variable-default-${index}`}
            type="text"
            className="form-input"
            data-testid="variable-default-input"
            value={variable.defaultValue ?? ""}
            onChange={(e) => updateVariable(index, { defaultValue: e.target.value })}
          />
          <button
            type="button"
            className="btn btn-secondary variable-remove-button"
            data-testid="remove-variable-button"
            onClick={() => setVariables(variables.filter((_, i) => i !== index))}
          >
            {t("flowEditor.removeVariable")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        data-testid="add-variable-button"
        onClick={() =>
          setVariables([...variables, { name: "", type: "string", defaultValue: "" }])
        }
      >
        {t("flowEditor.addVariable")}
      </button>
    </div>
  );
}

// Caret-tracked variable insertion shared by the Condition and Agent
// fields: records the last caret position in the target input, then
// splices the picked variable (formatted by the caller) in at that spot.
function useCaretInsertion(config, field, onChange, formatInsertion) {
  const caretRef = useRef(null);
  const recordCaret = (e) => {
    caretRef.current = e.target.selectionStart;
  };
  const insertVariable = (fullName) => {
    const current = config[field] || "";
    const caret = caretRef.current ?? current.length;
    onChange(field, current.slice(0, caret) + formatInsertion(fullName) + current.slice(caret));
  };
  return { recordCaret, insertVariable };
}

function ConditionFields({ config, onChange, nodes, edges, nodeId, t }) {
  // Condition expressions reference variables as bare fullName (signoff decision 3).
  const { recordCaret, insertVariable } = useCaretInsertion(
    config,
    "expression",
    onChange,
    (fullName) => fullName
  );

  return (
    <div className="form-group">
      <label className="form-label" htmlFor="condition-expression-input">
        {t("flowEditor.expression")}
      </label>
      <input
        id="condition-expression-input"
        type="text"
        className="form-input"
        data-testid="condition-expression-input"
        placeholder={t("flowEditor.expressionPlaceholder")}
        value={config.expression || ""}
        onChange={(e) => onChange("expression", e.target.value)}
        onSelect={recordCaret}
        onClick={recordCaret}
        onKeyUp={recordCaret}
      />
      <div className="help-text" data-testid="condition-expression-help">
        {t("flowEditor.expressionHelp")}
      </div>
      <VariablePicker nodes={nodes} edges={edges} currentNodeId={nodeId} onSelect={insertVariable} />
    </div>
  );
}

function AgentFields({ config, onChange, nodes, edges, nodeId, t }) {
  // Agent prompts interpolate variables as {{fullName}} (signoff decision 3).
  const { recordCaret, insertVariable } = useCaretInsertion(
    config,
    "prompt",
    onChange,
    (fullName) => `{{${fullName}}}`
  );

  return (
    <>
      <div className="form-group">
        <label className="form-label" htmlFor="agent-provider-select">
          {t("flowEditor.provider")}
        </label>
        <select
          id="agent-provider-select"
          className="form-input"
          data-testid="agent-provider-select"
          value={config.provider || ""}
          onChange={(e) => onChange("provider", e.target.value || undefined)}
        >
          <option value="">{t("flowEditor.providerNone")}</option>
          <option value="anthropic">{t("flowEditor.providerAnthropic")}</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="agent-model-select">
          {t("flowEditor.model")}
        </label>
        <select
          id="agent-model-select"
          className="form-input"
          data-testid="agent-model-select"
          value={config.model || "codex"}
          onChange={(e) => onChange("model", e.target.value)}
        >
          {MODEL_OPTIONS.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="agent-system-prompt-textarea">
          {t("flowEditor.systemPrompt")}
        </label>
        <textarea
          id="agent-system-prompt-textarea"
          className="form-textarea"
          data-testid="agent-system-prompt-textarea"
          value={config.systemPrompt || ""}
          onChange={(e) => onChange("systemPrompt", e.target.value)}
          rows={4}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="agent-prompt-textarea">
          {t("flowEditor.prompt")}
        </label>
        <textarea
          id="agent-prompt-textarea"
          className="form-textarea"
          data-testid="agent-prompt-textarea"
          value={config.prompt || ""}
          onChange={(e) => onChange("prompt", e.target.value)}
          onSelect={recordCaret}
          onClick={recordCaret}
          onKeyUp={recordCaret}
          rows={6}
        />
        <VariablePicker nodes={nodes} edges={edges} currentNodeId={nodeId} onSelect={insertVariable} />
      </div>
    </>
  );
}

function ErrorHandlingFields({ config, onChange, t }) {
  return (
    <>
      <div className="form-group">
        <label className="form-label" htmlFor="node-retries-input">
          {t("flowEditor.retries")}
        </label>
        <input
          id="node-retries-input"
          type="number"
          min="0"
          step="1"
          className="form-input"
          data-testid="node-retries-input"
          value={config.retries ?? 1}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange("retries", undefined);
              return;
            }
            const parsed = Number.parseInt(raw, 10);
            onChange("retries", Number.isNaN(parsed) ? undefined : Math.max(0, parsed));
          }}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="node-on-error-select">
          {t("flowEditor.onError")}
        </label>
        <select
          id="node-on-error-select"
          className="form-input"
          data-testid="node-on-error-select"
          value={config.onError || "fail"}
          onChange={(e) => onChange("onError", e.target.value)}
        >
          <option value="fail">{t("flowEditor.onErrorFail")}</option>
          <option value="ignore">{t("flowEditor.onErrorIgnore")}</option>
        </select>
      </div>
    </>
  );
}

function ForEachFields({ config, onChange, t }) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor="foreach-array-input">
        {t("flowEditor.arrayExpression")}
      </label>
      <input
        id="foreach-array-input"
        type="text"
        className="form-input"
        data-testid="foreach-array-input"
        value={config.array || ""}
        onChange={(e) => onChange("array", e.target.value)}
      />
    </div>
  );
}

function WhileFields({ config, onChange, t }) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor="while-expression-input">
        {t("flowEditor.expression")}
      </label>
      <input
        id="while-expression-input"
        type="text"
        className="form-input"
        data-testid="while-expression-input"
        value={config.expression || ""}
        onChange={(e) => onChange("expression", e.target.value)}
      />
    </div>
  );
}

function OutputFields({ config, onChange, t }) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor="output-path-input">
        {t("flowEditor.outputPath")}
      </label>
      <input
        id="output-path-input"
        type="text"
        className="form-input"
        data-testid="output-path-input"
        value={config.path || ""}
        onChange={(e) => onChange("path", e.target.value)}
      />
    </div>
  );
}
