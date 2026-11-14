import { API_BASE } from "../config";

let sessionReady: Promise<void> | null = null;

function ensureSession(): Promise<void> {
  if (!sessionReady) {
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

export async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
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

export const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
