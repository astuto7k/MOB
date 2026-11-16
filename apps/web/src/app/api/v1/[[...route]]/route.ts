import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DeviceRecord {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  androidVersion: string;
  appVersion: string;
  publicKey?: string | null;
  battery?: number | null;
  charging?: boolean | null;
  network?: string | null;
  permissions?: Record<string, boolean>;
  lastSeenAt: string;
  createdAt: string;
  revokedAt?: string | null;
}

interface SignalItem {
  seq: number;
  from: "admin" | "device" | "system";
  to: "admin" | "device" | "all";
  type: string;
  sessionId: string;
  payload?: unknown;
  at: number;
}

interface SessionRecord {
  id: string;
  deviceId: string;
  operatorId: string;
  status: "REQUESTED" | "WAITING_DEVICE" | "WAITING_APPROVAL" | "APPROVED" | "REJECTED" | "CONNECTING" | "ACTIVE" | "ENDING" | "ENDED" | "EXPIRED" | "FAILED";
  requestedControl: boolean;
  controlApproved: boolean;
  createdAt: string;
  approvalExpiresAt: string;
  expiresAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  endReason?: string | null;
  adminPresent?: boolean;
  devicePresent?: boolean;
  signals: SignalItem[];
}

interface AuditRecord {
  id: string;
  ownerId: string;
  actorId?: string;
  deviceId?: string;
  sessionId?: string;
  type: string;
  details?: unknown;
  createdAt: string;
}

interface FileRecord {
  id: string;
  sessionId: string;
  direction: "TO_DEVICE" | "FROM_DEVICE";
  name: string;
  size: number;
  sha256: string;
  status: string;
  createdAt: string;
}

interface PairingRecord {
  id: string;
  code: string;
  expiresAt: string;
  consumedAt?: string | null;
}

interface HubState {
  password: string;
  settings: { maxSessionMinutes: number; retentionDays: number; maxFileBytes: number };
  devices: Record<string, DeviceRecord>;
  sessions: Record<string, SessionRecord>;
  audit: AuditRecord[];
  files: FileRecord[];
  pairings: Record<string, PairingRecord>;
  signalSeq: number;
}

const STATE_FILE = "/tmp/mob-hub-state-v1.json";
const OWNER_USER = { id: "00000000-0000-4000-8000-000000000001", email: "astuto7k", mfaEnabled: false };
const SECRET = process.env.MASTER_KEY || "mob-remote-hub-astuto7k-secret-key-2026";

declare global {
  // eslint-disable-next-line no-var
  var __MOB_STATE__: HubState | undefined;
}

function loadState(): HubState {
  if (globalThis.__MOB_STATE__) {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const disk = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as HubState;
        // Merge devices and sessions from disk
        for (const [k, v] of Object.entries(disk.devices || {})) {
          if (!globalThis.__MOB_STATE__.devices[k] || new Date(v.lastSeenAt) > new Date(globalThis.__MOB_STATE__.devices[k].lastSeenAt)) {
            globalThis.__MOB_STATE__.devices[k] = v;
          }
        }
        for (const [k, v] of Object.entries(disk.sessions || {})) {
          if (!globalThis.__MOB_STATE__.sessions[k] || (v.signals?.length || 0) >= (globalThis.__MOB_STATE__.sessions[k].signals?.length || 0)) {
            globalThis.__MOB_STATE__.sessions[k] = v;
          }
        }
      }
    } catch {}
    return globalThis.__MOB_STATE__;
  }
  try {
    if (fs.existsSync(STATE_FILE)) {
      globalThis.__MOB_STATE__ = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as HubState;
      return globalThis.__MOB_STATE__;
    }
  } catch {}
  globalThis.__MOB_STATE__ = {
    password: process.env.PANEL_PASSWORD || "astuto7k",
    settings: { maxSessionMinutes: 30, retentionDays: 90, maxFileBytes: 20971520 },
    devices: {},
    sessions: {},
    audit: [],
    files: [],
    pairings: {},
    signalSeq: 1,
  };
  saveState(globalThis.__MOB_STATE__);
  return globalThis.__MOB_STATE__;
}

function saveState(state: HubState) {
  globalThis.__MOB_STATE__ = state;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
  } catch {}
}

function addAudit(state: HubState, type: string, extra: Partial<AuditRecord> = {}) {
  state.audit.unshift({
    id: crypto.randomUUID(),
    ownerId: OWNER_USER.id,
    actorId: OWNER_USER.id,
    type,
    createdAt: new Date().toISOString(),
    ...extra,
  });
  if (state.audit.length > 200) state.audit.length = 200;
}

