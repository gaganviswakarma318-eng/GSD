export type MediaType = "audio" | "video" | "image";
export type InstagramContentType =
  | "photo"
  | "carousel"
  | "video"
  | "reel"
  | "story"
  | "highlight"
  | "profile";
export interface MediaOption {
  id: string;
  type: MediaType;
  format: string;
  quality: string;
  label: string;
  requiresConversion: boolean;
  estimatedSize?: number;
  thumbnailSupport: {
    supported: boolean;
    method: string | null;
    reason: string;
  };
}
export interface ThumbnailSettings {
  embedThumbnail?: boolean;
  thumbnailSidecar?: boolean;
}
export interface ClipRange {
  startSeconds: number;
  endSeconds: number;
}
export interface MediaInfo {
  url: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  extractor: string;
  creator?: string | null;
  viewCount?: number | null;
  options: MediaOption[];
}
export interface InstagramMediaItem {
  id: string;
  index: number;
  kind: "image" | "video";
  title: string;
  thumbnail: string | null;
  duration: number | null;
  options: MediaOption[];
  error: string | null;
}
export interface InstagramInfo {
  url: string;
  contentType: InstagramContentType;
  title: string;
  creator: string | null;
  items: InstagramMediaItem[];
}
export interface InstagramSelection {
  itemId: string;
  optionId: string;
}
export interface InstagramQueueResult {
  jobs: DownloadJob[];
  errors: Array<{ itemId: string; error: string }>;
}
export type JobStatus =
  | "queued"
  | "downloading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "delivered";
export interface DownloadJob {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  type: MediaType;
  source?: "instagram";
  format: string;
  quality: string;
  status: JobStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBytes: number | null;
  etaSeconds: number | null;
  queuePosition: number | null;
  attempt: number;
  error: string | null;
  filename: string | null;
  createdAt: number;
  updatedAt: number;
  savedPath?: string;
  embedThumbnail: boolean;
  thumbnailSidecar: boolean;
  stage: string | null;
  warnings: string[];
  thumbnailEmbedded: boolean;
  sidecarFilename?: string | null;
  sidecarSavedPath?: string;
  sidecarDelivered?: boolean;
  clipRange?: ClipRange | null;
}
export interface Health {
  tools: { ytDlp: boolean; ffmpeg: boolean };
}
export interface SaveFileHandle {
  name: string;
  createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
export interface SaveDestination {
  token?: string;
  label: string;
  handle?: SaveFileHandle;
}
declare global {
  interface Window {
    gsd?: {
      chooseDirectory(): Promise<{ token: string; label: string } | null>;
      revealFile(jobId: string): Promise<void>;
    };
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<SaveFileHandle>;
  }
}
