// Пусто по умолчанию — фронт раздаётся тем же процессом/адресом, что и бэкенд
// (self-host), поэтому относительных путей достаточно (same-origin).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Ошибка запроса (${status})`);
    this.status = status;
  }
}

// "Просмотр от лица" (view as) — реальный админ/высшее командование может
// временно урезать себе доступ до конкретной роли/формирования, чтобы честно
// увидеть, что видит и может человек с такими правами. Хранится тут как модульное
// состояние (не React state), потому что request() — обычная функция, а не хук;
// переживает перезагрузку страницы через sessionStorage (не localStorage — не
// должно тянуться в другую вкладку/сессию).
const VIEW_AS_STORAGE_KEY = "collapsar-view-as";
let viewAsRole = null;
let viewAsRegimentId = null;
try {
  const saved = JSON.parse(sessionStorage.getItem(VIEW_AS_STORAGE_KEY) || "null");
  if (saved) {
    viewAsRole = saved.role;
    viewAsRegimentId = saved.regimentId;
  }
} catch {
  // повреждённое значение в sessionStorage — просто игнорируем
}

export function setViewAs(role, regimentId) {
  viewAsRole = role;
  viewAsRegimentId = regimentId ?? null;
  sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify({ role, regimentId: viewAsRegimentId }));
}

export function clearViewAs() {
  viewAsRole = null;
  viewAsRegimentId = null;
  sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
}

export function getViewAs() {
  return { role: viewAsRole, regimentId: viewAsRegimentId };
}

/** Обёртка над fetch: подставляет базовый URL, JWT и разбирает ошибки бэкенда.
 * Если body — FormData (загрузка файла), не сериализуем в JSON и не трогаем
 * Content-Type — браузер сам проставит его с нужным boundary. */
async function request(path, { method = "GET", token, body, withTotal = false } = {}) {
  const isFormData = body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (viewAsRole) {
    headers["X-View-As-Role"] = viewAsRole;
    if (viewAsRegimentId) headers["X-View-As-Regiment-Id"] = String(viewAsRegimentId);
  }

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
  const data = await response.json();
  if (withTotal) {
    const totalHeader = response.headers.get("X-Total-Count");
    return { data, total: totalHeader !== null ? Number(totalHeader) : null };
  }
  return data;
}

