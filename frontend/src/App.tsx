import { useEffect, useRef, useState } from "react";
import {
  downloadInBrowser,
  downloadThumbnailInBrowser,
  saveToHandle,
} from "./api/client";
import { DownloadComposer } from "./components/DownloadComposer";
import type { DeliveryState } from "./components/DownloadCard";
import { Icon, type IconName } from "./components/Icon";
import { InstagramDownloader } from "./components/InstagramDownloader";
import { QueuePanel } from "./components/QueuePanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { ACTIVE_STATUSES, isDesktop } from "./config";
import { useDownloads } from "./hooks/useDownloads";
import { useHealth } from "./hooks/useHealth";
import type {
  ClipRange,
  DownloadJob,
  InstagramQueueResult,
  InstagramSelection,
  SaveDestination,
  SaveFileHandle,
  ThumbnailSettings,
} from "./types";
import { errorMessage } from "./utils";

type WorkspacePage =
  | "home"
  | "universal"
  | "instagram"
  | "clip"
  | "processing"
  | "library"
  | "settings";

interface NavigationItem {
  label: string;
  href?: string;
  icon: IconName;
  page?: WorkspacePage;
}

interface NavigationSection {
  label: string;
  items: NavigationItem[];
}

const navigationSections: NavigationSection[] = [
  {
    label: "DOWNLOAD",
    items: [
      { label: "Home", href: "/", icon: "home", page: "home" },
      {
        label: "Universal Downloader",
        href: "/universal",
        icon: "globe",
        page: "universal",
      },
      {
        label: "Instagram Downloader",
        href: "/instagram",
        icon: "instagram",
        page: "instagram",
      },
    ],
  },
  {
    label: "CREATE & PROCESS",
    items: [
      { label: "Clip Studio", href: "/clip", icon: "scissors", page: "clip" },
      { label: "AI Summary", icon: "summary" },
      { label: "Subtitles", icon: "subtitles" },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { label: "Settings", href: "/settings", icon: "settings", page: "settings" },
    ],
  },
];

const pageForPath = (path: string): WorkspacePage => {
  if (path === "/universal") return "universal";
  if (path === "/instagram") return "instagram";
  if (path === "/clip") return "clip";
  if (path === "/processing") return "processing";
  if (path === "/library") return "library";
  if (path === "/settings") return "settings";
  return "home";
};

const pageTitles: Record<WorkspacePage, string> = {
  home: "Home",
  universal: "Universal Downloader",
  instagram: "Instagram Downloader",
  clip: "Clip Studio",
  processing: "Processing",
  library: "Library",
  settings: "Settings",
};

