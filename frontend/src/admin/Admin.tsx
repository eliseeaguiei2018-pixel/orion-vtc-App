import { useEffect, useRef, useState, useCallback, type ReactNode, type CSSProperties } from 'react';
import { SupervisionMap } from './SupervisionMap';
import { DEMO } from './demo';

/* ------------------------------- Types ------------------------------- */
export interface Overview {
  currency: string;
  rides: { total: number; active: number; completed: number; cancelled: number; byStatus: Record<string, number> };
  drivers: { total: number; online: number; onTrip: number };
  finance: { gmv: number; revenue: number; commission: number; payouts: number };
  safety: { total: number; open: number };
  generatedAt: string;
}
export interface Alert {
  id: string; kind: 'sos' | 'crash'; status: string; rideId?: string; userId: string;
  location: { lat: number; lng: number }; zoneName?: string; impactG?: number;
  dispatchedTo: string[]; createdAt: string; note?: string;
}
export interface FleetUnit { id: string; lat: number; lng: number; name: string; matricule: string | null; category: string; availability: string; }
export interface RideRow { id: string; clientId: string; driverName: string | null; matricule: string | null; status: string; amount: number; currency: string; trafficLevel: string; createdAt: string; }
export interface DriverRow { id: string; name: string; matricule: string; category: string; kycStatus: string; availability: string; rating: number; trips: number; balance: number; }
export interface Pricing {
  baseFare: number; perKm: number; perMinute: number; minFare: number; avgSpeedKmh: number;
  tvaRate: number; feeRate: number; insuranceRate: number; trafficWeight: number; stopFee: number;
  multipliers: Record<string, number>; bodySurcharge: Record<string, number>;
}
export interface Me { name: string; role: string; roleLabel: string; permissions: string[] }
export interface Client { id: string; name?: string; phone?: string; status: string; rides: number; createdAt: string; lastSeenAt: string }
export interface Promo { id: string; kind: 'percent' | 'amount'; value: number; active: boolean; uses: number; maxUses?: number; createdAt: string }
export interface ServicesConfig { city: string; open: boolean; services: Record<string, boolean> }
export interface Zone {
  id: string; name: string; factor: number; lat: number; lng: number; radiusKm: number; active: boolean;
  waitMaxMin?: number; driverBonus?: number; minStandard?: string; pickupFee?: number; dedicated?: boolean;
}
export interface SupportMsg { id: string; from: 'client' | 'agent'; author?: string; text: string; at: string }
export interface Conversation { id: string; clientId: string; subject: string; status: string; assignee?: string; messages: SupportMsg[]; createdAt: string; updatedAt: string }
export interface AuditEntry { id: string; at: string; actor: string; role: string; action: string; target?: string; details?: Record<string, unknown> }
export interface Finance { currency: string; gmv: number; revenue: number; commission: number; earnings: number; payouts: number; byTier: Record<string, { count: number; revenue: number }> }
export interface Announcement { id: string; audience: string; title: string; body: string; author: string; at: string }
export interface StatsDay { date: string; rides: number; revenue: number; cancelled: number }
export interface Stats { currency: string; days: number; series: StatsDay[]; totals: { rides: number; revenue: number; cancelled: number } }
export interface Transfer {
  id: string; amount: number; currency: string; destination: string; reason: string;
  requestedBy: string; requestedRole: string; status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string; decisionNote?: string; createdAt: string; decidedAt?: string; executedAt?: string;
}
export interface SearchResults {
  drivers: { id: string; name: string; matricule: string; category: string; availability: string }[];
  clients: { id: string; name: string | null; phone: string | null; status: string; rides: number }[];
  rides: { id: string; clientId: string; status: string; amount: number; createdAt: string }[];
}
export interface ActiveSession {
  id: string; username: string; name: string; role: string; ip?: string; userAgent?: string;
  createdAt: string; lastSeenAt: string; expiresAt: string; revoked?: boolean;
}
export interface PageMeta { total: number; page: number; pages: number }
export interface OpsConfig {
  strategy: 'nearest' | 'longest_idle' | 'zone_queue'; minRating: number; autoWarn: boolean;
  maxEtaMinutes: number; offerTimeoutSec: number; surgeEnabled: boolean; surgeCapGreen: number;
  waitFeePerMin: number;
}
export interface Team {
  id: string; name: string; managerUsername: string; managerName?: string; driverIds: string[]; createdAt: string;
  drivers?: { id: string; name: string; matricule: string; availability: string; rating: number }[];
}
export interface GreenReport {
  co2SavedKg: number; co2SavedTons: number; kmElectric: number; kmHybrid: number;
  electricShare: number; hybridShare: number;
  fleet: { electric: number; hybrid: number; lowBattery: number; batteries: { id: string; name: string; matricule: string; batteryPct?: number; availability: string }[] };
}
export interface QualityRow { id: string; name: string; matricule: string; category: string; rating: number; trips: number; warnings: number; kycStatus: string; below: boolean }
export interface Dispute {
  id: string; rideId: string; clientId: string; kind: string; description: string;
  status: 'open' | 'investigating' | 'resolved' | 'rejected';
  createdAt: string; decidedBy?: string; resolution?: string; refund?: number; decidedAt?: string;
}
export interface RideForensic {
  ride: {
    id: string; clientId: string; driverId?: string; status: string;
    origin: { lat: number; lng: number }; destination: { lat: number; lng: number };
    quote: { amount: number; currency: string; breakdown?: Record<string, number> };
    events: { type: string; at: string; payload?: Record<string, unknown> }[];
    trace?: { lat: number; lng: number }[];
    createdAt: string;
  };
  driverName: string | null; matricule: string | null;
}
const PAGE_SIZE = 25;
/** Pagination locale (mode démo) — même contrat que le serveur. */
function pageSlice<T>(list: T[], page: number): { items: T[]; meta: PageMeta } {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p = Math.min(pages, Math.max(1, page));
  return { items: list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), meta: { total: list.length, page: p, pages } };
}
export interface LedgerEntry { id?: string; type: string; amount: number; at?: string; createdAt?: string }
export interface DetailRide { id: string; status: string; amount: number; createdAt: string }
export interface DriverDetail {
  id: string; name: string; matricule: string; category: string; kycStatus: string; availability: string;
  rating: number; trips: number; balance: number; earnings: number; ledger: LedgerEntry[]; rides: DetailRide[];
}
export interface ClientDetail {
  id: string; name: string | null; phone: string | null; status: string; rides: number; createdAt: string | null;
  spent: number; recentRides: DetailRide[]; conversations: { id: string; subject: string; status: string; messages: number }[];
}

/* ------------------------------- API --------------------------------- */
const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const jwtKey = 'orion.admin.jwt';
const expKey = 'orion.admin.exp';
const getJwt = () => localStorage.getItem(jwtKey) ?? '';
const clearSession = () => { localStorage.removeItem(jwtKey); localStorage.removeItem(expKey); };
/** Session valide si un jeton existe et n'est pas expiré (garde locale, revérifiée serveur). */
const sessionValid = () => {
  if (!getJwt()) return false;
  const exp = Number(localStorage.getItem(expKey) ?? 0);
  return !exp || exp > Date.now();
};
const H = (): Record<string, string> => {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const jwt = getJwt();
  if (jwt && jwt !== 'demo') h['authorization'] = `Bearer ${jwt}`;
  return h;
};
/** 401 = session expirée/invalide → on purge et on renvoie à l'écran de connexion. */
function onUnauthorized() { clearSession(); if (API) window.location.reload(); }
async function adminGet<T>(p: string): Promise<T> { const r = await fetch(API + p, { headers: H() }); if (r.status === 401) onUnauthorized(); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
async function adminPost<T>(p: string, b?: unknown): Promise<T> { const r = await fetch(API + p, { method: 'POST', headers: H(), body: JSON.stringify(b ?? {}) }); if (r.status === 401) onUnauthorized(); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
async function adminPut<T>(p: string, b: unknown): Promise<T> { const r = await fetch(API + p, { method: 'PUT', headers: H(), body: JSON.stringify(b) }); if (r.status === 401) onUnauthorized(); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
async function adminDel(p: string): Promise<void> { const r = await fetch(API + p, { method: 'DELETE', headers: H() }); if (r.status === 401) onUnauthorized(); }
const fcfa = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' F';

/* ----------------------- Thème jour / nuit --------------------------- */
const themeKey = 'orion.admin.theme';
type AdmTheme = 'dark' | 'light';
function applyTheme(t: AdmTheme): void { document.documentElement.setAttribute('data-adm-theme', t); }
function savedTheme(): AdmTheme { return localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark'; }
applyTheme(savedTheme()); // appliqué dès le chargement (écran de connexion inclus)

/** Sirène d'alerte SAMU (deux tons), générée en WebAudio — aucun fichier audio requis. */
function playSiren(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.connect(gain); gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.linearRampToValueAtTime(587, t + 0.35);
    osc.frequency.linearRampToValueAtTime(880, t + 0.7);
    osc.frequency.linearRampToValueAtTime(587, t + 1.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.35);
    osc.start(t); osc.stop(t + 1.4);
    osc.onended = () => { void ctx.close(); };
  } catch { /* audio indisponible (autoplay bloqué) — la notification visuelle reste */ }
}

interface LoginResponse { token: string; expiresAt: string; account: Me }

/* --------------------------- Porte d'entrée -------------------------- */
export function Admin() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    (async () => {
      if (!sessionValid()) { clearSession(); setChecking(false); return; }
      if (!API) { setAuthed(true); setChecking(false); return; }
      try { await adminGet('/admin/me'); setAuthed(true); } catch { clearSession(); }
      setChecking(false);
    })();
  }, []);
  if (checking) return <div className="adm-loading">Vérification de l'accès…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Console onLogout={() => { clearSession(); setAuthed(false); }} />;
}

