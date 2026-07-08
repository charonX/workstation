export function forEachExecutor({ node, context, iteration = 0 }) {
  const array = context?.[node.config?.arrayVariable];
  if (!Array.isArray(array) || iteration >= array.length) {
    return {
      status: "success",
      output: "exit"
    };
  }
  return {
    status: "success",
    output: "body",
    logs: [{ at: new Date().toISOString(), message: `iter ${iteration}` }]
  };
}
