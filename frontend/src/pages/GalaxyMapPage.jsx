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
      // Сброс на статичное позиционирование перед замером — иначе второй и
      // последующие вызовы (ресайз окна) мерили бы уже зафиксированный блок
      // относительно viewport, а не его настоящее место в потоке.
      node.style.position = "static";
      const r = node.getBoundingClientRect();
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
