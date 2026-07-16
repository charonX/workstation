export function evaluateExpression(expression, context = {}) {
  const fn = new Function("context", "ctx", `with(context) { return (${expression}); }`);
  return fn(context, context);
}
