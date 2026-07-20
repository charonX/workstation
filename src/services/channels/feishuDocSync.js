async function fetchTenantAccessToken(domain, credentials) {
  const res = await fetch(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error("token");
  }
  return data.tenant_access_token;
}

async function postJson(url, body, token) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.code === 0, status: res.status, data };
}

async function patchJson(url, body, token) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.code === 0, status: res.status, data };
}

export async function syncMarkdownToFeishuDoc({ markdown, title, domain, credentials } = {}) {
  if (!markdown || !title || !domain || !credentials?.appId || !credentials?.appSecret) {
    return { error: { code: "E-DOC-SYNC-FAILED", stage: "input" } };
  }

  const baseUrl = domain.replace(/\/$/, "");
  let token;

  try {
    token = await fetchTenantAccessToken(baseUrl, credentials);
  } catch {
    return { error: { code: "E-DOC-SYNC-FAILED", stage: "token" } };
  }

  // 1. Convert markdown to docx blocks.
  const convertResult = await postJson(
    `${baseUrl}/open-apis/docx/v1/documents/blocks/convert`,
    { markdown },
    token
  );
  if (!convertResult.ok) {
    return { error: { code: "E-DOC-SYNC-FAILED", stage: "convert" } };
  }

  // 2. Create the document.
  const createResult = await postJson(
    `${baseUrl}/open-apis/docx/v1/documents`,
    { title },
    token
  );
  if (!createResult.ok) {
    return { error: { code: "E-DOC-SYNC-FAILED", stage: "create" } };
  }
  const documentId = createResult.data?.data?.document?.document_id;
  if (!documentId) {
    return { error: { code: "E-DOC-SYNC-FAILED", stage: "create" } };
  }

  // 3. Set tenant-readable permission.
  const permissionResult = await patchJson(
    `${baseUrl}/open-apis/drive/v1/permissions/${encodeURIComponent(documentId)}/public`,
    { security_setting: { permission: "tenant_readable" } },
    token
  );
  if (!permissionResult.ok) {
    return { error: { code: "E-DOC-SYNC-FAILED", stage: "permission" } };
  }

  return { url: `${baseUrl}/docx/${documentId}` };
}
