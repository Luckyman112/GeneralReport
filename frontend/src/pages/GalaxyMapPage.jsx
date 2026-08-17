import { useLayoutEffect, useRef, useState } from "react";

/** "Галактика" — на весь остаток экрана (только сайдбар слева и навбар
 * сверху остаются), а не в обычные max-width:1400px .page-container — по
 * просьбе пользователя. top берём у .page-container (уже правильно ниже
 * навбара/ViewAsBar благодаря flex-column у .app-content), left — у
 * .app-content напрямую, т.к. .page-container сам ограничен max-width:1400px
 * и отцентрирован — его собственный левый край не совпадает с сайдбаром на
 * широких экранах. Переключаем на position:fixed с этими координатами —
 * так не нужно вручную знать точную высоту навбара/ширину сайдбара (и это
 * переживёт их будущие правки). */
export function GalaxyMapPage() {
  const wrapRef = useRef(null);
  const [fixedRect, setFixedRect] = useState(null);

  useLayoutEffect(() => {
    function update() {
      const node = wrapRef.current;
      if (!node) return;
      // .page-container сам по себе ограничен max-width:1400px и
      // отцентрирован (margin:0 auto) внутри .app-content — его левый край
      // НЕ совпадает с сайдбаром, если контент шире 1400px (баг-репорт: с
      // right:0 ниже правый край выравнивался принудительно, а левый
      // оставался "внутри" центрированного узкого блока, отсюда зазор
      // именно слева). top берём у .page-container (уже верно — сразу под
      // навбаром/ViewAsBar благодаря flex-column), а left — у его родителя
      // .app-content, который ничем не ограничен и начинается сразу после
      // сайдбара.
      const pageContainer = node.parentElement;
      const appContent = pageContainer ? pageContainer.parentElement : null;
      const topRect = (pageContainer || node).getBoundingClientRect();
      const leftRect = (appContent || pageContainer || node).getBoundingClientRect();
      setFixedRect({ top: topRect.top, left: leftRect.left });
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
