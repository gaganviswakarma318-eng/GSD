import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { ClipRange, DownloadJob, ThumbnailSettings } from "../types";
import { errorMessage } from "../utils";

function newerJob(
  existing: DownloadJob | undefined,
  incoming: DownloadJob,
): DownloadJob {
  if (
    existing &&
    (existing.attempt > incoming.attempt ||
      (existing.attempt === incoming.attempt &&
        existing.updatedAt > incoming.updatedAt))
  )
    return existing;
  return incoming;
}

function mergeSnapshot(
  previous: DownloadJob[],
  snapshot: DownloadJob[],
): DownloadJob[] {
  const existing = new Map(previous.map((job) => [job.id, job]));
  return snapshot
    .map((job) => newerJob(existing.get(job.id), job))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function useDownloads() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const upsert = useCallback((job: DownloadJob) => {
    setJobs((previous) => {
      const existing = previous.find((item) => item.id === job.id);
      if (newerJob(existing, job) !== job) return previous;
      return [job, ...previous.filter((item) => item.id !== job.id)].sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    });
  }, []);
  const refresh = useCallback(async () => {
    try {
      const snapshot = await api.jobs();
      setJobs((previous) => mergeSnapshot(previous, snapshot));
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (loading) return;
    // One owner-wide connection avoids exhausting browsers' per-host HTTP/1.1 sockets.
    // Each reconnect receives a fresh complete snapshot, including completed file delivery.
    const source = new EventSource(api.eventsUrl());
    source.onmessage = (event) => {
      try {
        const snapshot: (DownloadJob & { expired?: boolean }) | DownloadJob[] =
          JSON.parse(event.data);
        if (Array.isArray(snapshot))
          setJobs((previous) => mergeSnapshot(previous, snapshot));
        else if (snapshot.expired)
          setJobs((previous) =>
            previous.filter((job) => job.id !== snapshot.id),
          );
        else if (snapshot.id) upsert(snapshot);
        setError("");
      } catch {
        /* A malformed event does not interrupt the native reconnect loop. */
      }
    };
    source.onopen = () => setReconnecting(false);
    source.onerror = () => setReconnecting(true);
    return () => source.close();
  }, [loading, upsert]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  const create = async (url: string, optionId: string, saveToken?: string, settings?: ThumbnailSettings, clipRange?: ClipRange) => {
    const job = await api.create(url, optionId, saveToken, settings, clipRange);
    upsert(job);
    return job;
  };
  const cancel = async (id: string) => {
    const job = await api.cancel(id);
    upsert(job);
  };
  const retry = async (id: string) => {
    const job = await api.retry(id);
    upsert(job);
  };
  return { jobs, loading, error, reconnecting, create, cancel, retry, refresh };
}
