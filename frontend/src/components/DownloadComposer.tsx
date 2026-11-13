import { useEffect, useRef, useState } from "react";
import { isDesktop } from "../config";
import { useMediaInfo } from "../hooks/useMediaInfo";
import type {
  ClipRange,
  DownloadJob,
  MediaType,
  SaveDestination,
  ThumbnailSettings,
} from "../types";
import {
  errorMessage,
  formatBytes,
  formatTimecode,
  parseTimecode,
  suggestedFilename,
  validMediaUrl,
} from "../utils";
import { Icon } from "./Icon";
import { ClipVideoPlayer } from "./ClipVideoPlayer";
import { MediaPreview } from "./MediaPreview";

interface Props {
  unavailable: boolean;
  ffmpegAvailable: boolean | null;
  mode?: "full" | "clip";
  onQueue(
    url: string,
    optionId: string,
    destination: SaveDestination | null,
    settings: ThumbnailSettings,
    clipRange?: ClipRange,
  ): Promise<DownloadJob>;
}
export function DownloadComposer({
  unavailable,
  ffmpegAvailable,
  mode = "full",
  onQueue,
}: Props) {
  const [url, setUrl] = useState("");
  const [type, setType] = useState<MediaType>("video");
  const [optionId, setOptionId] = useState("");
  const [destination, setDestination] = useState<SaveDestination | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [embedThumbnail, setEmbedThumbnail] = useState(true);
  const [thumbnailSidecar, setThumbnailSidecar] = useState(false);
  const [clipStart, setClipStart] = useState("00:00");
  const [clipEnd, setClipEnd] = useState("00:30");
  const input = useRef<HTMLInputElement>(null);
  const { info, loading, error, lookup, clear } = useMediaInfo();
  const clipMode = mode === "clip";
  const idPrefix = clipMode ? "clip-" : "";
  const options =
    info?.options.filter((item) => item.type === (clipMode ? "video" : type)) ||
    [];
  const selected = options.find((item) => item.id === optionId) || options[0];
  const formats = [...new Set(options.map((item) => item.format))];
  const qualities = options.filter((item) => item.format === selected?.format);
  const thumbnailSupported = Boolean(selected?.thumbnailSupport?.supported);
  const canEmbedThumbnail = thumbnailSupported && ffmpegAvailable === true;
  const clipStartSeconds = parseTimecode(clipStart);
  const clipEndSeconds = parseTimecode(clipEnd);
  const clipRangeError = !clipMode || !info
    ? ""
    : !Number.isFinite(info.duration) || !info.duration || info.duration < 1
      ? "This source does not report a usable duration, so a clip cannot be validated."
      : clipStartSeconds === null
        ? "Enter a start time as MM:SS or HH:MM:SS."
        : clipEndSeconds === null
          ? "Enter an end time as MM:SS or HH:MM:SS."
          : clipStartSeconds >= clipEndSeconds
            ? "The end time must be later than the start time."
            : clipEndSeconds > info.duration
              ? "The clip end must be within the video duration."
              : "";
  const clipRange =
    clipMode && !clipRangeError && clipStartSeconds !== null && clipEndSeconds !== null
      ? { startSeconds: clipStartSeconds, endSeconds: clipEndSeconds }
      : undefined;
  const clipSliderMax = Math.max(1, Math.floor(info?.duration || 1));

  useEffect(() => {
    if (!info) return;
    const first =
      info.options.find((item) => item.type === (clipMode ? "video" : type)) ||
      (!clipMode ? info.options[0] : undefined);
    if (first) {
      setType(first.type);
      setOptionId(first.id);
    }
    if (clipMode && info.duration && Number.isFinite(info.duration)) {
      setClipStart(formatTimecode(0));
      setClipEnd(formatTimecode(Math.max(1, Math.min(30, Math.floor(info.duration)))));
    }
    // Reset the selection when a new media source arrives, not while choosing its quality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, clipMode]);

  function changeOption(id: string) {
    setOptionId(id);
    setNotice("");
    setActionError("");
    if (!isDesktop) setDestination(null);
  }
  function changeUrl(value: string) {
    setUrl(value);
    clear();
    setActionError("");
    setNotice("");
    if (!isDesktop) setDestination(null);
  }
  async function paste() {
    try {
      const value = (await navigator.clipboard.readText()).trim();
      setUrl(value);
      setActionError("");
      setNotice("");
      if (!isDesktop) setDestination(null);
      await lookup(value);
    } catch {
      setActionError(
        "Clipboard access is unavailable. Paste into the link field using Ctrl+V.",
      );
      input.current?.focus();
    }
  }
  async function chooseLocation() {
    setChoosing(true);
    setActionError("");
    try {
      if (window.gsd) {
        const chosen = await window.gsd.chooseDirectory();
        if (chosen) setDestination(chosen);
      } else if (window.showSaveFilePicker && selected && info) {
        const mime =
          selected.type === "audio"
            ? selected.format === "mp3"
              ? "audio/mpeg"
              : `audio/${selected.format}`
            : `video/${selected.format}`;
        const handle = await window.showSaveFilePicker({
          suggestedName: suggestedFilename(info.title, selected.format),
          types: [
            {
              description: `${selected.format.toUpperCase()} ${selected.type}`,
              accept: { [mime]: [`.${selected.format}`] },
            },
          ],
        });
        setDestination({ label: handle.name, handle });
      }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError"))
        setActionError(errorMessage(reason));
    } finally {
      setChoosing(false);
    }
  }
  async function start() {
    if (!info || !selected || busy) return;
    if (clipMode && (!clipRange || ffmpegAvailable !== true)) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      let chosen = destination;
      if (window.gsd && !chosen) {
        const picked = await window.gsd.chooseDirectory();
        if (!picked) return;
        chosen = picked;
        setDestination(picked);
      }
      await onQueue(info.url, selected.id, chosen, {
        embedThumbnail: canEmbedThumbnail && embedThumbnail,
        thumbnailSidecar: !thumbnailSupported && thumbnailSidecar,
      }, clipRange);
      setNotice(
        "Added to your downloads. You can add another link while this one runs.",
      );
      if (!isDesktop) setDestination(null);
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  const canPick = isDesktop || Boolean(window.showSaveFilePicker);
  return (
    <section
      className={`composer panel ${clipMode ? "clip-composer" : ""}`}
      aria-labelledby={`${idPrefix}download-title`}
    >
      <div className="section-heading">
        <h2 id={`${idPrefix}download-title`}>
          {clipMode ? "Clip Downloader" : "Full Video Downloader"}
        </h2>
        <span className="step-hint">
          {clipMode ? "Choose a section to keep" : "Download the full media"}
        </span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setActionError("");
          setNotice("");
          void lookup(url);
        }}
      >
        <label className="field-label" htmlFor={`${idPrefix}media-url`}>
          Media link
        </label>
        <div className="link-field">
          <Icon name="link" size={20} />
          <input
            ref={input}
            id={`${idPrefix}media-url`}
            type="url"
            placeholder={
              clipMode ? "Paste a video link to clip" : "Paste a video or music link"
            }
            value={url}
            onChange={(event) => changeUrl(event.target.value)}
            onPaste={(event) => {
              const value = event.clipboardData.getData("text").trim();
              if (!validMediaUrl(value)) return;
              event.preventDefault();
              changeUrl(value);
              void lookup(value);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${idPrefix}link-hint`}
            aria-invalid={Boolean(error)}
            required
          />
          {url.trim() ? (
            <button
              className="paste-button"
              type="button"
              onClick={() => changeUrl("")}
              title="Clear media link"
              aria-label="Clear media link"
            >
              <Icon name="close" size={16} />
              <span>Clear</span>
            </button>
          ) : (
            <button
              className="paste-button"
              type="button"
              onClick={() => void paste()}
              title="Paste link from clipboard"
            >
              <Icon name="paste" size={16} />
              <span>Paste</span>
            </button>
          )}
        </div>
        <div className="link-under">
          <p id={`${idPrefix}link-hint`}>Public media links supported by yt-dlp.</p>
          <button
            className="text-button find-button"
            type="submit"
            disabled={!url.trim() || loading || unavailable}
          >
            {loading ? "Finding media…" : "Find media"}
            {loading ? (
              <span className="spinner" />
            ) : (
              <Icon name="arrow" size={16} />
            )}
          </button>
        </div>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <MediaPreview info={info} loading={loading} />
      {clipMode && info && (
        <ClipVideoPlayer
          info={info}
          startSeconds={clipStartSeconds}
          endSeconds={clipEndSeconds}
        />
      )}
      {clipMode && (
        <div className="clip-controls" aria-labelledby="clip-range-title">
          <div className="clip-range-heading">
            <h3 id="clip-range-title">Clip range</h3>
            <span>
              {info?.duration != null
                ? `Video length ${formatTimecode(Math.floor(info.duration))}`
                : "Find a video to choose a range"}
            </span>
          </div>
          {info && info.duration != null && (
            <div className="clip-time-fields">
              <div>
                <label className="field-label" htmlFor="clip-start-time">
                  Start time
                </label>
                <input
                  id="clip-start-time"
                  className="clip-time-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="MM:SS"
                  value={clipStart}
                  aria-invalid={Boolean(clipRangeError)}
                  aria-describedby="clip-range-help"
                  onChange={(event) => {
                    setClipStart(event.target.value);
                    setActionError("");
                  }}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="clip-end-time">
                  End time
                </label>
                <input
                  id="clip-end-time"
                  className="clip-time-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="MM:SS"
                  value={clipEnd}
                  aria-invalid={Boolean(clipRangeError)}
                  aria-describedby="clip-range-help"
                  onChange={(event) => {
                    setClipEnd(event.target.value);
                    setActionError("");
                  }}
                />
              </div>
            </div>
          )}
          {info && info.duration != null && (
            <div className="clip-slider-fields">
              <label>
                <span>Start point · {formatTimecode(clipStartSeconds ?? 0)}</span>
                <input
                  type="range"
                  min="0"
                  max={clipSliderMax}
                  step="1"
                  value={Math.min(clipSliderMax, clipStartSeconds ?? 0)}
                  aria-label="Clip start point"
                  onChange={(event) =>
                    setClipStart(formatTimecode(Number(event.target.value)))
                  }
                />
              </label>
              <label>
                <span>
                  End point · {formatTimecode(clipEndSeconds ?? clipSliderMax)}
                </span>
                <input
                  type="range"
                  min="0"
                  max={clipSliderMax}
                  step="1"
                  value={Math.min(
                    clipSliderMax,
                    clipEndSeconds ?? clipSliderMax,
                  )}
                  aria-label="Clip end point"
                  onChange={(event) =>
                    setClipEnd(formatTimecode(Number(event.target.value)))
                  }
                />
              </label>
            </div>
          )}
          <p
            className={
              clipRangeError ? "inline-error clip-range-error" : "format-note"
            }
            id="clip-range-help"
            role={clipRangeError ? "alert" : undefined}
          >
            {clipRangeError ||
              "Use MM:SS or HH:MM:SS. Cut points are selected to the nearest second."}
          </p>
          {ffmpegAvailable === false && (
            <p className="inline-error clip-range-error" role="alert">
              Clip downloads require FFmpeg. Install FFmpeg or configure
              GSD_FFMPEG_PATH.
            </p>
          )}
        </div>
      )}
      <div className={`download-options ${!info ? "options-unready" : ""}`}>
        {!clipMode && (
          <fieldset className="type-fieldset" disabled={!info || loading}>
            <legend className="field-label">Download as</legend>
            <div className="type-switch">
              {(["video", "audio"] as const).map((value) => (
                <label
                  className={`type-choice ${type === value ? "selected" : ""}`}
                  key={value}
                >
                  <input
                    type="radio"
                    name={`${idPrefix}media-type`}
                    value={value}
                    checked={type === value}
                    disabled={
                      !info?.options.some((option) => option.type === value)
                    }
                    onChange={() => {
                      setType(value);
                      changeOption(
                        info?.options.find((option) => option.type === value)
                          ?.id || "",
                      );
                    }}
                  />
                  <Icon name={value} size={18} />
                  <span>{value === "video" ? "Video" : "Audio"}</span>
                  {type === value && <Icon name="check" size={14} />}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="select-grid">
          <div>
            <label className="field-label" htmlFor={`${idPrefix}media-format`}>
              Format
            </label>
            <select
              id={`${idPrefix}media-format`}
              value={selected?.format || ""}
              disabled={!options.length || loading}
              onChange={(event) =>
                changeOption(
                  options.find((item) => item.format === event.target.value)
                    ?.id || "",
                )
              }
            >
              {!formats.length && <option value="">Select a format</option>}
              {formats.map((format) => (
                <option key={format} value={format}>
                  {format.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor={`${idPrefix}media-quality`}>
              Quality
            </label>
            <select
              id={`${idPrefix}media-quality`}
              value={selected?.id || ""}
              disabled={!qualities.length || loading}
              onChange={(event) => changeOption(event.target.value)}
            >
              {!qualities.length && (
                <option value="">Available after preview</option>
              )}
              {qualities.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.quality}
                </option>
              ))}
            </select>
          </div>
        </div>
        {info && (
          <p className="format-note">
            {selected ? (
              <>
                {selected.requiresConversion
                  ? "Includes conversion with FFmpeg."
                  : "Uses the available source format."}
                {selected.estimatedSize
                  ? ` Approximately ${formatBytes(selected.estimatedSize)}.`
                  : ""}
              </>
            ) : (
              "This source has no supported download formats."
            )}
          </p>
        )}
        <div className="thumbnail-options">
          <label className="thumbnail-choice">
            <input
              type="checkbox"
              checked={canEmbedThumbnail && embedThumbnail}
              disabled={!info || loading || !canEmbedThumbnail}
              aria-describedby={`${idPrefix}thumbnail-support`}
              onChange={(event) => setEmbedThumbnail(event.target.checked)}
            />
            <span>Embed Thumbnail</span>
          </label>
          <p className="format-note" id={`${idPrefix}thumbnail-support`}>
            {!selected
              ? "Choose a format to check embedded artwork support."
              : !thumbnailSupported
                ? selected.thumbnailSupport?.reason ||
                  `${selected.format.toUpperCase()} does not support embedded artwork.`
                : ffmpegAvailable === false
                  ? `${selected.format.toUpperCase()} supports embedded artwork. FFmpeg is required to embed it.`
                  : `${selected.thumbnailSupport.reason} Artwork visibility depends on your media player and device.`}
          </p>
          {selected && !thumbnailSupported && (
            <label className="thumbnail-choice sidecar-choice">
              <input
                type="checkbox"
                checked={thumbnailSidecar}
                disabled={!info || loading}
                onChange={(event) => setThumbnailSidecar(event.target.checked)}
              />
              <span>Save thumbnail separately</span>
            </label>
          )}
          {info && !info.thumbnail && (
            <p className="format-note">
              No thumbnail was found. Your media will still download normally.
            </p>
          )}
        </div>
        <div className="save-location">
          <span className="location-icon">
            <Icon name="folder" size={21} />
          </span>
          <div className="location-copy">
            <span className="field-label">Save to</span>
            <span className="location-name" title={destination?.label}>
              {destination?.label ||
                (isDesktop
                  ? "Choose a download folder"
                  : "Browser download location")}
            </span>
          </div>
          {canPick && (
            <button
              className="text-button"
              type="button"
              disabled={choosing || (!isDesktop && !selected)}
              onClick={() => void chooseLocation()}
            >
              {choosing ? "Choosing…" : destination ? "Change" : "Choose"}
            </button>
          )}
        </div>
        {!isDesktop && (
          <p className="location-help">
            {destination
              ? "Your file will be saved here when the download finishes. Keep this tab open."
              : canPick
                ? "Choose a file location, or use your browser’s default download folder."
                : "To choose a location, enable “Ask where to save” in your browser’s download settings."}
          </p>
        )}
        <button
          className="primary-button download-button"
          type="button"
          disabled={
            !info ||
            !selected ||
            loading ||
            busy ||
            unavailable ||
            (clipMode && (ffmpegAvailable !== true || !clipRange))
          }
          onClick={() => void start()}
        >
          {busy ? (
            <span className="spinner" />
          ) : (
            <Icon name="download" size={20} />
          )}
          <span>
            {busy
              ? "Adding to queue…"
              : clipMode
                ? "Download clip"
                : "Download"}
          </span>
          {selected && (
            <span className="download-format">
              {selected.format.toUpperCase()}
            </span>
          )}
        </button>
        {actionError && (
          <p className="inline-error" role="alert">
            {actionError}
          </p>
        )}
        <p className="success-notice" role="status">
          {notice}
        </p>
      </div>
    </section>
  );
}
