import { post, request } from "../api/request";
import type {
  InstagramInfo,
  InstagramQueueResult,
  InstagramSelection,
} from "../types";

export const instagramApi = {
  info: (url: string, signal: AbortSignal) =>
    request<InstagramInfo>("/instagram/info", { ...post({ url }), signal }),
  queue: (
    url: string,
    items: InstagramSelection[],
    saveToken?: string,
  ) =>
    request<InstagramQueueResult>(
      "/instagram/jobs",
      post({ url, items, saveToken }),
    ),
};
