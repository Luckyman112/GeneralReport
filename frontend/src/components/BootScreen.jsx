/** Полноэкранная заставка на время первичного входа (пока не известно, авторизован
 * ли пользователь) — вращающийся "радар" вместо голого текста "Выполняется вход...",
 * в тон остальному HUD-стилю приложения. */
export function BootScreen({ error }) {
  return (
    <div className="boot-screen">
      <div className="radar" aria-hidden="true">
        <div className="radar-ring radar-ring-1" />
        <div className="radar-ring radar-ring-2" />
        <div className="radar-ring radar-ring-3" />
        <div className="radar-crosshair-h" />
        <div className="radar-crosshair-v" />
        <div className="radar-sweep" />
        <div className="radar-blip radar-blip-1" />
        <div className="radar-blip radar-blip-2" />
        <div className="radar-blip radar-blip-3" />
      </div>
      <div className="boot-screen-brand">COLLAPSAR</div>
      {error ? (
        <p className="error-text">{error}</p>
      ) : (
        <p className="boot-screen-status">Выполняется вход...</p>
      )}
    </div>
  );
}
