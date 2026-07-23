/** Список категорий слева от рапортов — клик фильтрует список по категории
 * (например, зайти и посмотреть все "Тренировки"). */
export function CategoryNav({ categories, regimentsById, activeCategoryId, onSelect }) {
  const showRegimentName = new Set(categories.map((c) => c.regiment_id)).size > 1;

  return (
    <nav className="category-nav">
      <h4>Категории</h4>
      <ul>
        <li>
          <button
            className={activeCategoryId === null ? "active" : ""}
            onClick={() => onSelect(null)}
          >
            Все рапорты
          </button>
        </li>
        {categories.map((c) => (
          <li key={c.id}>
            <button className={activeCategoryId === c.id ? "active" : ""} onClick={() => onSelect(c.id)}>
              {c.name}
              {showRegimentName && (
                <span className="category-nav-regiment"> — {regimentsById[c.regiment_id]?.name}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
