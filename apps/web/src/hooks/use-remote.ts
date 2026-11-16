"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, post } from "@/lib/api";
import type { RemoteSession } from "@/lib/types";
import { terminalStates } from "@/lib/utils";
import { FILE_CHUNK_BYTES, MAX_FILE_BYTES, sha256, validOffer, type FileOffer } from "@/lib/protocol";

export interface TransferView { id: string; name: string; size: number; transferred: number; direction: "upload" | "download"; phase: string; error?: string; url?: string }
interface Transfer extends TransferView { offer: FileOffer; parts: ArrayBuffer[]; buffer?: ArrayBuffer; canceled?: boolean }

export function useRemote(session: RemoteSession | undefined, refresh: () => void, maxFileBytes = MAX_FILE_BYTES) {
  const [stream, setStream] = useState<MediaStream>();
  const [connection, setConnection] = useState("Aguardando autorização");
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState<{ latency?: number; fps?: number; width?: number; height?: number; relay?: boolean }>({});
  const [transfer, setTransfer] = useState<TransferView>();
  const [controlAvailable, setControlAvailable] = useState(false);
  const [filesAvailable, setFilesAvailable] = useState(false);
  const pcRef = useRef<RTCPeerConnection | undefined>(undefined);
  const controlRef = useRef<RTCDataChannel | undefined>(undefined);
  const filesRef = useRef<RTCDataChannel | undefined>(undefined);
  const transferRef = useRef<Transfer | undefined>(undefined);
  const sessionRef = useRef(session);
  const verifiedRef = useRef(0);
  const seqRef = useRef(0);
  const startedRef = useRef(false);
  const activeUrls = useRef<string[]>([]);
  const fileLimitRef = useRef(maxFileBytes);

  useEffect(() => { sessionRef.current = session; if (session) verifiedRef.current = Date.now(); }, [session]);
  useEffect(() => { fileLimitRef.current = Math.min(maxFileBytes, MAX_FILE_BYTES); }, [maxFileBytes]);

  const updateTransfer = useCallback((value: Transfer | undefined) => {
    transferRef.current = value;
    setTransfer(value ? { id: value.id, name: value.name, size: value.size, transferred: value.transferred, direction: value.direction, phase: value.phase, error: value.error, url: value.url } : undefined);
  }, []);

  const audit = useCallback((value: Transfer, status: string) => {
    const current = sessionRef.current;
    if (!current) return;
    void post("/files", { sessionId: current.id, name: value.name, size: value.size, sha256: value.offer.sha256, direction: value.direction === "upload" ? "TO_DEVICE" : "FROM_DEVICE", status }).catch(() => {});
  }, []);

  const close = useCallback(() => {
    controlRef.current?.close(); filesRef.current?.close(); pcRef.current?.close();
    setStream(undefined); setControlAvailable(false); setFilesAvailable(false);
    const pending = transferRef.current;
    if (pending && !["Concluído", "Cancelado", "Falhou"].includes(pending.phase)) { pending.canceled = true; pending.phase = "Cancelado"; updateTransfer({ ...pending }); }
  }, [updateTransfer]);

  const cancelTransfer = useCallback(() => {
    const current = transferRef.current;
    if (!current) return;
    current.canceled = true;
    if (filesRef.current?.readyState === "open") filesRef.current.send(JSON.stringify({ type: "file-cancel", id: current.id }));
    current.phase = "Cancelado"; updateTransfer({ ...current }); audit(current, "CANCELED");
  }, [audit, updateTransfer]);

  useEffect(() => {
    if (!session || terminalStates.has(session.status) || session.status === "ENDING") {
      if (startedRef.current) { close(); setConnection("Sessão encerrada"); startedRef.current = false; }
      return;
    }
    if (!["APPROVED", "CONNECTING", "ACTIVE"].includes(session.status) || startedRef.current) return;
    startedRef.current = true;
    let canceled = false;
    let statsTimer: ReturnType<typeof setInterval> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let polling = false;
    let offered = false;
    let lastSeq = 0;
    const iceQueue: RTCIceCandidateInit[] = [];
    const fail = (message: string) => { setError(message); setConnection("Conexão interrompida"); close(); };
    verifiedRef.current = Date.now();
    const leaseTimer = setInterval(() => {
      if (Date.now() - verifiedRef.current >= 10_000) {
        canceled = true;
        if (pollTimer) clearInterval(pollTimer);
        if (leaseTimer) clearInterval(leaseTimer);
        fail("A autorização do servidor expirou. Inicie uma nova sessão.");
      }
    }, 1000);

    const start = async () => {
      try {
        const configuration = await api<{ iceServers: RTCIceServer[] }>(`/sessions/${session.id}/ice`);
        if (canceled) return;
        const pc = new RTCPeerConnection({ iceServers: configuration.iceServers });
        pcRef.current = pc;
        pc.addTransceiver("video", { direction: "recvonly" });
        const control = pc.createDataChannel("control", { ordered: true });
        const files = pc.createDataChannel("files", { ordered: true });
        controlRef.current = control; filesRef.current = files; files.binaryType = "arraybuffer";
        control.onopen = () => setControlAvailable(true); control.onclose = () => setControlAvailable(false);
        control.onmessage = event => { try { const message = JSON.parse(event.data); if (message.type === "control-error" || message.type === "control-result" && message.ok === false) setError(message.message || "O Android recusou esta ação."); } catch {} };
        files.onopen = () => setFilesAvailable(true); files.onclose = () => setFilesAvailable(false);
        files.onmessage = async event => {
          const currentSession = sessionRef.current;
          if (!currentSession || currentSession.status !== "ACTIVE") return;
          try {
            if (typeof event.data === "string") {
              const message = JSON.parse(event.data);
              if (message.type === "file-offer") {
                const previous = transferRef.current;
                if (!validOffer(message) || message.size > fileLimitRef.current || message.direction !== "download" || (previous && !["Concluído", "Cancelado", "Falhou"].includes(previous.phase))) throw new Error("Oferta de arquivo inválida ou transferência já em andamento.");
                const next: Transfer = { ...message, offer: message, transferred: 0, parts: [], phase: "Recebendo" };
                updateTransfer(next); audit(next, "REQUESTED");
                files.send(JSON.stringify({ type: "file-accept", id: message.id }));
              } else if (message.type === "file-accept") {
                const current = transferRef.current;
                if (!current || current.id !== message.id || current.direction !== "upload" || !current.buffer || current.canceled) return;
                current.phase = "Enviando"; updateTransfer({ ...current });
                for (let offset = 0; offset < current.buffer.byteLength; offset += FILE_CHUNK_BYTES) {
                  while (files.bufferedAmount > 256 * 1024) {
                    if (current.canceled || files.readyState !== "open" || sessionRef.current?.status !== "ACTIVE") return;
                    await new Promise<void>(resolve => setTimeout(resolve, 25));
                  }
                  if (current.canceled || files.readyState !== "open" || sessionRef.current?.status !== "ACTIVE") return;
                  const chunk = current.buffer.slice(offset, offset + FILE_CHUNK_BYTES);
                  files.send(chunk); current.transferred += chunk.byteLength; updateTransfer({ ...current });
                }
                current.phase = "Verificando integridade"; updateTransfer({ ...current });
                files.send(JSON.stringify({ type: "file-complete", id: current.id }));
              } else if (message.type === "file-complete") {
                const current = transferRef.current;
                if (!current || current.id !== message.id || current.direction !== "download" || current.canceled) return;
                if (current.transferred !== current.size) throw new Error("O tamanho do arquivo recebido está incorreto.");
                const buffer = new ArrayBuffer(current.size), bytes = new Uint8Array(buffer);
                let offset = 0; for (const part of current.parts) { bytes.set(new Uint8Array(part), offset); offset += part.byteLength; }
                if (await sha256(buffer) !== current.offer.sha256) throw new Error("O arquivo foi recusado porque a verificação SHA-256 falhou.");
                if (current.canceled || files.readyState !== "open" || sessionRef.current?.status !== "ACTIVE") return;
                current.url = URL.createObjectURL(new Blob([buffer])); activeUrls.current.push(current.url);
                current.phase = "Concluído"; current.parts = []; updateTransfer({ ...current }); audit(current, "COMPLETED");
                files.send(JSON.stringify({ type: "file-result", id: current.id, ok: true }));
              } else if (message.type === "file-result" || message.type === "file-cancel") {
                const current = transferRef.current;
                if (!current || current.id !== message.id) return;
                current.phase = message.type === "file-cancel" ? "Cancelado" : message.ok ? "Concluído" : "Falhou";
                current.error = message.error; current.buffer = undefined; updateTransfer({ ...current }); audit(current, message.type === "file-cancel" ? "CANCELED" : message.ok ? "COMPLETED" : "FAILED");
              } else if (message.type === "file-error") throw new Error(message.message || "O Android não conseguiu compartilhar o arquivo.");
            } else {
              const current = transferRef.current;
              if (!current || current.direction !== "download" || current.canceled || current.phase !== "Recebendo" || !(event.data instanceof ArrayBuffer)) return;
              if (event.data.byteLength > FILE_CHUNK_BYTES || current.transferred + event.data.byteLength > current.size) throw new Error("O arquivo excedeu o tamanho autorizado.");
              current.parts.push(event.data); current.transferred += event.data.byteLength; updateTransfer({ ...current });
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : "Falha na transferência.";
            setError(message); const current = transferRef.current;
            if (current) { current.phase = "Falhou"; current.error = message; current.parts = []; current.canceled = true; updateTransfer({ ...current }); audit(current, "FAILED"); files.send(JSON.stringify({ type: "file-cancel", id: current.id })); }
          }
        };
        pc.ontrack = event => setStream(event.streams[0] || new MediaStream([event.track]));

        const sendSignal = async (type: string, payload?: unknown) => {
          try {
            return await post<{ ok: boolean; peerPresent?: boolean }>(`/sessions/${session.id}/signal`, { type, sessionId: session.id, ...(payload ? { payload } : {}) });
          } catch (e) { fail(e instanceof Error ? e.message : "Falha na sinalização."); throw e; }
        };

        pc.onicecandidate = event => { if (event.candidate) void sendSignal("ice", event.candidate.toJSON()).catch(() => {}); };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") { setConnection("Conectado"); verifiedRef.current = Date.now(); refresh(); }
          else if (["failed", "disconnected"].includes(pc.connectionState)) fail("A conexão com o Android foi perdida. Inicie uma nova sessão para continuar.");
          else if (pc.connectionState === "connecting") setConnection("Negociando conexão segura");
        };

        setConnection("Aguardando o Android");
        const joined = await sendSignal("join");
        if (joined?.peerPresent && !offered) {
          offered = true;
          setConnection("Estabelecendo conexão");
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendSignal("offer", { type: "offer", sdp: offer.sdp });
        }

        pollTimer = setInterval(async () => {
          if (canceled || polling) return;
          polling = true;
          try {
            const data = await api<{ messages: Array<{ seq: number; type: string; payload?: RTCSessionDescriptionInit & RTCIceCandidateInit }>; peerPresent?: boolean; session?: RemoteSession }>(`/sessions/${session.id}/signal?after=${lastSeq}`);
            verifiedRef.current = Date.now();
            if (data.peerPresent && !offered) {
              offered = true;
              setConnection("Estabelecendo conexão");
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              await sendSignal("offer", { type: "offer", sdp: offer.sdp });
            }
            for (const message of data.messages || []) {
              if (message.seq > lastSeq) lastSeq = message.seq;
              if (message.type === "peer-ready" && !offered) {
                offered = true;
                setConnection("Estabelecendo conexão");
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await sendSignal("offer", { type: "offer", sdp: offer.sdp });
              } else if (message.type === "answer" && message.payload) {
                if (pc.signalingState === "have-local-offer") {
                  await pc.setRemoteDescription(message.payload);
                  for (const candidate of iceQueue.splice(0)) await pc.addIceCandidate(candidate);
                }
              } else if (message.type === "ice" && message.payload) {
                if (pc.remoteDescription) await pc.addIceCandidate(message.payload);
                else iceQueue.push(message.payload);
              }
            }
            if (data.session && (terminalStates.has(data.session.status) || data.session.status === "ENDING")) {
              setConnection("Sessão encerrada");
              close();
              refresh();
            }
          } catch { /* The independent lease timer closes stale authority. */ }
          finally { polling = false; }
        }, 700);

        statsTimer = setInterval(async () => {
          if (pc.connectionState !== "connected") return;
          try {
            const stats = await pc.getStats();
            const next: { latency?: number; fps?: number; width?: number; height?: number; relay?: boolean } = {};
            stats.forEach(report => {
              if (report.type === "inbound-rtp" && report.kind === "video") { next.fps = report.framesPerSecond; next.width = report.frameWidth; next.height = report.frameHeight; }
              if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
                if (typeof report.currentRoundTripTime === "number") next.latency = Math.round(report.currentRoundTripTime * 1000);
                const local = stats.get(report.localCandidateId); const remote = stats.get(report.remoteCandidateId);
                next.relay = local?.candidateType === "relay" || remote?.candidateType === "relay";
              }
            }); setMetrics(next);
          } catch {}
        }, 2000);
      } catch (e) { if (!canceled) fail(e instanceof Error ? e.message : "Não foi possível iniciar WebRTC."); }
    };
    void start();
    return () => { canceled = true; if (pollTimer) clearInterval(pollTimer); if (statsTimer) clearInterval(statsTimer); if (leaseTimer) clearInterval(leaseTimer); close(); startedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, !!session && ["APPROVED", "CONNECTING", "ACTIVE"].includes(session.status), close, audit, refresh, updateTransfer]);

  useEffect(() => () => { for (const url of activeUrls.current) URL.revokeObjectURL(url); }, []);
  const canInteract = useCallback(() => sessionRef.current?.status === "ACTIVE" && Date.now() - verifiedRef.current < 10_000 && Date.now() < new Date(sessionRef.current.expiresAt).getTime() && pcRef.current?.connectionState === "connected", []);
  const sendControl = useCallback((action: Record<string, unknown>) => {
    if (!canInteract() || !sessionRef.current?.controlApproved || controlRef.current?.readyState !== "open") return false;
    controlRef.current.send(JSON.stringify({ ...action, seq: ++seqRef.current })); return true;
  }, [canInteract]);
  const setQuality = useCallback((profile: "low" | "balanced") => {
    if (canInteract() && controlRef.current?.readyState === "open") controlRef.current.send(JSON.stringify({ type: "quality", profile, seq: ++seqRef.current }));
  }, [canInteract]);
  const upload = useCallback(async (file: File) => {
    setError("");
    if (!canInteract() || filesRef.current?.readyState !== "open") { setError("A sessão precisa estar ativa para transferir arquivos."); return; }
    const previous = transferRef.current;
    if (previous && !["Concluído", "Cancelado", "Falhou"].includes(previous.phase)) { setError("Aguarde ou cancele a transferência atual."); return; }
    if (file.size > fileLimitRef.current) { setError(`O limite configurado é ${Math.floor(fileLimitRef.current / 1048576)} MB por arquivo.`); return; }
    try {
      const buffer = await file.arrayBuffer();
      const offer: FileOffer = { type: "file-offer", id: crypto.randomUUID(), name: file.name, size: file.size, sha256: await sha256(buffer), direction: "upload" };
      if (!validOffer(offer)) throw new Error("O nome ou tamanho deste arquivo não é aceito.");
      if (!canInteract() || filesRef.current?.readyState !== "open") return;
      const current: Transfer = { ...offer, offer, transferred: 0, parts: [], buffer, phase: "Aguardando destino no Android" };
      updateTransfer(current); audit(current, "REQUESTED"); filesRef.current.send(JSON.stringify(offer));
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo."); }
  }, [audit, updateTransfer, canInteract]);
  const pickFile = useCallback(() => {
    const current = transferRef.current;
    if (current && !["Concluído", "Cancelado", "Falhou"].includes(current.phase)) { setError("Aguarde ou cancele a transferência atual."); return; }
    if (canInteract() && filesRef.current?.readyState === "open") { filesRef.current.send(JSON.stringify({ type: "file-pick" })); setConnection("Conectado · seleção solicitada no Android"); }
  }, [canInteract]);
  return { stream, connection, error, metrics, transfer, controlAvailable, filesAvailable, sendControl, setQuality, upload, pickFile, cancelTransfer, close };
}
