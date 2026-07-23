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

// Reserved words that are valid as property names (scope["in"]) but cannot be
// used as bare identifiers in source (with(scope){ in.x } is a syntax error).
// We rewrite "ident." access for these to bracket notation before compiling.
const RESERVED_WORDS = new Set([
  "in", "of", "if", "do", "for", "new", "try", "let", "var", "case",
  "else", "enum", "eval", "false", "null", "this", "true", "void", "with",
  "break", "catch", "class", "const", "super", "throw", "while", "yield",
  "delete", "export", "import", "public", "return", "static", "switch",
  "typeof", "default", "extends", "finally", "package", "private", "continue",
  "debugger", "function", "arguments", "interface", "protected", "implements",
  "instanceof"
]);

// Rewrite leading reserved-word identifiers followed by "." into bracket access
// so `in.branch === 'a'` compiles as `scope["in"].branch === 'a'`. We only target
// identifier-then-dot because reserved words in operator position (x in y) are
// preceded by an operand and will not match the leading-word boundary.
function rewriteReservedWordAccess(expression, scope) {
  const reservedKeys = Object.keys(scope).filter(k => RESERVED_WORDS.has(k));
  if (reservedKeys.length === 0) return expression;
  let result = expression;
  for (const key of reservedKeys) {
    // Match the reserved word as a standalone identifier immediately followed by "."
    // Use negative lookbehind to avoid matching inside a member expression (e.g. x.in.y stays x.in.y).
    // We match: word boundary, the reserved word, ".", any identifier-continuation char.
    const re = new RegExp(`(^|[^\\w$.])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`, "g");
    result = result.replace(re, (_m, prefix) => `${prefix}context["${key}"].`);
  }
  return result;
}

export function evaluateExpression(expression, context = {}) {
  const scope = wrapScope(buildNestedScope(context));
  const body = rewriteReservedWordAccess(expression, scope);
  const fn = new Function("context", "ctx", `with(context) { return (${body}); }`);
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
