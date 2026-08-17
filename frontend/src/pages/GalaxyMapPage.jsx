/** "Галактика" — карта кампании (frontend/public/galaxy-map.html) живёт как
 * отдельное самостоятельное canvas/vanilla-JS приложение (своя тема, свой
 * layout, ничего общего с React-деревом сайта — см. CLAUDE.md), поэтому тут
 * не переписана на компоненты, а просто встроена через iframe того же
 * происхождения (localStorage с JWT общий, страница сама читает токен и
 * ходит в /api/galaxy-map). Раньше кнопка "Галактика" открывала этот файл
 * прямой ссылкой в новой вкладке — по просьбе пользователя ("хочу чтобы всё
 * на сайте было") заменено на обычный внутренний роут с iframe на всю
 * страницу. */
export function GalaxyMapPage() {
  return (
    <iframe
      src="/galaxy-map.html"
      title="Галактика"
      className="galaxy-map-frame"
      style={{
        display: "block",
        width: "calc(100% + 2rem)",
        height: "calc(100vh - 6.5rem)",
        margin: "-1.5rem -1rem",
        border: "none",
      }}
    />
  );
}
