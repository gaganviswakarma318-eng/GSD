import { useEffect, useRef, useState } from "react";
import {
  downloadInBrowser,
  downloadThumbnailInBrowser,
  saveToHandle,
} from "../features/download-queue/downloadService";
import { ClipDownloader } from "../features/clip-downloader/ClipDownloader";
import { UniversalDownloader } from "../features/universal-downloader/UniversalDownloader";
import type { DeliveryState } from "../features/download-queue/DownloadCard";
import { QueuePage } from "../features/download-queue/QueuePage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { Icon } from "../shared/components/Icon";
import { InstagramDownloader } from "../features/instagram-downloader/InstagramDownloader";
import { QueuePanel } from "../features/download-queue/QueuePanel";
import { ACTIVE_STATUSES, isDesktop } from "../shared/config";
import { useDownloads } from "../features/download-queue/useDownloads";
import { useHealth } from "./useHealth";
import {
  navigationSections,
  pageForPath,
  pageTitles,
} from "./navigation";
import type {
  ClipRange,
  DownloadJob,
  InstagramQueueResult,
  InstagramSelection,
  SaveDestination,
  SaveFileHandle,
  ThumbnailSettings,
} from "../shared/types";
import { errorMessage } from "../shared/utils";

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
            <DashboardPage
              activeCount={activeCount}
              completedCount={completedCount}
              failedCount={failedCount}
              totalCount={downloads.jobs.length}
              queueProps={queueProps}
            />
          )}
          {(page === "universal" || page === "clip") && (
            <div className="workspace-grid">
              {page === "clip" ? (
                <ClipDownloader
                  key="clip"
                  ffmpegAvailable={health ? health.tools.ffmpeg : null}
                  unavailable={Boolean(healthError || (health && !health.tools.ytDlp))}
                  onReadyChange={setFormReady}
                  onQueue={queue}
                />
              ) : (
                <UniversalDownloader
                  key="universal"
                  ffmpegAvailable={health ? health.tools.ffmpeg : null}
                  unavailable={Boolean(healthError || (health && !health.tools.ytDlp))}
                  onReadyChange={setFormReady}
                  onQueue={queue}
                />
              )}
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
            <QueuePage
              eyebrow="LIVE QUEUE"
              description="Active downloads and their real-time progress."
              title="Active downloads"
              initialFilter="active"
              queueProps={queueProps}
            />
          )}
          {page === "library" && (
            <QueuePage
              eyebrow="YOUR DOWNLOAD HISTORY"
              description="Completed files remain available here for delivery or retry."
              title="Completed downloads"
              initialFilter="done"
              queueProps={queueProps}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              health={health}
              healthError={healthError}
              onCheck={() => void check()}
            />
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
