import { request } from "../shared/api/request";
import type { Health } from "../shared/types";

export const healthApi = {
  health: () => request<Health>("/health"),
};
