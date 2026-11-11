import { isTheme, useTheme } from "../hooks/useTheme";
import { Icon } from "./Icon";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const icon = theme === "light" ? "sun" : "moon";

  return (
    <label className="theme-selector">
      <Icon className="theme-selector-icon" name={icon} size={16} />
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
