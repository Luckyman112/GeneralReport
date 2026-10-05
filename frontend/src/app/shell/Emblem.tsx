/** Эмблема COLLAPSAR: кольцо, стрелки сходятся к янтарному ядру (коллапсар). */
export function Emblem({ className }: { className?: string }) {
  const arrows = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="22.5" fill="none" stroke="var(--color-line-strong)" strokeWidth="1" />
      <circle cx="24" cy="24" r="15" fill="var(--color-panel)" stroke="var(--color-ice)" strokeOpacity="0.55" strokeWidth="1" />
      {arrows.map((deg) => (
        <g key={deg} transform={`rotate(${deg} 24 24)`}>
          <line x1="24" y1="5" x2="24" y2="13" stroke="var(--color-amber)" strokeWidth="1.3" />
          <polyline points="21.5,10.8 24,13.3 26.5,10.8" fill="none" stroke="var(--color-amber)" strokeWidth="1.3" />
        </g>
      ))}
      <circle cx="24" cy="24" r="5.5" fill="var(--color-amber)" />
    </svg>
  );
}
