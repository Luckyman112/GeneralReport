// Пусто по умолчанию — фронт раздаётся тем же процессом/адресом, что и бэкенд
// (self-host), поэтому относительных путей достаточно (same-origin).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Ошибка запроса (${status})`);
    this.status = status;
  }
}

// module state, not react state - request() is a plain function, not a hook.
// sessionStorage so it doesn't leak into other tabs
const VIEW_AS_STORAGE_KEY = "collapsar-view-as";
const VIEW_AS_DEFAULT = { mode: null, role: null, regimentId: null, extras: [], discordId: null, discordUsername: null };
let viewAsState = { ...VIEW_AS_DEFAULT };
try {
  const saved = JSON.parse(sessionStorage.getItem(VIEW_AS_STORAGE_KEY) || "null");
  if (saved) viewAsState = { ...VIEW_AS_DEFAULT, ...saved };
} catch {
  // повреждённое значение в sessionStorage — просто игнорируем
}

// mode: "role" -> {role, regimentId, extras}, "person" -> {discordId, discordUsername}
export function setViewAs(state) {
  viewAsState = { ...VIEW_AS_DEFAULT, ...state };
  sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(viewAsState));
}

export function clearViewAs() {
  viewAsState = { ...VIEW_AS_DEFAULT };
  sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
}

export function getViewAs() {
  return viewAsState;
}

/** Обёртка над fetch: подставляет базовый URL, JWT и разбирает ошибки бэкенда.
 * Если body — FormData (загрузка файла), не сериализуем в JSON и не трогаем
 * Content-Type — браузер сам проставит его с нужным boundary. */
