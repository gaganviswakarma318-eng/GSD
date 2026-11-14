import { useState } from "react";
import type { MediaInfo } from "../types";
import { formatDuration } from "../utils";
import { Icon } from "./Icon";
export function MediaPreview({
  info,
  loading,
}: {
  info: MediaInfo | null;
  loading: boolean;
}) {
  const [brokenImage, setBrokenImage] = useState("");
  if (loading)
    return (
      <div className="media-preview loading-preview" aria-busy="true">
        <div className="preview-image skeleton" />
        <div className="preview-copy">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
          <p>Finding your media and available formats…</p>
        </div>
      </div>
    );
  if (!info)
    return (
      <div className="preview-empty">
        <div className="empty-art" aria-hidden="true">
          <div className="art-square">
            <Icon name="download" size={35} />
          </div>
          <span className="art-note">
            <Icon name="audio" size={18} />
          </span>
          <span className="art-play">
            <Icon name="video" size={20} />
          </span>
        </div>
        <div>
          <h3>A good link goes a long way.</h3>
          <p>
            Paste a media link to preview it and see
            <br className="desktop-break" /> the formats available from its
            source.
          </p>
        </div>
      </div>
    );
  return (
    <section className="media-preview media-preview-card" aria-label="Media preview">
      <div className="preview-image">
        {info.thumbnail && brokenImage !== info.thumbnail ? (
          <img
            src={info.thumbnail}
            alt=""
            onError={() => setBrokenImage(info.thumbnail || "")}
            referrerPolicy="no-referrer"
          />
        ) : (
          <Icon name="video" size={32} />
        )}
        {info.duration != null && (
          <span className="duration">{formatDuration(info.duration)}</span>
        )}
      </div>
      <div className="preview-copy">
        <span className="eyebrow source-label">
          {info.extractor || "Media source"}
        </span>
        <h3>{info.title}</h3>
        <div className="media-meta">
          {info.creator && <span>{info.creator}</span>}
          {info.viewCount != null && (
            <span>{new Intl.NumberFormat().format(info.viewCount)} views</span>
          )}
          {info.duration != null && (
            <span>{formatDuration(info.duration)}</span>
          )}
        </div>
        <span className="ready-label">
          <Icon name="check" size={13} /> Source checked
        </span>
        <div className="available-formats" aria-label="Available video resolutions">
          {[...new Set(
            info.options
              .filter((option) => option.type === "video")
              .map((option) => option.quality),
          )]
            .slice(0, 5)
            .map((quality) => (
              <span className="format-chip" key={quality}>{quality}</span>
            ))}
        </div>
        <details className="media-details">
          <summary>
            Media details <Icon name="chevron" size={14} />
          </summary>
          <dl>
            <div><dt>Source</dt><dd>{info.extractor || "Media source"}</dd></div>
            {info.creator && <div><dt>Creator</dt><dd>{info.creator}</dd></div>}
            <div><dt>Duration</dt><dd>{info.duration != null ? formatDuration(info.duration) : "Not provided"}</dd></div>
            <div><dt>Formats found</dt><dd>{info.options.length}</dd></div>
          </dl>
        </details>
      </div>
    </section>
  );
}
