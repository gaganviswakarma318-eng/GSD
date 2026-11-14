import { useEffect, useState } from "react";
import type { ClipRange, MediaInfo } from "../types";
import { formatTimecode, parseTimecode } from "../utils";

export function useClipRange(info: MediaInfo | null, enabled: boolean) {
  const [start, setStart] = useState("00:00");
  const [end, setEnd] = useState("00:30");
  const startSeconds = parseTimecode(start);
  const endSeconds = parseTimecode(end);
  const error = !enabled || !info
    ? ""
    : !Number.isFinite(info.duration) || !info.duration || info.duration < 1
      ? "This source does not report a usable duration, so a clip cannot be validated."
      : startSeconds === null
        ? "Enter a start time as MM:SS or HH:MM:SS."
        : endSeconds === null
          ? "Enter an end time as MM:SS or HH:MM:SS."
          : startSeconds >= endSeconds
            ? "The end time must be later than the start time."
            : endSeconds > info.duration
              ? "The clip end must be within the video duration."
              : "";
  const range: ClipRange | undefined =
    enabled &&
    !error &&
    startSeconds !== null &&
    endSeconds !== null
      ? { startSeconds, endSeconds }
      : undefined;

  useEffect(() => {
    if (!enabled || !info?.duration || !Number.isFinite(info.duration)) return;
    setStart(formatTimecode(0));
    setEnd(
      formatTimecode(Math.max(1, Math.min(30, Math.floor(info.duration)))),
    );
  }, [info, enabled]);

  return {
    start,
    end,
    setStart,
    setEnd,
    startSeconds,
    endSeconds,
    error,
    range,
    sliderMax: Math.max(1, Math.floor(info?.duration || 1)),
  };
}
