import { useLayoutEffect, useRef, useState } from "react";

/** "Галактика" — на весь остаток экрана (только сайдбар слева и навбар
 * сверху остаются), а не в обычные max-width:1400px .page-container — по
 * просьбе пользователя. Меряем, где блок оказался бы в обычном потоке (сразу
 * после навбара, справа от сайдбара), и переключаем на position:fixed с
 * этими же координатами — так не нужно вручную знать точную высоту навбара
 * или ширину сайдбара (и это переживёт их будущие правки), а сама точка
 * "top/left" совпадает с тем, что даёт нормальная раскладка. */
export function GalaxyMapPage() {
  const wrapRef = useRef(null);
  const [fixedRect, setFixedRect] = useState(null);

  useLayoutEffect(() => {
    function update() {
      const node = wrapRef.current;
      if (!node) return;
      // Меряем РОДИТЕЛЯ (.page-container), не сам блок — у самого блока
      // getBoundingClientRect() уже учитывает padding .page-container
      // (1.5rem/1rem), из-за которого оставался зазор слева/сверху между
      // сайдбаром/навбаром и картой (баг-репорт). Внешний край контейнера —
      // как раз то место, где сайдбар/навбар заканчиваются.
      const r = (node.parentElement || node).getBoundingClientRect();
      setFixedRect({ top: r.top, left: r.left });
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div
      ref={wrapRef}
      className="galaxy-map-wrap"
      style={
        fixedRect
          ? {
              position: "fixed",
              top: fixedRect.top,
              left: fixedRect.left,
              right: 0,
              bottom: 0,
              width: "auto",
              height: "auto",
              margin: 0,
            }
          : undefined
      }
    >
      <iframe src="/galaxy-map.html" title="Галактика" />
    </div>
  );
}