function initialSidebarCollapsed() {
  try {
    return window.localStorage.getItem("gsd-sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}

export default function App() {
  const downloads = useDownloads();
  const { health, error: healthError, check } = useHealth();
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryState>>(
    {},
  );
  const [announcement, setAnnouncement] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialSidebarCollapsed,
  );
  const [formReady, setFormReady] = useState(false);
  const handles = useRef(new Map<string, SaveFileHandle>());
  const ownedJobs = useRef(new Set<string>());
  const deliveredAttempts = useRef(new Set<string>());
  const lastStatuses = useRef(new Map<string, string>());
  const page = pageForPath(window.location.pathname);
  const healthy = Boolean(health?.tools.ytDlp);
  const activeCount = downloads.jobs.filter((job) =>
    ACTIVE_STATUSES.has(job.status),
  ).length;
  const completedCount = downloads.jobs.filter((job) =>
    ["completed", "delivered"].includes(job.status),
  ).length;
  const failedCount = downloads.jobs.filter(
    (job) => job.status === "failed",
  ).length;
  const showComposer = ["universal", "clip"].includes(page);
  const missingTools = health && (!health.tools.ytDlp || !health.tools.ffmpeg);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "gsd-sidebar-collapsed",
        String(sidebarCollapsed),
      );
    } catch {
      // The sidebar remains usable for the current visit without storage.
    }
  }, [sidebarCollapsed]);

  async function queue(
    url: string,
    optionId: string,
    destination: SaveDestination | null,
    settings: ThumbnailSettings,
    clipRange?: ClipRange,
  ) {
    const job = await downloads.create(
      url,
      optionId,
      destination?.token,
      settings,
      clipRange,
    );
    ownedJobs.current.add(job.id);
    if (destination?.handle) handles.current.set(job.id, destination.handle);
    setAnnouncement(`${job.title} added to the download queue.`);
    return job;
  }

  async function queueInstagram(
    url: string,
    items: InstagramSelection[],
    destination: SaveDestination | null,
  ): Promise<InstagramQueueResult> {
    const result = await downloads.createInstagram(
      url,
      items,
      destination?.token,
    );
    for (const job of result.jobs) {
      ownedJobs.current.add(job.id);
      if (destination?.handle)
        handles.current.set(job.id, destination.handle);
    }
    if (result.jobs.length)
      setAnnouncement(
        `${result.jobs.length} Instagram item${result.jobs.length === 1 ? "" : "s"} added to the download queue.`,
      );
    return result;
  }

  async function save(job: DownloadJob) {
    const handle = handles.current.get(job.id);
    if (handle) {
      setDeliveries((previous) => ({
        ...previous,
        [job.id]: { status: "saving" },
      }));
      try {
        await saveToHandle(job.id, handle);
        handles.current.delete(job.id);
        setDeliveries((previous) => ({
          ...previous,
          [job.id]: { status: "saved" },
        }));
        setAnnouncement(`${job.title} saved to your device.`);
      } catch (reason) {
        setDeliveries((previous) => ({
          ...previous,
          [job.id]: {
            status: "error",
            error: `Saving failed: ${errorMessage(reason)} Use Save file to try again.`,
          },
        }));
      }
    } else {
      downloadInBrowser(job);
      setDeliveries((previous) => ({
        ...previous,
        [job.id]: { status: "sent" },
      }));
      setAnnouncement(`${job.title} is ready. Check your browser downloads.`);
    }
  }

  useEffect(() => {
    for (const job of downloads.jobs) {
      const last = lastStatuses.current.get(job.id);
      if (
        last &&
        last !== job.status &&
        ["failed", "cancelled", "completed", "delivered"].includes(job.status)
      ) {
        setAnnouncement(
          `${job.title}: ${job.status === "failed" ? `download failed. ${job.error || ""}` : job.status === "cancelled" ? "download cancelled." : `download complete. ${(job.warnings || []).join(" ")}`}`,
        );
      }
      lastStatuses.current.set(job.id, job.status);
      const deliveryKey = `${job.id}:${job.attempt}`;
      if (
        !isDesktop &&
        job.status === "completed" &&
        ownedJobs.current.has(job.id) &&
        !deliveredAttempts.current.has(deliveryKey)
      ) {
        deliveredAttempts.current.add(deliveryKey);
        void save(job);
      }
    }
  });

  async function retry(id: string) {
    setDeliveries((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    ownedJobs.current.add(id);
    await downloads.retry(id);
  }

  const queueProps = {
    jobs: downloads.jobs,
    loading: downloads.loading,
    error: downloads.error,
    reconnecting: downloads.reconnecting,
    deliveries,
    onRefresh: downloads.refresh,
    onCancel: downloads.cancel,
    onRetry: retry,
    onSave: save,
    onSaveThumbnail: downloadThumbnailInBrowser,
  };
  const connectionLabel = healthy
    ? isDesktop
      ? "Desktop ready"
      : "Service ready"
    : healthError
      ? "Service unavailable"
      : "Connecting";

  return (
    <div
      className={`workspace-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <aside className="workspace-sidebar">
        <a className="workspace-brand" href="/" aria-label="GSD home">
          <span className="workspace-brand-mark">
            <Icon name="download" size={20} />
          </span>
          <span className="workspace-brand-copy">
            <strong>GSD</strong>
            <small>MEDIA WORKSPACE</small>
          </span>
        </a>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigationSections.map((section) => (
            <div className="sidebar-nav-section" key={section.label}>
              <p className="sidebar-section-label">{section.label}</p>
              {section.items.map((item) =>
                item.href ? (
                  <a
                    className={`sidebar-link ${page === item.page ? "active" : ""}`}
                    href={item.href}
                    aria-current={page === item.page ? "page" : undefined}
                    aria-label={item.label}
                    title={item.label}
                    key={item.label}
                  >
                    <Icon name={item.icon} size={19} />
                    <span>{item.label}</span>
                  </a>
                ) : (
                  <button
                    className="sidebar-link sidebar-link-disabled"
                    type="button"
                    disabled
                    aria-disabled="true"
                    aria-label={item.label}
                    title={`${item.label} is not available in this version`}
                    key={item.label}
                  >
                    <Icon name={item.icon} size={19} />
                    <span>{item.label}</span>
                    <small>Unavailable</small>
                  </button>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            type="button"
            className="sidebar-collapse"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon
              name={sidebarCollapsed ? "expand" : "collapse"}
              size={17}
            />
            <span>{sidebarCollapsed ? "Expand" : "Collapse sidebar"}</span>
          </button>
        </div>
      </aside>
      <div className="workspace-main-column">
        <header className="workspace-topbar">
          <div className="workspace-page-heading">
            <span className="eyebrow">GSD / WORKSPACE</span>
            <h1>{pageTitles[page]}</h1>
          </div>
          <div className="workspace-topbar-actions">
            <span
              className={`connection-status ${healthy ? "" : "connection-waiting"}`}
            >
              <span className="status-dot" />
              {connectionLabel}
            </span>
            <details className="topbar-help">
              <summary aria-label="How GSD works">
                <Icon name="help" size={18} />
                <span>Help</span>
              </summary>
              <div className="guide-popover">
                <strong>Get. Save. Done.</strong>
                <ol>
                  <li>Paste a supported link and check the available formats.</li>
                  <li>Choose quality and a destination, then add it to the queue.</li>
                  <li>Track progress and manage completed downloads below.</li>
                </ol>
                <p>
                  GSD uses yt-dlp and FFmpeg. Quality choices come from each
                  source; unsupported features are clearly marked.
                </p>
              </div>
            </details>
          </div>
        </header>
        <main className="workspace-main" id="main-content">
          {healthError && (
            <div className="service-banner" role="alert">
              <div>
                <strong>The download service is unavailable.</strong>
                <p>{healthError}</p>
              </div>
              <button
                className="small-button"
                type="button"
                onClick={() => {
                  void check();
                  void downloads.refresh();
                }}
              >
                Reconnect <Icon name="retry" size={14} />
              </button>
            </div>
          )}
          {missingTools && (
            <div className="service-banner" role="alert">
              <div>
                <strong>
                  {!health.tools.ytDlp
                    ? "The media downloader is missing."
                    : "FFmpeg is missing."}
                </strong>
                <p>
                  {!health.tools.ytDlp
                    ? "GSD needs yt-dlp to inspect links and download media. Reinstall the desktop app, or follow the README’s media tool setup for development."
                    : "Direct source formats remain available. Clip trimming, conversion, audio/video merging and thumbnail embedding need FFmpeg."}
                </p>
              </div>
              <button
                className="small-button"
                type="button"
                onClick={() => void check()}
              >
                Check again <Icon name="retry" size={14} />
              </button>
            </div>
          )}
          {page === "home" && (
            <div className="dashboard-page">
              <section className="dashboard-welcome">
                <span className="eyebrow">YOUR MEDIA, IN ONE PLACE</span>
                <h2>A calmer way to collect and manage media.</h2>
                <p>
                  Choose a workflow to get started. Downloads and their live
                  progress stay together in your workspace.
                </p>
              </section>
              <section className="dashboard-stats" aria-label="Download overview">
                <StatCard label="In progress" value={activeCount} icon="processing" />
                <StatCard label="Completed" value={completedCount} icon="check" />
                <StatCard label="Needs attention" value={failedCount} icon="retry" />
                <StatCard label="All downloads" value={downloads.jobs.length} icon="download" />
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
              <QueuePanel
                {...queueProps}
                title="Recent downloads"
                initialFilter="all"
              />
            </div>
          )}
          {(page === "universal" || page === "clip") && (
            <div className="workspace-grid">
              <DownloadComposer
                key={page}
                mode={page === "clip" ? "clip" : "full"}
                pageTitle={page === "clip" ? "Create a clip" : "Download media"}
                ffmpegAvailable={health ? health.tools.ffmpeg : null}
                unavailable={Boolean(
                  healthError || (health && !health.tools.ytDlp),
                )}
                onReadyChange={setFormReady}
                onQueue={queue}
              />
              <QueuePanel
                {...queueProps}
                title={page === "clip" ? "Clip & media queue" : "Download queue"}
              />
            </div>
          )}
          {page === "instagram" && (
            <div className="instagram-workspace-grid">
              <InstagramDownloader
                unavailable={Boolean(
                  healthError || (health && !health.tools.ytDlp),
                )}
                onQueue={queueInstagram}
              />
              <QueuePanel
                {...queueProps}
                title="Instagram & media queue"
              />
            </div>
          )}
          {page === "processing" && (
            <section className="queue-page">
              <div className="page-intro">
                <span className="eyebrow">LIVE QUEUE</span>
                <p>Active downloads and their real-time progress.</p>
              </div>
              <QueuePanel
                {...queueProps}
                title="Active downloads"
                initialFilter="active"
              />
            </section>
          )}
          {page === "library" && (
            <section className="queue-page">
              <div className="page-intro">
                <span className="eyebrow">YOUR DOWNLOAD HISTORY</span>
                <p>Completed files remain available here for delivery or retry.</p>
              </div>
              <QueuePanel
                {...queueProps}
                title="Completed downloads"
                initialFilter="done"
              />
            </section>
          )}
          {page === "settings" && (
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
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void check()}
                  >
                    Refresh <Icon name="retry" size={14} />
                  </button>
                </div>
                <ToolStatus label="yt-dlp" available={health?.tools.ytDlp} />
                <ToolStatus label="FFmpeg" available={health?.tools.ffmpeg} />
                {healthError && <p className="inline-error" role="alert">{healthError}</p>}
              </section>
              <p className="settings-footnote">
                Downloads are processed by GSD’s local service. Unavailable
                modules are not simulated.
              </p>
            </section>
          )}
          {showComposer && (
            <div className="workspace-action-dock">
              <div className="action-queue-count">
                <span className={`status-dot ${activeCount ? "working" : ""}`} />
                <span>
                  <strong>{activeCount}</strong>
                  {activeCount === 1 ? " active download" : " active downloads"}
                </span>
              </div>
              <button
                className="primary-button action-start-button"
                type="submit"
                form={page === "clip" ? "clip-download-form" : "download-form"}
                disabled={!formReady}
              >
                <Icon name={page === "clip" ? "scissors" : "download"} size={18} />
                <span>{page === "clip" ? "Download clip" : "Start download"}</span>
              </button>
            </div>
          )}
        </main>
        <footer className="workspace-footer">
          <span>GSD <i>/</i> Get. Save. Done.</span>
        </footer>
      </div>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
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
