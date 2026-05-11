import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

/**
 * Hook-only theme store. No Context provider: the `dark` class on <html>
 * is the single source of truth for Tailwind, and a module-level subscriber
 * set lets each `useTheme()` caller read the current string value. Simpler
 * than a Context because there's no wrapping component to add and the two
 * consumers (logo swap + toggle) aren't deeply nested.
 */

const listeners = new Set<(t: Theme) => void>();

function readInitial(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let current: Theme = readInitial();

function applyToDom(t: Theme) {
  const root = document.documentElement;
  if (t === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

// Apply once at module load so the first render has the right class.
if (typeof window !== "undefined") applyToDom(current);

function set(t: Theme) {
  current = t;
  localStorage.setItem(STORAGE_KEY, t);
  applyToDom(t);
  listeners.forEach((fn) => fn(t));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(current);

  useEffect(() => {
    const fn = (t: Theme) => setThemeState(t);
    listeners.add(fn);
    // Catch any change that happened between render and effect commit.
    if (current !== theme) setThemeState(current);
    return () => {
      listeners.delete(fn);
    };
  }, [theme]);

  return {
    theme,
    setTheme: set,
    toggle: () => set(current === "dark" ? "light" : "dark"),
  };
}
