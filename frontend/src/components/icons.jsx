/** Небольшой набор чистых line-иконок (SVG, не эмодзи) — единый визуальный язык
 * для часто используемых действий вместо разномастных эмодзи-символов. */
const common = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function SearchIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M13.5 13.5 L10.2 10.2" />
    </svg>
  );
}

export function BellIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1 4 1.5 4.5h-11C3 10.5 4 9.5 4 6.5Z" />
      <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

export function MegaphoneIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M2 6.5v3l9 2.5v-8Z" />
      <path d="M11 5v6" />
      <path d="M4.5 9.5 5 13a1 1 0 0 0 1.94.35" />
    </svg>
  );
}

export function CheckIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M3 8.5 L6.2 11.5 L13 4.5" />
    </svg>
  );
}

export function CrossIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M4 4 L12 12 M12 4 L4 12" />
    </svg>
  );
}

export function MenuIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 11.5h11" />
    </svg>
  );
}

export function TrashIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M3 4.5h10" />
      <path d="M6 4.5V3h4v1.5" />
      <path d="M4.5 4.5 5 13h6l0.5-8.5" />
    </svg>
  );
}

export function GearIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 2.2v1.7M8 12.1v1.7M13.8 8h-1.7M3.9 8H2.2M12.1 3.9l-1.2 1.2M5.1 10.9l-1.2 1.2M12.1 12.1l-1.2-1.2M5.1 5.1 3.9 3.9" />
    </svg>
  );
}

export function InfoIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.3v4.2" />
      <circle cx="8" cy="4.9" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function SunIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6 3.4 3.4" />
    </svg>
  );
}

export function MoonIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
    </svg>
  );
}

export function LinkIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M6.7 9.3 9.3 6.7" />
      <path d="M7.6 4.6 8.6 3.6a2.3 2.3 0 0 1 3.3 3.3l-1 1" />
      <path d="M8.4 11.4 7.4 12.4a2.3 2.3 0 0 1-3.3-3.3l1-1" />
    </svg>
  );
}
