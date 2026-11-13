import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { MediaInfo, VideoPreview } from "../types";
import { errorMessage, formatTimecode } from "../utils";
import { Icon } from "./Icon";

interface Props {
  info: MediaInfo;
  startSeconds: number | null;
  endSeconds: number | null;
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function ClipVideoPlayer({ info, startSeconds, endSeconds }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const previewEnd = useRef<number | null>(null);
  const [preview, setPreview] = useState<VideoPreview | null>(null);
  const [error, setError] = useState("");
  const [playerError, setPlayerError] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let previewId: string | null = null;
    setPreview(null);
    setError("");
    setPlayerError("");
    setDuration(0);
    setCurrentTime(0);
    previewEnd.current = null;

    async function prepare() {
      try {
        let current = await api.createPreview(info.url);
        previewId = current.id;
        if (!active) {
          await api.removePreview(current.id);
          return;
        }
        setPreview(current);
        while (active && current.status === "preparing") {
          await delay(1000);
          current = await api.preview(current.id);
          if (active) setPreview(current);
        }
        if (active && current.status === "failed")
          setError(current.error || "The video preview could not be prepared.");
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      }
    }

    void prepare();
    return () => {
      active = false;
      if (previewId)
        void api
          .removePreview(previewId)
          .catch((reason) =>
            console.error("GSD preview cleanup:", errorMessage(reason)),
          );
    };
  }, [info.url, retry]);

  useEffect(() => {
    if (preview?.status !== "ready") return;
    let active = true;
    const timer = setInterval(() => {
      void api
        .preview(preview.id)
        .then((current) => {
          if (active) setPreview(current);
        })
        .catch((reason) => {
          if (active) setPlayerError(errorMessage(reason));
        });
    }, 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [preview?.id, preview?.status]);

  const timelineDuration = duration || info.duration || 0;
  const start = startSeconds ?? 0;
  const end = endSeconds ?? timelineDuration;
  const startPercent = timelineDuration
    ? Math.max(0, Math.min(100, (start / timelineDuration) * 100))
    : 0;
  const endPercent = timelineDuration
    ? Math.max(startPercent, Math.min(100, (end / timelineDuration) * 100))
    : 100;
  const canPreviewClip =
    duration > 0 &&
    startSeconds !== null &&
    endSeconds !== null &&
    startSeconds < endSeconds &&
    endSeconds <= timelineDuration;

  function seek(value: number) {
    const player = video.current;
    if (!player) return;
    player.currentTime = value;
    setCurrentTime(value);
  }

  async function playClip() {
    const player = video.current;
    if (!player || startSeconds === null || endSeconds === null) return;
    previewEnd.current = endSeconds;
    seek(startSeconds);
    try {
      await player.play();
    } catch (reason) {
      previewEnd.current = null;
      setPlayerError(errorMessage(reason));
    }
  }

  function updateTime() {
    const player = video.current;
    if (!player) return;
    setCurrentTime(player.currentTime);
    if (previewEnd.current !== null && player.currentTime >= previewEnd.current) {
      previewEnd.current = null;
      player.pause();
      seek(Math.min(end, player.duration || end));
    }
  }

  return (
    <section className="clip-player panel" aria-labelledby="clip-player-title">
      <div className="clip-player-heading">
        <div>
          <span className="eyebrow source-label">VIDEO PREVIEW</span>
          <h3 id="clip-player-title">Watch and set your cut</h3>
        </div>
        {preview?.status === "ready" && (
          <button
            className="small-button"
            type="button"
            disabled={!canPreviewClip}
            onClick={() => void playClip()}
          >
            <Icon name="video" size={14} />
            Preview clip
          </button>
        )}
      </div>
      {preview?.status === "ready" ? (
        <>
          <div className="clip-video-frame">
            <video
              ref={video}
              controls
              playsInline
              preload="metadata"
              poster={info.thumbnail || undefined}
              src={api.previewFileUrl(preview.id)}
              onLoadedMetadata={(event) => {
                setDuration(event.currentTarget.duration || 0);
                setPlayerError("");
              }}
              onTimeUpdate={updateTime}
              onError={() =>
                setPlayerError(
                  "This preview format cannot be played in your browser. You can still download the selected clip.",
                )
              }
            />
          </div>
          <div className="clip-timeline">
            <label className="sr-only" htmlFor="clip-playhead">
              Video timeline
            </label>
            <input
              id="clip-playhead"
              type="range"
              min="0"
              max={timelineDuration || 1}
              step="0.1"
              value={Math.min(currentTime, timelineDuration || 1)}
              disabled={!duration}
              style={{
                background: `linear-gradient(to right, #dce5d0 0%, #dce5d0 ${startPercent}%, #b7d85f ${startPercent}%, #b7d85f ${endPercent}%, #dce5d0 ${endPercent}%, #dce5d0 100%)`,
              }}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <div className="clip-timeline-labels">
              <span>{formatTimecode(currentTime)}</span>
              <span>
                {formatTimecode(start)} – {formatTimecode(end)}
              </span>
              <span>{formatTimecode(timelineDuration)}</span>
            </div>
          </div>
          {playerError && (
            <p className="inline-error clip-player-error" role="alert">
              {playerError}
            </p>
          )}
        </>
      ) : (
        <div className="clip-preview-status" aria-live="polite">
          {error ? (
            <>
              <p className="inline-error" role="alert">
                {error}
              </p>
              <button
                className="small-button"
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                <Icon name="retry" size={14} />
                Prepare preview again
              </button>
            </>
          ) : (
            <>
              <span className="spinner" />
              <div>
                <strong>
                  {preview?.status === "preparing"
                    ? `Preparing video timeline… ${Math.floor(preview.progress)}%`
                    : "Preparing video timeline…"}
                </strong>
                <p>
                  GSD creates a temporary preview (up to 480p when available)
                  so you can seek through the video. This uses additional data.
                </p>
                {preview?.status === "preparing" && (
                  <div
                    className="preview-progress"
                    role="progressbar"
                    aria-label="Preparing video preview"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.floor(preview.progress)}
                  >
                    <span style={{ width: `${preview.progress}%` }} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
