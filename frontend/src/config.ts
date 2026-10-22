export const API_BASE = '/api';
export const METADATA_CACHE_MS = 10 * 60 * 1000;
export const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'processing']);
export const isDesktop = Boolean(window.gsd);