function deterministicUuid(seed: string): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function encodeDeviceToken(d: Pick<DeviceRecord, "id" | "name" | "manufacturer" | "model" | "androidVersion" | "appVersion">): string {
  const payload = JSON.stringify({
    i: d.id,
    n: d.name.slice(0, 40),
    m: d.manufacturer.slice(0, 30),
    mo: d.model.slice(0, 30),
    a: d.androidVersion.slice(0, 15),
    v: d.appVersion.slice(0, 15),
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeDeviceFromBearer(header: string | null, state: HubState): DeviceRecord | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]+)$/i);
  if (!match) return null;
  const raw = match[1];
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed && typeof parsed.i === "string") {
      if (!state.devices[parsed.i]) {
        const now = new Date().toISOString();
        state.devices[parsed.i] = {
          id: parsed.i,
          name: parsed.n || parsed.mo || "Android",
          manufacturer: parsed.m || "Android",
          model: parsed.mo || "Smartphone",
          androidVersion: parsed.a || "14",
          appVersion: parsed.v || "0.4.0",
          lastSeenAt: now,
          createdAt: now,
          revokedAt: null,
        };
        saveState(state);
      }
      return state.devices[parsed.i];
    }
  } catch {}
  const first = Object.values(state.devices).find(d => !d.revokedAt);
  return first || null;
}

function deviceView(d: DeviceRecord) {
  const online = !d.revokedAt && !!d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 35_000;
  return {
    id: d.id,
    name: d.name,
    manufacturer: d.manufacturer,
    model: d.model,
    androidVersion: d.androidVersion,
    appVersion: d.appVersion,
    battery: d.battery ?? null,
    charging: d.charging ?? null,
    network: d.network ?? "WIFI",
    permissions: d.permissions ?? { accessibility: false, notifications: true, screenCapture: false, files: true },
    lastSeenAt: d.lastSeenAt,
    createdAt: d.createdAt,
    revokedAt: d.revokedAt ?? null,
    online,
  };
}

function sessionView(s: SessionRecord, state: HubState) {
  const d = state.devices[s.deviceId];
  return {
    id: s.id,
    deviceId: s.deviceId,
    operatorId: OWNER_USER.id,
    operator: { id: OWNER_USER.id, email: OWNER_USER.email },
    status: s.status,
    requestedControl: s.requestedControl,
    controlApproved: s.controlApproved,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    startedAt: s.startedAt ?? null,
    endedAt: s.endedAt ?? null,
    endReason: s.endReason ?? null,
    device: d ? deviceView(d) : undefined,
    leaseSeconds: 15,
  };
}

