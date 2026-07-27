/**
 * Compute variable groups for the variable picker (REQ-FLOW-022 +
 * REQ-FLOW-043: callFlow outputs discoverable downstream).
 *
 * A node's variables are available downstream when:
 * - the node is a Trigger (entry variables are flow-wide), or
 * - a directed edge path leads from that node to the current node.
 *
 * All node types expose their downstream-visible variables through
 * `nodeRegistry[type].deriveOutputVariables(config)`. The registry is the
 * single source of truth for output variable names (ADR-010).
 *
 * Trigger-like nodes (trigger / feishuMessage / flowInput / flowOutput) are
 * always visible regardless of edges. Other nodes require an upstream path.
 *
 * Groups are derived from live canvas state, so deleting or renaming an
 * upstream variable refreshes the picker immediately (REQ-FLOW-022 AC4).
 */
import { NODE_REGISTRY } from "./nodeRegistry.js";

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
    const registryEntry = NODE_REGISTRY[type];
    const derived = registryEntry?.deriveOutputVariables?.(node.data?.config) || [];
    for (const variable of derived) {
      const name = typeof variable?.name === "string" ? variable.name.trim() : "";
      if (name) {
        variables.push({
          name,
          type: variable.type || "string",
          fullName: `${node.id}.${name}`,
        });
      }
    }

    // Legacy fallback for non-trigger-like nodes that still use the singular
    // `outputVariable` field. This keeps the pre-unified-model canvas working
    // until S3 migrates all executors to `outputVariables`.
    if (!isTriggerLike && variables.length === 0) {
      const legacyName = node.data?.config?.outputVariable || node.data?.outputVariable;
      if (legacyName) {
        variables.push({ name: legacyName, type: "string", fullName: `${node.id}.${legacyName}` });
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
