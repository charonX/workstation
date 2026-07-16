import { ensureServer } from "../server.js";

export async function list() {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills`);
  return handleResponse(res);
}

export async function get(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills/${flags.id}`);
  return handleResponse(res);
}

export async function install(flags) {
  const server = await ensureServer();

  const startRes = await fetch(`${server.baseUrl}/api/skills/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: flags.source, identifier: flags.identifier })
  });

  if (!startRes.ok) {
    const data = await startRes.json().catch(() => ({ message: "Request failed" }));
    const err = new Error(data.message || "Request failed");
    err.status = startRes.status;
    err.data = data;
    throw err;
  }

  const { jobId } = await startRes.json();
  const streamRes = await fetch(`${server.baseUrl}/api/skills/install/${jobId}/stream`);

  if (!streamRes.ok) {
    const data = await streamRes.json().catch(() => ({ message: "Stream failed" }));
    const err = new Error(data.message || "Stream failed");
    err.status = streamRes.status;
    err.data = data;
    throw err;
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const logs = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "log") {
        logs.push(event.text);
        console.error(event.text);
      } else if (event.type === "success") {
        return { skill: event.skill, logs };
      } else if (event.type === "error") {
        const err = new Error(event.message || "Installation failed");
        err.logs = logs;
        throw err;
      }
    }
  }

  throw new Error("Installation stream ended without result");
}

async function deleteSkill(flags) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}/api/skills/${flags.id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Request failed" }));
    const err = new Error(data.message || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { success: true };
}

export { deleteSkill as delete };

async function handleResponse(res, expectedStatus) {
  const data = await res.json();
  if (!res.ok || (expectedStatus && res.status !== expectedStatus)) {
    const err = new Error(data.message || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
