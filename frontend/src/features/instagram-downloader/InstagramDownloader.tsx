import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { instagramApi } from "../../shared/services/instagramService";
import { isDesktop } from "../../shared/config";
import type {
  InstagramInfo,
  InstagramMediaItem,
  InstagramSelection,
  InstagramQueueResult,
  SaveDestination,
} from "../../shared/types";
import { errorMessage, formatDuration } from "../../shared/utils";
import { Icon } from "../../shared/components/Icon";

interface Props {
  unavailable: boolean;
  onQueue(
    url: string,
    items: InstagramSelection[],
    destination: SaveDestination | null,
  ): Promise<InstagramQueueResult>;
}

function validInstagramUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      ["instagram.com", "www.instagram.com", "m.instagram.com"].includes(
        url.hostname.toLowerCase(),
      ) &&
      url.pathname.split("/").filter(Boolean).length > 0
    );
  } catch {
    return false;
  }
}

const CONTENT_LABELS = {
  photo: "Photo",
  carousel: "Carousel",
  video: "Video",
  reel: "Reel",
  story: "Story",
  highlight: "Highlight",
  profile: "Profile picture",
} as const;

function preferredOption(item: InstagramMediaItem) {
  const preferredType = item.kind === "video" ? "video" : "image";
  return item.options.find((option) => option.type === preferredType) || item.options[0];
}

