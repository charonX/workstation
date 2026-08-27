import { encryptSecret, decryptSecret } from "./secretStore.js";
import { loadSettings, saveSettingsRaw } from "./settingsService.js";

function validationError(message, code = "E-CONFIG-INVALID") {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  return err;
}

function isValidHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function listCredentials() {
  const settings = loadSettings();
  const rawCreds = settings.credentials || {};
  const result = {};

  for (const [service, data] of Object.entries(rawCreds)) {
    if (!data || typeof data !== "object") continue;
    const configured = Boolean(data.accessKeyEncrypted);
    result[service] = {
      baseUrl: data.baseUrl || "",
      configured,
      ...(data.updatedAt ? { updatedAt: data.updatedAt } : {})
    };
  }

  return { credentials: result };
}

export function getCredential(service) {
  if (!service) return null;
  const settings = loadSettings();
  const raw = settings.credentials?.[service];
  if (!raw) return null;

  let accessKey;
  if (typeof raw.accessKeyEncrypted === "string" && raw.accessKeyEncrypted !== "") {
    try {
      accessKey = decryptSecret(raw.accessKeyEncrypted);
    } catch {
      accessKey = undefined;
    }
  }

  return {
    service,
    baseUrl: raw.baseUrl || "",
    accessKey,
    configured: Boolean(raw.accessKeyEncrypted),
    updatedAt: raw.updatedAt
  };
}

export function saveCredential(service, data = {}) {
  if (!service || typeof service !== "string" || service.trim() === "") {
    throw validationError("service 名称必填");
  }
  const cleanService = service.trim();

  const { baseUrl, accessKey } = data;
  if (!baseUrl || !isValidHttpUrl(baseUrl)) {
    throw validationError("请提供合法的 http/https Base URL", "E-CONFIG-INVALID");
  }

  if (accessKey !== undefined && typeof accessKey !== "string") {
    throw validationError("AccessKey 格式无效", "E-CONFIG-INVALID");
  }
  if (typeof accessKey === "string" && accessKey.length > 256) {
    throw validationError("AccessKey 长度不能超过 256 字符", "E-CONFIG-INVALID");
  }

  const settings = loadSettings();
  const existingCredentials = { ...settings.credentials };
  const existing = existingCredentials[cleanService] || {};

  let accessKeyEncrypted = existing.accessKeyEncrypted;
  if (typeof accessKey === "string" && accessKey.trim() !== "") {
    accessKeyEncrypted = encryptSecret(accessKey.trim());
  }

  const updatedAt = new Date().toISOString();
  const cleanBaseUrl = normalizeUrl(baseUrl);

  existingCredentials[cleanService] = {
    ...existing,
    baseUrl: cleanBaseUrl,
    accessKeyEncrypted,
    updatedAt
  };

  saveSettingsRaw({ ...settings, credentials: existingCredentials });

  return {
    service: cleanService,
    baseUrl: cleanBaseUrl,
    configured: Boolean(accessKeyEncrypted),
    updatedAt
  };
}

export async function testCredential(service, data = {}) {
  if (!service || typeof service !== "string") {
    return { ok: false, error: "E-CONFIG-INVALID" };
  }

  let baseUrl = data.baseUrl;
  let accessKey = data.accessKey;

  if (!baseUrl) {
    const existing = getCredential(service);
    if (existing) {
      baseUrl = existing.baseUrl;
      if (accessKey === undefined) {
        accessKey = existing.accessKey;
      }
    }
  }

  if (!baseUrl || !isValidHttpUrl(baseUrl)) {
    return { ok: false, error: "E-CONFIG-INVALID" };
  }

  const cleanBaseUrl = normalizeUrl(baseUrl);
  const startTime = Date.now();

  const headers = {};
  if (accessKey && typeof accessKey === "string" && accessKey.trim() !== "") {
    headers["Authorization"] = `Bearer ${accessKey.trim()}`;
  }

  try {
    const resp = await fetch(`${cleanBaseUrl}/`, {
      headers,
      signal: AbortSignal.timeout(6000)
    });

    const latencyMs = Date.now() - startTime;
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, latencyMs, error: "E-CRED-AUTH-FAILED" };
    }

    if (!resp.ok && resp.status >= 500) {
      return { ok: false, latencyMs, error: `HTTP_${resp.status}` };
    }

    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, error: err.code || "E-CRED-CONN-FAILED" };
  }
}
