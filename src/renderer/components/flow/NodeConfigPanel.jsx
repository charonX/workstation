import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import VariablePicker from "./VariablePicker.jsx";
import { VARIABLE_TYPES } from "./validateFlowNodes.js";
import { getUpstreamVariableGroups } from "./upstreamVariables.js";
import { listCallFlowCandidates } from "../../api/flows.js";
import { get } from "../../api/client.js";
import { NODE_REGISTRY } from "./nodeRegistry.js";

// Refined node types are the ones registered in the node registry.
const REFINED_NODE_TYPES = Object.keys(NODE_REGISTRY);

/**
 * Node properties panel for the Flow Editor.
 * Covers the refined node types and keeps the legacy field sets for the rest.
 * Edits are applied to canvas state immediately; persistence happens via the
 * editor-level Save button.
 */
export default function NodeConfigPanel({
  node,
  nodes,
  edges,
  onUpdateData,
  onUpdateConfig,
  onDelete,
  currentFlowId,
  onOpenSubflow,
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
        {type !== "trigger" && type !== "flowInput" && type !== "flowOutput" && type !== "setVariables" && (
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

        {(() => {
          const ConfigPanel = NODE_REGISTRY[type]?.configPanel || (type === "output" ? OutputFields : null);
          if (!ConfigPanel) return null;
          return (
            <ConfigPanel
              config={config}
              onChange={onUpdateConfig}
              t={t}
              nodeId={node.id}
              nodes={nodes}
              edges={edges}
              currentFlowId={currentFlowId}
              onOpenSubflow={onOpenSubflow}
            />
          );
        })()}

        {isRefinedType && type !== "callFlow" && <ErrorHandlingFields config={config} onChange={onUpdateConfig} t={t} />}

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

// Shared outputVariables editor used by trigger / flowInput / flowOutput.
// Same add/remove/rename affordances as the original TriggerFields.
function DeclaredVariablesFields({ config, onChange, t, testid, description }) {
  const variables = Array.isArray(config.outputVariables) ? config.outputVariables : [];
  const setVariables = (next) => onChange("outputVariables", next);
  const updateVariable = (index, patch) =>
    setVariables(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  return (
    <div className="form-group variables-editor" data-testid={testid}>
      <span className="form-label">{t("flowEditor.variables")}</span>
      {description && <div className="help-text">{description}</div>}
      {variables.map((variable, index) => (
        <div className="variable-row" data-testid="variable-row" key={index}>
          <label className="form-label" htmlFor={`variable-name-${testid}-${index}`}>
            {t("flowEditor.variableName")}
          </label>
          <input
            id={`variable-name-${testid}-${index}`}
            type="text"
            className="form-input"
            data-testid="variable-name-input"
            value={variable.name || ""}
            onChange={(e) => updateVariable(index, { name: e.target.value })}
          />
          <label className="form-label" htmlFor={`variable-type-${testid}-${index}`}>
            {t("flowEditor.variableType")}
          </label>
          <select
            id={`variable-type-${testid}-${index}`}
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
          <label className="form-label" htmlFor={`variable-default-${testid}-${index}`}>
            {t("flowEditor.defaultValue")}
          </label>
          <input
            id={`variable-default-${testid}-${index}`}
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

// REQ-FLOW-047 AC8: setVariables unified editor.
// Each row represents one output variable and its expression. Adding/removing a
// variable keeps outputVariables and expressions in sync; renaming a variable
// updates the matching expression name.
function SetVariablesFields({ config, onChange, t, nodeId, nodes, edges }) {
  const outputVariables = Array.isArray(config.outputVariables) ? config.outputVariables : [];
  const expressions = Array.isArray(config.expressions) ? config.expressions : [];

  const setOutputVariables = (next) => onChange("outputVariables", next);
  const setExpressions = (next) => onChange("expressions", next);

  const updateVariable = (index, patch) => {
    const oldName = outputVariables[index]?.name;
    const nextVars = outputVariables.map((v, i) => (i === index ? { ...v, ...patch } : v));
    setOutputVariables(nextVars);
    if ("name" in patch && oldName !== undefined) {
      const nextExprs = expressions.map((e) =>
        e.name === oldName ? { ...e, name: patch.name } : e
      );
      setExpressions(nextExprs);
    }
  };

  const addVariable = () => {
    setOutputVariables([...outputVariables, { name: "", type: "string" }]);
    setExpressions([...expressions, { name: "", expression: "" }]);
  };

  const removeVariable = (index) => {
    const removedName = outputVariables[index]?.name;
    setOutputVariables(outputVariables.filter((_, i) => i !== index));
    setExpressions(expressions.filter((e) => e.name !== removedName));
  };

  const updateExpression = (index, patch) => {
    setExpressions(
      expressions.map((e, i) => (i === index ? { ...(e || {}), ...patch } : e))
    );
  };

  // Caret-tracked insertion for expression fields (shared with FeishuSend/Condition).
  const caretRefs = useRef({});
  const recordCaret = (index) => (e) => {
    caretRefs.current[index] = e.target.selectionStart;
  };
  const makeInsertVariable = (index) => (fullName) => {
    const current = expressions[index]?.expression || "";
    const caret = caretRefs.current[index] ?? current.length;
    const insertion = `{{${fullName}}}`;
    updateExpression(index, {
      expression: current.slice(0, caret) + insertion + current.slice(caret),
    });
  };

  return (
    <div className="form-group variables-editor" data-testid="setvariables-output-variables-editor">
      <span className="form-label">{t("flowEditor.variables") || "Variables"}</span>
      <div className="help-text">
        {t("flowEditor.setVariablesHelp") ||
          "Assign values to variables. Use {{nodeId.varName}} to reference upstream variables."}
      </div>
      {outputVariables.map((variable, index) => (
        <div className="variable-row" data-testid="setvariable-row" key={index}>
          <label className="form-label" htmlFor={`setvar-name-${index}`}>
            {t("flowEditor.variableName")}
          </label>
          <input
            id={`setvar-name-${index}`}
            type="text"
            className="form-input"
            data-testid="setvariable-name-input"
            value={variable.name || ""}
            onChange={(e) => updateVariable(index, { name: e.target.value })}
          />
          <label className="form-label" htmlFor={`setvar-type-${index}`}>
            {t("flowEditor.variableType")}
          </label>
          <select
            id={`setvar-type-${index}`}
            className="form-input"
            data-testid="setvariable-type-select"
            value={variable.type || "string"}
            onChange={(e) => updateVariable(index, { type: e.target.value })}
          >
            {VARIABLE_TYPES.map((variableType) => (
              <option key={variableType} value={variableType}>
                {variableType}
              </option>
            ))}
          </select>
          <label className="form-label" htmlFor={`setvar-expr-${index}`}>
            {t("flowEditor.expression")}
          </label>
          <input
            id={`setvar-expr-${index}`}
            type="text"
            className="form-input"
            data-testid="setvariable-expression-input"
            value={expressions[index]?.expression || ""}
            onChange={(e) => updateExpression(index, { expression: e.target.value })}
            onSelect={recordCaret(index)}
            onClick={recordCaret(index)}
            onKeyUp={recordCaret(index)}
          />
          <VariablePicker
            nodes={nodes}
            edges={edges}
            currentNodeId={nodeId}
            onSelect={makeInsertVariable(index)}
          />
          <button
            type="button"
            className="btn btn-secondary variable-remove-button"
            data-testid="remove-setvariable-button"
            onClick={() => removeVariable(index)}
          >
            {t("flowEditor.removeVariable")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary"
        data-testid="add-setvariable-button"
        onClick={addVariable}
      >
        {t("flowEditor.addVariable")}
      </button>
    </div>
  );
}

function TriggerFields({ config, onChange, t }) {
  return (
    <DeclaredVariablesFields
      config={config}
      onChange={onChange}
      t={t}
      testid="trigger-variables-editor"
    />
  );
}

function FlowInputFields(props) {
  return (
    <DeclaredVariablesFields
      {...props}
      testid="flowinput-variables-editor"
      description={props.t("flowEditor.flowInputDescription")}
    />
  );
}

function FlowOutputFields(props) {
  return (
    <DeclaredVariablesFields
      {...props}
      testid="flowoutput-variables-editor"
      description={props.t("flowEditor.flowOutputDescription")}
    />
  );
}

const FEISHU_MESSAGE_FIXED_OUTPUTS = [
  { name: "text", type: "string", defaultValue: "" },
  { name: "sender", type: "string", defaultValue: "" },
  { name: "messageId", type: "string", defaultValue: "" }
];

function FeishuMessageFields({ config, onChange, t }) {
  // REQ-FLOW-031：固定输出 text/sender/messageId；用户可改 defaultValue，不可删除/重命名。
  const existing = Array.isArray(config.outputVariables) ? config.outputVariables : [];
  const byName = new Map(existing.map((v) => [v.name, v]));
  const variables = FEISHU_MESSAGE_FIXED_OUTPUTS.map((fixed) => ({
    ...fixed,
    ...byName.get(fixed.name)
  }));

  const updateVariable = (name, patch) => {
    const next = variables.map((v) => (v.name === name ? { ...v, ...patch } : v));
    onChange("outputVariables", next);
  };

  return (
    <div className="form-group variables-editor" data-testid="feishu-message-variables-editor">
      <span className="form-label">{t("flowEditor.variables")}</span>
      {variables.map((variable, index) => (
        <div className="variable-row" data-testid="variable-row" key={variable.name}>
          <label className="form-label" htmlFor={`variable-name-${index}`}>
            {t("flowEditor.variableName")}
          </label>
          <input
            id={`variable-name-${index}`}
            type="text"
            className="form-input"
            data-testid="variable-name-input"
            value={variable.name}
            readOnly
          />
          <label className="form-label" htmlFor={`variable-type-${index}`}>
            {t("flowEditor.variableType")}
          </label>
          <input
            id={`variable-type-${index}`}
            type="text"
            className="form-input"
            data-testid="variable-type-display"
            value={variable.type || "string"}
            readOnly
          />
          <label className="form-label" htmlFor={`variable-default-${index}`}>
            {t("flowEditor.defaultValue")}
          </label>
          <input
            id={`variable-default-${index}`}
            type="text"
            className="form-input"
            data-testid="variable-default-input"
            value={variable.defaultValue ?? ""}
            onChange={(e) => updateVariable(variable.name, { defaultValue: e.target.value })}
          />
        </div>
      ))}
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

// REQ-FLOW-032: 飞书消息预设格式（content JSON 模板）。
const FEISHU_SEND_PRESETS = [
  {
    label: "Text",
    msgType: "text",
    content: { text: "已存：{{node_id.path}}" }
  },
  {
    label: "Post (富文本)",
    msgType: "post",
    content: {
      zh_cn: {
        title: "链接速存完成",
        content: [[{ tag: "text", text: "已保存：" }], [{ tag: "a", text: "{{node_id.title}}", href: "{{node_id.url}}" }]]
      }
    }
  },
  {
    label: "Interactive Card",
    msgType: "interactive",
    content: {
      type: "template",
      data: {
        template_id: "",
        template_variable: { result: "{{node_id.summary}}" }
      }
    }
  }
];

function FeishuSendFields({ config, onChange, nodes, edges, nodeId, t }) {
  // REQ-FLOW-032: feishuSend msgType + JSON content with {{var}} interpolation.
  const { recordCaret, insertVariable } = useCaretInsertion(
    config,
    "content",
    onChange,
    (fullName) => `{{${fullName}}}`
  );

  const applyPreset = (preset) => {
    onChange("msgType", preset.msgType);
    onChange("content", JSON.stringify(preset.content, null, 2));
  };

  return (
    <>
      <div className="form-group">
        <label className="form-label">{t("flowEditor.messageType") || "消息类型"}</label>
        <select
          className="form-input"
          data-testid="feishu-send-msgtype-select"
          value={config.msgType || "text"}
          onChange={(e) => onChange("msgType", e.target.value)}
        >
          <option value="text">text（纯文本）</option>
          <option value="post">post（富文本）</option>
          <option value="interactive">interactive（卡片）</option>
          <option value="image">image</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">{t("flowEditor.presets") || "预设格式"}</label>
        <div style={{ display: "flex", gap: "var(--ch-space-2)", flexWrap: "wrap" }}>
          {FEISHU_SEND_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="feishu-send-content-textarea">
          {t("flowEditor.messageContent") || "消息内容（JSON，支持 {{nodeId.var}} 插值）"}
        </label>
        <textarea
          id="feishu-send-content-textarea"
          className="form-textarea"
          data-testid="feishu-send-content-textarea"
          value={config.content || ""}
          onChange={(e) => onChange("content", e.target.value)}
          onSelect={recordCaret}
          onClick={recordCaret}
          onKeyUp={recordCaret}
          rows={8}
          spellCheck={false}
          style={{ fontFamily: "var(--ch-font-mono, monospace)", fontSize: "12px" }}
        />
        <p className="help-text">{t("flowEditor.sendContentHelp") || "飞书消息 content JSON 字段。字符串值中的 {{nodeId.var}} 会被替换为对应变量（自动转义引号/换行）。默认回复原消息线程（reply）；取消勾选则在会话里新发送。"}</p>
        <VariablePicker nodes={nodes} edges={edges} currentNodeId={nodeId} onSelect={insertVariable} />
      </div>
      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "var(--ch-space-2)" }}>
          <input
            type="checkbox"
            data-testid="feishu-send-reply-toggle"
            checked={config.replyToMessage !== false}
            onChange={(e) => onChange("replyToMessage", e.target.checked)}
          />
          {t("flowEditor.replyToOriginalMessage") || "作为原消息的线程回复（否则直接发送到会话）"}
        </label>
      </div>
    </>
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

// ---------------------------------------------------------------------------
// callFlow configuration (REQ-FLOW-043 AC4 / REQ-FLOW-045)
// ---------------------------------------------------------------------------

// Fetch candidates once when the panel mounts and whenever the current flow id
// changes. Each candidate: {id, name, inputNodes: [{id, name, variables}]}.
function useCallFlowCandidates(currentFlowId) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentFlowId) {
      setCandidates([]);
      return undefined;
    }
    setLoading(true);
    setError(null);
    listCallFlowCandidates(currentFlowId)
      .then((list) => {
        if (!cancelled) setCandidates(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load subflows");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFlowId]);

  return { candidates, loading, error };
}

// Fetch the selected child flow (to read its flowOutput nodes for the
// read-only output-mappings table).
function useChildOutputs(targetFlowId) {
  const [outputs, setOutputs] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!targetFlowId) {
      setOutputs([]);
      return undefined;
    }
    get(`/api/flows/${targetFlowId}`)
      .then((flow) => {
        if (cancelled) return;
        const nodeList = Array.isArray(flow?.nodeList) ? flow.nodeList : [];
        const collected = [];
        for (const n of nodeList) {
          if (String(n?.type || "").toLowerCase() !== "flowoutput") continue;
          for (const v of Array.isArray(n.config?.outputVariables) ? n.config.outputVariables : []) {
            if (typeof v?.name === "string" && v.name) {
              collected.push({ nodeId: n.id, varName: v.name, type: v.type || "string" });
            }
          }
        }
        setOutputs(collected);
      })
      .catch(() => {
        if (!cancelled) setOutputs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [targetFlowId]);
  return outputs;
}

function CallFlowFields({
  config,
  onChange,
  t,
  nodeId,
  nodes,
  edges,
  currentFlowId,
  onOpenSubflow,
}) {
  const { candidates, loading, error } = useCallFlowCandidates(currentFlowId);
  const targetFlowId = config.targetFlowId || "";
  const selectedCandidate = candidates.find((c) => c.id === targetFlowId) || null;
  const inputNodes = Array.isArray(selectedCandidate?.inputNodes)
    ? selectedCandidate.inputNodes
    : [];

  // Auto-pick single-entry child on candidate change.
  useEffect(() => {
    if (!selectedCandidate) return;
    if (inputNodes.length === 1 && !config.targetInputNodeId) {
      onChange("targetInputNodeId", inputNodes[0].id);
    }
  }, [selectedCandidate, inputNodes, config.targetInputNodeId, onChange]);

  const entryNode =
    inputNodes.find((n) => n.id === config.targetInputNodeId) ||
    (inputNodes.length === 1 ? inputNodes[0] : null);

  const childOutputs = useChildOutputs(targetFlowId);

  // Derive output variables from the child flow's flowOutput nodes and write them
  // into config.outputVariables. The server regenerates them authoritatively on save.
  useEffect(() => {
    if (!targetFlowId) {
      if (Array.isArray(config.outputVariables) && config.outputVariables.length > 0) {
        onChange("outputVariables", []);
      }
      return;
    }
    const next = childOutputs.map((o) => ({ name: o.varName, type: o.type || "string" }));
    // Only update when materially different to avoid infinite loops.
    const existing = Array.isArray(config.outputVariables) ? config.outputVariables : [];
    const same =
      existing.length === next.length &&
      next.every((m, i) => existing[i] && existing[i].name === m.name && existing[i].type === m.type);
    if (!same) onChange("outputVariables", next);
  }, [targetFlowId, childOutputs]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputVars = Array.isArray(entryNode?.variables) ? entryNode.variables : [];
  const mappingsByChild = new Map(
    (Array.isArray(config.inputMappings) ? config.inputMappings : []).map((m) => [m.childVar, m])
  );

  const setMapping = (childVar, parentExpr) => {
    const existing = Array.isArray(config.inputMappings) ? config.inputMappings : [];
    const idx = existing.findIndex((m) => m.childVar === childVar);
    const nextMapping = { childVar, parentExpr };
    const next = idx >= 0
      ? existing.map((m, i) => (i === idx ? nextMapping : m))
      : [...existing, nextMapping];
    onChange("inputMappings", next);
  };

  const handleSubflowChange = (e) => {
    const id = e.target.value;
    onChange("targetFlowId", id);
    onChange("targetInputNodeId", "");
    onChange("inputMappings", []);
    onChange("outputVariables", []);
  };

  const handleEntryChange = (e) => {
    onChange("targetInputNodeId", e.target.value);
    onChange("inputMappings", []);
  };

  const handleOpenChild = () => {
    if (targetFlowId && onOpenSubflow) onOpenSubflow(targetFlowId);
  };

  return (
    <div className="form-group callflow-fields">
      <label className="form-label" htmlFor="callflow-subflow-select">
        {t("flowEditor.callFlowSubflow")}
      </label>
      <select
        id="callflow-subflow-select"
        className="form-input"
        data-testid="callflow-config-subflow-select"
        value={targetFlowId}
        onChange={handleSubflowChange}
      >
        <option value="">{loading ? t("flowEditor.loading") : t("flowEditor.callFlowSelectSubflow")}</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {error && <div className="help-text" style={{ color: "var(--ch-error)" }}>{error}</div>}

      {inputNodes.length > 1 && (
        <>
          <label className="form-label" htmlFor="callflow-entry-select" style={{ marginTop: "var(--ch-space-2)" }}>
            {t("flowEditor.callFlowEntry")}
          </label>
          <select
            id="callflow-entry-select"
            className="form-input"
            data-testid="callflow-config-entry-select"
            value={config.targetInputNodeId || ""}
            onChange={handleEntryChange}
          >
            {inputNodes.map((n) => (
              <option key={n.id} value={n.id}>{n.name || n.id}</option>
            ))}
          </select>
        </>
      )}

      {entryNode && (
        <div className="form-group" style={{ marginTop: "var(--ch-space-3)" }}>
          <span className="form-label">{t("flowEditor.callFlowInputMappings")}</span>
          <div className="callflow-mappings" data-testid="callflow-input-mappings">
            {inputVars.length === 0 && (
              <div className="help-text">{t("flowEditor.callFlowNoInputVars")}</div>
            )}
            {inputVars.map((v) => {
              const mapping = mappingsByChild.get(v.name) || {};
              return (
                <div
                  key={v.name}
                  className="callflow-mapping-row"
                  data-testid={`callflow-input-row-${v.name}`}
                >
                  <label className="form-label">{v.name}</label>
                  <ParentVariableSelect
                    nodes={nodes}
                    edges={edges}
                    currentNodeId={nodeId}
                    value={mapping.parentExpr || ""}
                    onChange={(parentExpr) => setMapping(v.name, parentExpr)}
                    t={t}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {entryNode && (
        <div className="form-group" style={{ marginTop: "var(--ch-space-3)" }}>
          <span className="form-label">{t("flowEditor.callFlowOutputMappings")}</span>
          <div className="callflow-mappings" data-testid="callflow-output-mappings">
            {config.outputVariables?.length === 0 && (
              <div className="help-text">{t("flowEditor.callFlowNoOutputVars")}</div>
            )}
            {(config.outputVariables || []).map((o) => (
              <div className="callflow-mapping-row" key={o.name}>
                <label className="form-label">{o.name}</label>
                <input
                  type="text"
                  className="form-input"
                  value={`${nodeId}.${o.name}`}
                  readOnly
                  disabled
                />
              </div>
            ))}
          </div>
          <div className="help-text">{t("flowEditor.callFlowOutputsHelp")}</div>
        </div>
      )}

      {targetFlowId && (
        <button
          type="button"
          className="btn btn-link"
          data-testid="callflow-open-child"
          onClick={handleOpenChild}
          style={{ marginTop: "var(--ch-space-2)" }}
        >
          {t("flowEditor.callFlowOpenChild")}
        </button>
      )}
    </div>
  );
}

// Dropdown listing upstream variables for a single child input mapping row.
function ParentVariableSelect({ nodes, edges, currentNodeId, value, onChange, t }) {
  const groups = getUpstreamVariableGroups(nodes, edges, currentNodeId);
  const selected = value ? value.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "") : "";
  return (
    <select
      className="form-input"
      value={selected}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v ? `{{${v}}}` : "");
      }}
    >
      <option value="">{t("flowEditor.callFlowSelectParentVar")}</option>
      {groups.map((g) => (
        <optgroup key={g.nodeId} label={g.nodeName}>
          {g.variables.map((v) => (
            <option key={v.fullName} value={v.fullName}>{v.fullName}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// Bind the concrete config panel components into the node registry so that
// NodePalette and NodeConfigPanel share a single source of truth for node types
// (ADR-010, REQ-FLOW-043 AC8).
if (NODE_REGISTRY) {
  NODE_REGISTRY.trigger.configPanel = TriggerFields;
  NODE_REGISTRY.feishuMessage.configPanel = FeishuMessageFields;
  NODE_REGISTRY.flowInput.configPanel = FlowInputFields;
  NODE_REGISTRY.flowOutput.configPanel = FlowOutputFields;
  NODE_REGISTRY.agent.configPanel = AgentFields;
  NODE_REGISTRY.feishuSend.configPanel = FeishuSendFields;
  NODE_REGISTRY.condition.configPanel = ConditionFields;
  NODE_REGISTRY.forEach.configPanel = ForEachFields;
  NODE_REGISTRY.while.configPanel = WhileFields;
  NODE_REGISTRY.callFlow.configPanel = CallFlowFields;
  NODE_REGISTRY.setVariables.configPanel = SetVariablesFields;
}

