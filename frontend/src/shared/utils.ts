export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value <= 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${["B", "KB", "MB", "GB"][unit]}`;
}
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const n = Math.max(0, Math.round(seconds));
  const hours = Math.floor(n / 3600);
  const minutes = Math.floor((n % 3600) / 60);
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(n % 60).padStart(2, "0")}`;
}
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
export function parseTimecode(value: string): number | null {
  const parts = value.trim().split(":");
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !/^\d+$/.test(part))
  )
    return null;
  const numbers = parts.map(Number);
  const seconds = numbers.at(-1)!;
  const minutes = numbers.at(-2)!;
  if (seconds > 59 || (parts.length === 3 && minutes > 59)) return null;
  return parts.length === 3
    ? numbers[0] * 3600 + minutes * 60 + seconds
    : minutes * 60 + seconds;
}
export function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "Calculating time…";
  if (seconds < 1) return "Almost there";
  if (seconds < 60) return `${Math.ceil(seconds)} sec left`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min left`;
  return `${Math.floor(seconds / 3600)} hr ${Math.ceil((seconds % 3600) / 60)} min left`;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export function validMediaUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function suggestedFilename(title: string, format: string): string {
  return `${
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/[. ]+$/g, "")
      .slice(0, 150) || "GSD download"
  }.${format}`;
}
