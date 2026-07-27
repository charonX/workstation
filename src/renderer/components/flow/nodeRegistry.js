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
  return FEISHU_MESSAGE_FIXED_OUTPUTS;
}

export const NODE_REGISTRY = {
  trigger: {
    type: "trigger",
    category: "trigger",
    icon: "⏱",
    defaultConfig: { outputVariables: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  feishuMessage: {
    type: "feishuMessage",
    category: "trigger",
    icon: "✉️",
    defaultConfig: {
      outputVariables: FEISHU_MESSAGE_FIXED_OUTPUTS.map((v) => ({ ...v })),
    },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveFeishuMessageVariables,
  },
  flowInput: {
    type: "flowInput",
    category: "trigger",
    icon: "⤵",
    defaultConfig: { outputVariables: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  flowOutput: {
    type: "flowOutput",
    category: "flow",
    icon: "⤴",
    defaultConfig: { outputVariables: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  agent: {
    type: "agent",
    category: "execution",
    icon: "◆",
    defaultConfig: { outputVariables: [{ name: "output", type: "string" }] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  feishuSend: {
    type: "feishuSend",
    category: "execution",
    icon: "💬",
    defaultConfig: { outputVariables: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  condition: {
    type: "condition",
    category: "logic",
    icon: "◈",
    defaultConfig: { outputVariables: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  forEach: {
    type: "forEach",
    category: "logic",
    icon: "↻",
    defaultConfig: { outputVariables: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  while: {
    type: "while",
    category: "logic",
    icon: "⟳",
    defaultConfig: { outputVariables: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  callFlow: {
    type: "callFlow",
    category: "logic",
    icon: "⎘",
    defaultConfig: { outputVariables: [], inputMappings: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
  setVariables: {
    type: "setVariables",
    category: "logic",
    icon: "=",
    defaultConfig: { outputVariables: [], expressions: [] },
    configPanel: PlaceholderConfigPanel,
    deriveOutputVariables: deriveDeclaredVariables,
  },
};
