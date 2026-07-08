import { evaluateExpression } from "./evaluateExpression.js";

export function forEachExecutor({ node, context, iteration = 0 }) {
  let array;
  if (node.config?.array !== undefined) {
    try {
      array = JSON.parse(node.config.array);
    } catch {
      return { status: "fatal", error: "Invalid array JSON" };
    }
  } else {
    array = context?.[node.config?.arrayVariable];
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
    item,
    logs: [{ at: new Date().toISOString(), message: `iter ${iteration}: ${JSON.stringify(item)}` }]
  };
}
