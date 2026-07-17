// REQ-FLOW-024 / REQ-FLOW-026 / tech-design §5.3：
// 扁平 fullName 键 context → 嵌套 scope（"n1.count" → scope.n1.count）；
// 无 "." 的 legacy 键保持顶层标识符（旧表达式与 while 的 ctx.count 继续可用）。
// 悬空引用不抛异常：未知标识符解析为"任意属性访问都返回 undefined 的对象"（Proxy）。

// 未知标识符的取值对象：任意属性访问都返回 undefined，
// 使 typeof n999.missing === 'undefined' 为 true、n999.missing > 3 为 false。
const undefinedRef = new Proxy({}, {
  get(_target, prop) {
    if (prop === Symbol.toPrimitive) {
      return () => undefined;
    }
    return undefined;
  }
});

export function evaluateExpression(expression, context = {}) {
  const scope = wrapScope(buildNestedScope(context));
  const fn = new Function("context", "ctx", `with(context) { return (${expression}); }`);
  return fn(scope, scope);
}

function buildNestedScope(context) {
  const scope = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    const dot = key.indexOf(".");
    if (dot <= 0 || dot === key.length - 1) {
      scope[key] = value;
      continue;
    }
    const nodeId = key.slice(0, dot);
    const varName = key.slice(dot + 1);
    if (scope[nodeId] === null || typeof scope[nodeId] !== "object") {
      scope[nodeId] = {};
    }
    scope[nodeId][varName] = value;
  }
  return scope;
}

function wrapScope(scope) {
  return new Proxy(scope, {
    // with(scope) 对每个自由标识符调用 has：始终命中，
    // 把解析权交给 get，避免未知 nodeId 落出 scope 抛 ReferenceError。
    // 例外："context"/"ctx" 放行给求值函数的同名参数（旧契约：ctx 指向 context 本身，
    // 如 while 表达式 "ctx.count < 3"）。
    has(_target, prop) {
      if (prop === Symbol.unscopables) return false;
      if (prop === "context" || prop === "ctx") return false;
      return true;
    },
    get(target, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (prop in target) return target[prop];
      // 已知全局（undefined / Math / JSON 等）按旧行为透传；其余按悬空引用处理。
      if (typeof prop === "string" && prop in globalThis) return globalThis[prop];
      return undefinedRef;
    }
  });
}
