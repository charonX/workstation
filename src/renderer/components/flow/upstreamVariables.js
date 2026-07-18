/**
 * Compute variable groups for the variable picker (REQ-FLOW-022).
 *
 * A node's variables are available downstream when:
 * - the node is a Trigger (entry variables are flow-wide), or
 * - a directed edge path leads from that node to the current node.
 *
 * Trigger nodes contribute their declared `config.outputVariables`
 * (name + declared type). Other nodes contribute their single declared
 * output variable (`config.outputVariable`, falling back to the legacy
 * top-level `outputVariable`); agent outputs are strings by contract.
 *
 * Groups are derived from live canvas state, so deleting or renaming an
 * upstream variable refreshes the picker immediately (REQ-FLOW-022 AC4).
 */
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
    const isTrigger = node.data?.type === "trigger";
    if (!isTrigger && !upstream.has(node.id)) continue;

    const variables = [];
    if (isTrigger) {
      const declared = node.data?.config?.outputVariables;
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
