// REQ-FLOW-047 (D11): setVariables 节点执行器。
// 通用变量赋值/重命名节点：遍历 node.config.outputVariables，按同名 expression
// 求值后通过 D10 多输出机制返回 outputVariables。
// 典型用途：多入口归一化、常量注入、嵌套字段提取、中间值重命名。
//
// expression 支持四种形式（与 tech-design D11 / REQ-FLOW-047 AC9 一致）：
//   1. 单 {{var}} 或 {{a.b.c}} 引用：用 evaluateExpression 求值，保留原类型
//   2. {{...}} 包裹的任意 JS 表达式：如 {{svA.url || svB.url}}、{{a ?? b}}、
//      {{svA.url ? svA.url : svB.url}}，按 JS 求值结果返回（不保证类型保留）
//   3. 含 {{var}} 模板（如 "Hello {{name}}"）：字符串插值拼接
//   4. 纯字面量（无 {{}}）：原样作为字符串值返回

import { evaluateExpression } from "./evaluateExpression.js";

const SINGLE_REF_PATTERN = /^\{\{\s*([\w.]+)\s*\}\}$/;
const EXPRESSION_PATTERN = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const TEMPLATE_REF_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

function evaluateSingleRef(path, context) {
  // Use evaluateExpression for correct handling: it builds a nested scope
  // from flat context keys (e.g. "trig.num" → scope.trig.num), so dot-path
  // references resolve correctly while preserving value types.
  return evaluateExpression(path, context);
}

function evaluateTemplate(expression, context) {
  return expression.replace(TEMPLATE_REF_PATTERN, (_match, path) => {
    const value = evaluateSingleRef(path, context);
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

function evaluateExpressionWrapped(expression, context) {
  return evaluateExpression(expression, context);
}

export function evaluate(expression, context) {
  if (typeof expression !== "string") return expression;

  // Case 1: single {{var}} reference — evaluate as JS expression, preserve type.
  const singleMatch = expression.match(SINGLE_REF_PATTERN);
  if (singleMatch) {
    return evaluateSingleRef(singleMatch[1], context);
  }

  // Case 2: {{...}} wrapping an arbitrary JS expression (multi-source
  // aggregation / fallback). Examples: {{svA.url || svB.url}}, {{a ?? b}}.
  const expressionMatch = expression.match(EXPRESSION_PATTERN);
  if (expressionMatch) {
    return evaluateExpressionWrapped(expressionMatch[1], context);
  }

  // Case 3: template string with {{var}} interpolations.
  if (expression.includes("{{")) {
    return evaluateTemplate(expression, context);
  }

  // Case 4: plain literal — return as-is (string).
  return expression;
}

export async function setVariablesExecutor({ node, context }) {
  const log = (message) => ({ at: new Date().toISOString(), message });
  const logs = [];

  const outputVarDefs = Array.isArray(node.config?.outputVariables) ? node.config.outputVariables : [];
  const expressions = Array.isArray(node.config?.expressions) ? node.config.expressions : [];
  const expressionByName = new Map();
  for (const expr of expressions) {
    if (expr && typeof expr.name === "string" && expr.name !== "") {
      expressionByName.set(expr.name, expr.expression);
    }
  }

  const outputVariables = {};
  for (const varDef of outputVarDefs) {
    if (!varDef || typeof varDef.name !== "string" || varDef.name === "") continue;
    const expression = expressionByName.get(varDef.name);
    outputVariables[varDef.name] = evaluate(expression, context);
  }

  logs.push(log(`setVariables: assigned ${Object.keys(outputVariables).length} variable(s)`));

  return {
    status: "success",
    outputVariables,
    logs
  };
}
