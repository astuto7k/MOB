export interface User { id: string; email: string; mfaEnabled: boolean }
export interface Device {
  id: string; name: string; manufacturer: string; model: string;
  androidVersion: string; appVersion: string; lastSeenAt?: string | null;
  revokedAt?: string | null; battery?: number | null; charging?: boolean | null;
  network?: string | null; online?: boolean;
  capabilities?: Record<string, boolean>; permissions?: Record<string, boolean>;
  createdAt?: string;
}
export interface RemoteSession {
  id: string; deviceId: string; status: string; requestedControl: boolean;
  controlApproved: boolean; expiresAt: string; createdAt: string;
  startedAt?: string | null; endedAt?: string | null; device?: Device;
}
export interface AuditEvent { id: string; type: string; createdAt: string; actorId?: string; deviceId?: string; sessionId?: string; details?: Record<string, unknown> }
export interface Pairing { id: string; code: string; expiresAt: string }
export interface AdminSession { id: string; createdAt: string; expiresAt: string; userAgent?: string; current: boolean }
export interface Settings { maxSessionMinutes: number; retentionDays: number; maxFileBytes: number }
export function deviceOnline(device: Device) {
  if (device.revokedAt) return false;
  if (typeof device.online === "boolean") return device.online;
  return !!device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 45000;
}