export function InstagramDownloader({ unavailable, onQueue }: Props) {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<InstagramInfo | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [optionIds, setOptionIds] = useState<Record<string, string>>({});
  const [destination, setDestination] = useState<SaveDestination | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imageFailures, setImageFailures] = useState<Set<string>>(new Set());
  const request = useRef<AbortController | null>(null);

  const availableItems = useMemo(
    () => info?.items.filter((item) => item.options.length > 0) || [],
    [info],
  );
  const selectedItems = useMemo(
    () => availableItems.filter((item) => selectedIds.has(item.id)),
    [availableItems, selectedIds],
  );

  useEffect(() => {
    return () => request.current?.abort();
  }, []);

  function changeUrl(value: string) {
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setUrl(value);
    setInfo(null);
    setSelectedIds(new Set());
    setOptionIds({});
    setError("");
    setNotice("");
  }

  async function inspect(value = url.trim()) {
    if (loading || unavailable) return;
    setError("");
    setNotice("");
    if (!validInstagramUrl(value)) {
      setInfo(null);
      setError("Enter a valid public Instagram post, reel, story, highlight, or profile URL.");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const result = await instagramApi.info(value, controller.signal);
      setUrl(result.url);
      setInfo(result);
      setSelectedIds(
        new Set(result.items.filter((item) => item.options.length).map((item) => item.id)),
      );
      setOptionIds(
        Object.fromEntries(
          result.items.flatMap((item) => {
            const option = preferredOption(item);
            return option ? [[item.id, option.id]] : [];
          }),
        ),
      );
      setImageFailures(new Set());
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError"))
        setError(errorMessage(reason));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  async function paste() {
    let value: string;
    try {
      value = (await navigator.clipboard.readText()).trim();
    } catch {
      setError("Clipboard access is unavailable. Paste into the link field using Ctrl+V.");
      return;
    }
    changeUrl(value);
    if (validInstagramUrl(value)) await inspect(value);
  }

  async function chooseDestination() {
    if (!window.gsd) return null;
    const chosen = await window.gsd.chooseDirectory();
    if (chosen) setDestination(chosen);
    return chosen;
  }

  async function queueItems(items: InstagramMediaItem[]) {
    if (!info || busy || !items.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let chosen = destination;
      if (window.gsd && !chosen) {
        chosen = await chooseDestination();
        if (!chosen) return;
      }
      const selections = items.flatMap((item) => {
        const option =
          item.options.find((candidate) => candidate.id === optionIds[item.id]) ||
          preferredOption(item);
        return option ? [{ itemId: item.id, optionId: option.id }] : [];
      });
      if (!selections.length) {
        setError("No downloadable formats are available for the selected items.");
        return;
      }
      const result = await onQueue(info.url, selections, chosen);
      const messages = result.errors.map((itemError) => {
        const item = info.items.find((candidate) => candidate.id === itemError.itemId);
        return `${item?.title || "An Instagram item"}: ${itemError.error}`;
      });
      if (result.jobs.length)
        setNotice(
          `${result.jobs.length} item${result.jobs.length === 1 ? "" : "s"} added to the download queue.`,
        );
      if (messages.length)
        setError(messages.slice(0, 3).join(" "));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void inspect();
  }

  const allSelected =
    availableItems.length > 0 && selectedItems.length === availableItems.length;

  return (
    <section className="instagram-page panel" aria-labelledby="instagram-title">
      <header className="instagram-heading">
        <span className="instagram-heading-icon">
          <Icon name="instagram" size={20} />
        </span>
        <div>
          <span className="eyebrow">PUBLIC CONTENT ONLY</span>
          <h2 id="instagram-title">Download public media</h2>
          <p>Inspect a public link and add the media you want to your queue.</p>
        </div>
      </header>

      <form className="instagram-url-form" onSubmit={submit}>
        <label htmlFor="instagram-url">Instagram URL</label>
        <div className="instagram-url-controls">
          <input
            id="instagram-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://www.instagram.com/p/…"
            value={url}
            onChange={(event) => changeUrl(event.target.value)}
            disabled={loading || unavailable}
          />
          <button
            className="small-button"
            type="button"
            onClick={() => void paste()}
            disabled={loading || unavailable}
          >
            <Icon name="clipboard" size={15} />
            Paste
          </button>
          {url && (
            <button
              className="icon-button"
              type="button"
              aria-label="Clear Instagram URL"
              onClick={() => changeUrl("")}
              disabled={loading}
            >
              <Icon name="close" size={16} />
            </button>
          )}
          <button
            className="primary-button instagram-fetch-button"
            type="submit"
            disabled={loading || unavailable || !url.trim()}
          >
            {loading ? <span className="spinner tiny" /> : <Icon name="link" size={16} />}
            {loading ? "Inspecting…" : "Fetch media"}
          </button>
        </div>
        <p className="instagram-privacy-note">
          No password or login cookies are used. Private or sign-in-only content is not accessible.
        </p>
      </form>

      {error && <p className="inline-error instagram-message" role="alert">{error}</p>}
      {notice && <p className="instagram-notice instagram-message" role="status">{notice}</p>}

      {loading && (
        <div className="instagram-loading" role="status">
          <span className="spinner" />
          <span>Checking what Instagram makes publicly available…</span>
        </div>
      )}

      {info && !loading && (
        <section className="instagram-results" aria-label="Instagram media preview">
          <div className="instagram-result-heading">
            <div>
              <span className="eyebrow">
                {CONTENT_LABELS[info.contentType]} · {info.items.length} item{info.items.length === 1 ? "" : "s"}
              </span>
              <h3 title={info.title}>{info.title}</h3>
              {info.creator && <p>{info.creator}</p>}
            </div>
            <div className="instagram-result-actions">
              <button
                type="button"
                className="small-button"
                onClick={() =>
                  setSelectedIds(
                    allSelected ? new Set() : new Set(availableItems.map((item) => item.id)),
                  )
                }
                disabled={!availableItems.length || busy}
              >
                {allSelected ? "Clear selection" : "Select all"}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void queueItems(selectedItems)}
                disabled={!selectedItems.length || busy}
              >
                <Icon name="download" size={16} />
                {busy ? "Adding…" : "Download selected"}
              </button>
              {availableItems.length > 1 && (
                <button
                  type="button"
                  className="small-button"
                  onClick={() => void queueItems(availableItems)}
                  disabled={busy}
                >
                  Download all
                </button>
              )}
            </div>
          </div>

          <div className="instagram-item-list">
            {info.items.map((item, index) => {
              const selectedOptionId = optionIds[item.id] || preferredOption(item)?.id || "";
              const selectedOption = item.options.find((option) => option.id === selectedOptionId);
              const imageFailed = imageFailures.has(item.id);
              return (
                <article className="instagram-item" key={item.id}>
                  <label className="instagram-item-select">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      disabled={!item.options.length || busy}
                      onChange={(event) =>
                        setSelectedIds((previous) => {
                          const next = new Set(previous);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        })
                      }
                      aria-label={`Select ${item.title}`}
                    />
                    <span className="sr-only">Select item {index + 1}</span>
                  </label>
                  <div className="instagram-item-preview">
                    {item.thumbnail && !imageFailed ? (
                      <img
                        src={item.thumbnail}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setImageFailures((previous) => new Set(previous).add(item.id))
                        }
                      />
                    ) : (
                      <Icon name={item.kind === "image" ? "image" : "video"} size={22} />
                    )}
                    <span className="instagram-item-kind">
                      <Icon name={item.kind === "image" ? "image" : "video"} size={12} />
                      {item.kind === "image" ? "Photo" : "Video"}
                    </span>
                  </div>
                  <div className="instagram-item-details">
                    <h4 title={item.title}>{item.title}</h4>
                    <p>
                      Item {index + 1}
                      {item.duration ? ` · ${formatDuration(item.duration)}` : ""}
                    </p>
                    {item.error ? (
                      <span className="instagram-item-error">{item.error}</span>
                    ) : (
                      <label className="instagram-format-label">
                        <span>Format & quality</span>
                        <select
                          value={selectedOptionId}
                          onChange={(event) =>
                            setOptionIds((previous) => ({
                              ...previous,
                              [item.id]: event.target.value,
                            }))
                          }
                          disabled={busy}
                          aria-label={`Format and quality for ${item.title}`}
                        >
                          {item.options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.type === "audio" ? "Audio only · " : ""}
                              {option.format.toUpperCase()} · {option.quality}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <button
                    className="icon-button instagram-item-download"
                    type="button"
                    aria-label={`Download ${item.title}`}
                    title="Add this item to the download queue"
                    disabled={!selectedOption || busy}
                    onClick={() => void queueItems([item])}
                  >
                    <Icon name="download" size={17} />
                  </button>
                </article>
              );
            })}
          </div>

          {info.items.every((item) => !item.options.length) && (
            <p className="instagram-empty">
              Instagram did not expose a downloadable media file for this link.
            </p>
          )}

          <div className="instagram-destination">
            <span>
              <Icon name="folder" size={15} />
              {destination
                ? `Save to ${destination.label}`
                : isDesktop
                  ? "Save downloads to a folder"
                  : "Files will be offered through your browser downloads"}
            </span>
            {isDesktop && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void chooseDestination().catch((reason) => setError(errorMessage(reason)));
                }}
                disabled={busy}
              >
                {destination ? "Change folder" : "Choose folder"}
              </button>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
