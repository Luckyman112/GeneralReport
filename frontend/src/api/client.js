// Пусто по умолчанию — фронт раздаётся тем же процессом/адресом, что и бэкенд
// (self-host), поэтому относительных путей достаточно (same-origin).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Ошибка запроса (${status})`);
    this.status = status;
  }
}

/** Обёртка над fetch: подставляет базовый URL, JWT и разбирает ошибки бэкенда.
 * Если body — FormData (загрузка файла), не сериализуем в JSON и не трогаем
 * Content-Type — браузер сам проставит его с нужным boundary. */
async function request(path, { method = "GET", token, body } = {}) {
  const isFormData = body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
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
  loginWithDiscord: (code, redirectUri) =>
    request("/auth/discord", { method: "POST", body: { code, redirect_uri: redirectUri } }),
  loginWithPassword: (password) => request("/auth/password", { method: "POST", body: { password } }),
  getMe: (token) => request("/api/me", { token }),

  listReports: (token, { status, regimentId, categoryId } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (regimentId) params.set("regiment_id", regimentId);
    if (categoryId) params.set("category_id", categoryId);
    const query = params.toString() ? `?${params.toString()}` : "";
    return request(`/api/reports${query}`, { token });
  },
  createReport: (token, { regimentId, categoryId, content, submit }) =>
    request("/api/reports", {
      method: "POST",
      token,
      body: { regiment_id: regimentId, category_id: categoryId ?? null, content, submit },
    }),
  updateReportStatus: (token, reportId, { status, rejectionReason }) =>
    request(`/api/reports/${reportId}`, {
      method: "PATCH",
      token,
      body: { status, rejection_reason: rejectionReason ?? null },
    }),
  deleteReport: (token, reportId) => request(`/api/reports/${reportId}`, { method: "DELETE", token }),
  setReportPoints: (token, reportId, points) =>
    request(`/api/reports/${reportId}/points`, { method: "PATCH", token, body: { points } }),
  uploadReportImage: (token, reportId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request(`/api/reports/${reportId}/images`, { method: "POST", token, body: formData });
  },
  deleteReportImage: (token, reportId, imageId) =>
    request(`/api/reports/${reportId}/images/${imageId}`, { method: "DELETE", token }),

  listRegiments: (token) => request("/api/regiments", { token }),
  getDiscordRoles: (token) => request("/api/regiments/discord-roles", { token }),
  createRegiment: (token, { name, discordRoleId, color }) =>
    request("/api/regiments", {
      method: "POST",
      token,
      body: { name, discord_role_id: discordRoleId, color: color || null },
    }),
  updateRegiment: (token, regimentId, { name, discordRoleId, color }) =>
    request(`/api/regiments/${regimentId}`, {
      method: "PATCH",
      token,
      body: { name: name ?? null, discord_role_id: discordRoleId ?? null, color: color || null },
    }),

  listCategories: (token, regimentId) => request(`/api/regiments/${regimentId}/categories`, { token }),
  createCategory: (token, regimentId, { name, fields, points }) =>
    request(`/api/regiments/${regimentId}/categories`, {
      method: "POST",
      token,
      body: { name, fields: fields || [], points: points ?? null },
    }),
  // Передаём только реально переданные поля (без null-заполнителей) — бэкенд
  // трактует отсутствие ключа как "не менять", а points: null как явную очистку
  updateCategory: (token, regimentId, categoryId, changes) =>
    request(`/api/regiments/${regimentId}/categories/${categoryId}`, {
      method: "PATCH",
      token,
      body: changes,
    }),
  deleteCategory: (token, regimentId, categoryId) =>
    request(`/api/regiments/${regimentId}/categories/${categoryId}`, { method: "DELETE", token }),

  getCommanderCandidates: (token, regimentId) =>
    request(`/api/regiments/${regimentId}/commander-candidates`, { token }),
  listCommanders: (token, regimentId) => request(`/api/regiments/${regimentId}/commanders`, { token }),
  addCommander: (token, regimentId, { discordId, username, roleType }) =>
    request(`/api/regiments/${regimentId}/commanders`, {
      method: "POST",
      token,
      body: { discord_id: discordId, username, role_type: roleType },
    }),
  removeCommander: (token, regimentId, discordId) =>
    request(`/api/regiments/${regimentId}/commanders/${discordId}`, { method: "DELETE", token }),

  getMembers: (token, regimentId) => request(`/api/regiments/${regimentId}/members`, { token }),
  getMemberReports: (token, regimentId, discordId) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/reports`, { token }),
  setMemberProfile: (token, regimentId, discordId, changes) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/profile`, {
      method: "PATCH",
      token,
      body: changes,
    }),

  getRanks: (token) => request("/api/ranks", { token }),

  getAppSettings: (token) => request("/api/app-settings", { token }),
  updateAppSettings: (token, { adminRoleId, commanderRoleId, deputyRoleId }) =>
    request("/api/app-settings", {
      method: "PATCH",
      token,
      body: {
        admin_role_id: adminRoleId ?? null,
        commander_role_id: commanderRoleId ?? null,
        deputy_role_id: deputyRoleId ?? null,
      },
    }),

  listViolations: (token) => request("/api/violations", { token }),
  getViolationTargetCandidates: (token) => request("/api/violations/target-candidates", { token }),
  createViolation: (token, { targetDiscordId, targetServiceId, targetRankId, targetRegimentId, targetCallsign, description }) =>
    request("/api/violations", {
      method: "POST",
      token,
      body: {
        target_discord_id: targetDiscordId || null,
        target_service_id: targetServiceId || null,
        target_rank_id: targetRankId || null,
        target_regiment_id: targetRegimentId || null,
        target_callsign: targetCallsign || null,
        description,
      },
    }),
  deleteViolation: (token, violationId) =>
    request(`/api/violations/${violationId}`, { method: "DELETE", token }),
  getViolationSettings: (token) => request("/api/violations/settings", { token }),
  updateViolationSettings: (token, changes) =>
    request("/api/violations/settings", { method: "PATCH", token, body: changes }),

  listNotifications: (token) => request("/api/notifications", { token }),
  markAllNotificationsRead: (token) => request("/api/notifications/read-all", { method: "POST", token }),
  sendBroadcast: (token, { title, body }) =>
    request("/api/notifications/broadcast", { method: "POST", token, body: { title, body } }),
};

export { ApiError };
