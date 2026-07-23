import { evaluateExpression } from "./evaluateExpression.js";

export function forEachExecutor({ node, context, iteration = 0 }) {
  let array;
  if (node.config?.array !== undefined) {
    try {
      array = JSON.parse(node.config.array);
    } catch {
      return { status: "fatal", error: "Invalid array JSON" };
    }
  } else if (node.config?.arrayVariable !== undefined) {
    array = context?.[node.config.arrayVariable];
  } else if (node.config?.["items-expr"] !== undefined) {
    // Tolerate test-authored "items-expr" (fullName reference) for back-compat.
    array = context?.[node.config["items-expr"]];
  } else {
    array = [];
  }

  if (!Array.isArray(array) || iteration >= array.length) {
    return {
      status: "success",
      output: "exit"
    };
  }

  const item = array[iteration];
  return {
    status: "success",
    output: "body",
    // Expose iteration item via D10 multi-output so callFlow (and other body
    // nodes) can reference {{nodeId.item}} / {{item}} in parentExpr / prompts.
    outputVariables: { item },
    item,
    logs: [{ at: new Date().toISOString(), message: `iter ${iteration}: ${JSON.stringify(item)}` }]
  };
}
