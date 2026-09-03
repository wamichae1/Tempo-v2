import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const LS_THEME = "tempo:theme";

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Light/dark/system theme. Applies the `.dark` class to <html> (which the
 * token layer in index.css keys off) and persists the choice.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(LS_THEME);
    return saved === "dark" || saved === "system" ? saved : "light";
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(LS_THEME, theme);
    } catch {
      // storage unavailable — keep in memory
    }
  }, [theme]);

  // Track OS preference while in "system" mode.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setThemeState((t) =>
      t === "light" ? "dark" : t === "dark" ? "system" : "light",
    );
  }, []);

  return { theme, setTheme: setThemeState, cycleTheme };
}
