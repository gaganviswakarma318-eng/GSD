export type MediaType = 'audio' | 'video';
export interface MediaOption {
  id: string;
  type: MediaType;
  format: string;
  quality: string;
  label: string;
  requiresConversion: boolean;
  estimatedSize?: number;
}
export interface MediaInfo {
  url: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  extractor: string;
  options: MediaOption[];
}
export type JobStatus = 'queued' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'delivered';
export interface DownloadJob {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  type: MediaType;
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
}
export interface Health { tools: { ytDlp: boolean; ffmpeg: boolean }; }
export interface SaveFileHandle {
  name: string;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface SaveDestination { token?: string; label: string; handle?: SaveFileHandle; }
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
