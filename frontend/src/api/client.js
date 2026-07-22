const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Ошибка запроса (${status})`);
    this.status = status;
  }
}

/** Обёртка над fetch: подставляет базовый URL, JWT и разбирает ошибки бэкенда. */
async function request(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let detail = null;
    try {
      detail = (await response.json()).detail;
    } catch {
      // тело ответа не JSON — оставляем detail пустым
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  loginWithDiscord: (code) => request("/auth/discord", { method: "POST", body: { code } }),
  getMe: (token) => request("/api/me", { token }),

  listReports: (token, { status, regimentId } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (regimentId) params.set("regiment_id", regimentId);
    const query = params.toString() ? `?${params.toString()}` : "";
    return request(`/api/reports${query}`, { token });
  },
  createReport: (token, { regimentId, content, submit }) =>
    request("/api/reports", {
      method: "POST",
      token,
      body: { regiment_id: regimentId, content, submit },
    }),
  updateReportStatus: (token, reportId, { status, rejectionReason }) =>
    request(`/api/reports/${reportId}`, {
      method: "PATCH",
      token,
      body: { status, rejection_reason: rejectionReason ?? null },
    }),
  deleteReport: (token, reportId) => request(`/api/reports/${reportId}`, { method: "DELETE", token }),

  listRegiments: (token) => request("/api/regiments", { token }),
  getDiscordRoles: (token) => request("/api/regiments/discord-roles", { token }),
  createRegiment: (token, { name, discordRoleId }) =>
    request("/api/regiments", {
      method: "POST",
      token,
      body: { name, discord_role_id: discordRoleId },
    }),
  updateRegiment: (token, regimentId, { name, discordRoleId }) =>
    request(`/api/regiments/${regimentId}`, {
      method: "PATCH",
      token,
      body: { name: name ?? null, discord_role_id: discordRoleId ?? null },
    }),
};

export { ApiError };
