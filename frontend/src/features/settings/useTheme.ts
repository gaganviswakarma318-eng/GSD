import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "black";
const STORAGE_KEY = "gsd-theme";

export const isTheme = (value: string | undefined | null): value is Theme =>
  value === "light" ||
  value === "dark" ||
  value === "black";

const themeColor: Record<Theme, string> = {
  light: "#f3f2ec",
  dark: "#090B0D",
  black: "#000000",
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = document.documentElement.dataset.theme;
    return isTheme(initial) ? initial : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme =
      theme === "light" ? "light" : "dark";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", themeColor[theme]);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Keep the selector usable when browser storage is unavailable. */
    }
  }, [theme]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null)
        setTheme(isTheme(event.newValue) ? event.newValue : "dark");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return { theme, setTheme };
}
