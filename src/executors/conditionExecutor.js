import { evaluateExpression } from "./evaluateExpression.js";

export function conditionExecutor({ node, context }) {
  const expression = node.config?.expression;
  try {
    const result = evaluateExpression(expression, context);
    return {
      status: "success",
      output: result ? "true" : "false"
    };
  } catch (err) {
    return {
      status: "fatal",
      error: err.message
    };
  }
}
