import { useState } from "react";
import { ACTIVE_STATUSES, isDesktop } from "../config";
import type { DownloadJob } from "../types";
import { errorMessage, formatBytes, formatDuration, formatEta } from "../utils";
import { Icon } from "./Icon";

export interface DeliveryState {
  status: "saving" | "saved" | "sent" | "error";
  error?: string;
}
interface Props {
  job: DownloadJob;
  delivery?: DeliveryState;
  onCancel(id: string): Promise<void>;
  onRetry(id: string): Promise<void>;
  onSave(job: DownloadJob): Promise<void>;
  onSaveThumbnail(job: DownloadJob): void;
}
const PROCESSING_STAGES: Record<string, string> = {
  merging: "Merging audio and video",
  converting_audio: "Converting audio",
  trimming: "Cutting clip",
  processing_thumbnail: "Processing thumbnail",
  embedding_thumbnail: "Embedding thumbnail",
  finalizing: "Finalizing file",
};
export function DownloadCard({
  job,
  delivery,
  onCancel,
  onRetry,
  onSave,
  onSaveThumbnail,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const active = ACTIVE_STATUSES.has(job.status);
  const complete = ["completed", "delivered"].includes(job.status);
  const indeterminate =
    job.status === "downloading" &&
    !(
      job.totalBytes != null &&
      Number.isFinite(job.totalBytes) &&
      job.totalBytes > 0
    );
  const progress = Math.max(
    0,
    Math.min(100, Number.isFinite(job.progress) ? job.progress : 0),
  );
  const processingStage = PROCESSING_STAGES[job.stage || ""];
  const status =
    job.status === "queued"
      ? `Queued${job.queuePosition ? ` · ${job.queuePosition} in line` : ""}`
      : job.status === "processing"
        ? processingStage || "Finishing your file"
        : job.status === "downloading"
          ? job.clipRange
            ? "Downloading clip"
            : "Downloading media"
          : job.status === "failed"
            ? "Download failed"
            : job.status === "cancelled"
              ? "Cancelled"
              : job.savedPath || delivery?.status === "saved"
                ? "Saved to your device"
                : delivery?.status === "saving"
                  ? "Saving your file…"
                  : delivery?.status === "sent"
                    ? "Sent to your browser"
                    : job.status === "delivered"
                      ? "File delivered"
                      : "Ready to save";
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className={`download-card status-${job.status}`}
      aria-label={`${job.title}, ${status}`}
    >
      <div className="job-top">
        <div className="job-thumbnail">
          {job.thumbnail && !imageFailed ? (
            <img
              src={job.thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Icon name={job.type} size={23} />
          )}
        </div>
        <div className="job-info">
          <h3 title={job.title}>{job.title}</h3>
          <div className="job-tags">
            <span>{job.format.toUpperCase()}</span>
            <span>{job.quality}</span>
            <span>{job.type === "audio" ? "Audio" : "Video"}</span>
          </div>
        </div>
        {active && (
          <button
            type="button"
            className="icon-button cancel-button"
            title="Cancel download"
            aria-label={`Cancel ${job.title}`}
            disabled={busy}
            onClick={() => void action(() => onCancel(job.id))}
          >
            <Icon name="close" size={17} />
          </button>
        )}
        {complete && (
          <span className="completed-check">
            <Icon name="check" size={16} />
          </span>
        )}
      </div>
      {job.clipRange && (
        <p className="job-detail clip-job-range">
          Clip: {formatDuration(job.clipRange.startSeconds)}–
          {formatDuration(job.clipRange.endSeconds)}
        </p>
      )}
      <div className="job-status-row">
        <span className={`job-status ${complete ? "success-text" : ""}`}>
          {job.status === "queued" && <Icon name="clock" size={13} />}
          {job.status === "processing" && <span className="spinner tiny" />}
          {status}
        </span>
        {job.status === "downloading" && !indeterminate && (
          <span className="progress-percent">{progress.toFixed(0)}%</span>
        )}
      </div>
      {active && (
        <div
          className={`progress-track ${job.status === "processing" ? "processing-track" : indeterminate ? "indeterminate-track" : ""}`}
          role="progressbar"
          aria-label={`Download progress for ${job.title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(job.status === "processing"
            ? { "aria-valuetext": processingStage || "Processing downloaded media" }
            : indeterminate
              ? { "aria-valuetext": "Downloading; total size unknown" }
              : { "aria-valuenow": Math.round(progress) })}
        >
          <div
            style={{
              width: "100%",
              transform:
                job.status === "downloading" && !indeterminate
                  ? `scaleX(${progress / 100})`
                  : undefined,
            }}
          />
        </div>
      )}
      {job.status === "downloading" && (
        <div className="job-stats">
          <span>
            {formatBytes(job.downloadedBytes)}
            {job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""}
          </span>
          <span>
            {job.speedBytes ? `${formatBytes(job.speedBytes)}/s` : "—"}
          </span>
          <span>{formatEta(job.etaSeconds)}</span>
        </div>
      )}
      {job.status === "processing" && (
        <p className="job-detail">
          {processingStage
            ? "Your file will be ready after processing finishes."
            : `Preparing ${job.format.toUpperCase()}…`}
        </p>
      )}
      {job.status === "queued" && (
        <p className="job-detail">
          Your download will begin when a slot is available.
        </p>
      )}
      {job.error && <p className="job-error">{job.error}</p>}
      {(job.warnings || []).map((warning, index) => (
        <p className="job-warning" role="status" key={`${index}:${warning}`}>
          {warning}
        </p>
      ))}
      {complete && job.thumbnailEmbedded && (
        <p className="job-detail">Cover artwork embedded.</p>
      )}
      {complete && job.savedPath && (
        <p className="saved-path" title={job.savedPath}>
          {job.savedPath}
        </p>
      )}
      {complete && job.sidecarSavedPath && (
        <p className="saved-path" title={job.sidecarSavedPath}>
          Thumbnail: {job.sidecarSavedPath}
        </p>
      )}
      {(complete || job.status === "failed" || job.status === "cancelled") && (
        <div className="job-actions">
          {(job.status === "failed" || job.status === "cancelled") && (
            <button
              className="small-button"
              type="button"
              disabled={busy}
              onClick={() => void action(() => onRetry(job.id))}
            >
              <Icon name="retry" size={14} />
              {busy ? "Retrying…" : "Try again"}
            </button>
          )}
          {complete &&
            (isDesktop && job.savedPath ? (
              <button
                className="small-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(() => window.gsd!.revealFile(job.id))
                }
              >
                <Icon name="folder" size={14} />
                Show in folder
              </button>
            ) : job.status !== "delivered" || delivery?.status === "error" ? (
              <button
                className="small-button"
                type="button"
                disabled={busy || delivery?.status === "saving"}
                onClick={() => void action(() => onSave(job))}
              >
                <Icon name="download" size={14} />
                {delivery?.status === "saving" ? "Saving…" : "Save file"}
              </button>
            ) : null)}
          {complete && job.sidecarFilename && !job.sidecarSavedPath && !job.sidecarDelivered && (
            <button
              className="small-button"
              type="button"
              disabled={busy}
              onClick={() => void action(async () => onSaveThumbnail(job))}
            >
              <Icon name="download" size={14} />
              Save thumbnail
            </button>
          )}
          {job.downloadedBytes > 0 && complete && (
            <span className="finished-size">
              {formatBytes(job.totalBytes || job.downloadedBytes)}
            </span>
          )}
          {job.attempt > 1 && (
            <span className="attempt-label">Attempt {job.attempt}</span>
          )}
        </div>
      )}
      {(error || delivery?.error) && (
        <p className="job-error" role="alert">
          {error || delivery?.error}
        </p>
      )}
    </article>
  );
}
