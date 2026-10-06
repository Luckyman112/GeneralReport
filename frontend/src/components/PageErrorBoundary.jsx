import { Component } from "react";

// Ошибка загрузки JS-чанка страницы: после деплоя старые файлы удалены, а
// открытая вкладка ещё ссылается на них. Лечится только перезагрузкой.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
const RELOAD_KEY = "collapsar_chunk_reload_at";

/** Перезагрузить страницу, но не чаще раза в минуту, чтобы не уйти в цикл,
 * если файл не грузится по другой причине. Возвращает true, если перезагружает. */
export function reloadForStaleChunk() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  } catch {
    // хранилище недоступно — перезагрузим один раз без защиты
  }
  if (Date.now() - last < 60_000) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // см. выше
  }
  window.location.reload();
  return true;
}

/** Ловит ошибки рендера страницы. Без него любая ошибка (или не загрузившийся
 * чанк) оставляла пустой экран на всём сайте до ручной перезагрузки. Сбрасывается
 * при переходе на другую страницу (`resetKey`). */
export class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (CHUNK_ERROR.test(String(error?.message || error))) reloadForStaleChunk();
    else console.error("Ошибка страницы:", error);
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const stale = CHUNK_ERROR.test(String(this.state.error?.message || this.state.error));
    return (
      <div className="page-error regiment-panel">
        <h3>{stale ? "Сайт обновился" : "Что-то пошло не так"}</h3>
        <p className="hint-text">
          {stale
            ? "Пока страница была открыта, вышла новая версия сайта. Обновите страницу, чтобы продолжить."
            : "Эта страница не смогла отобразиться. Попробуйте обновить её; если ошибка повторяется — сообщите администрации."}
        </p>
        <button className="primary" type="button" onClick={() => window.location.reload()}>
          Обновить страницу
        </button>
      </div>
    );
  }
}