/* --------------------------- Écran de connexion --------------------- */
function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfa, setMfa] = useState(false); // étape 2 : code TOTP demandé par le serveur
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) { setErr('Saisis ton identifiant et ton mot de passe.'); return; }
    if (mfa && !code.trim()) { setErr('Saisis le code à 6 chiffres de ton application d\'authentification.'); return; }
    setBusy(true); setErr('');
    // Mode démo (sans backend) : session locale, données simulées.
    if (!API) { localStorage.setItem(jwtKey, 'demo'); localStorage.setItem(expKey, String(Date.now() + 12 * 3600e3)); onDone(); return; }
    try {
      const res = await fetch(`${API}/admin/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, ...(mfa && code.trim() ? { code: code.trim() } : {}) }),
      });
      if (res.status === 429) { setErr('Compte temporairement verrouillé (trop de tentatives). Réessaie plus tard.'); setBusy(false); return; }
      if (!res.ok) { setErr(mfa ? 'Code 2FA invalide.' : 'Identifiants refusés. Accès réservé au personnel ORION.'); setBusy(false); return; }
      const data = (await res.json()) as LoginResponse & { mfaRequired?: boolean };
      if (data.mfaRequired) { setMfa(true); setBusy(false); return; } // mot de passe OK → code demandé
      localStorage.setItem(jwtKey, data.token);
      localStorage.setItem(expKey, String(Date.parse(data.expiresAt) || Date.now() + 12 * 3600e3));
      onDone();
    } catch {
      setErr('Serveur injoignable. Réessaie dans un instant.'); setBusy(false);
    }
  };
  return (
    <div className="adm-login">
      <form className="adm-login-card" onSubmit={submit}>
        <span className="adm-logo big" aria-hidden>
          <svg width="30" height="30" viewBox="0 0 512 512"><path d="M256 92 C 338 150 372 252 318 350 C 300 382 280 404 256 424 C 232 404 212 382 194 350 C 140 252 174 150 256 92 Z" fill="#04140d"/><g fill="#04140d"><circle cx="372" cy="120" r="15"/><circle cx="406" cy="150" r="12"/><circle cx="430" cy="186" r="9"/></g></svg>
        </span>
        <h1>ORION Admin</h1>
        <p className="adm-login-sub">Centre de contrôle — accès réservé au personnel ORION.</p>
        {!mfa && (
          <>
            <label className="adm-login-label">Identifiant</label>
            <input className="adm-login-input" type="text" autoComplete="username" placeholder="prenom.nom" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            <label className="adm-login-label" style={{ marginTop: 10 }}>Mot de passe</label>
            <input className="adm-login-input" type="password" autoComplete="current-password" placeholder="••••••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
        {mfa && (
          <>
            <p className="adm-login-sub" style={{ marginTop: 0 }}>🛡️ Double authentification — compte de direction.</p>
            <label className="adm-login-label">Code à 6 chiffres (application d'authentification)</label>
            <input className="adm-login-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </>
        )}
        {err && <div className="adm-login-err">{err}</div>}
        <button className="adm-btn solid big" type="submit" disabled={busy}>{busy ? 'Connexion…' : mfa ? 'Vérifier le code' : 'Se connecter'}</button>
        {mfa && <button className="adm-btn ghost" type="button" style={{ marginTop: 8 }} onClick={() => { setMfa(false); setCode(''); setErr(''); }}>← Retour</button>}
        {!API && <p className="adm-login-demo">Mode démo — n'importe quels identifiants ouvrent la console (données simulées).</p>}
      </form>
    </div>
  );
}

/* ------------------------------ Navigation --------------------------- */
type Section = 'overview' | 'alerts' | 'rides' | 'drivers' | 'clients' | 'support' | 'notify' | 'pricing' | 'zones' | 'promos' | 'finance' | 'treasury' | 'dispatch' | 'quality' | 'disputes' | 'green' | 'teams' | 'services' | 'audit' | 'sessions' | 'roles';
const NAV: { id: Section; label: string; perm: string; icon: string }[] = [
  { id: 'overview', label: 'Vue d’ensemble', perm: 'overview:read', icon: '📊' },
  { id: 'alerts', label: 'Supervision SAMU', perm: 'alerts:read', icon: '🚨' },
  { id: 'support', label: 'Support & chat', perm: 'support:read', icon: '💬' },
  { id: 'notify', label: 'Notifications', perm: 'notify:read', icon: '📣' },
  { id: 'rides', label: 'Courses', perm: 'rides:read', icon: '🚗' },
  { id: 'dispatch', label: 'Dispatch', perm: 'rides:write', icon: '🎯' },
  { id: 'quality', label: 'Qualité & notes', perm: 'drivers:read', icon: '⭐' },
  { id: 'green', label: 'Mobilité verte', perm: 'overview:read', icon: '🌱' },
  { id: 'teams', label: 'Équipes', perm: 'teams:read', icon: '🧑‍🤝‍🧑' },
  { id: 'disputes', label: 'Litiges', perm: 'support:read', icon: '⚖️' },
  { id: 'drivers', label: 'Chauffeurs', perm: 'drivers:read', icon: '🧑‍✈️' },
  { id: 'clients', label: 'Clients', perm: 'clients:read', icon: '👥' },
  { id: 'finance', label: 'Finances', perm: 'finance:read', icon: '📈' },
  { id: 'treasury', label: 'Trésorerie', perm: 'treasury:read', icon: '🏦' },
  { id: 'pricing', label: 'Tarification', perm: 'pricing:read', icon: '💰' },
  { id: 'zones', label: 'Zones & tarifs', perm: 'pricing:read', icon: '🗺️' },
  { id: 'promos', label: 'Codes promo', perm: 'promos:read', icon: '🎟️' },
  { id: 'services', label: 'Services & ville', perm: 'services:read', icon: '🧩' },
  { id: 'audit', label: 'Journal', perm: 'audit:read', icon: '📜' },
  { id: 'sessions', label: 'Sessions actives', perm: 'sessions:read', icon: '🖥️' },
  { id: 'roles', label: 'Rôles & accès', perm: 'roles:read', icon: '🛡️' },
];

/* ------------------------------- Console ----------------------------- */
function Console({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsDays, setStatsDays] = useState(7);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fleet, setFleet] = useState<FleetUnit[]>([]);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [services, setServices] = useState<ServicesConfig | null>(null);
  const [support, setSupport] = useState<Conversation[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [broadcasts, setBroadcasts] = useState<Announcement[]>([]);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [section, setSection] = useState<Section>('overview');
  const [driverSel, setDriverSel] = useState<DriverDetail | null>(null);
  const [clientSel, setClientSel] = useState<ClientDetail | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [selfSession, setSelfSession] = useState<string | null>(null);
  const [ops, setOps] = useState<OpsConfig | null>(null);
  const [quality, setQuality] = useState<{ threshold: number; autoWarn: boolean; drivers: QualityRow[] } | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [forensic, setForensic] = useState<RideForensic | null>(null);
  const [green, setGreen] = useState<GreenReport | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [muted, setMuted] = useState(() => localStorage.getItem('orion.admin.muted') === '1');
  const [theme, setTheme] = useState<AdmTheme>(savedTheme);
  const [ridesPage, setRidesPage] = useState(1);
  const [driversPage, setDriversPage] = useState(1);
  const [clientsPage, setClientsPage] = useState(1);
  const emptyMeta: PageMeta = { total: 0, page: 1, pages: 1 };
  const [ridesMeta, setRidesMeta] = useState<PageMeta>(emptyMeta);
  const [driversMeta, setDriversMeta] = useState<PageMeta>(emptyMeta);
  const [clientsMeta, setClientsMeta] = useState<PageMeta>(emptyMeta);

  const loadDemo = useCallback(() => {
    setMe(DEMO.me); setOv(DEMO.overview); setStats(DEMO.stats(statsDays)); setAlerts(DEMO.alerts); setFleet(DEMO.fleet);
    const dr = pageSlice(DEMO.rides, ridesPage); setRides(dr.items); setRidesMeta(dr.meta);
    const dd = pageSlice(DEMO.drivers, driversPage); setDrivers(dd.items); setDriversMeta(dd.meta);
    const dc = pageSlice(DEMO.clients, clientsPage); setClients(dc.items); setClientsMeta(dc.meta);
    setPricing(DEMO.pricing); setZones(DEMO.zones as Zone[]);
    setPromos(DEMO.promos as Promo[]); setServices(DEMO.services);
    setSupport(DEMO.support as Conversation[]); setAudit(DEMO.audit as AuditEntry[]);
    setFinance(DEMO.finance); setBroadcasts(DEMO.broadcasts as Announcement[]);
    setTransfers(DEMO.treasury as Transfer[]);
    setSessions(DEMO.sessions as ActiveSession[]); setSelfSession(DEMO.sessions[0]?.id ?? null);
    setOps(DEMO.ops as OpsConfig); setQuality(DEMO.quality()); setDisputes(DEMO.disputes as Dispute[]);
    setGreen(DEMO.green as GreenReport);
    setTeams(DEMO.teams as Team[]);
    setLive(false);
  }, [statsDays, ridesPage, driversPage, clientsPage]);

  const refresh = useCallback(async () => {
    if (!API) { loadDemo(); return; }
    try {
      const meRes = await adminGet<Me>('/admin/me');
      setMe(meRes); setLive(true);
      const has = (p: string) => meRes.permissions.includes(p);
      if (has('overview:read')) { setOv(await adminGet<Overview>('/admin/overview')); setStats(await adminGet<Stats>(`/admin/stats?days=${statsDays}`)); }
      if (has('alerts:read')) setAlerts((await adminGet<{ alerts: Alert[] }>('/admin/alerts')).alerts);
      if (has('drivers:read')) {
        setFleet((await adminGet<{ fleet: FleetUnit[] }>('/admin/fleet/live')).fleet);
        const d = await adminGet<{ drivers: DriverRow[] } & PageMeta>(`/admin/drivers?page=${driversPage}&limit=${PAGE_SIZE}`);
        setDrivers(d.drivers); setDriversMeta({ total: d.total, page: d.page, pages: d.pages });
      }
      if (has('rides:read')) {
        const r = await adminGet<{ rides: RideRow[] } & PageMeta>(`/admin/rides?page=${ridesPage}&limit=${PAGE_SIZE}`);
        setRides(r.rides); setRidesMeta({ total: r.total, page: r.page, pages: r.pages });
      }
      if (has('pricing:read')) { setPricing((await adminGet<{ pricing: Pricing }>('/admin/pricing')).pricing); setZones((await adminGet<{ zones: Zone[] }>('/admin/zones')).zones); }
      if (has('clients:read')) {
        const c = await adminGet<{ clients: Client[] } & PageMeta>(`/admin/clients?page=${clientsPage}&limit=${PAGE_SIZE}`);
        setClients(c.clients); setClientsMeta({ total: c.total, page: c.page, pages: c.pages });
      }
      if (has('promos:read')) setPromos((await adminGet<{ promos: Promo[] }>('/admin/promos')).promos);
      if (has('services:read')) setServices((await adminGet<{ config: ServicesConfig }>('/admin/services')).config);
      if (has('support:read')) setSupport((await adminGet<{ conversations: Conversation[] }>('/admin/support')).conversations);
      if (has('finance:read')) setFinance(await adminGet<Finance>('/admin/finance'));
      if (has('treasury:read')) setTransfers((await adminGet<{ transfers: Transfer[] }>('/admin/treasury')).transfers);
      if (has('sessions:read')) { const s = await adminGet<{ sessions: ActiveSession[]; self: string | null }>('/admin/sessions'); setSessions(s.sessions); setSelfSession(s.self); }
      if (has('rides:read')) setOps((await adminGet<{ ops: OpsConfig }>('/admin/dispatch')).ops);
      if (has('overview:read')) setGreen(await adminGet<GreenReport>('/admin/green'));
      if (has('teams:read')) setTeams((await adminGet<{ teams: Team[] }>('/admin/teams')).teams);
      if (has('drivers:read')) setQuality(await adminGet<{ threshold: number; autoWarn: boolean; drivers: QualityRow[] }>('/admin/quality'));
      if (has('support:read')) setDisputes((await adminGet<{ disputes: Dispute[] }>('/admin/disputes')).disputes);
      if (has('notify:read')) setBroadcasts((await adminGet<{ announcements: Announcement[] }>('/admin/broadcasts')).announcements);
      if (has('audit:read')) setAudit((await adminGet<{ entries: AuditEntry[] }>('/admin/audit')).entries);
    } catch { loadDemo(); }
  }, [loadDemo, statsDays, ridesPage, driversPage, clientsPage]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const p = API ? setInterval(() => void refresh(), 6000) : undefined;
    return () => { clearInterval(t); if (p) clearInterval(p); };
  }, [refresh]);

  // Alertes SAMU temps réel : sirène + notification navigateur à chaque NOUVELLE alerte.
  const seenAlerts = useRef<Set<string> | null>(null);
  useEffect(() => {
    const open = alerts.filter((a) => a.status !== 'resolved' && a.status !== 'cancelled');
    if (seenAlerts.current === null) { seenAlerts.current = new Set(open.map((a) => a.id)); return; }
    const fresh = open.filter((a) => !seenAlerts.current!.has(a.id));
    for (const a of fresh) seenAlerts.current!.add(a.id);
    if (fresh.length === 0) return;
    if (!muted) playSiren();
    if ('Notification' in window && Notification.permission === 'granted') {
      const a = fresh[0]!;
      new Notification('🚨 Alerte SAMU — ORION', {
        body: `${a.kind === 'crash' ? 'Accident détecté' : 'SOS client'} · ${a.zoneName ?? 'Abidjan'} — ouvre la console.`,
        tag: a.id,
      });
    }
  }, [alerts, muted]);

  // Autorisation de notification navigateur (demandée une seule fois).
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  }, []);

  const setAlertStatus = async (id: string, status: string) => {
    if (!API) { setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, status } : a))); return; }
    try { const { alert } = await adminPost<{ alert: Alert }>(`/admin/alerts/${id}/status`, { status }); setAlerts((xs) => xs.map((a) => (a.id === alert.id ? alert : a))); } catch { /* ignore */ }
  };

  const savePricing = async (patch: Partial<Pricing>) => {
    if (!API) { setPricing((p) => (p ? { ...p, ...patch, multipliers: { ...p.multipliers, ...(patch.multipliers ?? {}) } } : p)); return; }
    const { pricing: next } = await adminPut<{ pricing: Pricing }>('/admin/pricing', patch);
    setPricing(next);
  };

  const saveZone = async (zn: Zone) => {
    if (!API) { setZones((xs) => (xs.some((z) => z.id === zn.id) ? xs.map((z) => (z.id === zn.id ? zn : z)) : [...xs, zn])); return; }
    const { zone } = await adminPut<{ zone: Zone }>('/admin/zones', zn);
    setZones((xs) => (xs.some((z) => z.id === zone.id) ? xs.map((z) => (z.id === zone.id ? zone : z)) : [...xs, zone]));
  };
  const toggleZone = async (id: string, active: boolean) => {
    if (API) { try { await adminPost(`/admin/zones/${id}/active`, { active }); } catch { /* */ } }
    setZones((xs) => xs.map((z) => (z.id === id ? { ...z, active } : z)));
  };
  const deleteZone = async (id: string) => {
    if (API) await adminDel(`/admin/zones/${id}`);
    setZones((xs) => xs.filter((z) => z.id !== id));
  };
  const resetZones = async () => {
    if (!API) { setZones(DEMO.zones as Zone[]); return; }
    const { zones: next } = await adminPost<{ zones: Zone[] }>('/admin/zones/reset');
    setZones(next);
  };

  const setClientStatus = async (id: string, status: string) => {
    if (!API) { setClients((xs) => xs.map((c) => (c.id === id ? { ...c, status } : c))); return; }
    try { await adminPost(`/admin/clients/${id}/status`, { status }); setClients((xs) => xs.map((c) => (c.id === id ? { ...c, status } : c))); } catch { /* ignore */ }
  };

  const savePromo = async (p: { code: string; kind: 'percent' | 'amount'; value: number; maxUses?: number }) => {
    if (!API) { setPromos((xs) => { const id = p.code.toUpperCase(); const ex = xs.find((x) => x.id === id); const np: Promo = { id, kind: p.kind, value: p.value, active: ex?.active ?? true, uses: ex?.uses ?? 0, maxUses: p.maxUses, createdAt: ex?.createdAt ?? new Date().toISOString() }; return ex ? xs.map((x) => (x.id === id ? np : x)) : [np, ...xs]; }); return; }
    const { promo } = await adminPut<{ promo: Promo }>('/admin/promos', p);
    setPromos((xs) => (xs.some((x) => x.id === promo.id) ? xs.map((x) => (x.id === promo.id ? promo : x)) : [promo, ...xs]));
  };
  const togglePromo = async (code: string, active: boolean) => {
    if (!API) { setPromos((xs) => xs.map((x) => (x.id === code ? { ...x, active } : x))); return; }
    try { await adminPost(`/admin/promos/${code}/active`, { active }); setPromos((xs) => xs.map((x) => (x.id === code ? { ...x, active } : x))); } catch { /* */ }
  };
  const deletePromo = async (code: string) => {
    if (API) await adminDel(`/admin/promos/${code}`);
    setPromos((xs) => xs.filter((x) => x.id !== code));
  };

  const saveServices = async (patch: Partial<ServicesConfig>) => {
    if (!API) { setServices((s) => (s ? { ...s, ...patch, services: { ...s.services, ...(patch.services ?? {}) } } : s)); return; }
    const { config } = await adminPut<{ config: ServicesConfig }>('/admin/services', patch);
    setServices(config);
  };

  const supportReply = async (convId: string, text: string) => {
    const msg: SupportMsg = { id: Math.random().toString(36).slice(2, 8), from: 'agent', author: me?.name, text, at: new Date().toISOString() };
    if (API) { try { await adminPost(`/admin/support/${convId}/reply`, { text }); } catch { /* */ } }
    setSupport((xs) => xs.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg], status: 'pending' } : c)));
  };
  const supportSetStatus = async (convId: string, status: string) => {
    if (API) { try { await adminPost(`/admin/support/${convId}/status`, { status }); } catch { /* */ } }
    setSupport((xs) => xs.map((c) => (c.id === convId ? { ...c, status } : c)));
  };

  const sendBroadcast = async (a: { audience: string; title: string; body: string }) => {
    const local: Announcement = { id: Math.random().toString(36).slice(2, 8), author: me?.name ?? 'Admin', at: new Date().toISOString(), ...a };
    if (API) { try { const { announcement } = await adminPost<{ announcement: Announcement }>('/admin/broadcast', a); setBroadcasts((xs) => [announcement, ...xs]); return; } catch { /* */ } }
    setBroadcasts((xs) => [local, ...xs]);
  };

  /** Télécharge un CSV : via l'API (avec session JWT) ou généré localement (démo). */
  const downloadCsv = async (path: string, filename: string, local: () => string) => {
    let content: string;
    if (API) {
      try {
        const res = await fetch(API + path, { headers: H() });
        if (res.status === 401) { onUnauthorized(); return; }
        content = await res.text();
      } catch { content = local(); }
    } else {
      content = local();
    }
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  };

  const exportCsv = () => void downloadCsv('/admin/rides.csv', 'orion-courses.csv', () => {
    const head = 'id,client,status,amount';
    return [head, ...rides.map((r) => `${r.id},${r.clientId},${r.status},${r.amount}`)].join('\n');
  });

  const exportTreasuryCsv = () => void downloadCsv('/admin/treasury.csv', 'orion-tresorerie.csv', () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = 'reference,montant,devise,destination,motif,demande_par,statut,decide_par,cree_le';
    return [head, ...transfers.map((t) => [t.id, t.amount, t.currency, t.destination, t.reason, t.requestedBy, t.status, t.decidedBy, t.createdAt].map(esc).join(','))].join('\n');
  });

  const driverAction = async (id: string, kind: 'kyc' | 'availability', value: string) => {
    if (API) { try { await adminPost(`/admin/drivers/${id}/${kind}`, kind === 'kyc' ? { status: value } : { availability: value }); } catch { /* */ } }
    setDrivers((xs) => xs.map((d) => (d.id === id ? { ...d, ...(kind === 'kyc' ? { kycStatus: value, availability: value === 'suspended' ? 'offline' : d.availability } : { availability: value }) } : d)));
  };

  const openDriver = async (id: string) => {
    if (!API) { setDriverSel(DEMO.driverDetail(id, drivers)); return; }
    try { setDriverSel((await adminGet<{ driver: DriverDetail }>(`/admin/drivers/${id}`)).driver); }
    catch { setDriverSel(DEMO.driverDetail(id, drivers)); }
  };
  const openClient = async (id: string) => {
    if (!API) { setClientSel(DEMO.clientDetail(id, clients)); return; }
    try { setClientSel((await adminGet<{ client: ClientDetail }>(`/admin/clients/${id}`)).client); }
    catch { setClientSel(DEMO.clientDetail(id, clients)); }
  };

  // --- Trésorerie (double validation) ---
  const requestTransfer = async (input: { amount: number; destination: string; reason: string }) => {
    if (!API) {
      const local: Transfer = { id: Math.random().toString(36).slice(2, 10), currency: 'XOF', status: 'pending', requestedBy: me?.name ?? 'CFO', requestedRole: me?.role ?? 'cfo', createdAt: new Date().toISOString(), ...input };
      setTransfers((xs) => [local, ...xs]); return;
    }
    try { const { transfer } = await adminPost<{ transfer: Transfer }>('/admin/treasury/request', input); setTransfers((xs) => [transfer, ...xs]); } catch { /* */ }
  };
  const decideTransfer = async (id: string, action: 'approve' | 'reject', note?: string) => {
    if (!API) {
      setTransfers((xs) => xs.map((x) => (x.id === id && x.status === 'pending'
        ? { ...x, status: action === 'approve' ? 'approved' : 'rejected', decidedBy: me?.name, decisionNote: note, decidedAt: new Date().toISOString(), executedAt: action === 'approve' ? new Date().toISOString() : undefined }
        : x)));
      return;
    }
    try {
      const { transfer } = await adminPost<{ transfer: Transfer }>(`/admin/treasury/${id}/${action}`, note ? { note } : {});
      setTransfers((xs) => xs.map((x) => (x.id === transfer.id ? transfer : x)));
    } catch { /* séparation des tâches ou déjà décidé : on rafraîchit */ void refresh(); }
  };

  // --- Recherche globale ---
  const runSearch = async (q: string): Promise<SearchResults> => {
    if (!API) return DEMO.search(q);
    try { return await adminGet<SearchResults>(`/admin/search?q=${encodeURIComponent(q)}`); }
    catch { return { drivers: [], clients: [], rides: [] }; }
  };

  const toggleMute = () => {
    setMuted((m) => { localStorage.setItem('orion.admin.muted', m ? '0' : '1'); return !m; });
  };

  const toggleTheme = () => {
    setTheme((t) => {
      const next: AdmTheme = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem(themeKey, next); applyTheme(next);
      return next;
    });
  };

  // Dispatch & qualité (règles d'attribution + seuil de notes).
  const saveOps = async (patch: Partial<OpsConfig>) => {
    if (!API) { setOps((o) => (o ? { ...o, ...patch } : o)); setQuality((q) => (q ? { ...q, threshold: patch.minRating ?? q.threshold, autoWarn: patch.autoWarn ?? q.autoWarn } : q)); return; }
    try { const { ops: next } = await adminPut<{ ops: OpsConfig }>('/admin/dispatch', patch); setOps(next); } catch { /* */ }
  };

  const warnDriver = async (id: string) => {
    if (API) { try { await adminPost(`/admin/drivers/${id}/warn`); } catch { /* */ } }
    setQuality((q) => (q ? { ...q, drivers: q.drivers.map((d) => (d.id === id ? { ...d, warnings: d.warnings + 1 } : d)) } : q));
  };

  // Réassignation manuelle d'une course (auto : re-matching selon la règle courante).
  const reassignRide = async (id: string) => {
    if (!API) { setRides((xs) => xs.map((r) => (r.id === id ? { ...r, driverName: 'Serge Aka', matricule: 'ORION-CI-4820', status: 'accepted' } : r))); return; }
    try { await adminPost(`/admin/rides/${id}/reassign`); void refresh(); } catch { /* aucun chauffeur dispo */ }
  };

  // Instruction d'un litige : fiche complète de la course (tracé GPS + tarif).
  const openForensic = async (rideId: string) => {
    if (!API) { setForensic(DEMO.rideForensic(rideId)); return; }
    try { setForensic(await adminGet<RideForensic>(`/admin/rides/${rideId}`)); }
    catch { setForensic(DEMO.rideForensic(rideId)); }
  };

  const decideDispute = async (id: string, status: 'investigating' | 'resolved' | 'rejected', resolution?: string, refund?: number) => {
    if (API) { try { await adminPost(`/admin/disputes/${id}/status`, { status, resolution, refund }); } catch { /* */ } }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, status, resolution: resolution ?? d.resolution, refund: refund ?? d.refund, decidedBy: me?.name, decidedAt: new Date().toISOString() } : d)));
  };

  // Équipes : création/mise à jour + affectation de flotte.
  const saveTeam = async (input: { id?: string; name: string; managerUsername: string; managerName?: string; driverIds?: string[] }) => {
    if (!API) {
      const id = input.id ?? Math.random().toString(36).slice(2, 10);
      const detail = (input.driverIds ?? []).map((did) => drivers.find((d) => d.id === did)).filter(Boolean)
        .map((d) => ({ id: d!.id, name: d!.name, matricule: d!.matricule, availability: d!.availability, rating: d!.rating }));
      setTeams((xs) => {
        const next: Team = { id, name: input.name, managerUsername: input.managerUsername, managerName: input.managerName, driverIds: input.driverIds ?? [], createdAt: new Date().toISOString(), drivers: detail };
        return xs.some((t) => t.id === id) ? xs.map((t) => (t.id === id ? next : t)) : [...xs, next];
      });
      return;
    }
    try { await adminPut('/admin/teams', input); void refresh(); } catch { /* */ }
  };
  const deleteTeam = async (id: string) => {
    if (API) await adminDel(`/admin/teams/${id}`);
    setTeams((xs) => xs.filter((t) => t.id !== id));
  };

  // Révoque une session (l'employé est déconnecté immédiatement).
  const revokeSess = async (id: string) => {
    if (API) { try { await adminPost(`/admin/sessions/${id}/revoke`); } catch { /* */ } }
    setSessions((xs) => xs.map((s) => (s.id === id ? { ...s, revoked: true } : s)));
    if (id === selfSession) { clearSession(); window.location.reload(); } // on s'est déconnecté soi-même
  };

  if (!me || !ov) return <div className="adm-loading">Chargement de la console…</div>;

  const can = (p: string) => me.permissions.includes(p);
  const nav = NAV.filter((n) => can(n.perm));
  const openAlerts = alerts.filter((a) => a.status !== 'resolved' && a.status !== 'cancelled');

  return (
    <div className="adm-shell">
      <aside className="adm-side">
        <div className="adm-brand">
          <span className="adm-logo" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 512 512"><path d="M256 92 C 338 150 372 252 318 350 C 300 382 280 404 256 424 C 232 404 212 382 194 350 C 140 252 174 150 256 92 Z" fill="#04140d"/><g fill="#04140d"><circle cx="372" cy="120" r="15"/><circle cx="406" cy="150" r="12"/><circle cx="430" cy="186" r="9"/></g></svg>
          </span>
          <div><strong>ORION</strong><span className="adm-sub">Centre de contrôle</span></div>
        </div>
        <nav className="adm-nav">
          {nav.map((n) => (
            <button key={n.id} className={`adm-navi${section === n.id ? ' on' : ''}`} onClick={() => setSection(n.id)}>
              <span className="adm-navi-ico">{n.icon}</span> {n.label}
              {n.id === 'alerts' && openAlerts.length > 0 && <span className="adm-navi-badge">{openAlerts.length}</span>}
            </button>
          ))}
        </nav>
        <div className="adm-side-foot">
          <div className="adm-role"><span className="adm-role-dot" /> {me.roleLabel}</div>
          <div className="adm-me">{me.name}</div>
          <button className="adm-btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={onLogout}>Déconnexion</button>
        </div>
      </aside>

      <main className="adm-main">
        <header className="adm-mhead">
          <h2>{NAV.find((n) => n.id === section)?.label}</h2>
          {can('search:read') && (
            <GlobalSearch
              onSearch={runSearch}
              onOpenDriver={(id) => void openDriver(id)}
              onOpenClient={(id) => void openClient(id)}
              onOpenRide={() => setSection('rides')}
            />
          )}
          <div className="adm-top-right">
            <button className="adm-btn ghost adm-mute" title={theme === 'dark' ? 'Passer en mode jour' : 'Passer en mode nuit'} onClick={toggleTheme}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button className={`adm-btn ghost adm-mute${muted ? ' off' : ''}`} title={muted ? 'Réactiver la sirène SAMU' : 'Couper la sirène SAMU'} onClick={toggleMute}>
              {muted ? '🔕' : '🔔'}
            </button>
            <span className={`adm-live ${live ? 'on' : 'demo'}`}>{live ? '● EN DIRECT' : '● MODE DÉMO'}</span>
            <span className="adm-clock">{now.toLocaleTimeString('fr-FR')}</span>
            <button className="adm-btn ghost" onClick={() => void refresh()}>Rafraîchir</button>
          </div>
        </header>

        {section === 'overview' && <OverviewSection ov={ov} fleet={fleet} openAlerts={openAlerts} stats={stats} statsDays={statsDays} onStatsDays={setStatsDays} />}
        {section === 'alerts' && <AlertsSection alerts={alerts} fleet={fleet} openAlerts={openAlerts} canWrite={can('alerts:write')} onStatus={setAlertStatus} />}
        {section === 'support' && <SupportSection convs={support} canWrite={can('support:write')} onReply={supportReply} onStatus={supportSetStatus} />}
        {section === 'rides' && <RidesSection rides={rides} meta={ridesMeta} onPage={setRidesPage} canWrite={can('rides:write')} onReassign={reassignRide} onOpen={openForensic} />}
        {section === 'dispatch' && ops && <DispatchSection ops={ops} onSave={saveOps} />}
        {section === 'quality' && quality && <QualitySection q={quality} canWrite={can('drivers:write')} onWarn={warnDriver} onSuspend={(id) => driverAction(id, 'kyc', 'suspended')} onSaveOps={saveOps} />}
        {section === 'disputes' && <DisputesSection disputes={disputes} canWrite={can('support:write')} onDecide={decideDispute} onOpenRide={openForensic} />}
        {section === 'green' && green && <GreenSection g={green} />}
        {section === 'teams' && <TeamsSection teams={teams} allDrivers={drivers} canWrite={can('teams:write')} onSave={saveTeam} onDelete={deleteTeam} />}
        {section === 'drivers' && <DriversSection drivers={drivers} canWrite={can('drivers:write')} onAction={driverAction} onOpen={openDriver} meta={driversMeta} onPage={setDriversPage} />}
        {section === 'clients' && <ClientsSection clients={clients} canWrite={can('clients:write')} onStatus={setClientStatus} onOpen={openClient} meta={clientsMeta} onPage={setClientsPage} />}
        {section === 'notify' && <NotifySection broadcasts={broadcasts} canWrite={can('notify:write')} onSend={sendBroadcast} />}
        {section === 'finance' && finance && <FinanceSection finance={finance} onExport={exportCsv} canExport={can('rides:read')} />}
        {section === 'treasury' && <TreasurySection transfers={transfers} meName={me.name} canRequest={can('treasury:request')} canApprove={can('treasury:approve')} onRequest={requestTransfer} onDecide={decideTransfer} onExport={exportTreasuryCsv} />}
        {section === 'pricing' && pricing && <PricingEditor pricing={pricing} canWrite={can('pricing:write')} onSave={savePricing} />}
        {section === 'zones' && <ZonesSection zones={zones} canWrite={can('pricing:write')} onSave={saveZone} onToggle={toggleZone} onDelete={deleteZone} onReset={resetZones} />}
        {section === 'promos' && <PromosSection promos={promos} canWrite={can('promos:write')} onSave={savePromo} onToggle={togglePromo} onDelete={deletePromo} />}
        {section === 'services' && services && <ServicesSection config={services} canWrite={can('services:write')} onSave={saveServices} />}
        {section === 'audit' && <AuditSection entries={audit} />}
        {section === 'sessions' && <SessionsSection sessions={sessions} self={selfSession} canWrite={can('sessions:write')} onRevoke={revokeSess} />}
        {section === 'roles' && <RolesSection me={me} />}
      </main>

      {driverSel && <DriverDrawer d={driverSel} onClose={() => setDriverSel(null)} />}
      {clientSel && <ClientDrawer c={clientSel} onClose={() => setClientSel(null)} onOpenSupport={() => { setClientSel(null); setSection('support'); }} />}
      {forensic && <ForensicDrawer f={forensic} onClose={() => setForensic(null)} />}
    </div>
  );
}

/* ------------------------------ Sections ----------------------------- */
function OverviewSection({ ov, fleet, openAlerts, stats, statsDays, onStatsDays }: { ov: Overview; fleet: FleetUnit[]; openAlerts: Alert[]; stats: Stats | null; statsDays: number; onStatsDays: (d: number) => void }) {
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="Courses actives" value={String(ov.rides.active)} sub={`${ov.rides.total} au total`} tone="green" />
        <Kpi label="Chauffeurs en ligne" value={String(ov.drivers.online)} sub={`${ov.drivers.onTrip} en course`} tone="teal" />
        <Kpi label="Revenu (courses)" value={fcfa(ov.finance.revenue)} sub={`Commission ${fcfa(ov.finance.commission)}`} tone="mint" />
        <Kpi label="Alertes ouvertes" value={String(openAlerts.length)} sub={`${ov.safety.total} au total`} tone={openAlerts.length ? 'danger' : 'muted'} />
      </section>
      {stats && <TrendsChart stats={stats} statsDays={statsDays} onStatsDays={onStatsDays} />}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Supervision de la flotte</h3><span className="adm-muted">{fleet.length} véhicules · temps réel</span></div>
        <SupervisionMap fleet={fleet} alerts={openAlerts} />
        <div className="adm-legend"><span><i className="dot green" /> Disponible</span><span><i className="dot amber" /> En course</span><span><i className="dot red pulse" /> Alerte SAMU</span></div>
      </div>
    </>
  );
}

function TrendsChart({ stats, statsDays, onStatsDays }: { stats: Stats; statsDays: number; onStatsDays: (d: number) => void }) {
  const maxRides = Math.max(1, ...stats.series.map((d) => d.rides));
  const maxRev = Math.max(1, ...stats.series.map((d) => d.revenue));
  const fmtDay = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }); };
  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Tendances · {statsDays} jours</h3>
        <div className="adm-seg">
          {[7, 14, 30].map((d) => (
            <button key={d} className={`adm-seg-b${statsDays === d ? ' on' : ''}`} onClick={() => onStatsDays(d)}>{d} j</button>
          ))}
        </div>
      </div>
      <div className="adm-trend-kpis">
        <div><span className="adm-muted">Courses</span><strong>{stats.totals.rides}</strong></div>
        <div><span className="adm-muted">Revenu</span><strong>{fcfa(stats.totals.revenue)}</strong></div>
        <div><span className="adm-muted">Annulations</span><strong>{stats.totals.cancelled}</strong></div>
      </div>
      <div className="adm-chart" style={{ '--cols': stats.series.length } as CSSProperties}>
        {stats.series.map((d) => (
          <div key={d.date} className="adm-chart-col" title={`${d.date} · ${d.rides} courses · ${fcfa(d.revenue)} · ${d.cancelled} annulées`}>
            <div className="adm-chart-bars">
              <span className="adm-bar rides" style={{ height: `${(d.rides / maxRides) * 100}%` }} />
              <span className="adm-bar rev" style={{ height: `${(d.revenue / maxRev) * 100}%` }} />
            </div>
            <span className="adm-chart-x">{fmtDay(d.date)}</span>
          </div>
        ))}
      </div>
      <div className="adm-legend">
        <span><i className="dot green" /> Courses / jour</span>
        <span><i className="dot teal" /> Revenu / jour</span>
      </div>
    </div>
  );
}

function AlertsSection({ alerts, fleet, openAlerts, canWrite, onStatus }: { alerts: Alert[]; fleet: FleetUnit[]; openAlerts: Alert[]; canWrite: boolean; onStatus: (id: string, s: string) => void }) {
  return (
    <div className="adm-grid2">
      <div className="adm-card"><div className="adm-card-h"><h3>Carte des alertes</h3><span className="adm-muted">SAMU 185 · Police 170</span></div><SupervisionMap fleet={fleet} alerts={openAlerts} /></div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>File d'alertes</h3></div>
        <div className="adm-alert-list">
          {alerts.length === 0 && <p className="adm-empty">Aucune alerte. Tout est calme. ✅</p>}
          {alerts.map((a) => (
            <div key={a.id} className={`adm-alert ${a.status}`}>
              <div className="adm-alert-top">
                <span className={`adm-tag ${a.kind}`}>{a.kind === 'crash' ? '🚨 Accident' : '🆘 SOS'}</span>
                <span className="adm-alert-zone">{a.zoneName ?? 'Zone inconnue'}{a.impactG ? ` · ${a.impactG}g` : ''}</span>
                <span className={`adm-status ${a.status}`}>{statusLabel(a.status)}</span>
              </div>
              <div className="adm-alert-meta">Client {a.userId.slice(0, 8)} · {new Date(a.createdAt).toLocaleTimeString('fr-FR')} · SAMU {a.dispatchedTo.join(', ')}</div>
              {canWrite && a.status !== 'resolved' && a.status !== 'cancelled' && (
                <div className="adm-alert-actions">
                  <button className="adm-btn xs" onClick={() => onStatus(a.id, 'acknowledged')}>Prendre en charge</button>
                  <button className="adm-btn xs solid" onClick={() => onStatus(a.id, 'resolved')}>Résolue</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const REASSIGNABLE = new Set(['searching', 'no_driver', 'accepted', 'driver_en_route', 'arrived']);

function RidesSection({ rides, meta, onPage, canWrite, onReassign, onOpen }: { rides: RideRow[]; meta: PageMeta; onPage: (p: number) => void; canWrite: boolean; onReassign: (id: string) => void; onOpen: (id: string) => void }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Courses</h3><span className="adm-muted">{meta.total} · cliquer = fiche (tracé GPS, tarif)</span></div>
      <table className="adm-table">
        <thead><tr><th>Course</th><th>Chauffeur</th><th>Statut</th><th>Trafic</th><th className="r">Montant</th>{canWrite && <th>Actions</th>}</tr></thead>
        <tbody>
          {rides.map((r) => (
            <tr key={r.id} className="adm-row-click" onClick={() => onOpen(r.id)}>
              <td className="mono">{r.id.slice(0, 8)}</td><td>{r.driverName ?? '—'}</td>
              <td><span className={`adm-pill s-${r.status}`}>{rideStatusLabel(r.status)}</span></td>
              <td>{trafficLabel(r.trafficLevel)}</td><td className="r">{fcfa(r.amount)}</td>
              {canWrite && (
                <td onClick={(e) => e.stopPropagation()}>
                  {REASSIGNABLE.has(r.status) && <button className="adm-btn xs" onClick={() => onReassign(r.id)}>Réassigner</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Pager meta={meta} onPage={onPage} />
    </div>
  );
}

/* ---------------------- Dispatch & affectation ------------------------ */
const STRATEGIES: { id: OpsConfig['strategy']; label: string; desc: string }[] = [
  { id: 'nearest', label: 'Le plus proche', desc: 'Minimise l’attente du client. Recommandé en ville.' },
  { id: 'longest_idle', label: 'Le plus ancien en attente', desc: 'Équité de revenus entre chauffeurs (FIFO global).' },
  { id: 'zone_queue', label: 'File d’attente par zone', desc: 'FIFO dans les zones denses (aéroport, gares) — plus proche ailleurs.' },
];

function DispatchSection({ ops, onSave }: { ops: OpsConfig; onSave: (p: Partial<OpsConfig>) => void }) {
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          La <strong>règle d'attribution</strong> décide quel chauffeur reçoit chaque course. Effet immédiat
          sur toutes les nouvelles courses. En cas de bug ou de chauffeur injoignable, la course peut être
          <strong> réassignée manuellement</strong> depuis la table Courses.
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Règle d'attribution des courses</h3></div>
        <div className="stack" style={{ gap: 10 }}>
          {STRATEGIES.map((s) => (
            <button key={s.id} className={`adm-role-card${ops.strategy === s.id ? ' on' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => onSave({ strategy: s.id })}>
              <div className="row between"><strong>{s.label}</strong>{ops.strategy === s.id && <span className="adm-pill av-online">Active</span>}</div>
              <p className="adm-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{s.desc}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Filtre ETA & cascade d'attribution</h3></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="price-field"><span>ETA max chauffeur (minutes)</span>
            <input type="number" min={2} max={30} value={ops.maxEtaMinutes} onChange={(e) => onSave({ maxEtaMinutes: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Délai d'acceptation (10–15 s)</span>
            <input type="number" min={10} max={15} value={ops.offerTimeoutSec} onChange={(e) => onSave({ offerTimeoutSec: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Attente facturée (F / min)</span>
            <input type="number" min={0} max={1000} step={25} value={ops.waitFeePerMin} onChange={(e) => onSave({ waitFeePerMin: Number(e.target.value) })} />
          </label>
        </div>
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          Un chauffeur au-delà de l'ETA max n'est jamais proposé. En cascade : le meilleur profil reçoit l'offre ;
          sans réponse dans le délai, elle bascule au suivant (branché à l'app chauffeur).
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Multiplicateur de forte demande (surge)</h3></div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="row" style={{ gap: 8, alignItems: 'center', paddingBottom: 8 }}>
            <button className={`adm-toggle${ops.surgeEnabled ? ' on' : ''}`} onClick={() => onSave({ surgeEnabled: !ops.surgeEnabled })}><span /></button>
            <span style={{ fontSize: 13 }}>{ops.surgeEnabled ? 'Activé' : 'Désactivé'}</span>
          </label>
          <label className="price-field"><span>Plafond vert (incitation) ×</span>
            <input type="number" min={1} max={2} step={0.1} value={ops.surgeCapGreen} onChange={(e) => onSave({ surgeCapGreen: Number(e.target.value) })} />
          </label>
        </div>
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          La carte est découpée en cellules (~800 m). Si la demande y dépasse l'offre de 30 % → ×1.3 ; du double → ×1.5.
          Le multiplicateur est <strong>plafonné sur la flotte électrique</strong> : prix stable pour le choix vert,
          et toujours intégré AVANT le verrouillage — le prix affiché reste le prix payé.
        </p>
      </div>
    </>
  );
}

/* ------------------------- Qualité & notes ---------------------------- */
function QualitySection({ q, canWrite, onWarn, onSuspend, onSaveOps }: {
  q: { threshold: number; autoWarn: boolean; drivers: QualityRow[] };
  canWrite: boolean; onWarn: (id: string) => void; onSuspend: (id: string) => void; onSaveOps: (p: Partial<OpsConfig>) => void;
}) {
  const below = q.drivers.filter((d) => d.below).length;
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="Seuil qualité" value={`★ ${q.threshold.toFixed(1)}`} sub="note moyenne minimale" tone="green" />
        <Kpi label="Sous le seuil" value={String(below)} sub="chauffeurs à surveiller" tone={below ? 'danger' : 'muted'} />
        <Kpi label="Avertissement auto" value={q.autoWarn ? 'Activé' : 'Coupé'} sub="dès la 5e note sous le seuil" tone="teal" />
        <Kpi label="Chauffeurs suivis" value={String(q.drivers.length)} sub="classés par note croissante" tone="mint" />
      </section>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Réglages qualité</h3></div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Seuil (note minimale)</span>
              <input type="number" min={1} max={5} step={0.1} value={q.threshold} onChange={(e) => onSaveOps({ minRating: Number(e.target.value) })} />
            </label>
            <label className="row" style={{ gap: 8, alignItems: 'center', paddingBottom: 8 }}>
              <button className={`adm-toggle${q.autoWarn ? ' on' : ''}`} onClick={() => onSaveOps({ autoWarn: !q.autoWarn })}><span /></button>
              <span style={{ fontSize: 13 }}>Avertissement automatique sous le seuil</span>
            </label>
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Modération des notes</h3><span className="adm-muted">{q.drivers.length}</span></div>
        <table className="adm-table">
          <thead><tr><th>Chauffeur</th><th>Matricule</th><th className="r">Note</th><th className="r">Courses</th><th className="r">Avertissements</th><th>État</th>{canWrite && <th>Actions</th>}</tr></thead>
          <tbody>
            {q.drivers.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td><td className="mono">{d.matricule}</td>
                <td className={`r ${d.below ? 'neg' : ''}`}>★ {d.rating.toFixed(2)}</td>
                <td className="r">{d.trips}</td>
                <td className="r">{d.warnings > 0 ? <span className="adm-pill tr-pending">{d.warnings}</span> : '—'}</td>
                <td>{d.below ? <span className="adm-pill tr-rejected">Sous le seuil</span> : <span className="adm-pill av-online">OK</span>}</td>
                {canWrite && (
                  <td><div className="row" style={{ gap: 6 }}>
                    <button className="adm-btn xs" onClick={() => onWarn(d.id)}>Avertir</button>
                    {d.kycStatus !== 'suspended' && d.below && <button className="adm-btn xs" onClick={() => onSuspend(d.id)}>Suspendre</button>}
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------ Litiges ------------------------------- */
const DISPUTE_KIND: Record<string, string> = { objet_perdu: '🧳 Objet perdu', trajet: '🗺️ Contestation trajet', facturation: '🧾 Facturation', comportement: '⚠️ Comportement' };
const DISPUTE_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Ouvert', cls: 'tr-pending' },
  investigating: { label: 'En instruction', cls: 'tr-pending' },
  resolved: { label: 'Résolu', cls: 'tr-approved' },
  rejected: { label: 'Rejeté', cls: 'tr-rejected' },
};

function DisputesSection({ disputes, canWrite, onDecide, onOpenRide }: {
  disputes: Dispute[]; canWrite: boolean;
  onDecide: (id: string, s: 'investigating' | 'resolved' | 'rejected', resolution?: string, refund?: number) => void;
  onOpenRide: (rideId: string) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [refunds, setRefunds] = useState<Record<string, number>>({});
  const open = disputes.filter((d) => d.status === 'open' || d.status === 'investigating');
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Réclamations clients : objets trouvés, contestations de trajet, erreurs de facturation, comportements.
          Cliquer sur la <strong>réf. course</strong> ouvre la fiche d'instruction : <strong>tracé GPS</strong> de la
          course, tarification appliquée et événements horodatés. Un remboursement est crédité sur le
          portefeuille client et journalisé.
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Litiges</h3><span className="adm-muted">{open.length} en cours · {disputes.length} au total</span></div>
        {disputes.length === 0 && <p className="adm-empty">Aucun litige. ✅</p>}
        <div className="stack" style={{ gap: 10 }}>
          {disputes.map((d) => (
            <div key={d.id} className="adm-dispute">
              <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{DISPUTE_KIND[d.kind] ?? d.kind}</strong>
                  <span className={`adm-pill ${DISPUTE_STATUS[d.status]?.cls}`}>{DISPUTE_STATUS[d.status]?.label}</span>
                  <button className="adm-btn xs mono" onClick={() => onOpenRide(d.rideId)}>📍 {d.rideId.slice(0, 8)}</button>
                  <span className="adm-muted mono" style={{ fontSize: 11 }}>{d.clientId}</span>
                </div>
                <span className="adm-muted" style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleString('fr-FR')}</span>
              </div>
              <p style={{ margin: '8px 0', fontSize: 13 }}>{d.description}</p>
              {d.resolution && <p className="adm-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>Résolution : {d.resolution}{d.refund ? ` · remboursé ${fcfa(d.refund)}` : ''} — {d.decidedBy}</p>}
              {canWrite && (d.status === 'open' || d.status === 'investigating') && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {d.status === 'open' && <button className="adm-btn xs" onClick={() => onDecide(d.id, 'investigating')}>Instruire</button>}
                  <input className="adm-inline-input" placeholder="Note de résolution…" value={notes[d.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} />
                  <input className="adm-inline-input" style={{ width: 120 }} type="number" min={0} step={50} placeholder="Remb. (F)" value={refunds[d.id] ?? ''} onChange={(e) => setRefunds((r) => ({ ...r, [d.id]: Number(e.target.value) }))} />
                  <button className="adm-btn xs solid" onClick={() => onDecide(d.id, 'resolved', notes[d.id] || 'Litige traité', refunds[d.id] || 0)}>Résoudre</button>
                  <button className="adm-btn xs" onClick={() => onDecide(d.id, 'rejected', notes[d.id] || 'Réclamation non fondée')}>Rejeter</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* --------------- Fiche d'instruction : tracé GPS + tarif -------------- */
function ForensicDrawer({ f, onClose }: { f: RideForensic; onClose: () => void }) {
  const { ride } = f;
  const pts = ride.trace && ride.trace.length > 1 ? ride.trace : [ride.origin, ride.destination];
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const W = 380, H = 200, PAD = 16;
  const sx = (lng: number) => PAD + ((lng - minLng) / Math.max(1e-6, maxLng - minLng)) * (W - PAD * 2);
  const sy = (lat: number) => H - PAD - ((lat - minLat) / Math.max(1e-6, maxLat - minLat)) * (H - PAD * 2);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.lng).toFixed(1)},${sy(p.lat).toFixed(1)}`).join(' ');
  const bd = ride.quote.breakdown ?? {};
  return (
    <Drawer title={`Course ${ride.id.slice(0, 8)}`} sub={`${ride.clientId} · ${f.driverName ?? 'sans chauffeur'} ${f.matricule ? `(${f.matricule})` : ''}`} onClose={onClose}>
      <div className="adm-drawer-tags">
        <span className={`adm-pill s-${ride.status}`}>{rideStatusLabel(ride.status)}</span>
        <span className="adm-pill">{fcfa(ride.quote.amount)}</span>
        <span className="adm-pill">{new Date(ride.createdAt).toLocaleString('fr-FR')}</span>
      </div>
      <h4 className="adm-drawer-sec">Tracé GPS ({ride.trace?.length ?? 0} points)</h4>
      <svg className="adm-trace" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tracé GPS de la course">
        <rect x="0" y="0" width={W} height={H} rx="10" className="adm-trace-bg" />
        <path d={path} className="adm-trace-path" />
        <circle cx={sx(pts[0]!.lng)} cy={sy(pts[0]!.lat)} r="5" className="adm-trace-a" />
        <circle cx={sx(pts[pts.length - 1]!.lng)} cy={sy(pts[pts.length - 1]!.lat)} r="5" className="adm-trace-b" />
      </svg>
      <h4 className="adm-drawer-sec">Tarification appliquée</h4>
      <table className="adm-table sm">
        <tbody>
          {Object.entries({ base: 'Base', distance: 'Distance', time: 'Temps', discount: 'Remise', subtotal: 'Sous-total', tva: 'TVA', fee: 'Frais ORION', insurance: 'Assurance' })
            .filter(([k]) => bd[k] !== undefined && bd[k] !== 0)
            .map(([k, label]) => (
              <tr key={k}><td>{label}</td><td className="r">{fcfa(bd[k]!)}</td></tr>
            ))}
          <tr><td><strong>Total payé (prix fixe)</strong></td><td className="r"><strong>{fcfa(ride.quote.amount)}</strong></td></tr>
        </tbody>
      </table>
      <h4 className="adm-drawer-sec">Événements</h4>
      <ul className="adm-conv-list">
        {ride.events.map((e, i) => (
          <li key={i}><span>{e.type}</span><span className="adm-muted">{new Date(e.at).toLocaleTimeString('fr-FR')}</span></li>
        ))}
      </ul>
    </Drawer>
  );
}

function DriversSection({ drivers, canWrite, onAction, onOpen, meta, onPage }: { drivers: DriverRow[]; canWrite: boolean; onAction: (id: string, kind: 'kyc' | 'availability', value: string) => void; onOpen: (id: string) => void; meta: PageMeta; onPage: (p: number) => void }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Chauffeurs</h3><span className="adm-muted">{meta.total}</span></div>
      <table className="adm-table">
        <thead><tr><th>Nom</th><th>Matricule</th><th>Niveau</th><th>KYC</th><th>État</th><th className="r">Solde</th><th className="r">Note</th>{canWrite && <th>Actions</th>}</tr></thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id} className="adm-row-click" onClick={() => onOpen(d.id)}>
              <td>{d.name}</td><td className="mono">{d.matricule}</td><td className="cap">{d.category}</td>
              <td><span className={`adm-pill kyc-${d.kycStatus}`}>{kycLabel(d.kycStatus)}</span></td>
              <td><span className={`adm-pill av-${d.availability}`}>{availLabel(d.availability)}</span></td>
              <td className="r">{fcfa(d.balance)}</td><td className="r">★ {d.rating.toFixed(2)}</td>
              {canWrite && (
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row" style={{ gap: 6 }}>
                    {d.kycStatus !== 'active' && <button className="adm-btn xs solid" onClick={() => onAction(d.id, 'kyc', 'active')}>Approuver</button>}
                    {d.kycStatus !== 'suspended'
                      ? <button className="adm-btn xs" onClick={() => onAction(d.id, 'kyc', 'suspended')}>Suspendre</button>
                      : <button className="adm-btn xs" onClick={() => onAction(d.id, 'kyc', 'active')}>Réactiver</button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Pager meta={meta} onPage={onPage} />
    </div>
  );
}

function ClientsSection({ clients, canWrite, onStatus, onOpen, meta, onPage }: { clients: Client[]; canWrite: boolean; onStatus: (id: string, s: string) => void; onOpen: (id: string) => void; meta: PageMeta; onPage: (p: number) => void }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Clients</h3><span className="adm-muted">{meta.total}</span></div>
      <table className="adm-table">
        <thead><tr><th>Client</th><th>Téléphone</th><th className="r">Courses</th><th>Statut</th>{canWrite && <th>Actions</th>}</tr></thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="adm-row-click" onClick={() => onOpen(c.id)}>
              <td>{c.name ?? c.id}<div className="mono adm-muted" style={{ fontSize: 11 }}>{c.id}</div></td>
              <td>{c.phone ?? '—'}</td><td className="r">{c.rides}</td>
              <td><span className={`adm-pill ${c.status === 'blocked' ? 'kyc-manual_review' : 'av-online'}`}>{c.status === 'blocked' ? 'Bloqué' : 'Actif'}</span></td>
              {canWrite && (
                <td onClick={(e) => e.stopPropagation()}>{c.status === 'blocked'
                  ? <button className="adm-btn xs solid" onClick={() => onStatus(c.id, 'active')}>Débloquer</button>
                  : <button className="adm-btn xs" onClick={() => onStatus(c.id, 'blocked')}>Bloquer</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Pager meta={meta} onPage={onPage} />
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const pct = (f: number) => (f === 1 ? 'neutre' : `${f > 1 ? '+' : ''}${Math.round((f - 1) * 100)} %`);

function ZonesSection({ zones, canWrite, onSave, onToggle, onDelete, onReset }: { zones: Zone[]; canWrite: boolean; onSave: (z: Zone) => void; onToggle: (id: string, active: boolean) => void; onDelete: (id: string) => void; onReset: () => void }) {
  const [name, setName] = useState(''); const [factor, setFactor] = useState(1);
  const [lat, setLat] = useState(5.35); const [lng, setLng] = useState(-4.0); const [radiusKm, setRadiusKm] = useState(3);
  const add = () => {
    const id = slugify(name);
    if (!id) return;
    onSave({ id, name: name.trim(), factor, lat, lng, radiusKm, active: true });
    setName(''); setFactor(1);
  };
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Le <strong>facteur de zone</strong> module le prix fixe selon la commune de <strong>prise en charge</strong>.
          1 = neutre · &lt; 1 = moins cher (plus compétitif) · &gt; 1 = plus cher. Le trafic reste intégré au prix garanti.
        </p>
      </div>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Nouvelle zone</h3></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Nom (commune)</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cocody" /></label>
            <label className="price-field"><span>Facteur ×</span><input type="number" step="0.01" value={factor} onChange={(e) => setFactor(Number(e.target.value))} /></label>
            <label className="price-field"><span>Latitude</span><input type="number" step="0.0001" value={lat} onChange={(e) => setLat(Number(e.target.value))} /></label>
            <label className="price-field"><span>Longitude</span><input type="number" step="0.0001" value={lng} onChange={(e) => setLng(Number(e.target.value))} /></label>
            <label className="price-field"><span>Rayon (km)</span><input type="number" step="0.5" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} /></label>
            <button className="adm-btn solid" onClick={add}>Ajouter</button>
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Zones tarifaires</h3>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="adm-muted">{zones.length}</span>
            {canWrite && <button className="adm-btn xs" onClick={onReset}>Réinitialiser</button>}
          </div>
        </div>
        <table className="adm-table">
          <thead><tr><th>Zone</th><th className="r">Facteur</th><th className="r">Effet</th><th className="r">Rayon</th><th>Qualité de service</th><th>Actif</th>{canWrite && <th>Actions</th>}</tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td>{z.name}<div className="mono adm-muted" style={{ fontSize: 11 }}>{z.id}</div></td>
                <td className="r">× {z.factor.toFixed(2)}</td>
                <td className={`r ${z.factor < 1 ? 'pos' : z.factor > 1 ? 'neg' : ''}`}>{pct(z.factor)}</td>
                <td className="r">{z.radiusKm} km</td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {z.waitMaxMin && <span className="adm-pill" title="Temps d'attente garanti">⏱ ≤ {z.waitMaxMin} min</span>}
                    {z.minStandard && <span className="adm-pill tr-pending cap" title="Standard minimal">≥ {z.minStandard}</span>}
                    {z.pickupFee ? <span className="adm-pill" title="Frais de prise en charge">+{z.pickupFee} F</span> : null}
                    {z.driverBonus ? <span className="adm-pill av-online" title="Bonus chauffeur">🎁 {z.driverBonus} F</span> : null}
                    {z.dedicated && <span className="adm-pill tr-approved" title="Flotte cantonnée">📌 Flotte dédiée</span>}
                    {!z.waitMaxMin && !z.minStandard && !z.pickupFee && !z.driverBonus && !z.dedicated && <span className="adm-muted">—</span>}
                  </div>
                </td>
                <td><span className={`adm-pill ${z.active ? 'av-online' : 'kyc-manual_review'}`}>{z.active ? 'Actif' : 'Inactif'}</span></td>
                {canWrite && (
                  <td><div className="row" style={{ gap: 6 }}>
                    <button className="adm-btn xs" onClick={() => onToggle(z.id, !z.active)}>{z.active ? 'Désactiver' : 'Activer'}</button>
                    <button className="adm-btn xs" onClick={() => onDelete(z.id)}>Suppr.</button>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PromosSection({ promos, canWrite, onSave, onToggle, onDelete }: { promos: Promo[]; canWrite: boolean; onSave: (p: { code: string; kind: 'percent' | 'amount'; value: number; maxUses?: number }) => void; onToggle: (code: string, active: boolean) => void; onDelete: (code: string) => void }) {
  const [code, setCode] = useState(''); const [kind, setKind] = useState<'percent' | 'amount'>('percent'); const [value, setValue] = useState(20);
  return (
    <>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Nouveau code promo</h3></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Code</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BIENVENUE" /></label>
            <label className="price-field"><span>Type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'amount')} className="adm-select"><option value="percent">Pourcentage (%)</option><option value="amount">Montant (F)</option></select>
            </label>
            <label className="price-field"><span>Valeur</span><input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} /></label>
            <button className="adm-btn solid" onClick={() => { if (code.trim()) { onSave({ code: code.trim(), kind, value }); setCode(''); } }}>Créer</button>
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Codes promo</h3><span className="adm-muted">{promos.length}</span></div>
        <table className="adm-table">
          <thead><tr><th>Code</th><th>Remise</th><th className="r">Utilisations</th><th>Actif</th>{canWrite && <th>Actions</th>}</tr></thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td>{p.kind === 'percent' ? `-${p.value}%` : `-${fcfa(p.value)}`}</td>
                <td className="r">{p.uses}{p.maxUses ? ` / ${p.maxUses}` : ''}</td>
                <td><span className={`adm-pill ${p.active ? 'av-online' : 'kyc-manual_review'}`}>{p.active ? 'Actif' : 'Inactif'}</span></td>
                {canWrite && (
                  <td><div className="row" style={{ gap: 6 }}>
                    <button className="adm-btn xs" onClick={() => onToggle(p.id, !p.active)}>{p.active ? 'Désactiver' : 'Activer'}</button>
                    <button className="adm-btn xs" onClick={() => onDelete(p.id)}>Suppr.</button>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const SERVICE_LABEL: Record<string, string> = { course: 'Course (VTC)', delivery: 'Livraison moto', food: 'Food', shop: 'Achat & Vente', market: 'Supermarché', colis: 'Colis / Cargo' };
function ServicesSection({ config, canWrite, onSave }: { config: ServicesConfig; canWrite: boolean; onSave: (patch: Partial<ServicesConfig>) => void }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Services & disponibilité — {config.city}</h3><span className="adm-muted">Active/désactive les services de l'app cliente</span></div>
      <div className="opt" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--a-stroke)', marginBottom: 10 }}>
        <strong style={{ flex: 1 }}>ORION ouvert (service actif)</strong>
        <button className={`adm-toggle${config.open ? ' on' : ''}`} disabled={!canWrite} onClick={() => onSave({ open: !config.open })}><span /></button>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {Object.keys(SERVICE_LABEL).map((k) => (
          <div key={k} className="row between" style={{ padding: '8px 0' }}>
            <span>{SERVICE_LABEL[k]}</span>
            <button className={`adm-toggle${config.services[k] ? ' on' : ''}`} disabled={!canWrite} onClick={() => onSave({ services: { [k]: !config.services[k] } })}><span /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupportSection({ convs, canWrite, onReply, onStatus }: { convs: Conversation[]; canWrite: boolean; onReply: (id: string, text: string) => void; onStatus: (id: string, s: string) => void }) {
  const [sel, setSel] = useState<string | null>(convs[0]?.id ?? null);
  const [text, setText] = useState('');
  const conv = convs.find((c) => c.id === sel) ?? convs[0] ?? null;
  return (
    <div className="adm-grid2">
      <div className="adm-card" style={{ maxHeight: 640, overflow: 'auto' }}>
        <div className="adm-card-h"><h3>Conversations</h3><span className="adm-muted">{convs.length}</span></div>
        <div className="stack" style={{ gap: 6 }}>
          {convs.length === 0 && <p className="adm-empty">Aucune conversation.</p>}
          {convs.map((c) => (
            <button key={c.id} className={`adm-conv${conv?.id === c.id ? ' on' : ''}`} onClick={() => setSel(c.id)}>
              <div className="row between"><strong>{c.subject}</strong><span className={`adm-pill s-${c.status === 'open' ? 'searching' : c.status === 'pending' ? 'in_progress' : 'completed'}`}>{convStatus(c.status)}</span></div>
              <div className="adm-muted" style={{ fontSize: 12 }}>{c.clientId} · {c.messages.length} msg</div>
            </button>
          ))}
        </div>
      </div>
      <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 640 }}>
        {conv ? (
          <>
            <div className="adm-card-h"><h3>{conv.subject}</h3><span className="adm-muted">{conv.clientId}</span></div>
            <div className="adm-chat">
              {conv.messages.map((m) => (
                <div key={m.id} className={`adm-bubble ${m.from}`}>
                  <div className="adm-bubble-txt">{m.text}</div>
                  <div className="adm-bubble-meta">{m.from === 'agent' ? (m.author ?? 'Agent') : 'Client'} · {new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              ))}
            </div>
            {canWrite && (
              <div className="adm-chat-input">
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Répondre au client…" onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onReply(conv.id, text.trim()); setText(''); } }} />
                <button className="adm-btn solid" onClick={() => { if (text.trim()) { onReply(conv.id, text.trim()); setText(''); } }}>Envoyer</button>
                <button className="adm-btn ghost" onClick={() => onStatus(conv.id, 'closed')}>Clore</button>
              </div>
            )}
          </>
        ) : <p className="adm-empty">Sélectionne une conversation.</p>}
      </div>
    </div>
  );
}

function AuditSection({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Journal d'audit</h3><span className="adm-muted">{entries.length} actions</span></div>
      <table className="adm-table">
        <thead><tr><th>Quand</th><th>Auteur</th><th>Rôle</th><th>Action</th><th>Cible</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="adm-muted">{new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{e.actor}</td><td className="cap">{e.role}</td><td className="mono">{e.action}</td><td className="mono adm-muted">{e.target ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const convStatus = (s: string) => ({ open: 'Ouverte', pending: 'En attente', closed: 'Close' }[s] ?? s);

function NotifySection({ broadcasts, canWrite, onSend }: { broadcasts: Announcement[]; canWrite: boolean; onSend: (a: { audience: string; title: string; body: string }) => void }) {
  const [audience, setAudience] = useState('clients'); const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const audLabel = (a: string) => ({ clients: 'Clients', drivers: 'Chauffeurs', all: 'Tous' }[a] ?? a);
  return (
    <>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Nouvelle annonce</h3><span className="adm-muted">Diffusée en temps réel</span></div>
          <div className="price-grid">
            <label className="price-field"><span>Destinataires</span>
              <select className="adm-select" value={audience} onChange={(e) => setAudience(e.target.value)}><option value="clients">Clients</option><option value="drivers">Chauffeurs</option><option value="all">Tous</option></select>
            </label>
            <label className="price-field" style={{ gridColumn: 'span 2' }}><span>Titre</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Wi-Fi gratuit à bord" /></label>
          </div>
          <label className="price-field" style={{ marginTop: 12 }}><span>Message</span><textarea className="adm-select" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Votre message aux utilisateurs…" /></label>
          <button className="adm-btn solid" style={{ marginTop: 12 }} onClick={() => { if (title.trim() && body.trim()) { onSend({ audience, title: title.trim(), body: body.trim() }); setTitle(''); setBody(''); } }}>📣 Diffuser</button>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Annonces envoyées</h3><span className="adm-muted">{broadcasts.length}</span></div>
        <div className="stack" style={{ gap: 8 }}>
          {broadcasts.length === 0 && <p className="adm-empty">Aucune annonce.</p>}
          {broadcasts.map((a) => (
            <div key={a.id} className="adm-role-card">
              <div className="row between"><strong>{a.title}</strong><span className="adm-pill av-online">{audLabel(a.audience)}</span></div>
              <p className="adm-muted" style={{ margin: '4px 0', fontSize: 13 }}>{a.body}</p>
              <span className="adm-muted" style={{ fontSize: 11 }}>{a.author} · {new Date(a.at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const TIER_LABEL: Record<string, string> = { bronze: 'Bronze', argent: 'Argent', or: 'Or', diamant: 'Diamant', livraison: 'Livraison', ride: 'Course' };
function FinanceSection({ finance, onExport, canExport }: { finance: Finance; onExport: () => void; canExport: boolean }) {
  const tiers = Object.entries(finance.byTier);
  const maxRev = Math.max(1, ...tiers.map(([, v]) => v.revenue));
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="GMV (volume)" value={fcfa(finance.gmv)} sub="toutes courses" tone="teal" />
        <Kpi label="Revenu encaissé" value={fcfa(finance.revenue)} sub="courses payées" tone="green" />
        <Kpi label="Commission ORION" value={fcfa(finance.commission)} sub="marge plateforme" tone="mint" />
        <Kpi label="Payouts chauffeurs" value={fcfa(finance.payouts)} sub="retraits versés" tone="muted" />
      </section>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Revenu par catégorie</h3>{canExport && <button className="adm-btn ghost" onClick={onExport}>⬇ Exporter CSV</button>}</div>
        <div className="stack" style={{ gap: 10, marginTop: 6 }}>
          {tiers.map(([k, v]) => (
            <div key={k}>
              <div className="row between" style={{ fontSize: 13, marginBottom: 4 }}><span className="cap">{TIER_LABEL[k] ?? k} · {v.count} courses</span><strong>{fcfa(v.revenue)}</strong></div>
              <div className="fin-bar"><span style={{ width: `${(v.revenue / maxRev) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* --------------------------- Éditeur de prix ------------------------- */
function exampleFare(p: Pricing, tier: string, km: number): number {
  const m = p.multipliers[tier] ?? 1;
  const base = p.baseFare * m;
  const distance = km * p.perKm * m;
  const time = (km / p.avgSpeedKmh) * 60 * p.perMinute * m;
  const subtotal = Math.max(base + distance + time, p.minFare * m);
  return Math.round((subtotal * (1 + p.tvaRate + p.feeRate)) / 50) * 50;
}

function PricingEditor({ pricing, canWrite, onSave }: { pricing: Pricing; canWrite: boolean; onSave: (patch: Partial<Pricing>) => Promise<void> }) {
  const [form, setForm] = useState<Pricing>(pricing);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setForm(pricing); }, [pricing]);

  const num = (k: keyof Pricing) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  const mult = (t: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, multipliers: { ...f.multipliers, [t]: Number(e.target.value) } }));

  const save = async () => {
    setBusy(true); setSaved(false);
    try {
      await onSave({
        baseFare: form.baseFare, perKm: form.perKm, perMinute: form.perMinute, minFare: form.minFare,
        avgSpeedKmh: form.avgSpeedKmh, tvaRate: form.tvaRate, feeRate: form.feeRate,
        insuranceRate: form.insuranceRate, trafficWeight: form.trafficWeight, stopFee: form.stopFee,
        multipliers: form.multipliers,
      });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } finally { setBusy(false); }
  };

  const tiers = ['bronze', 'argent', 'or', 'diamant'];
  const F = ({ label, k, step = 10 }: { label: string; k: keyof Pricing; step?: number }) => (
    <label className="price-field"><span>{label}</span><input type="number" step={step} value={form[k] as number} onChange={num(k)} disabled={!canWrite} /></label>
  );

  return (
    <>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Tarification — leviers de prix</h3><span className="adm-muted">Effet immédiat sur toutes les nouvelles courses</span></div>
        {!canWrite && <p className="adm-empty">Lecture seule — votre rôle ne permet pas de modifier les prix.</p>}
        <div className="price-grid">
          <F label="Prise en charge (F)" k="baseFare" />
          <F label="Prix / km (F)" k="perKm" />
          <F label="Prix / min (F)" k="perMinute" />
          <F label="Course minimum (F)" k="minFare" />
          <F label="Vitesse moyenne (km/h)" k="avgSpeedKmh" step={1} />
          <F label="Forfait arrêt (F)" k="stopFee" />
          <label className="price-field"><span>TVA (%)</span><input type="number" step={1} value={Math.round(form.tvaRate * 100)} onChange={(e) => setForm((f) => ({ ...f, tvaRate: Number(e.target.value) / 100 }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Frais ORION (%)</span><input type="number" step={1} value={Math.round(form.feeRate * 100)} onChange={(e) => setForm((f) => ({ ...f, feeRate: Number(e.target.value) / 100 }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Poids trafic (0–1)</span><input type="number" step={0.1} value={form.trafficWeight} onChange={num('trafficWeight')} disabled={!canWrite} /></label>
        </div>

        <div className="adm-card-h" style={{ marginTop: 18 }}><h3 style={{ fontSize: 14 }}>Multiplicateurs par niveau</h3></div>
        <div className="price-grid">
          {tiers.map((t) => (
            <label key={t} className="price-field cap"><span>{t}</span><input type="number" step={0.05} value={form.multipliers[t] ?? 1} onChange={mult(t)} disabled={!canWrite} /></label>
          ))}
        </div>

        {canWrite && (
          <div className="row" style={{ gap: 10, marginTop: 18 }}>
            <button className="adm-btn solid" onClick={() => void save()} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les prix'}</button>
            <button className="adm-btn ghost" onClick={() => setForm(pricing)} disabled={busy}>Annuler</button>
            {saved && <span className="adm-live on" style={{ alignSelf: 'center' }}>✓ Enregistré — appliqué</span>}
          </div>
        )}
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Aperçu du prix</h3><span className="adm-muted">Exemple : trajet de 6,7 km</span></div>
        <div className="adm-kpis">
          {tiers.map((t) => (
            <Kpi key={t} label={t.toUpperCase()} value={fcfa(exampleFare(form, t, 6.7))} sub="prix fixe TTC" tone={t === 'bronze' ? 'green' : t === 'diamant' ? 'teal' : 'mint'} />
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ Rôles -------------------------------- */
/* --------------------------- Recherche globale ----------------------- */
function GlobalSearch({ onSearch, onOpenDriver, onOpenClient, onOpenRide }: {
  onSearch: (q: string) => Promise<SearchResults>;
  onOpenDriver: (id: string) => void; onOpenClient: (id: string) => void; onOpenRide: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const change = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setResults(null); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const r = await onSearch(value);
      setResults(r); setOpen(true);
    }, 220);
  };
  const close = () => { setOpen(false); setQ(''); setResults(null); };
  const empty = results && results.drivers.length === 0 && results.clients.length === 0 && results.rides.length === 0;

  return (
    <div className="adm-search">
      <input
        className="adm-search-input" type="search" placeholder="🔎 Rechercher chauffeur, client, course…"
        value={q} onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      />
      {open && results && (
        <div className="adm-search-pop">
          {empty && <p className="adm-muted" style={{ margin: 8 }}>Aucun résultat pour « {q} ».</p>}
          {results.drivers.length > 0 && (
            <div className="adm-search-group">
              <span className="adm-search-cat">Chauffeurs</span>
              {results.drivers.map((d) => (
                <button key={d.id} className="adm-search-item" onClick={() => { onOpenDriver(d.id); close(); }}>
                  <span>🧑‍✈️ {d.name}</span><span className="mono adm-muted">{d.matricule}</span>
                </button>
              ))}
            </div>
          )}
          {results.clients.length > 0 && (
            <div className="adm-search-group">
              <span className="adm-search-cat">Clients</span>
              {results.clients.map((c) => (
                <button key={c.id} className="adm-search-item" onClick={() => { onOpenClient(c.id); close(); }}>
                  <span>👤 {c.name ?? c.id}</span><span className="mono adm-muted">{c.phone ?? c.id}</span>
                </button>
              ))}
            </div>
          )}
          {results.rides.length > 0 && (
            <div className="adm-search-group">
              <span className="adm-search-cat">Courses</span>
              {results.rides.map((r) => (
                <button key={r.id} className="adm-search-item" onClick={() => { onOpenRide(r.id); close(); }}>
                  <span>🚗 {r.id.slice(0, 12)}</span><span className="adm-muted">{rideStatusLabel(r.status)} · {fcfa(r.amount)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------- Trésorerie (double validation) ------------------- */
const TR_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'En attente d’aval', cls: 'tr-pending' },
  approved: { label: 'Approuvé & exécuté', cls: 'tr-approved' },
  rejected: { label: 'Rejeté', cls: 'tr-rejected' },
};

function TreasurySection({ transfers, meName, canRequest, canApprove, onRequest, onDecide, onExport }: {
  transfers: Transfer[]; meName: string; canRequest: boolean; canApprove: boolean;
  onRequest: (i: { amount: number; destination: string; reason: string }) => void;
  onDecide: (id: string, action: 'approve' | 'reject', note?: string) => void;
  onExport: () => void;
}) {
  const [amount, setAmount] = useState(1_000_000);
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const pending = transfers.filter((t) => t.status === 'pending');
  const approvedTotal = transfers.filter((t) => t.status === 'approved').reduce((s, t) => s + t.amount, 0);
  const submit = () => {
    if (!destination.trim() || !reason.trim() || amount <= 0) return;
    onRequest({ amount, destination: destination.trim(), reason: reason.trim() });
    setDestination(''); setReason('');
  };
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          <strong>Double validation obligatoire</strong> : le Directeur Financier <em>demande</em> un virement,
          seul un membre de la direction (CEO, DG, DAA, COO) peut l'<em>approuver</em> ou le <em>rejeter</em>.
          Personne ne peut approuver sa propre demande. Chaque décision est journalisée.
        </p>
      </div>
      <section className="adm-kpis">
        <Kpi label="Demandes en attente" value={String(pending.length)} sub="à valider par la direction" tone={pending.length ? 'danger' : 'muted'} />
        <Kpi label="Virements exécutés" value={fcfa(approvedTotal)} sub={`${transfers.filter((t) => t.status === 'approved').length} virement(s)`} tone="mint" />
        <Kpi label="Total demandes" value={String(transfers.length)} sub="historique complet" tone="teal" />
        <Kpi label="Votre pouvoir" value={canApprove ? 'Approbation' : canRequest ? 'Demande' : 'Lecture'} sub={canApprove ? 'niveau direction' : canRequest ? 'aval requis' : 'consultation'} tone="green" />
      </section>
      {canRequest && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Demander un virement</h3><span className="adm-muted">soumis à l'aval de la direction</span></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Montant (F CFA)</span><input type="number" min={1} step={50000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
            <label className="price-field" style={{ minWidth: 260 }}><span>Destination (banque / compte)</span><input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="SGCI — CI93 SG01 0002 4518" /></label>
            <label className="price-field" style={{ minWidth: 220 }}><span>Motif</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Salaires, fournisseur…" /></label>
            <button className="adm-btn solid" onClick={submit}>Soumettre</button>
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Virements</h3>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="adm-muted">{transfers.length}</span>
            <button className="adm-btn xs" onClick={onExport}>⬇ Export comptable (CSV)</button>
          </div>
        </div>
        {transfers.length === 0 && <p className="adm-empty">Aucun virement pour l'instant.</p>}
        <table className="adm-table">
          <thead><tr><th>Réf.</th><th className="r">Montant</th><th>Destination</th><th>Motif</th><th>Demandé par</th><th>Statut</th><th>Décision</th>{canApprove && <th>Actions</th>}</tr></thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.id}</td>
                <td className="r"><strong>{fcfa(t.amount)}</strong></td>
                <td>{t.destination}</td>
                <td>{t.reason}</td>
                <td>{t.requestedBy}</td>
                <td><span className={`adm-pill ${TR_STATUS[t.status]?.cls ?? ''}`}>{TR_STATUS[t.status]?.label ?? t.status}</span></td>
                <td className="adm-muted" style={{ fontSize: 12 }}>{t.decidedBy ? `${t.decidedBy}${t.decisionNote ? ` — ${t.decisionNote}` : ''}` : '—'}</td>
                {canApprove && (
                  <td>
                    {t.status === 'pending' && t.requestedBy !== meName && (
                      <div className="row" style={{ gap: 6 }}>
                        <button className="adm-btn xs solid" onClick={() => onDecide(t.id, 'approve')}>Approuver</button>
                        <button className="adm-btn xs" onClick={() => onDecide(t.id, 'reject', 'Refusé par la direction')}>Rejeter</button>
                      </div>
                    )}
                    {t.status === 'pending' && t.requestedBy === meName && <span className="adm-muted" style={{ fontSize: 12 }}>Votre demande — aval d'un autre dirigeant requis</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* --------------------------- Mobilité verte --------------------------- */
function GreenSection({ g }: { g: GreenReport }) {
  const co2 = g.co2SavedTons >= 1 ? `${g.co2SavedTons.toLocaleString('fr-FR')} t` : `${g.co2SavedKg.toLocaleString('fr-FR')} kg`;
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="CO2 économisé" value={co2} sub="vs flotte thermique équivalente" tone="green" />
        <Kpi label="Trajets 100 % électriques" value={`${g.electricShare} %`} sub={`${g.kmElectric.toLocaleString('fr-FR')} km parcourus`} tone="mint" />
        <Kpi label="Trajets hybrides" value={`${g.hybridShare} %`} sub={`${g.kmHybrid.toLocaleString('fr-FR')} km parcourus`} tone="teal" />
        <Kpi label="Batteries faibles" value={String(g.fleet.lowBattery)} sub="véhicules < 20 % (exclus du dispatch si insuffisant)" tone={g.fleet.lowBattery ? 'danger' : 'muted'} />
      </section>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Hypothèses : thermique ~150 g CO2/km · électrique ~20 g/km · hybride ~90 g/km (courses terminées).
          L'algorithme <strong>écarte automatiquement</strong> du dispatch tout électrique dont la batterie ne couvre
          pas la course demandée (~1 %/km + réserve 10 %).
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Télémétrie batteries (SoC)</h3><span className="adm-muted">{g.fleet.electric} électriques · {g.fleet.hybrid} hybrides</span></div>
        {g.fleet.batteries.length === 0 && <p className="adm-empty">Aucune télémétrie remontée (app chauffeur → POST /drivers/:id/telemetry).</p>}
        <table className="adm-table">
          <thead><tr><th>Véhicule</th><th>Matricule</th><th>État</th><th style={{ width: '40%' }}>Batterie</th></tr></thead>
          <tbody>
            {g.fleet.batteries.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td><td className="mono">{b.matricule}</td>
                <td><span className={`adm-pill av-${b.availability}`}>{availLabel(b.availability)}</span></td>
                <td>
                  <div className="adm-batt">
                    <div className={`adm-batt-fill${(b.batteryPct ?? 0) < 20 ? ' low' : ''}`} style={{ width: `${b.batteryPct ?? 0}%` }} />
                    <span className="adm-batt-label">{b.batteryPct ?? 0} %</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* --------------------------- Équipes & managers ----------------------- */
function TeamsSection({ teams, allDrivers, canWrite, onSave, onDelete }: {
  teams: Team[]; allDrivers: DriverRow[]; canWrite: boolean;
  onSave: (i: { id?: string; name: string; managerUsername: string; managerName?: string; driverIds?: string[] }) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [managerUsername, setManagerUsername] = useState('');
  const [managerName, setManagerName] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const chosen = Object.keys(selected).filter((k) => selected[k]);
  const submit = () => {
    if (!name.trim() || !managerUsername.trim()) return;
    onSave({ name: name.trim(), managerUsername: managerUsername.trim(), managerName: managerName.trim() || undefined, driverIds: chosen });
    setName(''); setManagerUsername(''); setManagerName(''); setSelected({});
  };
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Chaque équipe est dirigée par un <strong>chef d'équipe</strong> (compte console, rôle « manager »)
          et se voit affilier une <strong>flotte de chauffeurs</strong>. Le manager ne voit et n'agit que sur
          SA flotte — la portée est imposée par le serveur, pas par l'affichage.
        </p>
      </div>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Créer une équipe</h3></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Nom de l'équipe</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Équipe Cocody Nord" /></label>
            <label className="price-field"><span>Identifiant du manager</span><input value={managerUsername} onChange={(e) => setManagerUsername(e.target.value)} placeholder="chef.awa" /></label>
            <label className="price-field"><span>Nom du manager</span><input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="Awa Koné" /></label>
          </div>
          <p className="adm-muted" style={{ margin: '12px 0 6px', fontSize: 12 }}>Flotte affiliée ({chosen.length} chauffeur{chosen.length > 1 ? 's' : ''}) :</p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {allDrivers.map((d) => (
              <button key={d.id} className={`adm-btn xs${selected[d.id] ? ' solid' : ''}`} onClick={() => setSelected((s) => ({ ...s, [d.id]: !s[d.id] }))}>
                {d.name}
              </button>
            ))}
          </div>
          <button className="adm-btn solid" style={{ marginTop: 12 }} onClick={submit}>Créer l'équipe</button>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Équipes</h3><span className="adm-muted">{teams.length}</span></div>
        {teams.length === 0 && <p className="adm-empty">Aucune équipe pour l'instant.</p>}
        <div className="stack" style={{ gap: 10 }}>
          {teams.map((t) => (
            <div key={t.id} className="adm-dispute">
              <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{t.name}</strong>
                  <div className="adm-muted" style={{ fontSize: 12 }}>Manager : {t.managerName ?? t.managerUsername} <span className="mono">({t.managerUsername})</span> · {t.driverIds.length} chauffeur{t.driverIds.length > 1 ? 's' : ''}</div>
                </div>
                {canWrite && <button className="adm-btn xs" onClick={() => onDelete(t.id)}>Dissoudre</button>}
              </div>
              {(t.drivers ?? []).length > 0 && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {(t.drivers ?? []).map((d) => (
                    <span key={d.id} className="adm-pill" title={d.matricule}>{d.name} · ★ {d.rating.toFixed(1)}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------- Sessions actives -------------------------- */
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
};

function SessionsSection({ sessions, self, canWrite, onRevoke }: { sessions: ActiveSession[]; self: string | null; canWrite: boolean; onRevoke: (id: string) => void }) {
  const active = sessions.filter((s) => !s.revoked);
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Qui est connecté à la console, depuis où, et depuis quand. La <strong>révocation</strong> déconnecte
          l'employé immédiatement (son jeton de session est refusé par le serveur). Visible uniquement par la direction.
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Sessions</h3><span className="adm-muted">{active.length} active(s)</span></div>
        {sessions.length === 0 && <p className="adm-empty">Aucune session JWT active. (Les jetons statiques d'automatisation n'apparaissent pas ici.)</p>}
        <table className="adm-table">
          <thead><tr><th>Employé</th><th>Rôle</th><th>IP</th><th>Appareil</th><th>Connecté</th><th>Dernière activité</th><th>Statut</th>{canWrite && <th>Actions</th>}</tr></thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.name}<div className="mono adm-muted" style={{ fontSize: 11 }}>{s.username}{s.id === self ? ' · cette session' : ''}</div></td>
                <td className="cap">{s.role}</td>
                <td className="mono">{s.ip ?? '—'}</td>
                <td className="adm-muted" style={{ fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.userAgent ?? '—'}</td>
                <td>{ago(s.createdAt)}</td>
                <td>{ago(s.lastSeenAt)}</td>
                <td><span className={`adm-pill ${s.revoked ? 'tr-rejected' : 'av-online'}`}>{s.revoked ? 'Révoquée' : 'Active'}</span></td>
                {canWrite && (
                  <td>{!s.revoked && (
                    <button className="adm-btn xs" onClick={() => onRevoke(s.id)}>
                      {s.id === self ? 'Se déconnecter' : 'Révoquer'}
                    </button>
                  )}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const ROLE_MATRIX: { role: string; label: string; desc: string; tier?: 'exec' }[] = [
  { role: 'ceo', label: 'CEO — Président Directeur Général', desc: 'Accès TOTAL au système, y compris l’approbation des virements bancaires.', tier: 'exec' },
  { role: 'dg', label: 'Directeur Général', desc: 'Accès total — direction générale, approbation des virements.', tier: 'exec' },
  { role: 'daa', label: 'Dir. des Affaires Administratives', desc: 'Accès total — administration, approbation des virements.', tier: 'exec' },
  { role: 'coo', label: 'Directeur des Opérations', desc: 'Accès total — opérations, approbation des virements.', tier: 'exec' },
  { role: 'super_admin', label: 'Super Admin (technique)', desc: 'Accès technique complet (équipe plateforme).', tier: 'exec' },
  { role: 'cfo', label: 'Directeur Financier (CFO)', desc: 'Finance complète + DEMANDE de virement — l’exécution exige l’aval d’un dirigeant (double validation).' },
  { role: 'fleet_manager', label: 'Gestionnaire de Flotte', desc: 'Validation des chauffeurs (KYC), gestion des véhicules, surveillance du dispatch, équipes.' },
  { role: 'financial_analyst', label: 'Analyste Financier', desc: 'Accès restreint en lecture : exports de données, factures, suivi des paiements chauffeurs.' },
  { role: 'manager', label: 'Chef d’équipe', desc: 'Supervise SON équipe et sa flotte affiliée uniquement — portée imposée par le serveur.' },
  { role: 'ops', label: 'Opérations / Dispatch', desc: 'Courses, chauffeurs, supervision SAMU, recherche.' },
  { role: 'finance', label: 'Équipe Finance', desc: 'Revenus, promos, trésorerie en lecture seule.' },
  { role: 'support', label: 'Support client', desc: 'Chat client, clients, courses, alertes (lecture).' },
  { role: 'viewer', label: 'Observateur', desc: 'Lecture seule sur l’ensemble.' },
];
function RolesSection({ me }: { me: Me }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Rôles & couches d'accès</h3><span className="adm-muted">Votre rôle : {me.roleLabel}</span></div>
      <div className="stack" style={{ gap: 10 }}>
        {ROLE_MATRIX.map((r) => (
          <div key={r.role} className={`adm-role-card${r.role === me.role ? ' on' : ''}`}>
            <div className="row between"><strong>{r.label}</strong>{r.role === me.role && <span className="adm-pill av-online">Vous</span>}</div>
            <p className="adm-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{r.desc}</p>
          </div>
        ))}
      </div>
      <p className="adm-muted" style={{ marginTop: 14, fontSize: 12 }}>
        Les comptes se configurent côté serveur (ADMIN_USERS, mots de passe hachés — <code>npm run hash-password</code>).
        Seuls les rôles de direction (CEO, DG, DAA, COO) peuvent approuver un virement : la double validation est imposée par le serveur, pas seulement par l'interface.
      </p>
    </div>
  );
}

/** Barre de pagination serveur (page X / Y · N éléments). */
function Pager({ meta, onPage }: { meta: PageMeta; onPage: (p: number) => void }) {
  if (meta.pages <= 1) return <div className="adm-pager"><span className="adm-muted">{meta.total} élément(s)</span></div>;
  return (
    <div className="adm-pager">
      <span className="adm-muted">{meta.total} élément(s) · page {meta.page} / {meta.pages}</span>
      <div className="row" style={{ gap: 6 }}>
        <button className="adm-btn xs" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>← Précédent</button>
        <button className="adm-btn xs" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>Suivant →</button>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`adm-kpi ${tone}`}>
      <span className="adm-kpi-label">{label}</span>
      <span className="adm-kpi-value">{value}</span>
      <span className="adm-kpi-sub">{sub}</span>
    </div>
  );
}

/* --------------------------- Fiches détaillées ----------------------- */
function Drawer({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="adm-drawer-wrap" onClick={onClose}>
      <aside className="adm-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="adm-drawer-h">
          <div><h3>{title}</h3>{sub && <span className="adm-muted mono">{sub}</span>}</div>
          <button className="adm-btn ghost xs" onClick={onClose}>✕ Fermer</button>
        </div>
        <div className="adm-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

const ledgerLabel = (t: string) => ({ ride_earning: 'Gain course', commission: 'Commission', payout: 'Retrait', topup: 'Recharge', adjustment: 'Ajustement' }[t] ?? t);

function DriverDrawer({ d, onClose }: { d: DriverDetail; onClose: () => void }) {
  return (
    <Drawer title={d.name} sub={d.matricule} onClose={onClose}>
      <div className="adm-drawer-tags">
        <span className="adm-pill cap">{d.category}</span>
        <span className={`adm-pill kyc-${d.kycStatus}`}>{kycLabel(d.kycStatus)}</span>
        <span className={`adm-pill av-${d.availability}`}>{availLabel(d.availability)}</span>
      </div>
      <div className="adm-mini-kpis">
        <div className="adm-mini-kpi"><span>Solde</span><strong>{fcfa(d.balance)}</strong></div>
        <div className="adm-mini-kpi"><span>Gains cumulés</span><strong>{fcfa(d.earnings)}</strong></div>
        <div className="adm-mini-kpi"><span>Note</span><strong>★ {d.rating.toFixed(2)}</strong></div>
        <div className="adm-mini-kpi"><span>Courses notées</span><strong>{d.trips}</strong></div>
      </div>
      <h4 className="adm-drawer-sec">Dernières courses</h4>
      {d.rides.length === 0 ? <p className="adm-muted">Aucune course.</p> : (
        <table className="adm-table sm">
          <thead><tr><th>Course</th><th>Statut</th><th className="r">Montant</th></tr></thead>
          <tbody>{d.rides.map((r) => (
            <tr key={r.id}><td className="mono">{r.id.slice(0, 10)}</td><td>{rideStatusLabel(r.status)}</td><td className="r">{fcfa(r.amount)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <h4 className="adm-drawer-sec">Mouvements du portefeuille</h4>
      {d.ledger.length === 0 ? <p className="adm-muted">Aucun mouvement.</p> : (
        <table className="adm-table sm">
          <thead><tr><th>Type</th><th className="r">Montant</th></tr></thead>
          <tbody>{d.ledger.map((e, i) => (
            <tr key={e.id ?? i}><td>{ledgerLabel(e.type)}</td><td className={`r ${e.amount < 0 ? 'neg' : 'pos'}`}>{fcfa(e.amount)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Drawer>
  );
}

function ClientDrawer({ c, onClose, onOpenSupport }: { c: ClientDetail; onClose: () => void; onOpenSupport: () => void }) {
  return (
    <Drawer title={c.name ?? c.id} sub={c.id} onClose={onClose}>
      <div className="adm-drawer-tags">
        <span className={`adm-pill ${c.status === 'blocked' ? 'kyc-manual_review' : 'av-online'}`}>{c.status === 'blocked' ? 'Bloqué' : 'Actif'}</span>
        {c.phone && <span className="adm-pill">{c.phone}</span>}
      </div>
      <div className="adm-mini-kpis">
        <div className="adm-mini-kpi"><span>Dépensé</span><strong>{fcfa(c.spent)}</strong></div>
        <div className="adm-mini-kpi"><span>Courses</span><strong>{c.rides}</strong></div>
        <div className="adm-mini-kpi"><span>Conversations</span><strong>{c.conversations.length}</strong></div>
      </div>
      <h4 className="adm-drawer-sec">Dernières courses</h4>
      {c.recentRides.length === 0 ? <p className="adm-muted">Aucune course.</p> : (
        <table className="adm-table sm">
          <thead><tr><th>Course</th><th>Statut</th><th className="r">Montant</th></tr></thead>
          <tbody>{c.recentRides.map((r) => (
            <tr key={r.id}><td className="mono">{r.id.slice(0, 10)}</td><td>{rideStatusLabel(r.status)}</td><td className="r">{fcfa(r.amount)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <h4 className="adm-drawer-sec" style={{ margin: 0 }}>Conversations</h4>
        <button className="adm-btn xs" onClick={onOpenSupport}>Ouvrir le support</button>
      </div>
      {c.conversations.length === 0 ? <p className="adm-muted">Aucune conversation.</p> : (
        <ul className="adm-conv-list">{c.conversations.map((cv) => (
          <li key={cv.id}><span>{cv.subject}</span><span className="adm-muted">{cv.messages} msg · {cv.status}</span></li>
        ))}</ul>
      )}
    </Drawer>
  );
}

const statusLabel = (s: string) => ({ raised: 'Levée', dispatched: 'Dispatchée', acknowledged: 'Prise en charge', resolved: 'Résolue', cancelled: 'Annulée' }[s] ?? s);
const rideStatusLabel = (s: string) => ({ searching: 'Recherche', accepted: 'Acceptée', driver_en_route: 'En approche', arrived: 'Arrivé', in_progress: 'En course', completed: 'Terminée', paid: 'Payée', rated: 'Notée', cancelled: 'Annulée', no_driver: 'Sans chauffeur' }[s] ?? s);
const trafficLabel = (s: string) => ({ fluid: '🟢 Fluide', dense: '🟠 Dense', jam: '🔴 Bouchon' }[s] ?? s);
const kycLabel = (s: string) => ({ draft: 'Brouillon', docs_submitted: 'Docs reçus', manual_review: 'Revue', approved: 'Approuvé', active: 'Actif', suspended: 'Suspendu' }[s] ?? s);
const availLabel = (s: string) => ({ offline: 'Hors-ligne', online: 'En ligne', on_trip: 'En course', paused: 'Pause' }[s] ?? s);
