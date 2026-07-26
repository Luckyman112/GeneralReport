/** Скелетон-заглушка вместо текста "Загрузка..." — несколько мерцающих полос,
 * повторяющих примерный силуэт страницы (заголовок + карточки), чтобы переход
 * между состояниями не выглядел как "прыжок" пустого экрана. */
export function PageLoading() {
  return (
    <div className="page-loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" style={{ width: "80%" }} />
      <div className="skeleton skeleton-card" />
    </div>
  );
}
