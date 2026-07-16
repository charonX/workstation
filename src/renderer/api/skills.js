import { get, post, del } from "./client.js";

const API_BASE = () => (typeof window !== "undefined" && window.opc?.apiBaseUrl) || "";

export function getSkillRepos() {
  return get("/api/skill-repos");
}

export function getSkill(skillId) {
  return get(`/api/skills/${skillId}`);
}

export async function startInstallJob(body) {
  const res = await post("/api/skills/install", body);
  return res.jobId;
}

export function subscribeInstallJob(jobId, { onLog, onSuccess, onError }) {
  const es = new EventSource(`${API_BASE()}/api/skills/install/${jobId}/stream`);
  es.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      data = { type: "log", text: event.data };
    }
    if (data.type === "log") {
      onLog?.(data.text);
    } else if (data.type === "success") {
      es.close();
      onSuccess?.(data.repo, data.skills);
    } else if (data.type === "error") {
      es.close();
      onError?.(new Error(data.message || "Installation failed"));
    }
  };
  es.onerror = () => {
    es.close();
    onError?.(new Error("Installation stream disconnected"));
  };
  return () => es.close();
}

export function installSkill(body) {
  return post("/api/skills/install", body);
}

export function deleteSkillRepo(repoId) {
  return del(`/api/skill-repos/${repoId}`);
}
