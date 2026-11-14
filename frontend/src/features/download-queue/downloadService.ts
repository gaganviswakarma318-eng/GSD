import { API_BASE } from "../../shared/config";
import { request, post } from "../../shared/api/request";
import type {
  ClipRange,
  DownloadJob,
  SaveFileHandle,
  ThumbnailSettings,
} from "../../shared/types";

export const downloadsApi = {
  jobs: () => request<DownloadJob[]>("/jobs"),
  create: (
    url: string,
    optionId: string,
    saveToken?: string,
    settings?: ThumbnailSettings,
    clipRange?: ClipRange,
  ) =>
    request<DownloadJob>(
      "/jobs",
      post({
        url,
        optionId,
        saveToken,
        ...settings,
        ...(clipRange ? { clipRange } : {}),
      }),
    ),
  cancel: (id: string) =>
    request<DownloadJob>(`/jobs/${encodeURIComponent(id)}/cancel`, post()),
  retry: (id: string) =>
    request<DownloadJob>(`/jobs/${encodeURIComponent(id)}/retry`, post()),
  delivered: (id: string) =>
    request<DownloadJob>(`/jobs/${encodeURIComponent(id)}/delivered`, post({})),
  eventsUrl: () => `${API_BASE}/events`,
  fileUrl: (id: string) =>
    `${API_BASE}/jobs/${encodeURIComponent(id)}/file`,
  thumbnailUrl: (id: string) =>
    `${API_BASE}/jobs/${encodeURIComponent(id)}/thumbnail`,
};

export async function saveToHandle(
  id: string,
  handle: SaveFileHandle,
): Promise<{ acknowledged: boolean }> {
  const response = await fetch(downloadsApi.fileUrl(id), {
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await downloadsApi.delivered(id);
      return { acknowledged: true };
    } catch {
      /* Delivery acknowledgement is idempotent and can safely be retried. */
    }
  }
  return { acknowledged: false };
}

export function downloadInBrowser(job: DownloadJob): void {
  const link = document.createElement("a");
  link.href = downloadsApi.fileUrl(job.id);
  link.download = job.filename || `GSD.${job.format}`;
  document.body.append(link);
  link.click();
  link.remove();
}

export function downloadThumbnailInBrowser(job: DownloadJob): void {
  const link = document.createElement("a");
  link.href = downloadsApi.thumbnailUrl(job.id);
  link.download = job.sidecarFilename || "GSD-thumbnail.jpg";
  document.body.append(link);
  link.click();
  link.remove();
}
