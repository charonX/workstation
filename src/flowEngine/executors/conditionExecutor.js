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
    // tech-design §5.3：表达式语法/求值异常 → status "error"（非 fatal），
    // 进入引擎统一重试/onError 流程；默认 onError=fail 时引擎仍终止，与旧行为一致。
    return {
      status: "error",
      error: err.message
    };
  }
}
