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
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export const get = (endpoint) => request("GET", endpoint);
export const patch = (endpoint, body) => request("PATCH", endpoint, body);
export const post = (endpoint, body) => request("POST", endpoint, body);
export const del = (endpoint) => request("DELETE", endpoint);
