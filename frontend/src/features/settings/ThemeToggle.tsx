import { isTheme, useTheme } from "./useTheme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <label className="theme-selector">
      <span className="sr-only">Appearance</span>
      <select
        className="theme-toggle"
        aria-label="Appearance"
        value={theme}
        onChange={(event) => {
          if (isTheme(event.currentTarget.value))
            setTheme(event.currentTarget.value);
        }}
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="black">Black</option>
      </select>
    </label>
  );
}
