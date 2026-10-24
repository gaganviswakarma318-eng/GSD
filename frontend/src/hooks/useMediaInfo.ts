import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { METADATA_CACHE_MS } from "../config";
import type { MediaInfo } from "../types";
import { errorMessage, validMediaUrl } from "../utils";
const cache = new Map<string, { at: number; info: MediaInfo }>();
export function useMediaInfo() {
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const currentUrl = useRef("");
  const clear = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    currentUrl.current = "";
    setInfo(null);
    setError("");
    setLoading(false);
  }, []);
  const lookup = useCallback(async (input: string) => {
    const url = input.trim();
    if (url === currentUrl.current && controller.current) return;
    controller.current?.abort();
    controller.current = null;
    setError("");
    setInfo(null);
    if (!validMediaUrl(url)) {
      currentUrl.current = "";
      setLoading(false);
      setError(
        "Paste a complete media link beginning with https:// or http://.",
      );
      return;
    }
    currentUrl.current = url;
    const cached = cache.get(url);
    if (cached && Date.now() - cached.at < METADATA_CACHE_MS) {
      setInfo(cached.info);
      setLoading(false);
      return;
    }
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    try {
      const result = await api.info(url, next.signal);
      if (next.signal.aborted) return;
      cache.set(url, { at: Date.now(), info: result });
      if (cache.size > 20) cache.delete(cache.keys().next().value as string);
      setInfo(result);
    } catch (reason) {
      if (!next.signal.aborted) {
        currentUrl.current = "";
        setError(errorMessage(reason));
      }
    } finally {
      if (!next.signal.aborted) {
        controller.current = null;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  return { info, loading, error, lookup, clear };
}
