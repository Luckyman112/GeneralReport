/** Список категорий слева от рапортов — клик фильтрует список по категории
 * (например, зайти и посмотреть все "Тренировки"). Сверху/снизу — "виртуальные"
 * разделы (Выговоры/Отпуска), которые не являются категориями рапортов, но живут
 * в этой же навигации ради единого места "куда смотреть". */
export function CategoryNav({
  categories,
  promotionCategories = [],
  demotionCategories = [],
  trainingCategories = [],
  regimentsById,
  activeCategoryId,
  view = "reports",
  onSelectView,
  showReprimands,
  showLeave,
}) {
  const showRegimentName = new Set(categories.map((c) => c.regiment_id)).size > 1;
  const showVirtualSection =
    showReprimands ||
    showLeave ||
    promotionCategories.length > 0 ||
    demotionCategories.length > 0 ||
    trainingCategories.length > 0;

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

      {showVirtualSection && (
        <>
          <hr className="hud-divider" />
          <ul>
            {promotionCategories.map((c) => (
              <li key={c.id}>
                <button
                  className={view === "reports" && activeCategoryId === c.id ? "active" : ""}
                  onClick={() => onSelectView("reports", c.id)}
                >
                  Повышения
                  {showRegimentName && (
                    <span className="category-nav-regiment"> — {regimentsById[c.regiment_id]?.name}</span>
                  )}
                </button>
              </li>
            ))}
            {demotionCategories.map((c) => (
              <li key={c.id}>
                <button
                  className={view === "reports" && activeCategoryId === c.id ? "active" : ""}
                  onClick={() => onSelectView("reports", c.id)}
                >
                  Понижения
                  {showRegimentName && (
                    <span className="category-nav-regiment"> — {regimentsById[c.regiment_id]?.name}</span>
                  )}
                </button>
              </li>
            ))}
            {trainingCategories.map((c) => (
              <li key={c.id}>
                <button
                  className={view === "reports" && activeCategoryId === c.id ? "active" : ""}
                  onClick={() => onSelectView("reports", c.id)}
                >
                  Обучение на специализацию
                  {showRegimentName && (
                    <span className="category-nav-regiment"> — {regimentsById[c.regiment_id]?.name}</span>
                  )}
                </button>
              </li>
            ))}
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
