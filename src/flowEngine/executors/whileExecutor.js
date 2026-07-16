import { evaluateExpression } from "./evaluateExpression.js";

export function whileExecutor({ node, context }) {
  const expression = node.config?.expression;
  try {
    const result = evaluateExpression(expression, context);
    return {
      status: "success",
      output: result ? "body" : "exit"
    };
  } catch (err) {
    return {
      status: "fatal",
      error: err.message
    };
  }
}
