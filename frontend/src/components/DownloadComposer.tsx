import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { api } from "../api/client";
import { isDesktop } from "../config";
import { useMediaInfo } from "../hooks/useMediaInfo";
import type {
  ClipRange,
  DownloadJob,
  MediaInfo,
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
import { MediaPreview } from "./MediaPreview";

interface Props {
  unavailable: boolean;
  ffmpegAvailable: boolean | null;
  mode?: "full" | "clip";
  pageTitle?: string;
  onReadyChange?(ready: boolean): void;
  onQueue(
    url: string,
    optionId: string,
    destination: SaveDestination | null,
    settings: ThumbnailSettings,
    clipRange?: ClipRange,
  ): Promise<DownloadJob>;
}

interface BatchPreference {
  type: MediaType;
  format?: string;
  quality?: string;
}

export function DownloadComposer({
  unavailable,
  ffmpegAvailable,
  mode = "full",
  pageTitle,
  onReadyChange,
  onQueue,
}: Props) {
  const [url, setUrl] = useState("");
  const [multipleMode, setMultipleMode] = useState(false);
  const [batchUrls, setBatchUrls] = useState<string[]>([]);
  const [batchPreference, setBatchPreference] = useState<BatchPreference>({
    type: "video",
  });
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { info, loading, error, lookup, clear } = useMediaInfo();
  const clipMode = mode === "clip";
  const idPrefix = clipMode ? "clip-" : "";
  const formId = clipMode ? "clip-download-form" : "download-form";
  const options =
    info?.options.filter((item) => item.type === type) || [];
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
    clipMode &&
    !clipRangeError &&
    clipStartSeconds !== null &&
    clipEndSeconds !== null
      ? { startSeconds: clipStartSeconds, endSeconds: clipEndSeconds }
      : undefined;
  const clipSliderMax = Math.max(1, Math.floor(info?.duration || 1));
  const draftUrls = url
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const validDraft = draftUrls.length > 0 && draftUrls.every(validMediaUrl);
  const isReady = !unavailable && !busy && (
    multipleMode && !clipMode
      ? batchUrls.length > 0 || validDraft
      : Boolean(info && selected && !loading && (!clipMode || (clipRange && ffmpegAvailable === true)))
  );

  useEffect(() => {
    if (!info) return;
    const first =
      info.options.find((item) => item.type === type) ||
      info.options.find((item) => item.type === "video") ||
      info.options[0];
    if (first) {
      setType(first.type);
      setOptionId(first.id);
    }
    if (clipMode && info.duration && Number.isFinite(info.duration)) {
      setClipStart(formatTimecode(0));
      setClipEnd(
        formatTimecode(Math.max(1, Math.min(30, Math.floor(info.duration)))),
      );
    }
    // Reset the selection when a new media source arrives, not while choosing its quality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, clipMode]);

  useEffect(() => {
    onReadyChange?.(isReady);
    return () => onReadyChange?.(false);
  }, [isReady, onReadyChange]);

  function changeOption(id: string) {
    setOptionId(id);
    setNotice("");
    setActionError("");
    if (!isDesktop) setDestination(null);
  }

  function changeUrl(value: string) {
    setUrl(value);
    if (!multipleMode) clear();
    setActionError("");
    setNotice("");
    if (!isDesktop) setDestination(null);
  }

  function changeMode(nextMultipleMode: boolean) {
    if (nextMultipleMode === multipleMode || clipMode) return;
    if (nextMultipleMode) {
      setBatchPreference({
        type,
        format: selected?.format,
        quality: selected?.quality,
      });
      if (destination?.handle) setDestination(null);
    }
    setMultipleMode(nextMultipleMode);
    setUrl("");
    clear();
    setActionError("");
    setNotice("");
  }

  async function paste() {
    let value: string;
    try {
      value = (await navigator.clipboard.readText()).trim();
    } catch {
      setActionError(
        "Clipboard access is unavailable. Paste into the link field using Ctrl+V.",
      );
      input.current?.focus();
      textarea.current?.focus();
      return;
    }
    changeUrl(value);
    if (!multipleMode && validMediaUrl(value)) await lookup(value);
  }

  async function importUrls(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const contents = (await file.text()).trim();
      if (contents.includes("\n") && !clipMode) changeMode(true);
      changeUrl(contents);
      if (!multipleMode && !contents.includes("\n") && validMediaUrl(contents))
        await lookup(contents);
    } catch (reason) {
      setActionError(`Could not read the URL list: ${errorMessage(reason)}`);
    }
  }

  function addBatchUrls() {
    const entries = url
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!entries.length) {
      setActionError("Paste or import at least one media link.");
      return;
    }
    const invalid = entries.find((item) => !validMediaUrl(item));
    if (invalid) {
      setActionError(`This is not a valid public media link: ${invalid}`);
      return;
    }
    setBatchUrls((previous) => [...previous, ...entries]);
    setUrl("");
    setActionError("");
    setNotice(
      `${entries.length} link${entries.length === 1 ? "" : "s"} added to the download list.`,
    );
  }

  async function chooseLocation() {
    setChoosing(true);
    setActionError("");
    try {
      if (window.gsd) {
        const chosen = await window.gsd.chooseDirectory();
        if (chosen) setDestination(chosen);
      } else if (!multipleMode && window.showSaveFilePicker && selected && info) {
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

  async function queueBatch(candidateUrls: string[]) {
    let chosen = destination?.handle ? null : destination;
    if (window.gsd && !chosen) {
      const picked = await window.gsd.chooseDirectory();
      if (!picked) return;
      chosen = picked;
      setDestination(picked);
    }

    const failed: string[] = [];
    const failureMessages: string[] = [];
    let added = 0;
    for (const candidateUrl of candidateUrls) {
      try {
        const candidateInfo = await api.info(
          candidateUrl,
          new AbortController().signal,
        );
        const option = chooseBatchOption(candidateInfo, type, batchPreference);
        if (!option)
          throw new Error(`No ${type} format is available for this link.`);
        await onQueue(
          candidateInfo.url,
          option.id,
          chosen,
          {
            embedThumbnail:
              Boolean(option.thumbnailSupport?.supported) &&
              ffmpegAvailable === true &&
              embedThumbnail,
            thumbnailSidecar:
              !option.thumbnailSupport?.supported && thumbnailSidecar,
          },
        );
        added += 1;
      } catch (reason) {
        failed.push(candidateUrl);
        failureMessages.push(`${candidateUrl}: ${errorMessage(reason)}`);
      }
    }
    setBatchUrls(failed);
    setUrl("");
    if (added)
      setNotice(
        `${added} download${added === 1 ? "" : "s"} added to the queue.`,
      );
    if (failed.length)
      setActionError(
        `${failed.length} link${failed.length === 1 ? "" : "s"} could not be queued. ${failureMessages.slice(0, 3).join(" ")}`,
      );
    if (added && !isDesktop) setDestination(null);
  }

  async function start() {
    if (busy || unavailable) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      if (multipleMode && !clipMode) {
        const draft = url
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
        const invalid = draft.find((item) => !validMediaUrl(item));
        if (invalid) {
          setActionError(`This is not a valid public media link: ${invalid}`);
          return;
        }
        const candidates = [...batchUrls, ...draft];
        if (!candidates.length) return;
        await queueBatch(candidates);
        return;
      }
      if (!info || !selected || loading) return;
      if (clipMode && (!clipRange || ffmpegAvailable !== true)) return;
      let chosen = destination;
      if (window.gsd && !chosen) {
        const picked = await window.gsd.chooseDirectory();
        if (!picked) return;
        chosen = picked;
        setDestination(picked);
      }
      await onQueue(
        info.url,
        selected.id,
        chosen,
        {
          embedThumbnail: canEmbedThumbnail && embedThumbnail,
          thumbnailSidecar: !thumbnailSupported && thumbnailSidecar,
        },
        clipRange,
      );
      setNotice(
        clipMode
          ? "Clip added to your downloads."
          : "Added to your downloads. You can add another link while this one runs.",
      );
      if (!isDesktop) setDestination(null);
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (multipleMode && !clipMode) {
      void start();
      return;
    }
    if (info && selected) void start();
    else {
      setActionError("");
      setNotice("");
      void lookup(url.trim());
    }
  }

  const canPick = isDesktop || (!multipleMode && Boolean(window.showSaveFilePicker));

  return (
    <section
      className={`composer panel ${clipMode ? "clip-composer" : ""}`}
      aria-labelledby={`${idPrefix}download-title`}
    >
      <form id={formId} onSubmit={submit}>
        <div className="composer-toolbar">
          <div className="section-heading">
            <div>
              <span className="eyebrow source-label">
                {clipMode ? "CLIP STUDIO" : multipleMode ? "BATCH DOWNLOAD" : "MEDIA DOWNLOADER"}
              </span>
              <h2 id={`${idPrefix}download-title`}>
                {pageTitle || (clipMode ? "Create a clip" : "Download media")}
              </h2>
            </div>
            <span className="step-hint">
              {clipMode
                ? "Choose a section to keep"
                : multipleMode
                  ? `${batchUrls.length} link${batchUrls.length === 1 ? "" : "s"} ready`
                  : "Choose the format and quality"}
            </span>
          </div>
          {!clipMode && (
            <div className="composer-toolbar-actions">
              <div
                className="url-mode-switch"
                role="group"
                aria-label="URL input mode"
              >
                <button
                  className={!multipleMode ? "selected" : ""}
                  type="button"
                  aria-pressed={!multipleMode}
                  onClick={() => changeMode(false)}
                >
                  Single URL
                </button>
                <button
                  className={multipleMode ? "selected" : ""}
                  type="button"
                  aria-pressed={multipleMode}
                  onClick={() => changeMode(true)}
                >
                  Multiple URLs
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="url-entry-section">
          <label className="field-label" htmlFor={`${idPrefix}media-url`}>
            {multipleMode && !clipMode ? "Media links" : "Media link"}
          </label>
          <div className={`link-field ${multipleMode && !clipMode ? "multi-link-field" : ""}`}>
            <Icon name="link" size={20} />
            {multipleMode && !clipMode ? (
              <textarea
                ref={textarea}
                id={`${idPrefix}media-url`}
                placeholder={"Paste one media link per line"}
                value={url}
                rows={3}
                onChange={(event) => changeUrl(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${idPrefix}link-hint`}
                aria-invalid={Boolean(actionError)}
                required={!batchUrls.length}
              />
            ) : (
              <input
                ref={input}
                id={`${idPrefix}media-url`}
                type="url"
                placeholder={
                  clipMode
                    ? "Paste a video link to clip"
                    : "Paste a video or music link"
                }
                value={url}
                onChange={(event) => changeUrl(event.target.value)}
                onPaste={(event) => {
                  const value = event.clipboardData.getData("text").trim();
                  if (multipleMode || !validMediaUrl(value)) return;
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
            )}
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
            <p id={`${idPrefix}link-hint`}>
              {multipleMode && !clipMode
                ? "Add one public media link per line, or import a .txt file."
                : "Public media links supported by yt-dlp."}
            </p>
            <div className="url-actions">
              {!clipMode && (
                <>
                  <input
                    ref={fileInput}
                    className="sr-only"
                    type="file"
                    accept=".txt,text/plain"
                    tabIndex={-1}
                    aria-label="Import a text file of media links"
                    onChange={(event) => void importUrls(event)}
                  />
                  <button
                    className="text-button import-button"
                    type="button"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="upload" size={15} />
                    Import
                  </button>
                </>
              )}
              {multipleMode && !clipMode ? (
                <button
                  className="text-button find-button"
                  type="button"
                  disabled={!url.trim()}
                  onClick={addBatchUrls}
                >
                  Add links <Icon name="plus" size={16} />
                </button>
              ) : (
                <button
                  className="text-button find-button"
                  type="button"
                  disabled={!url.trim() || loading || unavailable}
                  onClick={() => {
                    setActionError("");
                    setNotice("");
                    void lookup(url.trim());
                  }}
                >
                  {loading ? "Finding media…" : "Find media"}
                  {loading ? <span className="spinner" /> : <Icon name="arrow" size={16} />}
                </button>
              )}
            </div>
          </div>
        </div>
        {!multipleMode && error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {multipleMode && !clipMode && batchUrls.length > 0 && (
          <section className="batch-list" aria-label="Links ready for download">
            <div className="batch-list-heading">
              <span>{batchUrls.length} links added</span>
              <button
                type="button"
                className="text-button"
                onClick={() => setBatchUrls([])}
              >
                Clear list
              </button>
            </div>
            <ul>
              {batchUrls.map((candidate, index) => (
                <li key={`${candidate}-${index}`}>
                  <span className="batch-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="batch-url" title={candidate}>{candidate}</span>
                  <button
                    type="button"
                    className="icon-button batch-remove"
                    aria-label={`Remove link ${index + 1}`}
                    onClick={() =>
                      setBatchUrls((previous) =>
                        previous.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <Icon name="close" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!multipleMode && <MediaPreview info={info} loading={loading} />}
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
              <>
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
                  <div className="clip-duration-summary">
                    <span className="field-label">Selected duration</span>
                    <strong>
                      {clipStartSeconds !== null &&
                      clipEndSeconds !== null &&
                      clipEndSeconds > clipStartSeconds
                        ? formatTimecode(clipEndSeconds - clipStartSeconds)
                        : "—"}
                    </strong>
                  </div>
                </div>
                <div className="clip-slider-fields">
                  <label>
                    <span>
                      Start point · {formatTimecode(clipStartSeconds ?? 0)}
                    </span>
                    <input
                      type="range"
                      min="0"
                      max={clipSliderMax}
                      step="1"
                      value={Math.min(clipSliderMax, clipStartSeconds ?? 0)}
                      aria-label="Clip start point"
                      onChange={(event) => {
                        setClipStart(formatTimecode(Number(event.target.value)));
                        setActionError("");
                      }}
                    />
                  </label>
                  <label>
                    <span>
                      End point ·{" "}
                      {formatTimecode(clipEndSeconds ?? clipSliderMax)}
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
                      onChange={(event) => {
                        setClipEnd(formatTimecode(Number(event.target.value)));
                        setActionError("");
                      }}
                    />
                  </label>
                </div>
                <p
                  className={
                    clipRangeError ? "inline-error clip-range-error" : "format-note"
                  }
                  id="clip-range-help"
                  role={clipRangeError ? "alert" : undefined}
                >
                  {clipRangeError ||
                    "Use the sliders or enter a precise time. Cut points use one-second accuracy."}
                </p>
              </>
            )}
            {ffmpegAvailable === false && (
              <p className="inline-error clip-range-error" role="alert">
                Clip downloads require FFmpeg. Install FFmpeg or configure
                GSD_FFMPEG_PATH.
              </p>
            )}
          </div>
        )}
        <div className={`download-options ${!info && !multipleMode ? "options-unready" : ""}`}>
          <fieldset
            className="type-fieldset"
            disabled={!multipleMode && (!info || loading)}
          >
            <legend className="field-label">
              {clipMode ? "Clip output" : "Download as"}
            </legend>
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
                      !multipleMode &&
                      !info?.options.some((option) => option.type === value)
                    }
                    onChange={() => {
                      setType(value);
                      if (multipleMode)
                        setBatchPreference({ type: value });
                      const match = info?.options.find(
                        (option) => option.type === value,
                      );
                      changeOption(match?.id || "");
                    }}
                  />
                  <Icon name={value} size={18} />
                  <span>{value === "video" ? "Video" : "Audio only"}</span>
                  {type === value && <Icon name="check" size={14} />}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="select-grid">
            <div>
              <label className="field-label" htmlFor={`${idPrefix}media-format`}>
                Format
              </label>
              <select
                id={`${idPrefix}media-format`}
                value={selected?.format || ""}
                disabled={!options.length || loading || multipleMode}
                onChange={(event) =>
                  changeOption(
                    options.find((item) => item.format === event.target.value)
                      ?.id || "",
                  )
                }
              >
                {!formats.length && (
                  <option value="">
                    {multipleMode ? "Auto per link" : "Select a format"}
                  </option>
                )}
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
                disabled={!qualities.length || loading || multipleMode}
                onChange={(event) => changeOption(event.target.value)}
              >
                {!qualities.length && (
                  <option value="">
                    {multipleMode ? "Best available" : "Available after preview"}
                  </option>
                )}
                {qualities.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.quality}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {multipleMode && !clipMode && (
            <p className="format-note">
              Each link is checked against its real source formats. GSD uses
              the matching format and quality when available; otherwise it
              chooses the best available option.
            </p>
          )}
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
          <details className="advanced-options">
            <summary>
              <Icon name="layers" size={16} />
              More options
              <Icon name="chevron" size={14} />
            </summary>
            <div className="advanced-options-content">
              <div className="thumbnail-options">
                <label className="thumbnail-choice">
                  <input
                    type="checkbox"
                    checked={canEmbedThumbnail && embedThumbnail}
                    disabled={!info || loading || !canEmbedThumbnail || multipleMode}
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
                      disabled={!info || loading || multipleMode}
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
              <div className="unsupported-options">
                <p>
                  <span>Playlist downloads</span>
                  <span>Not available</span>
                </p>
                <p>
                  <span>Subtitle downloads</span>
                  <span>Not available</span>
                </p>
                <small>
                  GSD currently handles individual media links. These options
                  are shown for clarity and are not enabled.
                </small>
              </div>
            </div>
          </details>
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
              {multipleMode
                ? "Batch downloads use your browser’s default download folder."
                : destination
                  ? "Your file will be saved here when the download finishes. Keep this tab open."
                  : canPick
                    ? "Choose a file location, or use your browser’s default download folder."
                    : "To choose a location, enable “Ask where to save” in your browser’s download settings."}
            </p>
          )}
        </div>
        {actionError && (
          <p className="inline-error" role="alert">
            {actionError}
          </p>
        )}
        {notice && (
          <p className="success-notice" role="status">
            {notice}
          </p>
        )}
        <button className="sr-only" type="submit" tabIndex={-1}>
          {clipMode ? "Download clip" : "Start downloads"}
        </button>
      </form>
    </section>
  );
}

function chooseBatchOption(
  info: MediaInfo,
  type: MediaType,
  preference: BatchPreference,
) {
  const options = info.options.filter((item) => item.type === type);
  return (
    options.find(
      (item) =>
        preference.type === type &&
        item.format === preference.format &&
        item.quality === preference.quality,
    ) || options[0]
  );
}
