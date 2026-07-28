// REQ-FLOW-035: callFlow 节点执行器
// 职责：
//   1. 校验 inputMappings 格式（childVar + parentExpr 单 {{var}} 引用）
//   2. 从父 context 解析 inputVars（保留类型）
//   3. 委托 services.invokeSubflow 同步执行子流程（隔离由 invokeSubflow 负责）
//   4. 把子出参 + __childExecutionId 通过 D10 多输出返回给引擎，引擎写回父 context
//
// 本 executor 不创建子 context、不加载子流程——隔离与持久化全部由 services.invokeSubflow 承担，
// 以便单元测试用 stub services 即可覆盖，无需 DB。

// parentExpr 必须是单个 {{var}} 引用，fullName 以字母或下划线开头，后续允许字母/数字/下划线/点。
const PARENT_EXPR_PATTERN = /^\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}$/;

export async function callFlowExecutor({ node, context, services, currentDepth }) {
  const log = (message) => ({ at: new Date().toISOString(), message });
  const logs = [];

  // 1. 校验 services.invokeSubflow 可用
  if (!services || typeof services.invokeSubflow !== "function") {
    const message = "E-CALLFLOW-SVC: invokeSubflow service not available";
    logs.push(log(message));
    return { status: "error", error: message, logs };
  }

  // 2. 校验并解析 inputMappings
  const inputMappings = Array.isArray(node.config?.inputMappings) ? node.config.inputMappings : [];
  const inputVars = {};
  for (const mapping of inputMappings) {
    const childVar = mapping?.childVar;
    const parentExpr = mapping?.parentExpr;
    if (typeof childVar !== "string" || childVar === "" || typeof parentExpr !== "string") {
      const message = `E-CALLFLOW-MAP: invalid parentExpr for '${childVar ?? ""}'`;
      logs.push(log(message));
      return { status: "error", error: message, logs };
    }
    const match = parentExpr.match(PARENT_EXPR_PATTERN);
    if (!match) {
      const message = `E-CALLFLOW-MAP: invalid parentExpr for '${childVar}'`;
      logs.push(log(message));
      return { status: "error", error: message, logs };
    }
    const fullName = match[1];
    // 从父 context 读原值（保留类型：string/number/object/array 原样传递）
    inputVars[childVar] = context[fullName];
  }

  // 3. 调用 services.invokeSubflow（同步等待子流程完成）
  let result;
  try {
    result = await services.invokeSubflow({
      targetFlowId: node.config.targetFlowId,
      entryNodeId: node.config.targetInputNodeId,
      inputVars,
      parentNodeId: node.id,
      parentDepth: currentDepth
    });
  } catch (err) {
    // 子流程失败冒泡：invokeSubflow 抛错 → 按错误码格式回传，引擎 onError=fail 会中止父流程。
    const message = err?.message ? `E-SUBFLOW-FAILED: ${err.message}` : "E-SUBFLOW-FAILED: subflow invocation threw";
    logs.push(log(message));
    return { status: "error", error: message, logs };
  }

  if (!result || result.status !== "success") {
    const message = `E-SUBFLOW-FAILED: ${result?.error || "subflow returned non-success"}`;
    logs.push(log(message));
    return { status: "error", error: message, logs };
  }

  const childOutputs = result.output && typeof result.output === "object" ? result.output : {};
  const childExecutionId = result.childExecutionId;
  const targetFlowId = node.config.targetFlowId;

  logs.push(log(`callFlow: invoked ${targetFlowId} (${childExecutionId})`));

  // 4. 通过 D10 多输出把子出参 + __childExecutionId 返回给引擎，
  //    引擎会为每个 key 写 ${nodeId}.${varName} 和裸 ${varName}。
  return {
    status: "success",
    outputVariables: {
      ...childOutputs,
      __childExecutionId: childExecutionId
    },
    logs
  };
}
