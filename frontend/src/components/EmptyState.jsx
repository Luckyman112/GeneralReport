/** Единый пустой стейт для списков — вместо голого текста "X нет" везде по-своему.
 * Иконка — простой SVG-контур (не эмодзи), в цвет остального интерфейса. */
export function EmptyState({ text }) {
  return (
    <div className="empty-state">
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
        className="empty-state-icon"
      >
        <rect x="4" y="12" width="32" height="22" rx="3" strokeDasharray="3 3" />
        <path d="M4 20 L14 20 L17 24 L23 24 L26 20 L36 20" />
        <circle cx="20" cy="8" r="2.5" fill="currentColor" stroke="none" opacity="0.5" />
      </svg>
      <p>{text}</p>
    </div>
  );
}
