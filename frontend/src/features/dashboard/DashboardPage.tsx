import type { ComponentProps } from "react";
import { QueuePanel } from "../download-queue/QueuePanel";
import { Icon, type IconName } from "../../shared/components/Icon";

type QueueProps = Omit<
  ComponentProps<typeof QueuePanel>,
  "title" | "initialFilter"
>;

interface Props {
  activeCount: number;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  queueProps: QueueProps;
}

export function DashboardPage({
  activeCount,
  completedCount,
  failedCount,
  totalCount,
  queueProps,
}: Props) {
  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome">
        <span className="eyebrow">YOUR MEDIA, IN ONE PLACE</span>
        <h2>A calmer way to collect and manage media.</h2>
        <p>
          Choose a workflow to get started. Downloads and their live progress
          stay together in your workspace.
        </p>
      </section>
      <section className="dashboard-stats" aria-label="Download overview">
        <StatCard label="In progress" value={activeCount} icon="processing" />
        <StatCard label="Completed" value={completedCount} icon="check" />
        <StatCard label="Needs attention" value={failedCount} icon="retry" />
        <StatCard label="All downloads" value={totalCount} icon="download" />
      </section>
      <section className="quick-actions" aria-label="Start a workflow">
        <a href="/universal">
          <span><Icon name="globe" size={19} /></span>
          <strong>Universal Downloader</strong>
          <small>Use yt-dlp with a supported source</small>
          <Icon className="quick-action-arrow" name="chevron" size={16} />
        </a>
        <a href="/clip">
          <span><Icon name="scissors" size={19} /></span>
          <strong>Clip Studio</strong>
          <small>Preview a video and choose a segment</small>
          <Icon className="quick-action-arrow" name="chevron" size={16} />
        </a>
      </section>
      <QueuePanel {...queueProps} title="Recent downloads" initialFilter="all" />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: IconName;
}) {
  return (
    <article className="stat-card">
      <span className="stat-icon"><Icon name={icon} size={17} /></span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </article>
  );
}
