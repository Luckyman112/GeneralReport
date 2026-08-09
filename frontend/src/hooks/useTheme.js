import { useEffect, useState } from "react";

const STORAGE_KEY = "collapsar-theme";
// useTheme() below gives each caller its own independent state — fine for the
// single Navbar toggle button, but a second consumer (chart components) needs
// to react when Navbar's instance changes theme, not just its own. This tiny
// pub/sub lets useThemeValue() below stay in sync with whichever useTheme()
// instance last toggled.
const listeners = new Set();

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
      for (const listener of listeners) listener(next);
      return next;
    });
  }

  return [theme, toggleTheme];
}

/** Только чтение текущей темы, реактивно — для компонентов, которым не нужен
 * переключатель (графики), но нужно перерисоваться сразу же, когда тему
 * переключат в Navbar, а не только на следующий несвязанный ре-рендер. */
export function useThemeValue() {
  const [theme, setTheme] = useState(getInitialTheme);
  useEffect(() => {
    listeners.add(setTheme);
    return () => listeners.delete(setTheme);
  }, []);
  return theme;
}
