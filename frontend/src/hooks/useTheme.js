import { useEffect, useState } from "react";

const STORAGE_KEY = "collapsar-theme";

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return systemPrefersDark() ? "dark" : "light";
}

/** Ручной переключатель темы поверх системной настройки — выбор запоминается
 * в localStorage и стамповается атрибутом data-theme на <html>, который
 * перебивает @media (prefers-color-scheme) в styles.css. */
export function useTheme() {
  const [theme, setThemeState] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }

  return [theme, toggleTheme];
}
