/**
 * Compute variable groups for the variable picker (REQ-FLOW-022 +
 * REQ-FLOW-043: callFlow outputs discoverable downstream).
 *
 * A node's variables are available downstream when:
 * - the node is a Trigger (entry variables are flow-wide), or
 * - a directed edge path leads from that node to the current node.
 *
 * Trigger-like nodes (trigger / feishuMessage / flowInput / flowOutput)
 * contribute their declared `config.outputVariables` (name + declared
 * type). callFlow nodes contribute each outputMapping.parentKey (sourced
 * from the child flow's flowOutput variables). Other nodes contribute
 * their single declared output variable (`config.outputVariable`,
 * falling back to the legacy top-level `outputVariable`); agent outputs
 * are strings by contract.
 *
 * Groups are derived from live canvas state, so deleting or renaming an
 * upstream variable refreshes the picker immediately (REQ-FLOW-022 AC4).
 */
const FEISHU_MESSAGE_FIXED_OUTPUTS = [
  { name: "text", type: "string" },
  { name: "sender", type: "string" },
  { name: "messageId", type: "string" },
];

const TRIGGER_LIKE_TYPES = new Set(["trigger", "feishuMessage", "flowInput", "flowOutput"]);

export function getUpstreamVariableGroups(nodes, edges, currentNodeId) {
  const upstream = new Set();
  const queue = [currentNodeId];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const edge of edges) {
      if (edge.target === id && !upstream.has(edge.source)) {
        upstream.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  const groups = [];
  for (const node of nodes) {
    if (node.id === currentNodeId) continue;
    const type = node.data?.type;
    const isTriggerLike = TRIGGER_LIKE_TYPES.has(type);
    if (!isTriggerLike && !upstream.has(node.id)) continue;

    const variables = [];
    if (isTriggerLike) {
      let declared = node.data?.config?.outputVariables;
      // BUG-016: feishuMessage nodes always expose text/sender/messageId even
      // if the config has not been persisted yet (e.g. just added from palette).
      if (type === "feishuMessage" && !Array.isArray(declared)) {
        declared = FEISHU_MESSAGE_FIXED_OUTPUTS;
      }
      for (const variable of Array.isArray(declared) ? declared : []) {
        const name = typeof variable?.name === "string" ? variable.name.trim() : "";
        if (name) {
          variables.push({
            name,
            type: variable.type || "string",
            fullName: `${node.id}.${name}`,
          });
        }
      }
    } else if (type === "callFlow") {
      const mappings = Array.isArray(node.data?.config?.outputMappings)
        ? node.data.config.outputMappings
        : [];
      for (const mapping of mappings) {
        const parentKey = typeof mapping?.parentKey === "string" ? mapping.parentKey.trim() : "";
        if (parentKey) {
          // parentKey is already `${callFlowNodeId}.${childVar}` (the form
          // downstream nodes reference). Expose it verbatim as fullName.
          const shortName = parentKey.includes(".") ? parentKey.slice(parentKey.indexOf(".") + 1) : parentKey;
          variables.push({ name: shortName, type: mapping.childType || "string", fullName: parentKey });
        }
      }
    } else {
      const name = node.data?.config?.outputVariable || node.data?.outputVariable;
      if (name) {
        variables.push({ name, type: "string", fullName: `${node.id}.${name}` });
      }
    }

    if (variables.length > 0) {
      groups.push({
        nodeId: node.id,
        nodeName: node.data?.label || node.id,
        variables,
      });
    }
  }
  return groups;
}
