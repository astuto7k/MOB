export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const FILE_CHUNK_BYTES = 16 * 1024;
export interface FileOffer { type: "file-offer"; id: string; name: string; size: number; sha256: string; direction: "upload" | "download" }
export function validOffer(value: unknown): value is FileOffer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.type === "file-offer" && typeof v.id === "string" && /^[A-Za-z0-9-]{1,128}$/.test(v.id)
    && typeof v.name === "string" && v.name.length > 0 && v.name.length <= 255 && !/[\x00-\x1f/\\]/.test(v.name)
    && typeof v.size === "number" && Number.isSafeInteger(v.size) && v.size >= 0 && v.size <= MAX_FILE_BYTES
    && typeof v.sha256 === "string" && /^[a-f0-9]{64}$/.test(v.sha256)
    && (v.direction === "upload" || v.direction === "download");
}
export function contentPoint(x: number, y: number, rect: { left: number; top: number; width: number; height: number }, videoWidth: number, videoHeight: number): { x: number; y: number } | null {
  if (videoWidth <= 0 || videoHeight <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const width = videoWidth * scale, height = videoHeight * scale;
  const left = rect.left + (rect.width - width) / 2, top = rect.top + (rect.height - height) / 2;
  const px = (x - left) / width, py = (y - top) / height;
  return px < 0 || py < 0 || px > 1 || py > 1 ? null : { x: px, y: py };
}
export async function sha256(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