async function request(path, { method = "GET", token, body, withTotal = false } = {}) {
  const isFormData = body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (viewAsState.mode === "person" && viewAsState.discordId) {
    headers["X-View-As-Discord-Id"] = viewAsState.discordId;
  } else if (viewAsState.mode === "role" && viewAsState.role) {
    headers["X-View-As-Role"] = viewAsState.role;
    if (viewAsState.regimentId) headers["X-View-As-Regiment-Id"] = String(viewAsState.regimentId);
    if (viewAsState.extras && viewAsState.extras.length > 0) {
      headers["X-View-As-Extra"] = viewAsState.extras.join(",");
    }
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
  checkHealth: () => request("/health"),
  loginWithDiscord: (code, redirectUri) =>
    request("/auth/discord", { method: "POST", body: { code, redirect_uri: redirectUri } }),
  loginWithPassword: (password, token) => request("/auth/password", { method: "POST", token, body: { password } }),
  getMe: (token) => request("/api/me", { token }),
  getViewAsCandidates: (token) => request("/api/me/view-as-candidates", { token }),

  listReports: (token, { status, regimentId, categoryId, search, period, limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (regimentId) params.set("regiment_id", regimentId);
    if (categoryId) params.set("category_id", categoryId);
    if (search) params.set("search", search);
    if (period) params.set("period", period);
    if (limit) params.set("limit", limit);
    if (offset) params.set("offset", offset);
    const query = params.toString() ? `?${params.toString()}` : "";
    return request(`/api/reports${query}`, { token, withTotal: Boolean(limit) });
  },
  listRecruitTrainingReports: (token) => request("/api/reports/recruit-training", { token }),
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
      trainingSpecializationIds,
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
        training_specialization_ids: trainingSpecializationIds || [],
      },
    }),
  updateReportStatus: (token, reportId, { status, rejectionReason }) =>
    request(`/api/reports/${reportId}`, {
      method: "PATCH",
      token,
      body: { status, rejection_reason: rejectionReason ?? null },
    }),
  // Совместные категории (см. ReportCategory.is_joint) — решение ОДНОГО
  // формирования-участника по рапорту, независимо от остальных
  decideReportForRegiment: (token, reportId, regimentId, { status, rejectionReason }) =>
    request(`/api/reports/${reportId}/regiments/${regimentId}`, {
      method: "PATCH",
      token,
      body: { status, rejection_reason: rejectionReason ?? null },
    }),
  updateReportContent: (token, reportId, content) =>
    request(`/api/reports/${reportId}/content`, { method: "PATCH", token, body: { content } }),
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

  listRegiments: (token, { includeArchived } = {}) =>
    request(`/api/regiments${includeArchived ? "?include_archived=true" : ""}`, { token }),
  archiveRegiment: (token, regimentId, isArchived) =>
    request(`/api/regiments/${regimentId}`, { method: "PATCH", token, body: { is_archived: isArchived } }),
  getHqLeadership: (token) => request("/api/regiments/hq-leadership", { token }),
  getDiscordRoles: (token) => request("/api/regiments/discord-roles", { token }),
  getInactiveMembers: (token) => request("/api/regiments/members/inactive", { token }),
  createRegiment: (token, { name, discordRoleId, color, discordChannelUrl, isJediOrder }) =>
    request("/api/regiments", {
      method: "POST",
      token,
      body: {
        name,
        discord_role_id: discordRoleId,
        color: color || null,
        discord_channel_url: discordChannelUrl || null,
        is_jedi_order: !!isJediOrder,
      },
    }),
  updateRegiment: (token, regimentId, { name, discordRoleId, color, discordChannelUrl, isJediOrder, startingRankId }) =>
    request(`/api/regiments/${regimentId}`, {
      method: "PATCH",
      token,
      body: {
        name: name ?? null,
        discord_role_id: discordRoleId ?? null,
        color: color || null,
        discord_channel_url: discordChannelUrl ?? null,
        is_jedi_order: isJediOrder,
        starting_rank_id: startingRankId ?? null,
      },
    }),

  listCategories: (token, regimentId) => request(`/api/regiments/${regimentId}/categories`, { token }),
  createCategory: (
    token,
    regimentId,
    {
      name,
      fields,
      points,
      participantPoints,
      requiredSpecializationId,
      openToRegimentLeadership,
      requiredSquadId,
      isJoint,
      maxPerDay,
    }
  ) =>
    request(`/api/regiments/${regimentId}/categories`, {
      method: "POST",
      token,
      body: {
        name,
        fields: fields || [],
        points: points ?? null,
        participant_points: participantPoints ?? null,
        required_specialization_id: requiredSpecializationId ?? null,
        open_to_regiment_leadership: openToRegimentLeadership ?? false,
        required_squad_id: requiredSquadId ?? null,
        is_joint: isJoint ?? false,
        max_per_day: maxPerDay ?? null,
      },
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
  getMentorCandidates: (token, regimentId) =>
    request(`/api/regiments/${regimentId}/mentor-candidates`, { token }),
  listCommanders: (token, regimentId) => request(`/api/regiments/${regimentId}/commanders`, { token }),

  submitRegistration: (token, { serviceId, callsign, steamId }) =>
    request("/api/me/registration", {
      method: "POST",
      token,
      body: { service_id: serviceId, callsign, steam_id: steamId },
    }),
  getSteamLoginUrl: (token) => request("/api/steam/login-url", { token }),
  listPendingRegistrations: (token) => request("/api/registrations/pending", { token }),
  listRejectedRegistrations: (token) => request("/api/registrations/rejected", { token }),
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

  listSquads: (token, regimentId) => request(`/api/regiments/${regimentId}/squads`, { token }),
  createSquad: (token, regimentId, name) =>
    request(`/api/regiments/${regimentId}/squads`, { method: "POST", token, body: { name } }),
  updateSquadTierLabels: (token, regimentId, squadId, tierLabels) =>
    request(`/api/regiments/${regimentId}/squads/${squadId}`, {
      method: "PATCH",
      token,
      body: { tier_labels: tierLabels },
    }),
  deleteSquad: (token, regimentId, squadId) =>
    request(`/api/regiments/${regimentId}/squads/${squadId}`, { method: "DELETE", token }),
  addSquadMember: (token, regimentId, squadId, { discordId, username, tier }) =>
    request(`/api/regiments/${regimentId}/squads/${squadId}/members`, {
      method: "POST",
      token,
      body: { discord_id: discordId, username, tier },
    }),
  updateSquadMemberTier: (token, regimentId, squadId, discordId, tier) =>
    request(`/api/regiments/${regimentId}/squads/${squadId}/members/${discordId}`, {
      method: "PATCH",
      token,
      body: { tier },
    }),
  removeSquadMember: (token, regimentId, squadId, discordId) =>
    request(`/api/regiments/${regimentId}/squads/${squadId}/members/${discordId}`, { method: "DELETE", token }),

  getMembers: (token, regimentId) => request(`/api/regiments/${regimentId}/members`, { token }),
  getMemberReports: (token, regimentId, discordId) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/reports`, { token }),
  setMemberProfile: (token, regimentId, discordId, changes) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/profile`, {
      method: "PATCH",
      token,
      body: changes,
    }),
  getMemberHistory: (token, regimentId, discordId) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/history`, { token }),
  resetMemberRegistration: (token, regimentId, discordId) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/reset-registration`, { method: "POST", token }),
  getMemberJediTrials: (token, regimentId, discordId) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/jedi-trials`, { token }),
  uploadMemberPhoto: (token, regimentId, discordId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request(`/api/regiments/${regimentId}/members/${discordId}/photo`, {
      method: "POST",
      token,
      body: formData,
    });
  },
  deleteMemberPhoto: (token, regimentId, discordId) =>
    request(`/api/regiments/${regimentId}/members/${discordId}/photo`, { method: "DELETE", token }),

  getRanks: (token) => request("/api/ranks", { token }),

  getAppSettings: (token) => request("/api/app-settings", { token }),
  updateAppSettings: (
    token,
    {
      adminRoleId,
      commanderRoleId,
      deputyRoleId,
      highCommandRoleId,
      adminUserDiscordIds,
      founderRoleId,
      founderUserDiscordIds,
    }
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
        founder_user_discord_ids: founderUserDiscordIds ?? null,
      },
    }),
  getAppSettingsMembers: (token) => request("/api/app-settings/discord-members", { token }),

  listSpecializations: (token) => request("/api/specializations", { token }),
  getInstructorActivity: (token, period = "all") =>
    request(`/api/specializations/instructor-activity?period=${period}`, { token }),
  getSystemHealth: (token, staleDays = 3) =>
    request(`/api/admin/health?stale_days=${staleDays}`, { token }),
  createSpecialization: (
    token,
    { code, name, category, minRankId, requiredRegimentId, parentId, prerequisiteSpecializationIds, isSingleton }
  ) =>
    request("/api/specializations", {
      method: "POST",
      token,
      body: {
        code,
        name,
        category,
        min_rank_id: minRankId ?? null,
        required_regiment_id: requiredRegimentId ?? null,
        parent_id: parentId ?? null,
        prerequisite_specialization_ids: prerequisiteSpecializationIds ?? [],
        is_singleton: isSingleton ?? false,
      },
    }),
  updateSpecialization: (
    token,
    specializationId,
    { code, name, category, minRankId, requiredRegimentId, parentId, prerequisiteSpecializationIds, isSingleton }
  ) =>
    request(`/api/specializations/${specializationId}`, {
      method: "PATCH",
      token,
      body: {
        code,
        name,
        category,
        min_rank_id: minRankId,
        required_regiment_id: requiredRegimentId,
        parent_id: parentId,
        prerequisite_specialization_ids: prerequisiteSpecializationIds,
        is_singleton: isSingleton,
      },
    }),
  deleteSpecialization: (token, specializationId) =>
    request(`/api/specializations/${specializationId}`, { method: "DELETE", token }),

  listInstructorRoles: (token) => request("/api/instructor-roles", { token }),
  createInstructorRole: (token, { discordRoleId, label, discipline, canTeachAll, tier }) =>
    request("/api/instructor-roles", {
      method: "POST",
      token,
      body: {
        discord_role_id: discordRoleId,
        label,
        discipline: discipline ?? null,
        can_teach_all: canTeachAll,
        tier: tier || "instructor",
      },
    }),
  getDisciplineRoster: (token, discipline) => request(`/api/specializations/discipline/${discipline}/roster`, { token }),
  sendDisciplineBroadcast: (token, { title, body, discipline }) =>
    request("/api/notifications/discipline-broadcast", { method: "POST", token, body: { title, body, discipline } }),
  deleteInstructorRole: (token, id) => request(`/api/instructor-roles/${id}`, { method: "DELETE", token }),
  listMemberSpecializations: (token, discordId) =>
    request(`/api/members/${discordId}/specializations`, { token }),
  grantSpecialization: (token, discordId, specializationId) =>
    request(`/api/members/${discordId}/specializations`, {
      method: "POST",
      token,
      body: { specialization_id: specializationId },
    }),
  revokeSpecialization: (token, discordId, grantId) =>
    request(`/api/members/${discordId}/specializations/${grantId}`, { method: "DELETE", token }),

  listActiveSpecializationBans: (token) => request("/api/specialization-bans/active", { token }),
  listSpecializationBans: (token, discordId) => request(`/api/members/${discordId}/specialization-bans`, { token }),
  createSpecializationBan: (token, discordId, { specializationId, untilDate, reason }) =>
    request(`/api/members/${discordId}/specialization-bans`, {
      method: "POST",
      token,
      body: { specialization_id: specializationId ?? null, until_date: untilDate || null, reason: reason || null },
    }),
  deleteSpecializationBan: (token, discordId, banId) =>
    request(`/api/members/${discordId}/specialization-bans/${banId}`, { method: "DELETE", token }),

  updateTierSpecializationLimits: (token, tierId, limits) =>
    request(`/api/ranks/tiers/${tierId}/specialization-limits`, { method: "PATCH", token, body: limits }),

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

  listWanted: (token) => request("/api/wanted", { token }),
  createWanted: (token, payload) => request("/api/wanted", { method: "POST", token, body: payload }),
  resolveWanted: (token, entryId, resolution) =>
    request(`/api/wanted/${entryId}/resolve`, { method: "POST", token, body: { resolution } }),
  deleteWanted: (token, entryId) => request(`/api/wanted/${entryId}`, { method: "DELETE", token }),

  getModuleAccess: (token) => request("/api/module-access", { token }),
  updateModuleAccess: (token, changes) =>
    request("/api/module-access", { method: "PATCH", token, body: changes }),
  getDiscordChannels: (token) => request("/api/module-access/discord-channels", { token }),

  getMaintenanceStatus: () => request("/api/maintenance-status", {}),
  updateMaintenance: (token, { enabled, message }) =>
    request("/api/admin/maintenance", { method: "PATCH", token, body: { enabled, message } }),

  listNotifications: (token) => request("/api/notifications", { token }),
  markAllNotificationsRead: (token) => request("/api/notifications/read-all", { method: "POST", token }),
  sendBroadcast: (token, { title, body }) =>
    request("/api/notifications/broadcast", { method: "POST", token, body: { title, body } }),
  deleteNotification: (token, id) => request(`/api/notifications/${id}`, { method: "DELETE", token }),

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
  deleteReprimand: (token, regimentId, reprimandId) =>
    request(`/api/regiments/${regimentId}/reprimands/${reprimandId}/permanent`, { method: "DELETE", token }),
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
    if (filters.adminOnly) params.set("admin_only", "true");
    if (filters.discipline) params.set("discipline", filters.discipline);
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
  createMandatoryCategoryRequirement: (
    token,
    { rankId, categoryName, categoryFields, countRequired, categoryMinRankId, categoryCommanderOnly }
  ) =>
    request("/api/promotion-category-requirements/mandatory", {
      method: "POST",
      token,
      body: {
        rank_id: rankId,
        category_name: categoryName,
        category_fields: categoryFields || [],
        count_required: countRequired,
        category_min_rank_id: categoryMinRankId || null,
        category_commander_only: !!categoryCommanderOnly,
      },
    }),
  updateMandatoryCategoryRequirement: (
    token,
    groupId,
    { rankId, categoryName, categoryFields, countRequired, categoryMinRankId, categoryCommanderOnly }
  ) =>
    request(`/api/promotion-category-requirements/mandatory/${groupId}`, {
      method: "PATCH",
      token,
      body: {
        rank_id: rankId,
        category_name: categoryName,
        category_fields: categoryFields || [],
        count_required: countRequired,
        category_min_rank_id: categoryMinRankId || null,
        category_commander_only: !!categoryCommanderOnly,
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

  createTransferRequest: (token, { toRegimentId, reason }) =>
    request("/api/transfer-requests", { method: "POST", token, body: { to_regiment_id: toRegimentId, reason } }),
  listTransferRequests: (token) => request("/api/transfer-requests", { token }),
  approveTransferSource: (token, requestId) =>
    request(`/api/transfer-requests/${requestId}/approve-source`, { method: "POST", token }),
  approveTransferTarget: (token, requestId, targetRankId) =>
    request(`/api/transfer-requests/${requestId}/approve-target`, {
      method: "POST",
      token,
      body: { target_rank_id: targetRankId },
    }),
  rejectTransferRequest: (token, requestId, reason) =>
    request(`/api/transfer-requests/${requestId}/reject`, { method: "POST", token, body: { reason: reason || null } }),

  listCharacters: (token, discordId) => request(`/api/users/${discordId}/characters`, { token }),
  createCharacter: (token, discordId, { regimentId, serviceId, callsign, rankId, steamId, isJedi }) =>
    request(`/api/users/${discordId}/characters`, {
      method: "POST",
      token,
      body: {
        regiment_id: regimentId,
        service_id: serviceId || null,
        callsign: callsign || null,
        rank_id: rankId || null,
        steam_id: steamId || null,
        is_jedi: !!isJedi,
      },
    }),
  updateCharacter: (token, discordId, characterId, { serviceId, callsign, rankId, steamId, isInactive, isJedi }) =>
    request(`/api/users/${discordId}/characters/${characterId}`, {
      method: "PATCH",
      token,
      body: {
        service_id: serviceId,
        callsign: callsign,
        rank_id: rankId,
        steam_id: steamId,
        is_inactive: isInactive,
        is_jedi: isJedi,
      },
    }),
  deleteCharacter: (token, discordId, characterId) =>
    request(`/api/users/${discordId}/characters/${characterId}`, { method: "DELETE", token }),

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
  async downloadSettingsExport(token) {
    const response = await fetch(`${API_BASE_URL}/api/admin/backups/settings-export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new ApiError(response.status, "Не удалось выгрузить настройки");
    const disposition = response.headers.get("content-disposition") || "";
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const filename = match ? match[1] : "settings.json";
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
  revokeAllSessions: (token) => request("/api/admin/sessions/revoke-all", { method: "POST", token }),

  listEvents: (token) => request("/api/event-room", { token }),
  createEvent: (token, { title, payload }) =>
    request("/api/event-room", { method: "POST", token, body: { title, payload } }),
  updateEvent: (token, eventId, { title, payload }) =>
    request(`/api/event-room/${eventId}`, { method: "PATCH", token, body: { title, payload } }),
  approveEvent: (token, eventId) => request(`/api/event-room/${eventId}/approve`, { method: "POST", token }),
  rejectEvent: (token, eventId, reason) =>
    request(`/api/event-room/${eventId}/reject`, { method: "POST", token, body: { reason } }),
  createEventMessage: (token, eventId, content) =>
    request(`/api/event-room/${eventId}/messages`, { method: "POST", token, body: { content } }),
  decideEventMessage: (token, messageId, { status, rejectionReason }) =>
    request(`/api/event-room/messages/${messageId}`, {
      method: "PATCH",
      token,
      body: { status, rejection_reason: rejectionReason || null },
    }),
  sendEventMessage: (token, messageId) =>
    request(`/api/event-room/messages/${messageId}/send`, { method: "POST", token }),
  cancelEvent: (token, eventId, reason) =>
    request(`/api/event-room/${eventId}/cancel`, { method: "POST", token, body: { reason: reason || null } }),
  getEventMemberCandidates: (token) => request("/api/event-room/member-candidates", { token }),
  listEventMaps: (token) => request("/api/event-room/maps/all", { token }),
  createEventMap: (token, { name, url }) =>
    request("/api/event-room/maps", {
      method: "POST",
      token,
      body: { name, url: url || null },
    }),
  updateEventMap: (token, mapId, { name, url }) =>
    request(`/api/event-room/maps/${mapId}`, {
      method: "PATCH",
      token,
      body: { name, url: url || null },
    }),
  deleteEventMap: (token, mapId) => request(`/api/event-room/maps/${mapId}`, { method: "DELETE", token }),
  getEventRoster: (token) => request("/api/event-room/roster", { token }),
  getEventRosterMemberDetail: (token, discordId) => request(`/api/event-room/roster/${discordId}`, { token }),
  uploadEventMapImage: (token, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("/api/event-room/upload-map-image", { method: "POST", token, body: formData });
  },
  // не через request() — ответ бинарный (PNG), а не JSON, см. app/api/event_room.py::preview_event_card
  previewEventCard: async (token, body) => {
    const response = await fetch(`${API_BASE_URL}/api/event-room/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let detail = null;
      try {
        detail = (await response.json()).detail;
      } catch {
        // тело ответа не JSON
      }
      throw new ApiError(response.status, detail);
    }
    return response.blob();
  },
  // как previewEventCard, но для уже сохранённой заявки (см. app/api/event_room.py::get_event_card)
  getEventCard: async (token, eventId) => {
    const response = await fetch(`${API_BASE_URL}/api/event-room/${eventId}/card`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let detail = null;
      try {
        detail = (await response.json()).detail;
      } catch {
        // тело ответа не JSON
      }
      throw new ApiError(response.status, detail);
    }
    return response.blob();
  },

  listEventActivityReports: (token) => request("/api/event-activity-reports", { token }),
  createEventActivityReport: (token, { eventType, payload }) =>
    request("/api/event-activity-reports", { method: "POST", token, body: { event_type: eventType, payload } }),
  decideEventActivityReport: (token, reportId, { status, rejectionReason }) =>
    request(`/api/event-activity-reports/${reportId}`, {
      method: "PATCH",
      token,
      body: { status, rejection_reason: rejectionReason || null },
    }),
  uploadEventActivityReportAttachment: (token, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("/api/event-activity-reports/attachments", { method: "POST", token, body: formData });
  },

  listEventBookings: (token, { rangeStart, rangeEnd }) =>
    request(
      `/api/event-bookings?range_start=${encodeURIComponent(rangeStart)}&range_end=${encodeURIComponent(rangeEnd)}`,
      { token }
    ),
  listMyEventBookings: (token) => request("/api/event-bookings/mine", { token }),
  createEventBooking: (token, { title, startsAt, endsAt }) =>
    request("/api/event-bookings", {
      method: "POST",
      token,
      body: { title, starts_at: startsAt, ends_at: endsAt },
    }),
  cancelEventBooking: (token, bookingId, reason) =>
    request(`/api/event-bookings/${bookingId}/cancel`, { method: "POST", token, body: { reason: reason || null } }),

  listAdminReports: (token) => request("/api/admin-reports", { token }),
  createAdminReport: (token, { reportType, payload }) =>
    request("/api/admin-reports", { method: "POST", token, body: { report_type: reportType, payload } }),
  decideAdminReport: (token, reportId, { status, rejectionReason }) =>
    request(`/api/admin-reports/${reportId}`, {
      method: "PATCH",
      token,
      body: { status, rejection_reason: rejectionReason || null },
    }),
  uploadAdminReportAttachment: (token, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("/api/admin-reports/attachments", { method: "POST", token, body: formData });
  },
  getAdminActivitySummary: (token) => request("/api/admin-reports/activity-summary", { token }),
};

export { ApiError };
