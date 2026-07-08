export function evaluateExpression(expression, context = {}) {
  const fn = new Function("context", `with(context) { return (${expression}); }`);
  return fn(context);
}
