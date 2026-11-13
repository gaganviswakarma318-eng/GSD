import { useEffect, useRef, useState } from "react";
import { downloadInBrowser, downloadThumbnailInBrowser, saveToHandle } from "./api/client";
import { DownloadComposer } from "./components/DownloadComposer";
import type { DeliveryState } from "./components/DownloadCard";
import { Icon } from "./components/Icon";
import { QueuePanel } from "./components/QueuePanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { isDesktop } from "./config";
import { useDownloads } from "./hooks/useDownloads";
import { useHealth } from "./hooks/useHealth";
import type { ClipRange, DownloadJob, SaveDestination, SaveFileHandle, ThumbnailSettings } from "./types";
import { errorMessage } from "./utils";

export default function App() {
  const downloads = useDownloads();
  const { health, error: healthError, check } = useHealth();
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryState>>(
    {},
  );
  const [announcement, setAnnouncement] = useState("");
  const [mobileDownloader, setMobileDownloader] = useState<"full" | "clip">(
    "full",
  );
  const handles = useRef(new Map<string, SaveFileHandle>());
  const ownedJobs = useRef(new Set<string>());
  const deliveredAttempts = useRef(new Set<string>());
  const lastStatuses = useRef(new Map<string, string>());
  const healthy = Boolean(health?.tools.ytDlp);

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
  const missingTools = health && (!health.tools.ytDlp || !health.tools.ffmpeg);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to downloads
      </a>
      <header className="app-header">
        <a className="brand" href="/" aria-label="GSD home">
          <span className="brand-mark">
            <Icon name="download" size={25} />
          </span>
          <span className="brand-word">
            GSD<span className="brand-caption">GET. SAVE. DONE.</span>
          </span>
        </a>
        <div className="header-actions">
          <ThemeToggle />
          <span
            className={`connection-status ${healthy ? "" : "connection-waiting"}`}
          >
            <span className="status-dot" />
            {healthy
              ? isDesktop
                ? "Desktop is ready"
                : "Service is ready"
              : healthError
                ? "Service unavailable"
                : "Connecting…"}
          </span>
          <details className="help-menu">
            <summary aria-label="Help with GSD">
              <Icon name="help" size={21} />
              <span>How it works</span>
            </summary>
            <div className="help-popover">
              <h2>Get. Save. Done.</h2>
              <ol>
                <li>Choose Full Video or Clip, then paste a supported media link.</li>
                <li>Preview it, choose a format and quality; for a clip, set its start and end.</li>
                <li>Choose a save location and download.</li>
              </ol>
              <p>
                Quality choices come from the source. Some sites require sign-in
                or restrict automated access; GSD explains when a link cannot be
                downloaded.
              </p>
              <p>
                {isDesktop
                  ? "You can keep adding downloads while GSD works. Close the app to stop active downloads."
                  : "Keep this tab open to save files automatically. Your downloads continue on the service if you refresh."}
              </p>
            </div>
          </details>
        </div>
      </header>
      <main id="main-content">
        <section className="intro">
          <div>
            <span className="eyebrow intro-eyebrow">
              <span className="small-rule" />
              LESS FRICTION. MORE PLAY.
            </span>
            <h1>
              Your media.
              <br />
              Ready to{" "}
              <span className="title-accent">
                go.
                <svg viewBox="0 0 92 12" aria-hidden="true">
                  <path d="M2 9C22 2 67 2 90 6" />
                </svg>
              </span>
            </h1>
            <p>
              From a link to your library.
              <br className="mobile-break" /> Music and videos, made simple.
            </p>
          </div>
          <div className="intro-stamp" aria-hidden="true">
            <span>PASTE IT.</span>
            <Icon name="arrow" size={25} />
            <span>KEEP IT.</span>
          </div>
        </section>
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
                  : "GSD can use direct source formats. Clip trimming, conversion, audio/video merging and thumbnail embedding are unavailable until FFmpeg is installed. See the README for setup."}
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
        <div className="workspace-grid">
          <div className="downloaders-area">
            <div
              className="downloader-tabs"
              role="tablist"
              aria-label="Download type"
            >
              <button
                id="full-video-tab"
                type="button"
                role="tab"
                aria-selected={mobileDownloader === "full"}
                aria-controls="full-video-panel"
                tabIndex={mobileDownloader === "full" ? 0 : -1}
                onClick={() => setMobileDownloader("full")}
              >
                Full Video
              </button>
              <button
                id="clip-tab"
                type="button"
                role="tab"
                aria-selected={mobileDownloader === "clip"}
                aria-controls="clip-panel"
                tabIndex={mobileDownloader === "clip" ? 0 : -1}
                onClick={() => setMobileDownloader("clip")}
              >
                Clip
              </button>
            </div>
            <div className="downloaders-grid">
              <div
                id="full-video-panel"
                className={`download-section ${mobileDownloader === "full" ? "mobile-active" : ""}`}
                role="tabpanel"
                aria-labelledby="full-video-tab"
              >
                <DownloadComposer
                  ffmpegAvailable={health ? health.tools.ffmpeg : null}
                  unavailable={Boolean(
                    healthError || (health && !health.tools.ytDlp),
                  )}
                  onQueue={queue}
                />
              </div>
              <div
                id="clip-panel"
                className={`download-section ${mobileDownloader === "clip" ? "mobile-active" : ""}`}
                role="tabpanel"
                aria-labelledby="clip-tab"
              >
                <DownloadComposer
                  mode="clip"
                  ffmpegAvailable={health ? health.tools.ffmpeg : null}
                  unavailable={Boolean(
                    healthError || (health && !health.tools.ytDlp),
                  )}
                  onQueue={queue}
                />
              </div>
            </div>
          </div>
          <QueuePanel
            jobs={downloads.jobs}
            loading={downloads.loading}
            error={downloads.error}
            reconnecting={downloads.reconnecting}
            deliveries={deliveries}
            onRefresh={downloads.refresh}
            onCancel={downloads.cancel}
            onRetry={retry}
            onSave={save}
            onSaveThumbnail={downloadThumbnailInBrowser}
          />
        </div>
        <div className="workflow-note">
          <span>
            <Icon name="link" size={15} />
            Paste a link
          </span>
          <i />
          <span>
            <Icon name="audio" size={15} />
            Make it your format
          </span>
          <i />
          <span>
            <Icon name="download" size={15} />
            Take it with you
          </span>
        </div>
      </main>
      <footer className="app-footer">
        <span>
          GSD <span className="footer-separator">/</span> Get. Save. Done.
        </span>
        <span>Made for a little less friction.</span>
      </footer>
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
