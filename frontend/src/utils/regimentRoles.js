/** У Ордена Джедаев "командир" называется иначе — "Следящий за джедаями" (см.
 * решение пользователя). Заместитель/наставник не переименовываются — только
 * сам role_type "commander". Значение role_type в БД/коде остаётся "commander",
 * меняется только видимая надпись — тот же паттерн, что переименование
 * "Администратор" -> "Высшая администрация" (см. CLAUDE.md). */
export function commanderRoleLabel(roleType, isJediOrder) {
  if (roleType === "deputy") return "Заместитель";
  if (roleType === "mentor") return "Наставник";
  return isJediOrder ? "Следящий за джедаями" : "Командир";
}

// Держим синхронно с app/models/user.py::JEDI_COUNCIL_SEATS — чистый титул,
// прав в системе не даёт (см. решение пользователя)
export const JEDI_COUNCIL_SEATS = {
  consular_head: "Глава Консулов",
  guardian_head: "Глава Защитников",
  sentinel_head: "Глава Стражей",
  apprentice_head: "Глава Ученичества",
};
