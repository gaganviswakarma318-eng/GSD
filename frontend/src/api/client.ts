import { API_BASE } from "../config";
import type { ClipRange, DownloadJob, Health, MediaInfo, SaveFileHandle, ThumbnailSettings } from "../types";

let sessionReady: Promise<void> | null = null;
function ensureSession(): Promise<void> {
  if (!sessionReady) {
    // Establish the owner cookie before parallel requests or EventSource connections.
    sessionReady = fetch(`${API_BASE}/health`)
      .then((response) => {
        if (!response.ok)
          throw new Error(
            "The download service could not initialize this session.",
          );
      })
      .catch((error) => {
        sessionReady = null;
        throw error;
      });
  }
  return sessionReady;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    await ensureSession();
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error(
      "GSD could not reach the download service. Check that it is running and try again.",
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `The download service returned an error (${response.status}). Please try again.`,
    );
  return body as T;
}
const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
export const api = {
  health: () => request<Health>("/health"),
  info: (url: string, signal: AbortSignal) =>
    request<MediaInfo>("/info", { ...post({ url }), signal }),
  jobs: () => request<DownloadJob[]>("/jobs"),
  create: (url: string, optionId: string, saveToken?: string, settings?: ThumbnailSettings, clipRange?: ClipRange) =>
    request<DownloadJob>("/jobs", post({ url, optionId, saveToken, ...settings, ...(clipRange ? { clipRange } : {}) })),
  cancel: (id: string) =>
    request<DownloadJob>(`/jobs/${encodeURIComponent(id)}/cancel`, post()),
  retry: (id: string) =>
    request<DownloadJob>(`/jobs/${encodeURIComponent(id)}/retry`, post()),
  delivered: (id: string) =>
    request<DownloadJob>(`/jobs/${encodeURIComponent(id)}/delivered`, post({})),
  eventsUrl: () => `${API_BASE}/events`,
  fileUrl: (id: string) => `${API_BASE}/jobs/${encodeURIComponent(id)}/file`,
  thumbnailUrl: (id: string) => `${API_BASE}/jobs/${encodeURIComponent(id)}/thumbnail`,
};
export async function saveToHandle(
  id: string,
  handle: SaveFileHandle,
): Promise<{ acknowledged: boolean }> {
  const response = await fetch(api.fileUrl(id), {
    headers: { "X-GSD-Delivery-Ack": "manual" },
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error || "The file could not be saved. Try Save file again.",
    );
  }
  let writable: Awaited<ReturnType<SaveFileHandle["createWritable"]>>;
  try {
    writable = await handle.createWritable();
  } catch (error) {
    // A denied/lost file handle must release the response and the backend's transfer lock.
    await response.body.cancel().catch(() => undefined);
    throw error;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      await writable.write(value);
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  // The disk write is already committed. A transient acknowledgement failure must
  // not tell the user their saved file failed; the backend also has bounded expiry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await api.delivered(id);
      return { acknowledged: true };
    } catch {
      /* Delivery acknowledgement is idempotent and can safely be retried. */
    }
  }
  return { acknowledged: false };
}
export function downloadInBrowser(job: DownloadJob): void {
  const link = document.createElement("a");
  link.href = api.fileUrl(job.id);
  link.download = job.filename || `GSD.${job.format}`;
  document.body.append(link);
  link.click();
  link.remove();
}
export function downloadThumbnailInBrowser(job: DownloadJob): void {
  const link = document.createElement("a");
  link.href = api.thumbnailUrl(job.id);
  link.download = job.sidecarFilename || "GSD-thumbnail.jpg";
  document.body.append(link);
  link.click();
  link.remove();
}
