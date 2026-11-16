export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = "ApiError"; }
}
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "/api/v1").replace(/\/$/, "");
let csrfToken = "";
export function setCsrfToken(value: string) { csrfToken = value; }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method)) headers.set("x-csrf-token", csrfToken);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(8_000), headers, credentials: "include", cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Não foi possível alcançar o servidor. Verifique sua conexão.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login" && path !== "/auth/me" && typeof window !== "undefined") window.dispatchEvent(new Event("arh:unauthorized"));
    throw new ApiError(response.status, body.code || "API_ERROR", typeof body.message === "string" ? body.message : `O servidor respondeu com erro ${response.status}.`);
  }
  return body as T;
}
export function post<T>(path: string, body: unknown = {}) { return api<T>(path, { method: "POST", body: JSON.stringify(body) }); }
export function signalingUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    if (typeof window !== "undefined") {
      try {
        const ws = new URL(process.env.NEXT_PUBLIC_WS_URL);
        if ((ws.hostname === "localhost" || ws.hostname === "127.0.0.1") && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
          ws.hostname = window.location.hostname;
        }
        return ws.toString();
      } catch {}
    }
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  const url = new URL(`${API_BASE}/signaling`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
