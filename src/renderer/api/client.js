/**
 * Thin fetch wrapper around window.opc.apiBaseUrl.
 */
const API_BASE = () => (typeof window !== "undefined" && window.opc?.apiBaseUrl) || "";

async function request(method, endpoint, body) {
  const url = `${API_BASE()}${endpoint}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const error = new Error(err.message || `HTTP ${res.status}`);
    error.status = res.status;
    // 错误响应带顶层 `code` 字段（权限配置端点契约，tech-design §3.2）或既有
    // `error` 字段（mapError）——两形态都挂上（?? 保持既有行为不变）。
    error.code = err.code ?? err.error;
    // 400 E-PERMISSION-INVALID 的路径化校验错误（issues:[{path,message}]）透传，
    // 供 UI 错误条定位展示。
    if (Array.isArray(err.issues)) error.issues = err.issues;
    throw error;
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export const get = (endpoint) => request("GET", endpoint);
export const put = (endpoint, body) => request("PUT", endpoint, body);
export const patch = (endpoint, body) => request("PATCH", endpoint, body);
export const post = (endpoint, body) => request("POST", endpoint, body);
export const del = (endpoint, body) => request("DELETE", endpoint, body);
