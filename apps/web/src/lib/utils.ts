import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function date(value?: string | null) {
  if (!value) return "Ainda sem comunicação";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Data indisponível" : d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function relative(value?: string | null) {
  if (!value) return "Nunca conectado";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Agora mesmo";
  if (seconds < 3600) return `Há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Há ${Math.floor(seconds / 3600)} h`;
  return `Há ${Math.floor(seconds / 86400)} dias`;
}
export function bytes(n: number) { return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`; }
export const terminalStates = new Set(["ENDED", "REJECTED", "EXPIRED", "FAILED"]);
export const stateLabels: Record<string, string> = { REQUESTED: "Solicitada", WAITING_DEVICE: "Aguardando aparelho", WAITING_APPROVAL: "Aguardando autorização", APPROVED: "Autorizada", CONNECTING: "Conectando", ACTIVE: "Em andamento", ENDING: "Encerrando", ENDED: "Encerrada", REJECTED: "Recusada", EXPIRED: "Expirada", FAILED: "Falhou" };