export const api = {
  loginWithDiscord: (code, redirectUri) =>
    request("/auth/discord", { method: "POST", body: { code, redirect_uri: redirectUri } }),
  loginWithPassword: (password) => request("/auth/password", { method: "POST", body: { password } }),
  getMe: (token) => request("/api/me", { token }),

  listReports: (token, { status, regimentId, categoryId, limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (regimentId) params.set("regiment_id", regimentId);
    if (categoryId) params.set("category_id", categoryId);
    if (limit) params.set("limit", limit);
    if (offset) params.set("offset", offset);
    const query = params.toString() ? `?${params.toString()}` : "";
    return request(`/api/reports${query}`, { token, withTotal: Boolean(limit) });
  },
  createReport: (
    token,
    {
      regimentId,
      categoryId,
      content,
      submit,
      targetDiscordId,
      targetServiceId,
      targetRankId,
      targetRegimentId,
      targetCallsign,
      punishmentType,
      punishmentOtherText,
      punishmentAmount,
      participantDiscordIds,
    }
  ) =>
    request("/api/reports", {
      method: "POST",
      token,
      body: {
        regiment_id: regimentId,
        category_id: categoryId ?? null,
        content,
        submit,
        target_discord_id: targetDiscordId || null,
        target_service_id: targetServiceId || null,
        target_rank_id: targetRankId || null,
        target_regiment_id: targetRegimentId || null,
        target_callsign: targetCallsign || null,
        punishment_type: punishmentType || null,
        punishment_other_text: punishmentOtherText || null,
        punishment_amount: punishmentAmount || null,
        participant_discord_ids: participantDiscordIds || [],
      },
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
  createRegiment: (token, { name, discordRoleId, color, discordChannelUrl }) =>
    request("/api/regiments", {
      method: "POST",
      token,
      body: { name, discord_role_id: discordRoleId, color: color || null, discord_channel_url: discordChannelUrl || null },
    }),
  updateRegiment: (token, regimentId, { name, discordRoleId, color, discordChannelUrl }) =>
    request(`/api/regiments/${regimentId}`, {
      method: "PATCH",
      token,
      body: {
        name: name ?? null,
        discord_role_id: discordRoleId ?? null,
        color: color || null,
        discord_channel_url: discordChannelUrl ?? null,
      },
    }),

  listCategories: (token, regimentId) => request(`/api/regiments/${regimentId}/categories`, { token }),
  createCategory: (token, regimentId, { name, fields, points, participantPoints }) =>
    request(`/api/regiments/${regimentId}/categories`, {
      method: "POST",
      token,
      body: { name, fields: fields || [], points: points ?? null, participant_points: participantPoints ?? null },
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

  submitRegistration: (token, { serviceId, callsign, steamId }) =>
    request("/api/me/registration", {
      method: "POST",
      token,
      body: { service_id: serviceId, callsign, steam_id: steamId },
    }),
  listPendingRegistrations: (token) => request("/api/registrations/pending", { token }),
  approveRegistration: (token, discordId) =>
    request(`/api/registrations/${discordId}/approve`, { method: "POST", token }),
  rejectRegistration: (token, discordId) =>
    request(`/api/registrations/${discordId}/reject`, { method: "POST", token }),
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
  updateAppSettings: (
    token,
    { adminRoleId, commanderRoleId, deputyRoleId, highCommandRoleId, adminUserDiscordIds, founderRoleId }
  ) =>
    request("/api/app-settings", {
      method: "PATCH",
      token,
      body: {
        admin_role_id: adminRoleId ?? null,
        commander_role_id: commanderRoleId ?? null,
        deputy_role_id: deputyRoleId ?? null,
        high_command_role_id: highCommandRoleId ?? null,
        admin_user_discord_ids: adminUserDiscordIds ?? null,
        founder_role_id: founderRoleId ?? null,
      },
    }),
  getAppSettingsMembers: (token) => request("/api/app-settings/discord-members", { token }),

  listViolations: (token, { search, dateFrom, dateTo } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    return request(`/api/violations${query}`, { token });
  },
  getViolationTargetCandidates: (token, regimentId) =>
    request(`/api/violations/target-candidates${regimentId ? `?regiment_id=${regimentId}` : ""}`, { token }),
  deleteViolation: (token, violationId) =>
    request(`/api/violations/${violationId}`, { method: "DELETE", token }),

  getModuleAccess: (token) => request("/api/module-access", { token }),
  updateModuleAccess: (token, changes) =>
    request("/api/module-access", { method: "PATCH", token, body: changes }),

  getMaintenanceStatus: () => request("/api/maintenance-status", {}),
  updateMaintenance: (token, { enabled, message }) =>
    request("/api/admin/maintenance", { method: "PATCH", token, body: { enabled, message } }),

  listNotifications: (token) => request("/api/notifications", { token }),
  markAllNotificationsRead: (token) => request("/api/notifications/read-all", { method: "POST", token }),
  sendBroadcast: (token, { title, body }) =>
    request("/api/notifications/broadcast", { method: "POST", token, body: { title, body } }),

  listReprimands: (token, regimentId) => request(`/api/regiments/${regimentId}/reprimands`, { token }),
  issueReprimand: (token, regimentId, { targetDiscordId, reason, severity, pointsRequired }) =>
    request(`/api/regiments/${regimentId}/reprimands`, {
      method: "POST",
      token,
      body: {
        target_discord_id: targetDiscordId,
        reason,
        severity: severity || "strict",
        points_required: pointsRequired || 0,
      },
    }),
  revokeReprimand: (token, regimentId, reprimandId) =>
    request(`/api/regiments/${regimentId}/reprimands/${reprimandId}`, { method: "DELETE", token }),
  // Все выговоры, видимые текущему пользователю (своё/формирование/всё по правам) —
  // для отдельной страницы "Выговоры", в отличие от listReprimands (по одному формированию)
  listAllReprimands: (token) => request("/api/reprimands", { token }),
  selfRevokeReprimand: (token, reprimandId) =>
    request(`/api/reprimands/${reprimandId}/self-revoke`, { method: "POST", token }),
  setReprimandAppeal: (token, reprimandId, appealText) =>
    request(`/api/reprimands/${reprimandId}/appeal`, { method: "PATCH", token, body: { appeal_text: appealText } }),

  listAuditLog: (token, filters = {}) => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    params.set("limit", filters.limit || 1000);
    return request(`/api/admin/audit-log?${params.toString()}`, { token });
  },

  getPromotionRequirements: (token, regimentId) =>
    request(`/api/regiments/${regimentId}/promotion-requirements`, { token }),
  updatePromotionRequirements: (token, regimentId, items) =>
    request(`/api/regiments/${regimentId}/promotion-requirements`, {
      method: "PATCH",
      token,
      body: { items },
    }),
  updateTierTenure: (token, tierId, tenureDaysRequired) =>
    request(`/api/ranks/tiers/${tierId}`, {
      method: "PATCH",
      token,
      body: { tenure_days_required: tenureDaysRequired },
    }),
  // regimentIds=null — применить сразу ко всем формированиям
  updateAdminPointsRequired: (token, items, regimentIds = null) =>
    request("/api/promotion-requirements/admin", {
      method: "PATCH",
      token,
      body: { items, regiment_ids: regimentIds },
    }),
  listPromotionRequests: (token) => request("/api/promotion-requests", { token }),
  approvePromotionRequest: (token, requestId) =>
    request(`/api/promotion-requests/${requestId}/approve`, { method: "POST", token }),
  rejectPromotionRequest: (token, requestId) =>
    request(`/api/promotion-requests/${requestId}/reject`, { method: "POST", token }),
  getMyPromotionStatus: (token) => request("/api/me/promotion-status", { token }),
  getMyPromotionHistory: (token) => request("/api/me/promotion-history", { token }),
  getPromotionReview: (token, requestId) => request(`/api/promotion-requests/${requestId}/review`, { token }),
  getMemberPromotionStatus: (token, regimentId, discordId) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/promotion-status`, { token }),

  updateRankTenure: (token, rankId, tenureDaysRequired) =>
    request(`/api/ranks/${rankId}`, {
      method: "PATCH",
      token,
      body: { tenure_days_required: tenureDaysRequired },
    }),

  getCategoryRequirements: (token, regimentId) =>
    request(`/api/regiments/${regimentId}/promotion-category-requirements`, { token }),
  createLocalCategoryRequirement: (token, regimentId, { rankId, categoryId, countRequired }) =>
    request(`/api/regiments/${regimentId}/promotion-category-requirements`, {
      method: "POST",
      token,
      body: { rank_id: rankId, category_id: categoryId, count_required: countRequired },
    }),
  createMandatoryCategoryRequirement: (token, { rankId, categoryName, categoryFields, countRequired }) =>
    request("/api/promotion-category-requirements/mandatory", {
      method: "POST",
      token,
      body: {
        rank_id: rankId,
        category_name: categoryName,
        category_fields: categoryFields || [],
        count_required: countRequired,
      },
    }),
  deleteCategoryRequirement: (token, requirementId) =>
    request(`/api/promotion-category-requirements/${requirementId}`, { method: "DELETE", token }),
  overrideCategoryRequirement: (token, { requirementId, targetDiscordId, satisfied }) =>
    request("/api/promotion-category-requirements/override", {
      method: "POST",
      token,
      body: { requirement_id: requirementId, target_discord_id: targetDiscordId, satisfied },
    }),

  updateMemberTenure: (token, regimentId, discordId, daysInRank) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/tenure`, {
      method: "PATCH",
      token,
      body: { days_in_rank: daysInRank },
    }),
  issuePointsAdjustment: (token, regimentId, discordId, { points, reason }) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/points-adjustment`, {
      method: "POST",
      token,
      body: { points, reason },
    }),

  listLeaveRequests: (token) => request("/api/leave-requests", { token }),
  createLeaveRequest: (token, { regimentId, startDate, endDate, reason }) =>
    request("/api/leave-requests", {
      method: "POST",
      token,
      body: { regiment_id: regimentId, start_date: startDate, end_date: endDate, reason },
    }),
  approveLeaveRequest: (token, requestId) =>
    request(`/api/leave-requests/${requestId}/approve`, { method: "POST", token }),
  rejectLeaveRequest: (token, requestId) =>
    request(`/api/leave-requests/${requestId}/reject`, { method: "POST", token }),

  getRegimentStats: (token, regimentId, period) =>
    request(`/api/stats/regiment/${regimentId}?period=${period}`, { token }),
  getFormationStats: (token, period) => request(`/api/stats/formations?period=${period}`, { token }),

  listBackups: (token) => request("/api/admin/backups", { token }),
  createBackup: (token) => request("/api/admin/backups", { method: "POST", token }),
  deleteBackup: (token, filename) => request(`/api/admin/backups/${filename}`, { method: "DELETE", token }),
  // Скачивание требует авторизации — обычная <a href> ссылка не передаст токен,
  // поэтому качаем через fetch и подсовываем браузеру blob как файл
  async downloadBackup(token, filename) {
    const response = await fetch(`${API_BASE_URL}/api/admin/backups/${filename}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new ApiError(response.status, "Не удалось скачать файл");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
};

export { ApiError };
