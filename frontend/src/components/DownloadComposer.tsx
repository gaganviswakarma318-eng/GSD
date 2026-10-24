import { useEffect, useRef, useState } from "react";
import { isDesktop } from "../config";
import { useMediaInfo } from "../hooks/useMediaInfo";
import type { DownloadJob, MediaType, SaveDestination, ThumbnailSettings } from "../types";
import {
  errorMessage,
  formatBytes,
  suggestedFilename,
  validMediaUrl,
} from "../utils";
import { Icon } from "./Icon";
import { MediaPreview } from "./MediaPreview";

interface Props {
  unavailable: boolean;
  ffmpegAvailable: boolean;
  onQueue(
    url: string,
    optionId: string,
    destination: SaveDestination | null,
    settings: ThumbnailSettings,
  ): Promise<DownloadJob>;
}
export function DownloadComposer({ unavailable, ffmpegAvailable, onQueue }: Props) {
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
  const input = useRef<HTMLInputElement>(null);
  const { info, loading, error, lookup, clear } = useMediaInfo();
  const options = info?.options.filter((item) => item.type === type) || [];
  const selected = options.find((item) => item.id === optionId) || options[0];
  const formats = [...new Set(options.map((item) => item.format))];
  const qualities = options.filter((item) => item.format === selected?.format);
  const thumbnailSupported = Boolean(selected?.thumbnailSupport?.supported);
  const canEmbedThumbnail = thumbnailSupported && ffmpegAvailable;

  useEffect(() => {
    if (!info) return;
    const first =
      info.options.find((item) => item.type === type) || info.options[0];
    if (first) {
      setType(first.type);
      setOptionId(first.id);
    }
    // Reset the selection when a new media source arrives, not while choosing its quality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

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
      });
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
    <section className="composer panel" aria-labelledby="new-download-title">
      <div className="section-heading">
        <h2 id="new-download-title">New download</h2>
        <span className="step-hint">A link is all you need</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setActionError("");
          setNotice("");
          void lookup(url);
        }}
      >
        <label className="field-label" htmlFor="media-url">
          Media link
        </label>
        <div className="link-field">
          <Icon name="link" size={20} />
          <input
            ref={input}
            id="media-url"
            type="url"
            placeholder="Paste a video or music link"
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
            aria-describedby="link-hint"
            aria-invalid={Boolean(error)}
            required
          />
          <button
            className="paste-button"
            type="button"
            onClick={() => void paste()}
            title="Paste link from clipboard"
          >
            <Icon name="paste" size={16} />
            <span>Paste</span>
          </button>
        </div>
        <div className="link-under">
          <p id="link-hint">Public media links supported by yt-dlp.</p>
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
      <div className={`download-options ${!info ? "options-unready" : ""}`}>
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
                  name="media-type"
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
        <div className="select-grid">
          <div>
            <label className="field-label" htmlFor="media-format">
              Format
            </label>
            <select
              id="media-format"
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
            <label className="field-label" htmlFor="media-quality">
              Quality
            </label>
            <select
              id="media-quality"
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
              aria-describedby="thumbnail-support"
              onChange={(event) => setEmbedThumbnail(event.target.checked)}
            />
            <span>Embed Thumbnail</span>
          </label>
          <p className="format-note" id="thumbnail-support">
            {!selected
              ? "Choose a format to check embedded artwork support."
              : !thumbnailSupported
                ? selected.thumbnailSupport?.reason || `${selected.format.toUpperCase()} does not support embedded artwork.`
                : !ffmpegAvailable
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
          disabled={!info || !selected || loading || busy || unavailable}
          onClick={() => void start()}
        >
          {busy ? (
            <span className="spinner" />
          ) : (
            <Icon name="download" size={20} />
          )}
          <span>{busy ? "Adding to queue…" : "Download"}</span>
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
