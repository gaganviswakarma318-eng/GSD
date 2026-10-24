import { useTheme } from "../hooks/useTheme";
import { Icon } from "./Icon";

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Turn dark mode off" : "Turn dark mode on"}
      onClick={toggle}
    >
      <Icon name={dark ? "sun" : "moon"} size={17} />
      <span className="theme-toggle-label">Dark mode</span>
    </button>
  );
}
