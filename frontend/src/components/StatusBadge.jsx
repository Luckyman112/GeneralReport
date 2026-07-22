const LABELS = {
  draft: "Черновик",
  submitted: "Отправлен",
  approved: "Одобрен",
  rejected: "Отклонён",
  deleted: "Удалён",
};

export function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{LABELS[status] || status}</span>;
}