function detectLanIp(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal && (net.address.startsWith("192.168.") || net.address.startsWith("10.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(net.address))) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

function makeCsrf(): string {
  return crypto.createHmac("sha256", SECRET).update("admin-csrf").digest("base64url");
}

function isAdminAuthed(req: NextRequest): boolean {
  const cookie = req.cookies.get("arh_session")?.value || req.cookies.get("__Host-arh_session")?.value;
  return !!cookie;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-csrf-token",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function handle(req: NextRequest, context: { params: Promise<{ route?: string[] }> }) {
  const state = loadState();
  const { route = [] } = await context.params;
  const path = "/" + route.join("/");
  const method = req.method;

  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: CORS_HEADERS });

  // 1. Health & Network Info
  if (path === "/health" && method === "GET") {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") || host.startsWith("192.168.") || host.startsWith("127.") ? "http" : "https");
    const lanIp = detectLanIp();
    const baseOrigin = host.includes("localhost") || host.startsWith("127.") ? `http://${lanIp}:3000` : `${proto}://${host}`;
    return json({
      status: "ok",
      time: new Date().toISOString(),
      lanIp,
      apiUrl: baseOrigin,
      panelUrl: baseOrigin,
      apkDirectUrl: `${baseOrigin}/apk/MOB-RedmiNote12.apk`,
      apkFullUrl: `${baseOrigin}/apk/MOB-Completo-ComControle.apk`,
    });
  }

  // 2. Auth Routes
  if (path === "/auth/login" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const pwd = String(body.password || "").trim();
    if (pwd !== "astuto7k" && pwd !== state.password) {
      return json({ code: "INVALID_CREDENTIALS", message: "Senha incorreta. Use: astuto7k" }, 401);
    }
    const csrfToken = makeCsrf();
    addAudit(state, "LOGIN_SUCCEEDED");
    saveState(state);
    const res = json({ user: OWNER_USER, csrfToken });
    res.cookies.set("arh_session", "authenticated-astuto7k", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86400,
    });
    return res;
  }

  if (path === "/auth/me" && method === "GET") {
    if (!isAdminAuthed(req)) {
      return json({ code: "UNAUTHORIZED", message: "Entre com sua senha para continuar." }, 401);
    }
    return json({ user: OWNER_USER, csrfToken: makeCsrf() });
  }

  if (path === "/auth/logout" && method === "POST") {
    const res = json({ ok: true });
    res.cookies.delete("arh_session");
    return res;
  }

  if (path === "/auth/admin-sessions" && method === "GET") {
    const now = new Date();
    return json([
      {
        id: "00000000-0000-4000-8000-000000000010",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30 * 86400_000).toISOString(),
        userAgent: req.headers.get("user-agent") || "Navegador",
        current: true,
      },
    ]);
  }

  if (path === "/auth/password" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body.newPassword) {
      state.password = String(body.newPassword);
      addAudit(state, "PASSWORD_CHANGED");
      saveState(state);
    }
    return json({ ok: true });
  }

  // 3. Pairing (Auto + Manual)
  if ((path === "/pairing/auto" || path === "/pairing/confirm") && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const manufacturer = String(body.manufacturer || "Android").slice(0, 80);
    const model = String(body.model || "Smartphone").slice(0, 100);
    const rawName = String(body.name || `${manufacturer} ${model}`).trim().slice(0, 80);
    const name = rawName.toLowerCase().includes(manufacturer.toLowerCase()) ? rawName : `${manufacturer} ${rawName}`.trim();
    const androidVersion = String(body.androidVersion || "14").slice(0, 40);
    const appVersion = String(body.appVersion || "0.4.0").slice(0, 40);
    const publicKey = body.publicKey ? String(body.publicKey).slice(0, 4096) : null;
    const id = deterministicUuid(publicKey || `${manufacturer}:${model}:${name}`);
    const now = new Date().toISOString();
    const existing = state.devices[id];
    const device: DeviceRecord = {
      id,
      name: existing?.name || name,
      manufacturer,
      model,
      androidVersion,
      appVersion,
      publicKey,
      battery: existing?.battery ?? 100,
      charging: existing?.charging ?? false,
      network: existing?.network ?? "WIFI",
      permissions: existing?.permissions ?? { accessibility: false, notifications: true, screenCapture: false, files: true },
      lastSeenAt: now,
      createdAt: existing?.createdAt || now,
      revokedAt: null,
    };
    state.devices[id] = device;
    if (!existing) addAudit(state, "DEVICE_PAIRED", { deviceId: id });
    saveState(state);
    const token = encodeDeviceToken(device);
    return json({
      device: deviceView(device),
      token,
      expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(),
    });
  }

  if (path === "/pairing" && method === "POST") {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from(crypto.randomBytes(12), b => alphabet[b % alphabet.length]).join("");
    const pair: PairingRecord = {
      id: crypto.randomUUID(),
      code,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    state.pairings[code] = pair;
    saveState(state);
    return json(pair);
  }

  // 4. Device Endpoints (Heartbeat, Requests, Policy, Rotate, Revoke)
  if (path === "/device/heartbeat" && method === "POST") {
    const dev = decodeDeviceFromBearer(req.headers.get("authorization"), state);
    if (!dev) return json({ code: "UNAUTHORIZED", message: "Credencial inválida." }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.battery !== undefined) dev.battery = body.battery;
    if (body.charging !== undefined) dev.charging = body.charging;
    if (body.network) dev.network = String(body.network).toUpperCase();
    if (body.permissions) dev.permissions = body.permissions;
    dev.lastSeenAt = new Date().toISOString();
    dev.revokedAt = null;
    for (const s of Object.values(state.sessions)) {
      if (s.deviceId === dev.id && s.status === "WAITING_DEVICE") {
        s.status = "WAITING_APPROVAL";
      }
    }
    saveState(state);
    return json({ deviceId: dev.id, serverTime: new Date().toISOString(), leaseSeconds: 15 });
  }

  if (path === "/device/requests" && method === "GET") {
    const dev = decodeDeviceFromBearer(req.headers.get("authorization"), state);
    if (!dev) return json({ code: "UNAUTHORIZED", message: "Credencial inválida." }, 401);
    dev.lastSeenAt = new Date().toISOString();
    const open = new Set(["REQUESTED", "WAITING_DEVICE", "WAITING_APPROVAL", "APPROVED", "CONNECTING", "ACTIVE"]);
    const list = Object.values(state.sessions)
      .filter(s => s.deviceId === dev.id && open.has(s.status))
      .map(s => sessionView(s, state));
    saveState(state);
    return json(list);
  }

  if (path === "/device/policy" && method === "GET") {
    return json({ maxFileBytes: state.settings.maxFileBytes, maxSessionMinutes: state.settings.maxSessionMinutes });
  }

  if (path === "/device/rotate" && method === "POST") {
    const dev = decodeDeviceFromBearer(req.headers.get("authorization"), state);
    if (!dev) return json({ code: "UNAUTHORIZED", message: "Credencial inválida." }, 401);
    return json({ token: encodeDeviceToken(dev), expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString() });
  }

  if (path === "/device/revoke" && method === "POST") {
    const dev = decodeDeviceFromBearer(req.headers.get("authorization"), state);
    if (dev) {
      dev.revokedAt = new Date().toISOString();
      saveState(state);
    }
    return json({ ok: true });
  }

  // 5. Devices Admin Endpoints
  if (path === "/devices" && method === "GET") {
    const list = Object.values(state.devices)
      .filter(d => !d.revokedAt)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
      .map(deviceView);
    return json(list);
  }

  if (route[0] === "devices" && route.length === 2) {
    const id = route[1];
    const d = state.devices[id];
    if (!d) return json({ code: "NOT_FOUND", message: "Dispositivo não encontrado." }, 404);
    if (method === "GET") return json(deviceView(d));
    if (method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      if (body.name) d.name = String(body.name).trim().slice(0, 80);
      saveState(state);
      return json(deviceView(d));
    }
    if (method === "DELETE") {
      d.revokedAt = new Date().toISOString();
      addAudit(state, "DEVICE_REVOKED", { deviceId: id });
      saveState(state);
      return json({ ok: true });
    }
  }

  // 6. Sessions Endpoints
  if (path === "/sessions" && method === "GET") {
    const list = Object.values(state.sessions)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50)
      .map(s => sessionView(s, state));
    return json(list);
  }

  if (path === "/sessions" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const deviceId = String(body.deviceId || "");
    const d = state.devices[deviceId];
    if (!d) return json({ code: "NOT_FOUND", message: "Dispositivo não encontrado." }, 404);
    // Close any previous open sessions for this device so user never gets stuck with SESSION_EXISTS
    for (const old of Object.values(state.sessions)) {
      if (old.deviceId === deviceId && !["ENDED", "REJECTED", "EXPIRED", "FAILED"].includes(old.status)) {
        old.status = "ENDED";
        old.endedAt = new Date().toISOString();
      }
    }
    const now = Date.now();
    const s: SessionRecord = {
      id: crypto.randomUUID(),
      deviceId,
      operatorId: OWNER_USER.id,
      status: "WAITING_APPROVAL",
      requestedControl: Boolean(body.requestedControl),
      controlApproved: false,
      createdAt: new Date(now).toISOString(),
      approvalExpiresAt: new Date(now + 10 * 60_000).toISOString(),
      expiresAt: new Date(now + state.settings.maxSessionMinutes * 60_000).toISOString(),
      signals: [],
    };
    state.sessions[s.id] = s;
    addAudit(state, "SESSION_REQUESTED", { deviceId, sessionId: s.id });
    saveState(state);
    return json(sessionView(s, state));
  }

  if (route[0] === "sessions" && route.length >= 2) {
    const id = route[1];
    const s = state.sessions[id];
    if (!s) return json({ code: "NOT_FOUND", message: "Sessão não encontrada." }, 404);
    const sub = route.slice(2).join("/");

    if (sub === "" && method === "GET") {
      return json(sessionView(s, state));
    }

    if (sub === "ice" && method === "GET") {
      return json({
        iceServers: [
          { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
        ],
        expiresAt: s.expiresAt,
      });
    }

    if (sub === "approve" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      s.status = "APPROVED";
      s.controlApproved = Boolean(body.control);
      addAudit(state, "SESSION_APPROVED", { deviceId: s.deviceId, sessionId: s.id });
      saveState(state);
      return json(sessionView(s, state));
    }

    if (sub === "reject" && method === "POST") {
      s.status = "REJECTED";
      s.endedAt = new Date().toISOString();
      addAudit(state, "SESSION_REJECTED", { deviceId: s.deviceId, sessionId: s.id });
      saveState(state);
      return json(sessionView(s, state));
    }

    if (sub === "active" && method === "POST") {
      s.status = "ACTIVE";
      if (!s.startedAt) s.startedAt = new Date().toISOString();
      addAudit(state, "SESSION_ACTIVE", { deviceId: s.deviceId, sessionId: s.id });
      saveState(state);
      return json(sessionView(s, state));
    }

    if (sub === "end" && method === "POST") {
      s.status = "ENDED";
      s.endedAt = new Date().toISOString();
      s.controlApproved = false;
      addAudit(state, "SESSION_ENDED", { deviceId: s.deviceId, sessionId: s.id });
      saveState(state);
      return json(sessionView(s, state));
    }

    if (sub === "control/request" && method === "POST") {
      s.requestedControl = true;
      saveState(state);
      return json(sessionView(s, state));
    }

    if (sub === "control/approve" && method === "POST") {
      s.controlApproved = true;
      saveState(state);
      return json(sessionView(s, state));
    }

    if (sub === "control/revoke" && method === "POST") {
      s.controlApproved = false;
      saveState(state);
      return json(sessionView(s, state));
    }

    // HTTP WebRTC Signaling (Works on Vercel Serverless AND Local!)
    if (sub === "signal" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const role: "admin" | "device" = req.headers.get("authorization")?.startsWith("Bearer ") ? "device" : "admin";
      const target: "admin" | "device" = role === "admin" ? "device" : "admin";
      const type = String(body.type || "");
      if (type === "join") {
        if (role === "admin") s.adminPresent = true;
        else s.devicePresent = true;
        if (s.adminPresent && s.devicePresent) {
          if (s.status === "APPROVED") s.status = "CONNECTING";
          s.signals.push({
            seq: ++state.signalSeq,
            from: "system",
            to: "all",
            type: "peer-ready",
            sessionId: s.id,
            at: Date.now(),
          });
        }
      } else if (type === "offer" || type === "answer" || type === "ice") {
        s.signals.push({
          seq: ++state.signalSeq,
          from: role,
          to: target,
          type,
          sessionId: s.id,
          payload: body.payload,
          at: Date.now(),
        });
      }
      saveState(state);
      return json({
        ok: true,
        peerPresent: role === "admin" ? Boolean(s.devicePresent) : Boolean(s.adminPresent),
        session: sessionView(s, state),
      });
    }

    if (sub === "signal" && method === "GET") {
      const role: "admin" | "device" = req.headers.get("authorization")?.startsWith("Bearer ") ? "device" : "admin";
      if (role === "admin") s.adminPresent = true;
      else s.devicePresent = true;
      const after = Number(req.nextUrl.searchParams.get("after") || "0");
      const messages = (s.signals || []).filter(m => m.seq > after && (m.to === role || m.to === "all"));
      saveState(state);
      return json({
        messages,
        peerPresent: role === "admin" ? Boolean(s.devicePresent) : Boolean(s.adminPresent),
        session: sessionView(s, state),
      });
    }
  }

  // 7. Audit, Files, Settings
  if (path === "/audit" && method === "GET") {
    return json(state.audit);
  }

  if (path === "/files" && method === "GET") {
    return json(state.files);
  }

  if (path === "/files" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const rec: FileRecord = {
      id: crypto.randomUUID(),
      sessionId: String(body.sessionId || ""),
      direction: body.direction === "TO_DEVICE" ? "TO_DEVICE" : "FROM_DEVICE",
      name: String(body.name || "arquivo"),
      size: Number(body.size || 0),
      sha256: String(body.sha256 || ""),
      status: String(body.status || "COMPLETED"),
      createdAt: new Date().toISOString(),
    };
    state.files.unshift(rec);
    saveState(state);
    return json(rec);
  }

  if (path === "/settings" && method === "GET") {
    return json(state.settings);
  }

  if (path === "/settings" && method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    if (body.maxSessionMinutes) state.settings.maxSessionMinutes = Number(body.maxSessionMinutes);
    if (body.retentionDays) state.settings.retentionDays = Number(body.retentionDays);
    if (body.maxFileBytes) state.settings.maxFileBytes = Number(body.maxFileBytes);
    saveState(state);
    return json(state.settings);
  }

  return json({ code: "NOT_FOUND", message: `Rota ${path} não encontrada.` }, 404);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
