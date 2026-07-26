/** Список категорий слева от рапортов — клик фильтрует список по категории
 * (например, зайти и посмотреть все "Тренировки"). Сверху/снизу — "виртуальные"
 * разделы (Выговоры/Отпуска), которые не являются категориями рапортов, но живут
 * в этой же навигации ради единого места "куда смотреть". */
export function CategoryNav({
  categories,
  regimentsById,
  activeCategoryId,
  view = "reports",
  onSelectView,
  showReprimands,
  showLeave,
}) {
  const showRegimentName = new Set(categories.map((c) => c.regiment_id)).size > 1;

  return (
    <nav className="category-nav">
      <h4>Категории</h4>
      <ul>
        <li>
          <button
            className={view === "reports" && activeCategoryId === null ? "active" : ""}
            onClick={() => onSelectView("reports", null)}
          >
            Все рапорты
          </button>
        </li>
        {categories.map((c) => (
          <li key={c.id}>
            <button
              className={view === "reports" && activeCategoryId === c.id ? "active" : ""}
              onClick={() => onSelectView("reports", c.id)}
            >
              {c.name}
              {showRegimentName && (
                <span className="category-nav-regiment"> — {regimentsById[c.regiment_id]?.name}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {(showReprimands || showLeave) && (
        <>
          <hr className="hud-divider" />
          <ul>
            {showReprimands && (
              <li>
                <button className={view === "reprimands" ? "active" : ""} onClick={() => onSelectView("reprimands")}>
                  Выговоры
                </button>
              </li>
            )}
            {showLeave && (
              <li>
                <button className={view === "leave" ? "active" : ""} onClick={() => onSelectView("leave")}>
                  Отпуска
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </nav>
  );
}
