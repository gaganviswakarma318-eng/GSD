import { post, request } from "../api/request";
import type { MediaInfo } from "../types";

export const mediaApi = {
  info: (url: string, signal: AbortSignal) =>
    request<MediaInfo>("/info", { ...post({ url }), signal }),
};
