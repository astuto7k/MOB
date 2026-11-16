"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Activity, ArrowRight, Bell, Command, Eye, EyeOff, Files, History, LayoutDashboard, Loader2, LockKeyhole, LogOut, Menu, MonitorSmartphone, Moon, Settings2, ShieldCheck, Smartphone, Sun, X } from "lucide-react";
import { api, ApiError, post, setCsrfToken } from "@/lib/api";
import type { AuditEvent, Device, RemoteSession, User } from "@/lib/types";
import { useResource } from "@/hooks/use-resource";
import { Button } from "./ui/button";
import { ErrorAlert, PairingDialog, RequestSessionDialog } from "./common";
import { DashboardPage, DevicePage, DevicesPage, FilesPage, HistoryPage, SessionsPage, SettingsPage } from "./pages";
import { SessionViewer } from "./session-viewer";

function Brand({ compact = false }: { compact?: boolean }) { return <Link href="/" className="brand" aria-label="Android Remote Hub — início"><span className="brand-mark"><MonitorSmartphone size={22} /></span>{!compact && <span>Remote<span className="brand-weight">Hub</span><small>ANDROID ASSISTANCE</small></span>}</Link>; }
const navigation = [{ href: "/", label: "Visão geral", icon: LayoutDashboard }, { href: "/dispositivos", label: "Dispositivos", icon: Smartphone }, { href: "/sessoes", label: "Sessões remotas", icon: MonitorSmartphone }, { href: "/arquivos", label: "Arquivos", icon: Files }, { href: "/historico", label: "Histórico", icon: History }, { href: "/configuracoes", label: "Configurações", icon: Settings2 }];
export function Hub() {
  const path = usePathname(), router = useRouter();
  const [user, setUser] = useState<User>(), [loading, setLoading] = useState(true), [authError, setAuthError] = useState("");
  const [mobile, setMobile] = useState(false), [pairing, setPairing] = useState(false), [request, setRequest] = useState(false), [requestDevice, setRequestDevice] = useState<Device>();
  const [revision, setRevision] = useState(0), [light, setLight] = useState(false), [notifications, setNotifications] = useState(false);
  const [toast, setToast] = useState("");
  const refresh = () => setRevision(n => n + 1);
  useEffect(() => {
    const theme = localStorage.getItem("arh-theme") === "light";
    const themeFrame = requestAnimationFrame(() => { setLight(theme); document.documentElement.dataset.theme = theme ? "light" : "dark"; });
    const controller = new AbortController();
    api<{ user: User; csrfToken: string }>("/auth/me", { signal: controller.signal }).then(value => { setUser(value.user); setCsrfToken(value.csrfToken); }).catch(e => { if (e instanceof ApiError && e.status === 401) { setUser(undefined); if (path !== "/login") router.replace("/login"); } else if (!controller.signal.aborted) setAuthError(e instanceof Error ? e.message : "Falha de autenticação."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const unauthorized = () => { setUser(undefined); setCsrfToken(""); router.replace("/login"); };
    window.addEventListener("arh:unauthorized", unauthorized);
    return () => { cancelAnimationFrame(themeFrame); controller.abort(); window.removeEventListener("arh:unauthorized", unauthorized); };
    // Auth is checked once and refreshed through explicit login/logout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => { setMobile(false); setNotifications(false); }); return () => cancelAnimationFrame(frame); }, [path]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); } }, [toast]);
  const inventory = useResource(signal => user ? api<Device[]>("/devices", { signal }) : Promise.resolve([]), [user?.id, revision], 3000);
  const events = useResource(signal => user ? api<AuditEvent[]>("/audit", { signal }) : Promise.resolve([]), [user?.id, revision], 15000);
  const requestAssistance = (device?: Device) => { setRequestDevice(device); setRequest(true); };
  const openSession = (session: RemoteSession) => { refresh(); router.push(`/sessoes/${session.id}`); };
  if (loading) return <div className="app-loading"><Brand /><Loader2 size={24} className="spin" /><p>Conectando ao seu espaço privado</p></div>;
  if (!user || path === "/login") return <Login authError={authError} onLogin={(nextUser, csrf) => { setUser(nextUser); setCsrfToken(csrf); setAuthError(""); router.replace("/"); }} />;
  const active = navigation.find(item => item.href === "/" ? path === "/" : path.startsWith(item.href));
  let content: ReactNode;
  if (path === "/") content = <DashboardPage revision={revision} pair={() => setPairing(true)} request={requestAssistance} />;
  else if (path === "/dispositivos") content = <DevicesPage revision={revision} pair={() => setPairing(true)} request={requestAssistance} />;
  else if (path.startsWith("/dispositivos/")) content = <DevicePage id={path.split("/")[2]} request={requestAssistance} notify={setToast} />;
  else if (path === "/sessoes") content = <SessionsPage revision={revision} request={() => requestAssistance()} />;
  else if (path.startsWith("/sessoes/")) content = <SessionViewer key={path} id={path.split("/")[2]} notify={setToast} />;
  else if (path === "/arquivos") content = <FilesPage />;
  else if (path === "/historico") content = <HistoryPage />;
  else if (path === "/configuracoes") content = <SettingsPage user={user} onUser={setUser} notify={setToast} />;
  else content = <div className="not-found"><h1>Página não encontrada</h1><p>Este endereço não pertence ao seu painel.</p><Button asChild><Link href="/">Voltar ao início</Link></Button></div>;
  return <div className="app-shell"><a href="#main-content" className="skip-link">Pular para o conteúdo</a>{mobile && <button className="sidebar-scrim" onClick={() => setMobile(false)} aria-label="Fechar navegação" />}<aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}><div className="sidebar-top"><Brand /><Button variant="ghost" size="icon" className="mobile-only" aria-label="Fechar navegação" onClick={() => setMobile(false)}><X size={18} /></Button></div><div className="workspace-switch"><span className="workspace-icon">P</span><div><strong>Meu espaço</strong><span>Infraestrutura privada</span></div><LockKeyhole size={13} /></div><span className="nav-label">WORKSPACE</span><nav aria-label="Navegação principal">{navigation.map(item => <Link key={item.href} href={item.href} className={`nav-item ${(item.href === "/" ? path === "/" : path.startsWith(item.href)) ? "nav-active" : ""}`} aria-current={(item.href === "/" ? path === "/" : path.startsWith(item.href)) ? "page" : undefined}><item.icon size={18} /><span>{item.label}</span>{item.href === "/dispositivos" && inventory.data && <small>{inventory.data.filter(d => !d.revokedAt).length}</small>}</Link>)}</nav><div className="sidebar-bottom"><div className="privacy-card"><ShieldCheck size={22} /><strong>Sua conexão. Seu controle.</strong><p>Acesso privado com autorização em cada sessão.</p><Link href="/configuracoes">Revisar segurança<ArrowRight size={13} /></Link></div><div className="account"><span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span><span><strong>Proprietário</strong><small title={user.email}>{user.email}</small></span><Button variant="ghost" size="icon" aria-label="Sair do painel" onClick={async () => { try { await post("/auth/logout"); setUser(undefined); setCsrfToken(""); router.replace("/login"); } catch (e) { setToast(e instanceof Error ? e.message : "Não foi possível sair."); } }}><LogOut size={16} /></Button></div></div></aside><div className="main-shell"><header className="topbar"><div className="breadcrumb"><Button className="mobile-only" variant="ghost" size="icon" aria-label="Abrir navegação" onClick={() => setMobile(true)}><Menu size={20} /></Button><span className="breadcrumb-home"><LayoutDashboard size={15} />Meu espaço</span><span className="slash">/</span><strong>{active?.label || "Assistência"}</strong></div><div className="topbar-actions"><span className="private-badge"><LockKeyhole size={12} />Acesso privado</span><Button variant="ghost" size="icon" aria-label={light ? "Ativar tema escuro" : "Ativar tema claro"} onClick={() => { const next = !light; setLight(next); localStorage.setItem("arh-theme", next ? "light" : "dark"); document.documentElement.dataset.theme = next ? "light" : "dark"; }}>{light ? <Moon size={17} /> : <Sun size={17} />}</Button><div className="notification-wrapper"><Button variant="ghost" size="icon" aria-label="Eventos recentes" aria-expanded={notifications} onClick={() => setNotifications(!notifications)}><Bell size={17} /></Button>{notifications && <NotificationCenter events={events.data || []} error={events.error} />}</div><span className="topbar-avatar">{user.email.slice(0, 1).toUpperCase()}</span></div></header><main id="main-content" className="main-content">{content}<footer className="page-footer"><span><ShieldCheck size={13} />Android Remote Hub</span><span>Assistência autorizada, de ponta a ponta.</span><span>v0.1.0</span></footer></main></div><PairingDialog open={pairing} onOpenChange={setPairing} refresh={refresh} /><RequestSessionDialog open={request} onOpenChange={setRequest} device={requestDevice} devices={inventory.data || []} onCreated={openSession} />{toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="Fechar mensagem" onClick={() => setToast("")}><X size={15} /></button></div>}</div>;
}
function NotificationCenter({ events, error }: { events: AuditEvent[]; error: string }) {
  return <div className="notification-center"><div className="section-row"><h3>Eventos recentes</h3><Activity size={16} /></div>{error ? <p className="text-danger">{error}</p> : !events.length ? <p className="muted">Nenhum evento registrado ainda.</p> : events.slice(0, 5).map(event => <div key={event.id} className="notification-event"><ShieldCheck size={15} /><span>{event.type.replaceAll("_", " ").toLowerCase()}<small>{new Date(event.createdAt).toLocaleString("pt-BR")}</small></span></div>)}<Link href="/historico">Ver histórico completo<ArrowRight size={14} /></Link></div>;
}
function Login({ onLogin, authError }: { onLogin: (user: User, csrf: string) => void; authError: string }) {
  const [password, setPassword] = useState(""), [showPassword, setShowPassword] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(authError);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await post<{ user: User; csrfToken: string }>("/auth/login", { password });
      onLogin(result.user, result.csrfToken);
    } catch (e) { setError(e instanceof Error ? e.message : "Senha incorreta."); } finally { setBusy(false); }
  };
  return <div className="login-shell"><div className="login-story"><Brand /><div className="login-story-content"><span className="eyebrow"><span className="status-dot" />ASSISTÊNCIA REMOTA PRIVADA</span><h1>Seus dispositivos.<br />Sempre ao seu<br /><span>alcance.</span></h1><p>Basta instalar e abrir o APK em qualquer Android: o aparelho aparece conectado automaticamente no seu painel.</p><div className="login-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="visual-node node-one"><Smartphone size={22} /></div><div className="visual-node node-two"><MonitorSmartphone size={23} /></div><div className="visual-hub"><ShieldCheck size={39} /></div><span className="visual-caption"><LockKeyhole size={12} />CONEXÃO AUTOMÁTICA</span></div><div className="login-principles"><span><ShieldCheck size={16} />Sem código manual</span><span><LockKeyhole size={16} />Conexão imediata</span></div></div><small>Android Remote Hub · Acesso simplificado</small></div><div className="login-form-side"><div className="login-card"><span className="login-symbol"><Command size={25} /></span><span className="eyebrow">ACESSO RÁPIDO</span><h2>Entre no Painel</h2><p>Digite apenas sua senha de acesso para visualizar seus aparelhos.</p><form onSubmit={submit} className="form-stack"><label className="field-label">Senha de acesso<span className="input-icon"><input type={showPassword ? "text" : "password"} required minLength={1} maxLength={128} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Digite sua senha" autoFocus /><button type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>{error && <ErrorAlert>{error}</ErrorAlert>}<Button type="submit" disabled={busy}>{busy ? <Loader2 size={17} className="spin" /> : <LockKeyhole size={16} />}Entrar no painel<ArrowRight size={16} /></Button></form><div style={{ marginTop: "16px", padding: "12px", borderRadius: "12px", background: "rgba(108, 233, 192, 0.08)", border: "1px solid rgba(108, 233, 192, 0.25)", display: "flex", flexDirection: "column", gap: "8px" }}><strong style={{ fontSize: "13px" }}>Instalar APK no Celular:</strong><div><Button asChild size="sm"><a href="/apk/MOB.apk" download="MOB.apk"><Smartphone size={14} />Baixar APK</a></Button></div></div></div><div className="login-bottom"><LockKeyhole size={12} />Abriu o APK no celular, ele aparece automaticamente no painel</div></div></div>;
}
