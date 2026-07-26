export const PUNISHMENT_OPTIONS = [
  { value: "verbal", label: "Устное предупреждение" },
  { value: "skt", label: "СКТ" },
  { value: "detention", label: "Задержание" },
  { value: "other", label: "Другое" },
];

const PUNISHMENT_LABELS = Object.fromEntries(PUNISHMENT_OPTIONS.map((o) => [o.value, o.label]));

export function formatPunishmentType(report) {
  if (!report.punishment_type) return "";
  if (report.punishment_type === "other") return report.punishment_other_text || "Другое";
  return PUNISHMENT_LABELS[report.punishment_type] || report.punishment_type;
}

/** Имя задержанного для отображения: из состава Discord-сервера — сохранённый
 * ник, иначе — введённые вручную ИДН/звание/позывной. */
export function formatDetentionTarget(report) {
  if (report.target_username) return report.target_username;
  if (report.target_service_id && report.target_rank && report.target_callsign) {
    return `${report.target_service_id} ${report.target_rank.code} ${report.target_callsign}`;
  }
  return null;
}
