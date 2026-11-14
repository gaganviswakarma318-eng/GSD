import { Icon } from "../../shared/components/Icon";
import type { Health } from "../../shared/types";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  health: Health | null;
  healthError: string;
  onCheck(): void;
}

export function SettingsPage({ health, healthError, onCheck }: Props) {
  return (
    <section className="settings-page">
      <div className="page-intro">
        <span className="eyebrow">PREFERENCES</span>
        <p>Adjust your appearance and review the media tools.</p>
      </div>
      <section className="settings-card panel">
        <div>
          <span className="settings-card-icon"><Icon name="sun" size={19} /></span>
          <div>
            <h3>Appearance</h3>
            <p>Choose light, dark, or black.</p>
          </div>
        </div>
        <ThemeToggle />
      </section>
      <section className="settings-card settings-tools panel">
        <div className="settings-card-heading">
          <span className="settings-card-icon"><Icon name="processing" size={19} /></span>
          <div>
            <h3>Media tools</h3>
            <p>Runtime availability reported by the local GSD service.</p>
          </div>
          <button className="text-button" type="button" onClick={onCheck}>
            Refresh <Icon name="retry" size={14} />
          </button>
        </div>
        <ToolStatus label="yt-dlp" available={health?.tools.ytDlp} />
        <ToolStatus label="FFmpeg" available={health?.tools.ffmpeg} />
        {healthError && <p className="inline-error" role="alert">{healthError}</p>}
      </section>
      <p className="settings-footnote">
        Downloads are processed by GSD’s local service. Unavailable modules are
        not simulated.
      </p>
    </section>
  );
}

function ToolStatus({
  label,
  available,
}: {
  label: string;
  available?: boolean;
}) {
  return (
    <div className="tool-status-row">
      <span>{label}</span>
      <span className={`tool-status ${available ? "available" : ""}`}>
        <i />
        {available === undefined
          ? "Checking"
          : available
            ? "Available"
            : "Unavailable"}
      </span>
    </div>
  );
}
