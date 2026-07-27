/**
 * Unified node type registry (ADR-010).
 *
 * Each node type declares its metadata, default configuration, config panel
 * component and a pure `deriveOutputVariables(config)` function. The registry
 * is the single source of truth for the canvas (NodePalette, NodeConfigPanel)
 * and for downstream variable discovery (upstreamVariables.js).
 */

const FEISHU_MESSAGE_FIXED_OUTPUTS = [
  { name: "text", type: "string", defaultValue: "" },
  { name: "sender", type: "string", defaultValue: "" },
  { name: "messageId", type: "string", defaultValue: "" },
];

// Placeholder config panel components. Slice S2 will bind the real field
// components from NodeConfigPanel to avoid a circular import during S1.
function PlaceholderConfigPanel() {
  return null;
}

function deriveDeclaredVariables(config) {
  return Array.isArray(config?.outputVariables) ? config.outputVariables : [];
}

function deriveFeishuMessageVariables(config) {
  if (Array.isArray(config?.outputVariables) && config.outputVariables.length > 0) {
    return config.outputVariables;
  }
  // Return a defensive copy so callers cannot mutate the shared constant.
  return FEISHU_MESSAGE_FIXED_OUTPUTS.map((v) => ({ ...v }));
}

function makeNodeTypeRegistration(
  type,
  category,
  icon,
  defaultConfig,
  deriveOutputVariables = deriveDeclaredVariables,
  configPanel = PlaceholderConfigPanel,
  labelKey = `nodeTypes.${type}`
) {
  return {
    type,
    category,
    icon,
    defaultConfig,
    configPanel,
    deriveOutputVariables,
    labelKey,
  };
}

export const NODE_REGISTRY = {
  trigger: makeNodeTypeRegistration("trigger", "trigger", "⏱", { outputVariables: [] }, deriveDeclaredVariables, PlaceholderConfigPanel, "nodeTypes.manual"),
  feishuMessage: makeNodeTypeRegistration(
    "feishuMessage",
    "trigger",
    "✉️",
    { outputVariables: FEISHU_MESSAGE_FIXED_OUTPUTS.map((v) => ({ ...v })) },
    deriveFeishuMessageVariables
  ),
  flowInput: makeNodeTypeRegistration("flowInput", "trigger", "⤵", { outputVariables: [] }),
  flowOutput: makeNodeTypeRegistration("flowOutput", "flow", "⤴", { outputVariables: [] }),
  agent: makeNodeTypeRegistration("agent", "execution", "◆", {
    outputVariables: [{ name: "output", type: "string" }],
  }),
  feishuSend: makeNodeTypeRegistration("feishuSend", "execution", "💬", { outputVariables: [] }),
  condition: makeNodeTypeRegistration("condition", "logic", "◈", { outputVariables: [] }),
  forEach: makeNodeTypeRegistration("forEach", "logic", "↻", { outputVariables: [] }),
  while: makeNodeTypeRegistration("while", "logic", "⟳", { outputVariables: [] }),
  callFlow: makeNodeTypeRegistration("callFlow", "logic", "⎘", {
    outputVariables: [],
    inputMappings: [],
  }),
  setVariables: makeNodeTypeRegistration("setVariables", "logic", "=", {
    outputVariables: [],
    expressions: [],
  }),
};
