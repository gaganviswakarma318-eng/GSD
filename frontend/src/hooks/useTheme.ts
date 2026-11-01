import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "gsd-theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#1d221e" : "#f3f2ec");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Keep the toggle usable when browser storage is unavailable. */
    }
  }, [theme]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null)
        setTheme(event.newValue === "dark" ? "dark" : "light");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return {
    dark: theme === "dark",
    toggle: () =>
      setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
