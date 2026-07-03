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
  id: string; kind: string; status: string; rideId?: string; userId: string;
  location: { lat: number; lng: number }; zoneName?: string; impactG?: number;
  dispatchedTo: string[]; createdAt: string; note?: string;
  /* --- Session SAMU : triage, prise en charge nominative, chat, scellement --- */
  level?: 'rouge' | 'orange' | 'jaune';
  source?: string;
  agent?: string;
  chat?: SosChat[];
  closingNote?: string;
  sealed?: boolean;
  slaSeconds?: number;
}
export interface SosChat { from: 'agent' | 'usager'; author?: string; text: string; at: string }
export interface SosDossier {
  alert: Alert; presets: string[];
  ride: { id: string; status: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; trace: { lat: number; lng: number }[]; createdAt: string } | null;
  vehicle: { plate: string; model: string; color: string; engine: string } | null;
  driver: { id: string; name: string; matricule: string; phone: string | null; licenseNo: string | null; birthDate: string | null; phoneBatteryPct: number; batteryPct: number | null } | null;
  passenger: { id: string; name: string | null; phone: string | null; phoneBatteryPct: number; lastRides: { id: string; status: string; createdAt: string }[] };
  telemetry: { speedEstimateKmh: number | null; points: number; refreshSeconds: number };
  emergencyNumbers: Record<string, string>;
}
export interface SecurityAttempt {
  id: string; username?: string; name: string; role: string;
  permission?: string; section?: string; path?: string; ip?: string; at: string; notified: string[];
}
export interface Reservation {
  id: string; clientId: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number };
  category: string; scheduledFor: string; status: string; driverId?: string; driverName?: string | null;
  minutesToGo?: number; punctualityAlert?: boolean; createdAt: string;
}
export interface SupportStats { open: number; resolvedToday: number; avgFirstReplyMin: number | null; csat: number | null }
export interface Macro { title: string; text: string }
export interface Triggers {
  lowBattery: { id: string; name: string; matricule: string; batteryPct?: number; station: string | null }[];
  winback: { id: string; name: string | null; rides: number; lastSeenAt: string }[];
  offPeak: { start: number; end: number; bonus: number };
}
export interface CsatReport { series: { date: string; avg: number | null; count: number }[]; csat7d: number | null; acceptRate: number; cancelRate: number }
export interface QualityTop { id: string; name: string; matricule: string; rating: number; trips: number; vip: boolean }
export interface SimResult { sampled: number; matched: number; matchRate: number; avgEtaMin: number | null }
/* --- S8 Équipes / RH --- */
export interface StaffKpi { actor: string; role: string; total: number; support: number; moderation: number; finance: number; promos: number; lastAt: string }
export interface Shift { id: string; username: string; name: string; date: string; slot: 'matin' | 'soir' | 'nuit'; zoneId?: string; createdAt: string }
export interface MaintenanceTicket { id: string; driverId: string; kind: string; title: string; status: string; teamId?: string; assignee?: string; dueDate?: string; createdAt: string }
export interface SquadPnl { vehicles: number; active: number; grounded: number; activityRate: number; revenue: number; rides: number; roi: number }
export interface TeamMessage { id: string; teamId: string; author: string; text: string; at: string }
/* --- S9 IA --- */
export interface FraudReport {
  ghostRides: { clientId: string; driverId: string; driverName: string | null; count: number }[];
  gpsSpoof: { rideId: string; driverId: string | null; jumpMeters: number }[];
  txRisk: { id: string; name: string | null; cancellations: number; warnings: number }[];
}
export interface ElasticityCell { cell: string; lat: number; lng: number; sessions: number; rate: number; recommended: number }
export interface CopilotAnswer { query: string; answer: string; data: unknown }
/* --- S10 B2B --- */
export interface TravelPolicy { days?: number[]; hourStart?: number; hourEnd?: number; zoneIds?: string[]; maxTier?: string }
/* --- S11 Litiges --- */
export interface Garage { id: string; name: string; electric: boolean; zone: string }
export interface FleetUnit { id: string; lat: number; lng: number; name: string; matricule: string | null; category: string; availability: string; }
export interface RideRow { id: string; clientId: string; driverName: string | null; matricule: string | null; status: string; amount: number; currency: string; trafficLevel: string; anomaly?: string | null; createdAt: string; }
export interface DriverRow { id: string; name: string; matricule: string; category: string; kycStatus: string; availability: string; rating: number; trips: number; balance: number; }
export interface Pricing {
  baseFare: number; perKm: number; perMinute: number; minFare: number; avgSpeedKmh: number;
  tvaRate: number; feeRate: number; insuranceRate: number; trafficWeight: number; stopFee: number;
  multipliers: Record<string, number>; bodySurcharge: Record<string, number>;
}
export interface Me { name: string; role: string; roleLabel: string; permissions: string[] }
export interface Client { id: string; name?: string; phone?: string; status: string; rides: number; greenPoints?: number; createdAt: string; lastSeenAt: string }
export interface Promo { id: string; kind: 'percent' | 'amount'; value: number; active: boolean; uses: number; maxUses?: number; createdAt: string }
export interface ServicesConfig { city: string; open: boolean; services: Record<string, boolean> }
export interface Zone {
  id: string; name: string; factor: number; lat: number; lng: number; radiusKm: number; active: boolean;
  waitMaxMin?: number; driverBonus?: number; minStandard?: string; pickupFee?: number; dedicated?: boolean;
  surgeManual?: number;
}
export interface SupportMsg { id: string; from: 'client' | 'agent'; author?: string; text: string; at: string }
export interface Conversation { id: string; clientId: string; subject: string; status: string; priority?: number; csat?: number; assignee?: string; messages: SupportMsg[]; createdAt: string; updatedAt: string }
export interface AuditEntry { id: string; at: string; actor: string; role: string; action: string; target?: string; details?: Record<string, unknown> }
export interface Finance { currency: string; gmv: number; revenue: number; commission: number; earnings: number; payouts: number; byTier: Record<string, { count: number; revenue: number }> }
export interface Announcement {
  id: string; audience: string; title: string; body: string; author: string; at: string;
  channel?: 'push' | 'sms' | 'email'; segment?: string; zoneId?: string; scheduledAt?: string;
  stats?: { sent: number; delivered: number; opened: number; clicked: number; rides: number };
}
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
  radiusKm: number; radiusMaxKm: number; offerMode: 'cascade' | 'broadcast';
  weightRating: number; weightIdle: number; greenPriority: boolean;
  surgeThreshold: number; surgeSmoothingMin: number;
  refundCap: number; offPeakBonus: number; offPeakStart: number; offPeakEnd: number;
}
export interface Team {
  id: string; name: string; managerUsername: string; managerName?: string; driverIds: string[]; createdAt: string;
  drivers?: { id: string; name: string; matricule: string; availability: string; rating: number }[];
}
export interface GreenReport {
  co2SavedKg: number; co2SavedTons: number; kmElectric: number; kmHybrid: number;
  electricShare: number; hybridShare: number;
  fleet: { electric: number; hybrid: number; lowBattery: number; batteries: { id: string; name: string; matricule: string; batteryPct?: number; batteryHealthPct?: number | null; availability: string }[]; avgSoh?: number | null };
  topGreenClients?: { id: string; name: string | null; greenPoints: number }[];
  chargingStations?: { id: string; name: string; lat: number; lng: number; fast: boolean }[];
}
export interface PredictCell { cell: string; lat: number; lng: number; expected: number; supply: number; gap: number }
export interface ConversionCell { cell: string; lat: number; lng: number; sessions: number; orders: number; rate: number }
export interface ChurnReport {
  clients: { id: string; name: string | null; rides: number; lastSeenAt: string }[];
  drivers: { id: string; name: string; matricule: string; idleSince?: string }[];
}
export interface CorporateAccount {
  id: string; name: string; contactEmail?: string; creditLimit: number; balanceUsed: number; active: boolean; createdAt: string;
  nif?: string; billingAddress?: string; parentId?: string; policy?: TravelPolicy; kickbackRate?: number; members?: string[];
}
export interface QualityRow { id: string; name: string; matricule: string; category: string; rating: number; trips: number; warnings: number; kycStatus: string; vip?: boolean; below: boolean }
export interface Dispute {
  id: string; rideId: string; clientId: string; kind: string; description: string;
  status: 'open' | 'investigating' | 'resolved' | 'rejected';
  createdAt: string; decidedBy?: string; resolution?: string; refund?: number; decidedAt?: string;
  escalation?: string; lockedBy?: string; quarantined?: boolean; notes?: { author: string; text: string; at: string }[];
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
type Section = 'overview' | 'alerts' | 'rides' | 'drivers' | 'clients' | 'support' | 'notify' | 'pricing' | 'zones' | 'promos' | 'finance' | 'treasury' | 'dispatch' | 'quality' | 'disputes' | 'green' | 'teams' | 'intel' | 'b2b' | 'services' | 'audit' | 'sessions' | 'security' | 'roles';
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
  { id: 'intel', label: 'Intelligence', perm: 'rides:read', icon: '🧠' },
  { id: 'b2b', label: 'Entreprises (B2B)', perm: 'finance:read', icon: '🏢' },
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
  { id: 'security', label: 'Alertes sécurité', perm: 'security:read', icon: '🛑' },
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
  const [predict, setPredict] = useState<{ hour: number; cells: PredictCell[] } | null>(null);
  const [conversion, setConversion] = useState<ConversionCell[]>([]);
  const [churn, setChurn] = useState<ChurnReport | null>(null);
  const [corporate, setCorporate] = useState<CorporateAccount[]>([]);
  const [sosSel, setSosSel] = useState<SosDossier | null>(null);
  const [security, setSecurity] = useState<SecurityAttempt[]>([]);
  const [supportStats, setSupportStats] = useState<SupportStats | null>(null);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [triggers, setTriggers] = useState<Triggers | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [csat, setCsat] = useState<CsatReport | null>(null);
  const [qTop, setQTop] = useState<QualityTop[]>([]);
  // S8 Équipes / RH
  const [staffKpis, setStaffKpis] = useState<StaffKpi[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceTicket[]>([]);
  // S9 IA
  const [fraud, setFraud] = useState<FraudReport | null>(null);
  const [elasticity, setElasticity] = useState<ElasticityCell[]>([]);
  /** Modale « accès refusé » : session verrouillée, tentative signalée à la direction. */
  const [denied, setDenied] = useState<string | null>(null);
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
    setMe(DEMO.me); setOv(DEMO.overview); setStats(DEMO.stats(statsDays)); setAlerts(DEMO.sos as Alert[]); setFleet(DEMO.fleet);
    setSecurity(DEMO.security as SecurityAttempt[]);
    setSupportStats(DEMO.supportStats); setMacros(DEMO.macros);
    setTriggers(DEMO.triggers as Triggers); setReservations(DEMO.reservations as Reservation[]);
    setCsat(DEMO.csat as CsatReport); setQTop(DEMO.qualityTop as QualityTop[]);
    setStaffKpis(DEMO.staffKpis as StaffKpi[]); setShifts(DEMO.shifts as Shift[]); setMaintenance(DEMO.maintenance as MaintenanceTicket[]);
    setFraud(DEMO.fraud as FraudReport); setElasticity(DEMO.elasticity as ElasticityCell[]);
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
    setPredict(DEMO.predict); setConversion(DEMO.conversion); setChurn(DEMO.churn);
    setCorporate(DEMO.corporate as CorporateAccount[]);
    setLive(false);
  }, [statsDays, ridesPage, driversPage, clientsPage]);

  const refresh = useCallback(async () => {
    if (!API) { loadDemo(); return; }
    try {
      const meRes = await adminGet<Me>('/admin/me');
      setMe(meRes); setLive(true);
      const has = (p: string) => meRes.permissions.includes(p);
      if (has('overview:read')) { setOv(await adminGet<Overview>('/admin/overview')); setStats(await adminGet<Stats>(`/admin/stats?days=${statsDays}`)); }
      if (has('alerts:read')) {
        // Session SAMU : file de triage (niveaux + SLA). Les messages pré-enregistrés
        // sont renvoyés avec le dossier d'une alerte (SosDrawer).
        setAlerts((await adminGet<{ alerts: Alert[] }>('/admin/sos')).alerts);
      }
      if (has('security:read')) setSecurity((await adminGet<{ attempts: SecurityAttempt[] }>('/admin/security-alerts')).attempts);
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
      if (has('support:read')) {
        const sp = await adminGet<{ conversations: Conversation[]; stats?: SupportStats }>('/admin/support');
        setSupport(sp.conversations); if (sp.stats) setSupportStats(sp.stats);
        setMacros((await adminGet<{ macros: Macro[] }>('/admin/support/macros')).macros);
      }
      if (has('finance:read')) setFinance(await adminGet<Finance>('/admin/finance'));
      if (has('treasury:read')) setTransfers((await adminGet<{ transfers: Transfer[] }>('/admin/treasury')).transfers);
      if (has('sessions:read')) { const s = await adminGet<{ sessions: ActiveSession[]; self: string | null }>('/admin/sessions'); setSessions(s.sessions); setSelfSession(s.self); }
      if (has('rides:read')) setOps((await adminGet<{ ops: OpsConfig }>('/admin/dispatch')).ops);
      if (has('overview:read')) setGreen(await adminGet<GreenReport>('/admin/green'));
      if (has('teams:read')) {
        setTeams((await adminGet<{ teams: Team[] }>('/admin/teams')).teams);
        setStaffKpis((await adminGet<{ staff: StaffKpi[] }>('/admin/staff/productivity')).staff);
        setShifts((await adminGet<{ shifts: Shift[] }>('/admin/shifts')).shifts);
        setMaintenance((await adminGet<{ tickets: MaintenanceTicket[] }>('/admin/maintenance')).tickets);
      }
      if (has('rides:read')) {
        setPredict(await adminGet<{ hour: number; cells: PredictCell[] }>('/admin/predict'));
        setConversion((await adminGet<{ cells: ConversionCell[] }>('/admin/conversion')).cells);
        setFraud(await adminGet<FraudReport>('/admin/fraud'));
        setElasticity((await adminGet<{ cells: ElasticityCell[] }>('/admin/elasticity')).cells);
      }
      if (has('overview:read')) setChurn(await adminGet<ChurnReport>('/admin/churn'));
      if (has('finance:read')) setCorporate((await adminGet<{ accounts: CorporateAccount[] }>('/admin/corporate')).accounts);
      if (has('drivers:read')) {
        const q = await adminGet<{ threshold: number; autoWarn: boolean; drivers: QualityRow[]; top?: QualityTop[] }>('/admin/quality');
        setQuality(q); setQTop(q.top ?? []);
        setCsat(await adminGet<CsatReport>('/admin/quality/csat'));
      }
      if (has('notify:read')) setTriggers(await adminGet<Triggers>('/admin/notify/triggers'));
      if (has('rides:read')) setReservations((await adminGet<{ reservations: Reservation[] }>('/admin/reservations')).reservations);
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

  /** Téléchargement authentifié d'un fichier serveur (PDF/CSV) via la session JWT. */
  const downloadFile = async (path: string, filename: string) => {
    if (!API) { alert('Disponible avec le backend connecté — le document est généré côté serveur.'); return; }
    try {
      const res = await fetch(API + path, { headers: H() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { alert('Document indisponible (accès réservé ?).'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    } catch { /* réseau */ }
  };

  /* --------------- Session SAMU : triage, prise en charge, clôture --------------- */
  const claimSos = async (id: string) => {
    if (!API) { setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, agent: me?.name, status: 'acknowledged' } : a))); return; }
    try { await adminPost(`/admin/sos/${id}/claim`); void refresh(); }
    catch { alert('Alerte déjà prise en charge par un autre agent (verrou nominatif).'); }
  };
  const openSos = async (id: string) => {
    if (!API) { setSosSel(DEMO.sosDossier(id) as SosDossier); return; }
    try { setSosSel(await adminGet<SosDossier>(`/admin/sos/${id}`)); }
    catch { alert('Dossier scellé — accès réservé à la direction.'); }
  };
  const sosMessage = async (id: string, text: string) => {
    if (API) { try { await adminPost(`/admin/sos/${id}/message`, { text }); } catch { alert('Crise gérée par un autre agent.'); return; } }
    const msg: SosChat = { from: 'agent', author: me?.name, text, at: new Date().toISOString() };
    setSosSel((s) => (s && s.alert.id === id ? { ...s, alert: { ...s.alert, chat: [...(s.alert.chat ?? []), msg] } } : s));
  };
  const closeSos = async (id: string, note: string) => {
    if (API) {
      try { await adminPost(`/admin/sos/${id}/close`, { note }); }
      catch { alert('Clôture refusée : note de synthèse trop courte, ou vous n’êtes pas l’agent gestionnaire.'); return; }
    }
    setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, status: 'resolved', sealed: true, closingNote: note } : a)));
    setSosSel(null);
  };

  /* ------ Accès non autorisé : refus affiché + signalement direction ------ */
  const openLocked = async (sectionId: string, label: string) => {
    if (API) { try { await adminPost('/admin/access-denied', { section: sectionId }); } catch { /* déjà signalé côté serveur */ } }
    setDenied(`Vous n’avez pas le droit d’accéder à la session « ${label} » sans autorisation de la direction. Cette tentative vient d’être signalée à la direction (DG, CFO, DAA).`);
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

  const sendBroadcast = async (a: { audience: string; title: string; body: string; channel?: string; segment?: string; scheduledAt?: string }) => {
    const local: Announcement = {
      id: Math.random().toString(36).slice(2, 8), author: me?.name ?? 'Admin', at: new Date().toISOString(),
      ...a, channel: (a.channel as Announcement['channel']) ?? 'push',
      stats: { sent: 1240, delivered: 1203, opened: 662, clicked: 199, rides: 53 },
    };
    if (API) { try { const { announcement } = await adminPost<{ announcement: Announcement }>('/admin/broadcast', a); setBroadcasts((xs) => [announcement, ...xs]); return; } catch { /* */ } }
    setBroadcasts((xs) => [local, ...xs]);
  };

  // Déclencheurs automatisés (batterie < 15 %, win-back 30 j).
  const runTrigger = async (trigger: 'battery' | 'winback') => {
    if (!API) { alert(trigger === 'battery' ? 'Guidage borne envoyé aux véhicules < 15 % (démo).' : 'Campagne win-back envoyée avec un code RETOUR-XXXX (démo).'); return; }
    try {
      const r = await adminPost<{ sent: number; code?: string }>('/admin/notify/triggers/run', { trigger });
      alert(`${r.sent} notification(s) envoyée(s)${r.code ? ` · code ${r.code}` : ''}.`);
      void refresh();
    } catch { /* */ }
  };

  // Code promotionnel personnalisé de dédommagement (support).
  const compensate = async (clientId: string, percent: number) => {
    if (!API) { alert(`Code DESOLE-${Math.random().toString(36).slice(2, 6).toUpperCase()} (-${percent} %) envoyé à ${clientId} (démo).`); return; }
    try {
      const { promo } = await adminPost<{ promo: { id: string } }>('/admin/promos/compensation', { clientId, percent, days: 7 });
      alert(`Code ${promo.id} (-${percent} %, 7 jours) envoyé dans l’app de ${clientId}.`);
    } catch { /* */ }
  };

  // Clôture forcée / ajustement de destination en vol (centre d'intervention manuelle).
  const forceRide = async (id: string, action: 'complete' | 'cancel') => {
    if (!API) { setRides((xs) => xs.map((r) => (r.id === id ? { ...r, status: action === 'complete' ? 'completed' : 'cancelled' } : r))); return; }
    try { await adminPost(`/admin/rides/${id}/force`, { action }); void refresh(); } catch { /* déjà terminée */ }
  };
  const changeDestination = async (id: string) => {
    const input = window.prompt('Nouvelle destination — latitude, longitude :', '5.3600, -3.9850');
    if (!input) return;
    const [lat, lng] = input.split(',').map((s) => Number(s.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { alert('Coordonnées invalides.'); return; }
    if (!API) { alert('Destination mise à jour, devis recalculé (démo).'); return; }
    try {
      const r = await adminPut<{ ride: { amount: number } }>(`/admin/rides/${id}/destination`, { lat, lng });
      alert(`Destination mise à jour — nouveau prix fixe : ${fcfa(r.ride.amount)}.`);
      void refresh();
    } catch { alert('Destination modifiable uniquement en course active.'); }
  };

  // Réservations à l'avance : assignation / annulation.
  const assignReservation = async (id: string) => {
    if (!API) { setReservations((xs) => xs.map((r) => (r.id === id ? { ...r, status: 'assignee', driverName: 'Serge Aka', punctualityAlert: false } : r))); return; }
    try { await adminPost(`/admin/reservations/${id}/assign`); void refresh(); }
    catch { alert('Aucun chauffeur disponible pour cette réservation.'); }
  };
  const cancelReservation = async (id: string) => {
    if (API) { try { await adminPost(`/admin/reservations/${id}/cancel`); } catch { /* */ } }
    setReservations((xs) => xs.map((r) => (r.id === id ? { ...r, status: 'annulee' } : r)));
  };

  // Programme VIP / Top Driver (priorité dispatch + commission réduite).
  const setVip = async (id: string, vip: boolean) => {
    if (API) { try { await adminPost(`/admin/drivers/${id}/vip`, { vip }); } catch { /* */ } }
    setQTop((xs) => xs.map((t) => (t.id === id ? { ...t, vip } : t)));
  };

  // Shadow mode : simulation d'une configuration hypothétique de dispatch.
  const simulate = async (patch: { maxEtaMinutes?: number; radiusMaxKm?: number }): Promise<{ current: SimResult; proposed: SimResult } | null> => {
    if (!API) return DEMO.simulate(patch);
    try { return await adminPost<{ current: SimResult; proposed: SimResult }>('/admin/dispatch/simulate', patch); }
    catch { return null; }
  };

  /* --- S8 Équipes / RH : shifts, maintenance, micro-broadcast, P&L --- */
  const assignShift = async (input: { username: string; name: string; date: string; slot: string; zoneId?: string }) => {
    if (API) { try { await adminPut('/admin/shifts', input); void refresh(); return; } catch { /* */ } }
    setShifts((xs) => [...xs, { id: Math.random().toString(36).slice(2, 8), createdAt: new Date().toISOString(), ...input } as Shift]);
  };
  const removeShift = async (id: string) => {
    if (API) await adminDel(`/admin/shifts/${id}`);
    setShifts((xs) => xs.filter((s) => s.id !== id));
  };
  const openMaintenance = async (input: { driverId: string; kind: string; title: string; teamId?: string }) => {
    if (API) { try { await adminPost('/admin/maintenance', input); void refresh(); return; } catch { /* */ } }
    setMaintenance((xs) => [{ id: Math.random().toString(36).slice(2, 8), status: 'ouvert', createdAt: new Date().toISOString(), ...input } as MaintenanceTicket, ...xs]);
  };
  const resolveMaintenance = async (id: string) => {
    if (API) { try { await adminPost(`/admin/maintenance/${id}/resolve`); } catch { /* */ } }
    setMaintenance((xs) => xs.map((t) => (t.id === id ? { ...t, status: 'resolu' } : t)));
  };
  const microBroadcast = async (teamId: string, title: string, body: string) => {
    if (!API) { alert(`Micro-broadcast envoyé à la flotte de l'équipe (démo).`); return; }
    try { const r = await adminPost<{ sent: number }>(`/admin/teams/${teamId}/broadcast`, { title, body }); alert(`${r.sent} chauffeur(s) de la flotte notifié(s).`); }
    catch { /* */ }
  };
  const loadSquadPnl = async (teamId: string): Promise<SquadPnl | null> => {
    if (!API) return DEMO.squadPnl(teamId);
    try { return (await adminGet<{ pnl: SquadPnl }>(`/admin/teams/${teamId}/pnl`)).pnl; } catch { return null; }
  };

  /* --- S9 IA : copilote conversationnel --- */
  const askCopilot = async (q: string): Promise<CopilotAnswer | null> => {
    if (!API) return DEMO.copilot(q);
    try { return await adminPost<CopilotAnswer>('/admin/copilot', { q }); } catch { return null; }
  };

  /* --- S10 B2B : import de masse, web booker --- */
  const importMembers = async (id: string, memberIds: string[]) => {
    if (!API) { alert(`${memberIds.length} collaborateur(s) importé(s) (démo).`); return; }
    try { const r = await adminPost<{ added: number }>(`/admin/corporate/${id}/members`, { memberIds }); alert(`${r.added} nouveau(x) collaborateur(s) rattaché(s).`); void refresh(); }
    catch { /* */ }
  };
  const webBook = async (id: string, input: { guestName: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; category: string }) => {
    if (!API) { alert(`Course conciergerie réservée pour ${input.guestName} (démo). SMS de suivi GPS + plaque envoyé.`); return; }
    try { const r = await adminPost<{ booking: { amount: number } }>(`/admin/corporate/${id}/book`, input); alert(`Course réservée pour ${input.guestName} — ${fcfa(r.booking.amount)}. SMS de suivi envoyé.`); void refresh(); }
    catch { alert('Réservation refusée (politique entreprise ou crédit dépassé).'); }
  };

  /* --- S11 Litiges : escalade, quarantaine, notes --- */
  const escalateDispute = async (id: string, kind: string) => {
    if (API) { try { await adminPost(`/admin/disputes/${id}/escalate`, { kind }); void refresh(); return; } catch { alert('Dossier déjà verrouillé par un autre expert.'); return; } }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, escalation: kind, lockedBy: me?.name, status: 'investigating' } : d)));
  };
  const quarantineDispute = async (id: string, on: boolean) => {
    if (API) { try { await adminPost(`/admin/disputes/${id}/quarantine`, { on }); void refresh(); return; } catch { /* */ } }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, quarantined: on } : d)));
  };
  const noteDispute = async (id: string, text: string) => {
    if (API) { try { await adminPost(`/admin/disputes/${id}/note`, { text }); void refresh(); return; } catch { alert('Note réservée à l’expert gestionnaire.'); return; } }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, notes: [...(d.notes ?? []), { author: me?.name ?? 'Expert', text, at: new Date().toISOString() }] } : d)));
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

  // B2B : comptes entreprises (ligne de crédit, facture, règlement).
  const saveCorporate = async (input: { id?: string; name: string; contactEmail?: string; creditLimit: number }) => {
    if (!API) {
      const id = input.id ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      setCorporate((xs) => {
        const ex = xs.find((a) => a.id === id);
        const next: CorporateAccount = { id, name: input.name, contactEmail: input.contactEmail, creditLimit: input.creditLimit, balanceUsed: ex?.balanceUsed ?? 0, active: true, createdAt: ex?.createdAt ?? new Date().toISOString() };
        return ex ? xs.map((a) => (a.id === id ? next : a)) : [...xs, next];
      });
      return;
    }
    try { await adminPut('/admin/corporate', input); void refresh(); } catch { /* */ }
  };
  const settleCorporate = async (id: string) => {
    if (API) { try { await adminPost(`/admin/corporate/${id}/settle`); } catch { /* */ } }
    setCorporate((xs) => xs.map((a) => (a.id === id ? { ...a, balanceUsed: 0 } : a)));
  };
  const exportInvoice = (id: string) => void downloadCsv(`/admin/corporate/${id}/invoice`, `facture-${id}.csv`, () => {
    const acc = corporate.find((a) => a.id === id);
    return `"Facture ORION — ${acc?.name ?? id}"\ncourse,date,client,statut,montant_fcfa\n"TOTAL",,,,"${acc?.balanceUsed ?? 0}"`;
  });

  // Bilan carbone PDF (via session JWT).
  const downloadCarbonPdf = async () => {
    if (!API) { alert('Disponible avec le backend connecté — le PDF est généré côté serveur.'); return; }
    try {
      const res = await fetch(`${API}/admin/green/report.pdf`, { headers: H() });
      if (res.status === 401) { onUnauthorized(); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'orion-bilan-carbone.pdf'; a.click(); URL.revokeObjectURL(url);
    } catch { /* */ }
  };

  // Campagne de réengagement (churn) → diffusion clients avec code promo.
  const reengage = () => void sendBroadcast({
    audience: 'clients',
    title: 'Tu nous manques 💚',
    body: 'Reviens rouler vert avec ORION : -20 % sur ta prochaine course avec le code RETOUR20.',
  });

  // Révoque une session (l'employé est déconnecté immédiatement).
  const revokeSess = async (id: string) => {
    if (API) { try { await adminPost(`/admin/sessions/${id}/revoke`); } catch { /* */ } }
    setSessions((xs) => xs.map((s) => (s.id === id ? { ...s, revoked: true } : s)));
    if (id === selfSession) { clearSession(); window.location.reload(); } // on s'est déconnecté soi-même
  };

  if (!me || !ov) return <div className="adm-loading">Chargement de la console…</div>;

  const can = (p: string) => me.permissions.includes(p);
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
          {NAV.map((n) => {
            const allowed = can(n.perm);
            return (
              <button
                key={n.id}
                className={`adm-navi${section === n.id ? ' on' : ''}${allowed ? '' : ' locked'}`}
                title={allowed ? undefined : 'Session non autorisée pour votre rôle'}
                onClick={() => { if (allowed) setSection(n.id); else void openLocked(n.id, n.label); }}
              >
                <span className="adm-navi-ico">{n.icon}</span> {n.label}
                {allowed && n.id === 'alerts' && openAlerts.length > 0 && <span className="adm-navi-badge">{openAlerts.length}</span>}
                {allowed && n.id === 'security' && security.length > 0 && <span className="adm-navi-badge">{security.length}</span>}
                {!allowed && <span className="adm-navi-lock" aria-hidden>🔒</span>}
              </button>
            );
          })}
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
        {section === 'alerts' && <SamuSection alerts={alerts} fleet={fleet} openAlerts={openAlerts} canWrite={can('alerts:write')} onClaim={claimSos} onOpen={openSos} />}
        {section === 'support' && <SupportSection convs={support} stats={supportStats} macros={macros} canWrite={can('support:write')} canPromo={can('promos:write')} onReply={supportReply} onStatus={supportSetStatus} onCompensate={compensate} />}
        {section === 'rides' && (
          <>
            <RidesSection rides={rides} meta={ridesMeta} onPage={setRidesPage} canWrite={can('rides:write')} onReassign={reassignRide} onOpen={openForensic} onForce={forceRide} onDest={changeDestination} />
            <ReservationsCard reservations={reservations} canWrite={can('rides:write')} onAssign={assignReservation} onCancel={cancelReservation} />
          </>
        )}
        {section === 'dispatch' && ops && <DispatchSection ops={ops} onSave={saveOps} onSimulate={simulate} onConfigPdf={() => void downloadFile('/admin/dispatch/config.pdf', 'orion-config-dispatch.pdf')} onMatrixCsv={() => void downloadFile('/admin/pricing/matrix.csv', 'orion-matrice-tarifaire.csv')} />}
        {section === 'quality' && quality && <QualitySection q={quality} csat={csat} top={qTop} canWrite={can('drivers:write')} onWarn={warnDriver} onSuspend={(id) => driverAction(id, 'kyc', 'suspended')} onSaveOps={saveOps} onVip={setVip} onMatrixCsv={() => void downloadFile('/admin/quality.csv', 'orion-matrice-qualite.csv')} onDriverPdf={(id) => void downloadFile(`/admin/drivers/${id}/quality.pdf`, `orion-qualite-${id.slice(0, 8)}.pdf`)} />}
        {section === 'disputes' && <DisputesSection disputes={disputes} canWrite={can('support:write')} onDecide={decideDispute} onOpenRide={openForensic} onEscalate={escalateDispute} onQuarantine={quarantineDispute} onNote={noteDispute} onChargeback={(id) => void downloadFile(`/admin/disputes/${id}/chargeback.pdf`, `orion-chargeback-${id}.pdf`)} onDossier={(id) => void downloadFile(`/admin/disputes/${id}/dossier.pdf`, `orion-dossier-${id}.pdf`)} onLossCsv={() => void downloadCsv('/admin/disputes.csv', 'orion-pertes.csv', () => 'dossier,categorie,statut')} />}
        {section === 'green' && green && <GreenSection g={green} ops={ops} onPdf={() => void downloadCarbonPdf()} onEnergyCsv={() => void downloadCsv('/admin/green/energy.csv', 'orion-energie.csv', () => 'matricule,nom,motorisation,km_factures,kwh_estimes')} />}
        {section === 'teams' && <TeamsSection teams={teams} allDrivers={drivers} staffKpis={staffKpis} shifts={shifts} maintenance={maintenance} canWrite={can('teams:write')} onSave={saveTeam} onDelete={deleteTeam} onShift={assignShift} onRemoveShift={removeShift} onMaintenance={openMaintenance} onResolveMaintenance={resolveMaintenance} onBroadcast={microBroadcast} onPnl={loadSquadPnl} onHoursCsv={() => void downloadCsv('/admin/staff/hours.csv', 'orion-heures.csv', () => 'employe,identifiant,date,tranche,zone')} onEvalPdf={(u) => void downloadFile(`/admin/staff/${u}/eval.pdf`, `orion-eval-${u}.pdf`)} />}
        {section === 'intel' && <IntelSection predict={predict} conversion={conversion} churn={churn} fraud={fraud} elasticity={elasticity} canNotify={can('notify:write')} onReengage={reengage} onCopilot={askCopilot} />}
        {section === 'b2b' && <CorporateSection accounts={corporate} canWrite={can('treasury:request')} canSettle={can('treasury:approve')} canBook={can('rides:write')} onSave={saveCorporate} onSettle={settleCorporate} onInvoice={exportInvoice} onEsg={(id) => void downloadFile(`/admin/corporate/${id}/esg.pdf`, `orion-esg-${id}.pdf`)} onInvoicePdf={(id) => void downloadFile(`/admin/corporate/${id}/invoice.pdf`, `facture-${id}.pdf`)} onImport={importMembers} onBook={webBook} />}
        {section === 'drivers' && <DriversSection drivers={drivers} canWrite={can('drivers:write')} onAction={driverAction} onOpen={openDriver} meta={driversMeta} onPage={setDriversPage} />}
        {section === 'clients' && <ClientsSection clients={clients} canWrite={can('clients:write')} onStatus={setClientStatus} onOpen={openClient} meta={clientsMeta} onPage={setClientsPage} />}
        {section === 'notify' && <NotifySection broadcasts={broadcasts} triggers={triggers} canWrite={can('notify:write')} onSend={sendBroadcast} onTrigger={runTrigger} />}
        {section === 'finance' && finance && <FinanceSection finance={finance} onExport={exportCsv} canExport={can('rides:read')} />}
        {section === 'treasury' && <TreasurySection transfers={transfers} meName={me.name} canRequest={can('treasury:request')} canApprove={can('treasury:approve')} onRequest={requestTransfer} onDecide={decideTransfer} onExport={exportTreasuryCsv} />}
        {section === 'pricing' && pricing && <PricingEditor pricing={pricing} canWrite={can('pricing:write')} onSave={savePricing} />}
        {section === 'zones' && <ZonesSection zones={zones} canWrite={can('pricing:write')} onSave={saveZone} onToggle={toggleZone} onDelete={deleteZone} onReset={resetZones} />}
        {section === 'promos' && <PromosSection promos={promos} canWrite={can('promos:write')} onSave={savePromo} onToggle={togglePromo} onDelete={deletePromo} />}
        {section === 'services' && services && <ServicesSection config={services} canWrite={can('services:write')} onSave={saveServices} />}
        {section === 'audit' && <AuditSection entries={audit} />}
        {section === 'sessions' && <SessionsSection sessions={sessions} self={selfSession} canWrite={can('sessions:write')} onRevoke={revokeSess} />}
        {section === 'security' && <SecuritySection attempts={security} />}
        {section === 'roles' && <RolesSection me={me} />}
      </main>

      {driverSel && <DriverDrawer d={driverSel} onClose={() => setDriverSel(null)} />}
      {clientSel && <ClientDrawer c={clientSel} onClose={() => setClientSel(null)} onOpenSupport={() => { setClientSel(null); setSection('support'); }} />}
      {forensic && <ForensicDrawer f={forensic} onClose={() => setForensic(null)} />}
      {sosSel && (
        <SosDrawer
          d={sosSel}
          canWrite={can('alerts:write')}
          onClose={() => setSosSel(null)}
          onMessage={sosMessage}
          onCloseAlert={closeSos}
          onPdf={(id) => void downloadFile(`/admin/sos/${id}/report.pdf`, `orion-requisition-${id.slice(0, 8)}.pdf`)}
          onCsv={(id) => void downloadFile(`/admin/sos/${id}/telemetry.csv`, `orion-telemetrie-${id.slice(0, 8)}.csv`)}
        />
      )}
      {denied && (
        <div className="adm-denied-wrap" onClick={() => setDenied(null)}>
          <div className="adm-denied" onClick={(e) => e.stopPropagation()}>
            <h3>⛔ Accès refusé</h3>
            <p>{denied}</p>
            <button className="adm-btn solid" onClick={() => setDenied(null)}>J’ai compris</button>
          </div>
        </div>
      )}
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

/* --------------------- Session SAMU (« dark room ») ------------------- */
const SOS_KIND: Record<string, string> = {
  sos: '🆘 SOS', crash: '🚨 Accident', deviation: '🧭 Déviation d’itinéraire',
  immobilisation: '⏸ Immobilisation anormale', mot_sensible: '⚠️ Mot sensible (avis)',
};
const LEVEL_META: Record<string, { label: string; cls: string }> = {
  rouge: { label: 'ROUGE', cls: 'lvl-rouge' },
  orange: { label: 'ORANGE', cls: 'lvl-orange' },
  jaune: { label: 'JAUNE', cls: 'lvl-jaune' },
};
/** Chronomètre SLA : temps écoulé depuis le déclenchement (mm:ss / h min). */
const sla = (a: Alert) => {
  const s = a.slaSeconds ?? Math.max(0, Math.round((Date.now() - Date.parse(a.createdAt)) / 1000));
  if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};

function SamuSection({ alerts, fleet, openAlerts, canWrite, onClaim, onOpen }: {
  alerts: Alert[]; fleet: FleetUnit[]; openAlerts: Alert[]; canWrite: boolean;
  onClaim: (id: string) => void; onOpen: (id: string) => void;
}) {
  return (
    <div className="samu-room">
      <div className="adm-card samu-head">
        <p className="adm-muted" style={{ margin: 0 }}>
          <strong>Centre de tri (triage)</strong> — interface épurée, sans donnée marketing ni financière.
          Niveaux : <span className="adm-pill lvl-rouge">ROUGE</span> SOS pressé · <span className="adm-pill lvl-orange">ORANGE</span> déviation
          majeure · <span className="adm-pill lvl-jaune">JAUNE</span> immobilisation anormale. La <strong>prise en charge est
          nominative</strong> : accepter une alerte la verrouille pour les autres agents. La clôture exige une
          <strong> note de synthèse</strong> ; le dossier est ensuite <strong>scellé</strong> (lecture direction uniquement).
        </p>
      </div>
      <div className="adm-grid2">
        <div className="adm-card"><div className="adm-card-h"><h3>Carte tactique</h3><span className="adm-muted">SAMU 185 · Police 170 · Pompiers 180</span></div><SupervisionMap fleet={fleet} alerts={openAlerts} /></div>
        <div className="adm-card">
          <div className="adm-card-h"><h3>File de triage</h3><span className="adm-muted">{openAlerts.length} ouverte(s)</span></div>
          <div className="adm-alert-list">
            {alerts.length === 0 && <p className="adm-empty">Aucune alerte. Tout est calme. ✅</p>}
            {alerts.map((a) => {
              const open = a.status !== 'resolved' && a.status !== 'cancelled';
              const lvl = LEVEL_META[a.level ?? 'rouge']!;
              return (
                <div key={a.id} className={`adm-alert ${a.status}${open ? ` ${lvl.cls}` : ''}`}>
                  <div className="adm-alert-top">
                    <span className={`adm-pill ${lvl.cls}`}>{lvl.label}</span>
                    <span className={`adm-tag ${a.kind}`}>{SOS_KIND[a.kind] ?? a.kind}</span>
                    {open && <span className="samu-sla mono" title="Temps écoulé depuis le déclenchement (SLA)">⏱ {sla(a)}</span>}
                    <span className={`adm-status ${a.status}`}>{a.sealed ? '🔏 Scellée' : statusLabel(a.status)}</span>
                  </div>
                  <div className="adm-alert-meta">
                    {a.zoneName ?? 'Zone inconnue'}{a.impactG ? ` · impact ${a.impactG} g` : ''} · usager {a.userId.slice(0, 10)}
                    {a.agent ? <> · <strong>pris en charge : {a.agent}</strong></> : ' · non assignée'}
                  </div>
                  <div className="adm-alert-actions">
                    {canWrite && open && !a.agent && <button className="adm-btn xs solid" onClick={() => onClaim(a.id)}>Accepter l’alerte</button>}
                    <button className="adm-btn xs" onClick={() => onOpen(a.id)}>{a.sealed ? 'Dossier scellé' : 'Ouvrir le dossier'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------- Dossier SAMU : identification, télémétrie, chat, clôture ----- */
function SosDrawer({ d, canWrite, onClose, onMessage, onCloseAlert, onPdf, onCsv }: {
  d: SosDossier; canWrite: boolean; onClose: () => void;
  onMessage: (id: string, text: string) => void;
  onCloseAlert: (id: string, note: string) => void;
  onPdf: (id: string) => void; onCsv: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const a = d.alert;
  const lvl = LEVEL_META[a.level ?? 'rouge']!;
  const pts = d.ride?.trace && d.ride.trace.length > 1 ? d.ride.trace : d.ride ? [d.ride.origin, d.ride.destination] : [];
  const open = a.status !== 'resolved' && a.status !== 'cancelled';
  return (
    <Drawer title={`Dossier ${a.id.slice(0, 8)}`} sub={`${SOS_KIND[a.kind] ?? a.kind} · niveau ${a.level ?? 'rouge'}`} onClose={onClose}>
      <div className="adm-drawer-tags">
        <span className={`adm-pill ${lvl.cls}`}>{lvl.label}</span>
        <span className="adm-pill">⏱ SLA {sla(a)}</span>
        {a.agent && <span className="adm-pill av-online">Agent : {a.agent}</span>}
        {a.sealed && <span className="adm-pill tr-rejected">🔏 Scellé</span>}
      </div>

      <h4 className="adm-drawer-sec">Fiche véhicule (à dicter à la police)</h4>
      {d.vehicle ? (
        <div className="samu-plate">
          <div className="samu-plate-no mono">{d.vehicle.plate}</div>
          <div className="adm-muted">{d.vehicle.model} · {d.vehicle.color} · {d.vehicle.engine === 'electric' ? '⚡ 100 % Électrique (batterie haute tension)' : d.vehicle.engine === 'hybrid' ? 'Hybride (batterie haute tension)' : 'Thermique'}</div>
        </div>
      ) : <p className="adm-muted">Aucun véhicule associé.</p>}

      <h4 className="adm-drawer-sec">Chauffeur & passager</h4>
      <div className="adm-mini-kpis">
        <div className="adm-mini-kpi"><span>Chauffeur</span><strong>{d.driver?.name ?? '—'}</strong></div>
        <div className="adm-mini-kpi"><span>Tél. / permis</span><strong style={{ fontSize: 12 }}>{d.driver?.phone ?? 'n/c'} · {d.driver?.licenseNo ?? 'n/c'}</strong></div>
        <div className="adm-mini-kpi"><span>📱 Batterie chauffeur</span><strong>{d.driver ? `${d.driver.phoneBatteryPct} %` : '—'}</strong></div>
        <div className="adm-mini-kpi"><span>📱 Batterie passager</span><strong>{d.passenger.phoneBatteryPct} %</strong></div>
      </div>
      <p className="adm-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        Passager : {d.passenger.name ?? d.passenger.id} · {d.passenger.phone ?? 'tél. n/c'} · {d.passenger.lastRides.length} trajets récents
        {d.passenger.lastRides.length < 2 ? ' — ⚠ compte récent (vérifier fraude)' : ''}
      </p>

      <h4 className="adm-drawer-sec">Télémétrie live (rafraîchie chaque seconde)</h4>
      <div className="adm-mini-kpis">
        <div className="adm-mini-kpi"><span>Vitesse estimée</span><strong>{d.telemetry.speedEstimateKmh ?? '—'} km/h</strong></div>
        <div className="adm-mini-kpi"><span>Points GPS</span><strong>{d.telemetry.points}</strong></div>
        <div className="adm-mini-kpi"><span>Position</span><strong style={{ fontSize: 12 }}>{a.location.lat.toFixed(4)}, {a.location.lng.toFixed(4)}</strong></div>
      </div>
      {pts.length > 1 && d.ride && (
        <>
          <p className="adm-muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>Itinéraire théorique (gris) vs réel (rouge) :</p>
          <SosTrace ride={d.ride} />
        </>
      )}

      <h4 className="adm-drawer-sec">Liaison secours</h4>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {Object.entries(d.emergencyNumbers).map(([k, v]) => (
          <span key={k} className="adm-pill lvl-rouge">📞 {k.toUpperCase()} {v}</span>
        ))}
      </div>

      <h4 className="adm-drawer-sec">Chat sécurisé discret</h4>
      <div className="adm-chat" style={{ maxHeight: 160 }}>
        {(a.chat ?? []).length === 0 && <p className="adm-muted" style={{ fontSize: 12 }}>Aucun message. Utilisez un message pré-enregistré — silencieux côté usager.</p>}
        {(a.chat ?? []).map((m, i) => (
          <div key={i} className={`adm-bubble ${m.from === 'agent' ? 'agent' : 'client'}`}>
            <div className="adm-bubble-txt">{m.text}</div>
            <div className="adm-bubble-meta">{m.from === 'agent' ? m.author ?? 'Agent' : 'Usager'} · {new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        ))}
      </div>
      {canWrite && open && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
            {d.presets.map((p) => (
              <button key={p} className="adm-btn xs" onClick={() => onMessage(a.id, p)}>{p}</button>
            ))}
          </div>
          <div className="adm-chat-input">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message libre (discret)…" onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onMessage(a.id, text.trim()); setText(''); } }} />
            <button className="adm-btn solid" onClick={() => { if (text.trim()) { onMessage(a.id, text.trim()); setText(''); } }}>Envoyer</button>
          </div>
        </>
      )}

      <h4 className="adm-drawer-sec">Réquisitions légales</h4>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="adm-btn xs solid" onClick={() => onPdf(a.id)}>⬇ Rapport de réquisition (PDF)</button>
        <button className="adm-btn xs" onClick={() => onCsv(a.id)}>⬇ Télémétrie brute (CSV)</button>
      </div>

      {canWrite && open && (
        <>
          <h4 className="adm-drawer-sec">Clôture (note de synthèse OBLIGATOIRE)</h4>
          <textarea className="adm-select" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Résumé factuel de l’incident, actions menées, issue… (10 caractères min.)" />
          <button className="adm-btn solid" style={{ marginTop: 8 }} disabled={note.trim().length < 10} onClick={() => onCloseAlert(a.id, note.trim())}>
            🔏 Clore & sceller le dossier
          </button>
          <p className="adm-muted" style={{ fontSize: 11, marginTop: 6 }}>Après scellement, le dossier n’est plus lisible que par la direction.</p>
        </>
      )}
      {a.closingNote && <p className="adm-muted" style={{ fontSize: 12, marginTop: 8 }}>Note de synthèse : {a.closingNote}</p>}
    </Drawer>
  );
}

/** Itinéraire théorique (gris, ligne droite) vs réel (rouge, trace GPS). */
function SosTrace({ ride }: { ride: NonNullable<SosDossier['ride']> }) {
  const pts = ride.trace.length > 1 ? ride.trace : [ride.origin, ride.destination];
  const all = [...pts, ride.origin, ride.destination];
  const lats = all.map((p) => p.lat), lngs = all.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const W = 380, H = 180, PAD = 14;
  const sx = (lng: number) => PAD + ((lng - minLng) / Math.max(1e-6, maxLng - minLng)) * (W - PAD * 2);
  const sy = (lat: number) => H - PAD - ((lat - minLat) / Math.max(1e-6, maxLat - minLat)) * (H - PAD * 2);
  const real = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.lng).toFixed(1)},${sy(p.lat).toFixed(1)}`).join(' ');
  return (
    <svg className="adm-trace" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Itinéraire théorique vs réel">
      <rect x="0" y="0" width={W} height={H} rx="10" className="adm-trace-bg" />
      <line x1={sx(ride.origin.lng)} y1={sy(ride.origin.lat)} x2={sx(ride.destination.lng)} y2={sy(ride.destination.lat)} className="samu-theoretical" />
      <path d={real} className="samu-real" />
      <circle cx={sx(ride.origin.lng)} cy={sy(ride.origin.lat)} r="5" className="adm-trace-a" />
      <circle cx={sx(ride.destination.lng)} cy={sy(ride.destination.lat)} r="5" className="adm-trace-b" />
    </svg>
  );
}

/* ------- Alertes sécurité interne (tentatives d'accès non autorisé) ------- */
function SecuritySection({ attempts }: { attempts: SecurityAttempt[] }) {
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Chaque fois qu'un employé tente d'ouvrir une <strong>session qui ne lui est pas autorisée</strong>,
          le refus lui est notifié et la tentative est <strong>signalée ici à la direction (DG, CFO, DAA)</strong>,
          en plus du journal d'audit. Boîte réservée à la direction.
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Tentatives d'accès non autorisé</h3><span className="adm-muted">{attempts.length}</span></div>
        {attempts.length === 0 && <p className="adm-empty">Aucune tentative signalée. ✅</p>}
        <table className="adm-table">
          <thead><tr><th>Quand</th><th>Employé</th><th>Rôle</th><th>Session / permission visée</th><th>IP</th><th>Notifiés</th></tr></thead>
          <tbody>
            {attempts.map((s) => (
              <tr key={s.id}>
                <td className="adm-muted">{new Date(s.at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{s.name}{s.username && <div className="mono adm-muted" style={{ fontSize: 11 }}>{s.username}</div>}</td>
                <td className="cap">{s.role}</td>
                <td className="mono">{s.section ?? s.permission ?? s.path ?? '—'}</td>
                <td className="mono">{s.ip ?? '—'}</td>
                <td><span className="adm-pill tr-pending">{s.notified.join(' · ')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const REASSIGNABLE = new Set(['searching', 'no_driver', 'accepted', 'driver_en_route', 'arrived']);
const ACTIVE_RIDE = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress']);
const ANOMALY_LABEL: Record<string, string> = {
  detour: '🔴 Détour majeur', attente_longue: '🟠 Attente longue',
  sans_chauffeur: '🟠 Sans chauffeur', immobile: '🔴 Immobile',
};

function RidesSection({ rides, meta, onPage, canWrite, onReassign, onOpen, onForce, onDest }: {
  rides: RideRow[]; meta: PageMeta; onPage: (p: number) => void; canWrite: boolean;
  onReassign: (id: string) => void; onOpen: (id: string) => void;
  onForce: (id: string, action: 'complete' | 'cancel') => void; onDest: (id: string) => void;
}) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Courses (radar temps réel)</h3><span className="adm-muted">{meta.total} · anomalies en surbrillance · cliquer = fiche (tracé GPS, tarif)</span></div>
      <table className="adm-table">
        <thead><tr><th>Course</th><th>Chauffeur</th><th>Statut</th><th>Anomalie</th><th>Trafic</th><th className="r">Montant</th>{canWrite && <th>Interventions</th>}</tr></thead>
        <tbody>
          {rides.map((r) => (
            <tr key={r.id} className={`adm-row-click${r.anomaly ? ' anomaly' : ''}`} onClick={() => onOpen(r.id)}>
              <td className="mono">{r.id.slice(0, 8)}</td><td>{r.driverName ?? '—'}</td>
              <td><span className={`adm-pill s-${r.status}`}>{rideStatusLabel(r.status)}</span></td>
              <td>{r.anomaly ? <span className="adm-pill tr-rejected">{ANOMALY_LABEL[r.anomaly] ?? r.anomaly}</span> : <span className="adm-muted">—</span>}</td>
              <td>{trafficLabel(r.trafficLevel)}</td><td className="r">{fcfa(r.amount)}</td>
              {canWrite && (
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {REASSIGNABLE.has(r.status) && <button className="adm-btn xs" title="Réaffectation d'urgence" onClick={() => onReassign(r.id)}>Réassigner</button>}
                    {ACTIVE_RIDE.has(r.status) && <button className="adm-btn xs" title="Ajuster la destination en vol (devis recalculé)" onClick={() => onDest(r.id)}>Dest.</button>}
                    {ACTIVE_RIDE.has(r.status) && <button className="adm-btn xs" title="Clôture forcée (bug réseau)" onClick={() => onForce(r.id, 'complete')}>Terminer</button>}
                    {(ACTIVE_RIDE.has(r.status) || r.status === 'searching' || r.status === 'no_driver') && <button className="adm-btn xs" title="Annulation sans frais" onClick={() => onForce(r.id, 'cancel')}>Annuler</button>}
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

/* --------------- Réservations à l'avance (courses planifiées) ---------- */
const RES_STATUS: Record<string, { label: string; cls: string }> = {
  planifiee: { label: 'Planifiée', cls: 'tr-pending' },
  assignee: { label: 'Chauffeur assigné', cls: 'tr-approved' },
  lancee: { label: 'Lancée', cls: 'av-online' },
  annulee: { label: 'Annulée', cls: 'tr-rejected' },
};
function ReservationsCard({ reservations, canWrite, onAssign, onCancel }: {
  reservations: Reservation[]; canWrite: boolean;
  onAssign: (id: string) => void; onCancel: (id: string) => void;
}) {
  const upcoming = reservations.filter((r) => r.status !== 'annulee');
  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Réservations à l'avance</h3>
        <span className="adm-muted">{upcoming.length} planifiée(s) · alerte de ponctualité à H-30 si aucun chauffeur prêt</span>
      </div>
      {reservations.length === 0 && <p className="adm-empty">Aucune réservation. Les clients planifient depuis l'app (aéroport, hôtels, rendez-vous).</p>}
      {reservations.length > 0 && (
        <table className="adm-table">
          <thead><tr><th>Réf.</th><th>Client</th><th>Prise en charge</th><th>Gamme</th><th>Statut</th><th>Chauffeur</th><th>Ponctualité</th>{canWrite && <th>Actions</th>}</tr></thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td>{r.clientId}</td>
                <td>{new Date(r.scheduledFor).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {typeof r.minutesToGo === 'number' && r.minutesToGo > 0 && <div className="adm-muted" style={{ fontSize: 11 }}>dans {r.minutesToGo >= 60 ? `${Math.round(r.minutesToGo / 60)} h` : `${r.minutesToGo} min`}</div>}
                </td>
                <td className="cap">{r.category}</td>
                <td><span className={`adm-pill ${RES_STATUS[r.status]?.cls ?? ''}`}>{RES_STATUS[r.status]?.label ?? r.status}</span></td>
                <td>{r.driverName ?? '—'}</td>
                <td>{r.punctualityAlert ? <span className="adm-pill tr-rejected">⚠ Risque de retard</span> : <span className="adm-pill av-online">OK</span>}</td>
                {canWrite && (
                  <td><div className="row" style={{ gap: 6 }}>
                    {(r.status === 'planifiee' || r.punctualityAlert) && <button className="adm-btn xs solid" onClick={() => onAssign(r.id)}>Assigner</button>}
                    {r.status !== 'annulee' && <button className="adm-btn xs" onClick={() => onCancel(r.id)}>Annuler</button>}
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------------- Dispatch & affectation ------------------------ */
const STRATEGIES: { id: OpsConfig['strategy']; label: string; desc: string }[] = [
  { id: 'nearest', label: 'Le plus proche', desc: 'Minimise l’attente du client. Recommandé en ville.' },
  { id: 'longest_idle', label: 'Le plus ancien en attente', desc: 'Équité de revenus entre chauffeurs (FIFO global).' },
  { id: 'zone_queue', label: 'File d’attente par zone', desc: 'FIFO dans les zones denses (aéroport, gares) — plus proche ailleurs.' },
];

function DispatchSection({ ops, onSave, onSimulate, onConfigPdf, onMatrixCsv }: {
  ops: OpsConfig; onSave: (p: Partial<OpsConfig>) => void;
  onSimulate: (p: { maxEtaMinutes?: number; radiusMaxKm?: number }) => Promise<{ current: SimResult; proposed: SimResult } | null>;
  onConfigPdf: () => void; onMatrixCsv: () => void;
}) {
  const [simEta, setSimEta] = useState(ops.maxEtaMinutes);
  const [simRadius, setSimRadius] = useState(ops.radiusMaxKm);
  const [simRes, setSimRes] = useState<{ current: SimResult; proposed: SimResult } | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const runSim = async () => {
    setSimBusy(true);
    try { setSimRes(await onSimulate({ maxEtaMinutes: simEta, radiusMaxKm: simRadius })); } finally { setSimBusy(false); }
  };
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
        <div className="adm-card-h"><h3>Rayon de recherche & cascade d'attribution</h3></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="price-field"><span>Rayon initial (km)</span>
            <input type="number" min={0.5} max={10} step={0.5} value={ops.radiusKm} onChange={(e) => onSave({ radiusKm: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Rayon max (élargissement auto, km)</span>
            <input type="number" min={1} max={20} step={0.5} value={ops.radiusMaxKm} onChange={(e) => onSave({ radiusMaxKm: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>ETA max chauffeur (minutes)</span>
            <input type="number" min={2} max={30} value={ops.maxEtaMinutes} onChange={(e) => onSave({ maxEtaMinutes: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Délai d'acceptation (10–15 s)</span>
            <input type="number" min={10} max={15} value={ops.offerTimeoutSec} onChange={(e) => onSave({ offerTimeoutSec: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Mode d'offre</span>
            <select className="adm-select" value={ops.offerMode} onChange={(e) => onSave({ offerMode: e.target.value as OpsConfig['offerMode'] })}>
              <option value="cascade">Cascade (un chauffeur à la fois)</option>
              <option value="broadcast">Broadcast (3 plus proches, 1er qui accepte)</option>
            </select>
          </label>
          <label className="price-field"><span>Attente facturée (F / min)</span>
            <input type="number" min={0} max={1000} step={25} value={ops.waitFeePerMin} onChange={(e) => onSave({ waitFeePerMin: Number(e.target.value) })} />
          </label>
        </div>
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          La recherche démarre au rayon initial et s'élargit automatiquement jusqu'au rayon max si personne
          n'accepte. Au-delà de l'ETA max, un chauffeur n'est jamais proposé.
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Pondération du scoring (au-delà de la distance)</h3></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="price-field"><span>Poids de la note (0 = distance pure)</span>
            <input type="number" min={0} max={10} value={ops.weightRating} onChange={(e) => onSave({ weightRating: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Poids de l'inactivité (lissage revenus)</span>
            <input type="number" min={0} max={10} value={ops.weightIdle} onChange={(e) => onSave({ weightIdle: Number(e.target.value) })} />
          </label>
          <label className="row" style={{ gap: 8, alignItems: 'center', paddingBottom: 8 }}>
            <button className={`adm-toggle${ops.greenPriority ? ' on' : ''}`} onClick={() => onSave({ greenPriority: !ops.greenPriority })}><span /></button>
            <span style={{ fontSize: 13 }}>🌱 Priorisation écologique absolue (le moins émetteur d'abord)</span>
          </label>
        </div>
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          Exemple : avec un poids de note élevé, un chauffeur 4.9/5 l'emporte sur un 4.2/5 un peu plus proche.
          Le poids d'inactivité favorise un chauffeur en attente depuis 45 min (équité de revenus).
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Multiplicateur de forte demande (surge)</h3></div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="row" style={{ gap: 8, alignItems: 'center', paddingBottom: 8 }}>
            <button className={`adm-toggle${ops.surgeEnabled ? ' on' : ''}`} onClick={() => onSave({ surgeEnabled: !ops.surgeEnabled })}><span /></button>
            <span style={{ fontSize: 13 }}>{ops.surgeEnabled ? 'Activé' : 'Désactivé'}</span>
          </label>
          <label className="price-field"><span>Seuil demande/offre ×</span>
            <input type="number" min={1.1} max={3} step={0.1} value={ops.surgeThreshold} onChange={(e) => onSave({ surgeThreshold: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Plafond vert (incitation) ×</span>
            <input type="number" min={1} max={2} step={0.1} value={ops.surgeCapGreen} onChange={(e) => onSave({ surgeCapGreen: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Lissage retour normale (min)</span>
            <input type="number" min={0} max={30} value={ops.surgeSmoothingMin} onChange={(e) => onSave({ surgeSmoothingMin: Number(e.target.value) })} />
          </label>
        </div>
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          La carte est découpée en cellules (~800 m). Si la demande y dépasse l'offre de 30 % → ×1.3 ; du double → ×1.5.
          Le multiplicateur est <strong>plafonné sur la flotte électrique</strong> et intégré AVANT le verrouillage —
          le prix affiché reste le prix payé. Un <strong>surge manuel d'urgence</strong> se force zone par zone
          (section Zones &amp; tarifs, champ « surge manuel » — stade, concert…).
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Plafond support & heures creuses (verte)</h3></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="price-field"><span>Plafond remboursement agent (F)</span>
            <input type="number" min={0} max={100000} step={500} value={ops.refundCap} onChange={(e) => onSave({ refundCap: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Bonus recharge heures creuses (F)</span>
            <input type="number" min={0} max={5000} step={50} value={ops.offPeakBonus} onChange={(e) => onSave({ offPeakBonus: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Début heures creuses (h)</span>
            <input type="number" min={0} max={23} value={ops.offPeakStart} onChange={(e) => onSave({ offPeakStart: Number(e.target.value) })} />
          </label>
          <label className="price-field"><span>Fin heures creuses (h)</span>
            <input type="number" min={0} max={23} value={ops.offPeakEnd} onChange={(e) => onSave({ offPeakEnd: Number(e.target.value) })} />
          </label>
        </div>
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          Au-delà du plafond, un remboursement exige l'escalade au Superviseur Support (imposé par le serveur).
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Simulateur d'algorithme (shadow mode)</h3><span className="adm-muted">aucun impact sur le réseau réel</span></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="price-field"><span>ETA max testé (min)</span>
            <input type="number" min={2} max={30} value={simEta} onChange={(e) => setSimEta(Number(e.target.value))} />
          </label>
          <label className="price-field"><span>Rayon max testé (km)</span>
            <input type="number" min={1} max={20} value={simRadius} onChange={(e) => setSimRadius(Number(e.target.value))} />
          </label>
          <button className="adm-btn solid" onClick={() => void runSim()} disabled={simBusy}>{simBusy ? 'Simulation…' : '▶ Simuler sur l’historique'}</button>
        </div>
        {simRes && (
          <table className="adm-table sm" style={{ marginTop: 12 }}>
            <thead><tr><th>Configuration</th><th className="r">Courses rejouées</th><th className="r">Matchées</th><th className="r">Taux</th><th className="r">ETA moyen</th></tr></thead>
            <tbody>
              <tr><td>Actuelle</td><td className="r">{simRes.current.sampled}</td><td className="r">{simRes.current.matched}</td><td className="r">{simRes.current.matchRate} %</td><td className="r">{simRes.current.avgEtaMin ?? '—'} min</td></tr>
              <tr><td><strong>Proposée</strong></td><td className="r">{simRes.proposed.sampled}</td><td className="r">{simRes.proposed.matched}</td>
                <td className={`r ${simRes.proposed.matchRate >= simRes.current.matchRate ? 'pos' : 'neg'}`}><strong>{simRes.proposed.matchRate} %</strong></td>
                <td className="r">{simRes.proposed.avgEtaMin ?? '—'} min</td></tr>
            </tbody>
          </table>
        )}
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Exports professionnels</h3></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="adm-btn xs solid" onClick={onConfigPdf}>⬇ Documentation technique (PDF)</button>
          <button className="adm-btn xs" onClick={onMatrixCsv}>⬇ Matrice tarifaire (Excel/CSV)</button>
        </div>
        <p className="adm-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
          Paramètres algorithmiques compilés pour audit technique / investisseurs ; grille tarifaire complète
          (zones × gammes) prête pour la modélisation du business plan.
        </p>
      </div>
    </>
  );
}

/* ------------------------- Qualité & notes ---------------------------- */
function QualitySection({ q, csat, top, canWrite, onWarn, onSuspend, onSaveOps, onVip, onMatrixCsv, onDriverPdf }: {
  q: { threshold: number; autoWarn: boolean; drivers: QualityRow[] };
  csat: CsatReport | null; top: QualityTop[];
  canWrite: boolean; onWarn: (id: string) => void; onSuspend: (id: string) => void; onSaveOps: (p: Partial<OpsConfig>) => void;
  onVip: (id: string, vip: boolean) => void; onMatrixCsv: () => void; onDriverPdf: (id: string) => void;
}) {
  const below = q.drivers.filter((d) => d.below).length;
  const maxCsat = 5;
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="CSAT 7 jours" value={csat?.csat7d != null ? `★ ${csat.csat7d.toFixed(2)}` : '—'} sub="satisfaction plateforme" tone="green" />
        <Kpi label="Taux d'acceptation" value={csat ? `${csat.acceptRate} %` : '—'} sub="fiabilité du réseau" tone="teal" />
        <Kpi label="Taux d'annulation" value={csat ? `${csat.cancelRate} %` : '—'} sub="à contenir < 15 %" tone={csat && csat.cancelRate > 15 ? 'danger' : 'mint'} />
        <Kpi label="Sous le seuil" value={String(below)} sub={`seuil ★ ${q.threshold.toFixed(1)} · avert. auto ${q.autoWarn ? 'ON' : 'OFF'}`} tone={below ? 'danger' : 'muted'} />
      </section>
      {csat && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Courbe CSAT · 7 jours</h3><span className="adm-muted">détecte une dégradation soudaine de la qualité</span></div>
          <div className="adm-chart" style={{ '--cols': csat.series.length } as CSSProperties}>
            {csat.series.map((d) => (
              <div key={d.date} className="adm-chart-col" title={`${d.date} · ${d.avg != null ? `★ ${d.avg}` : 'aucune note'} (${d.count})`}>
                <div className="adm-chart-bars">
                  <span className="adm-bar rides" style={{ height: `${((d.avg ?? 0) / maxCsat) * 100}%` }} />
                </div>
                <span className="adm-chart-x">{new Date(d.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Programme VIP / Top Driver (top 5 %)</h3>
          <button className="adm-btn xs" onClick={onMatrixCsv}>⬇ Matrice de performance (Excel)</button>
        </div>
        {top.length === 0 && <p className="adm-empty">Pas encore assez de volume (≥ 20 courses notées) pour identifier le top 5 %.</p>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {top.map((t) => (
            <div key={t.id} className="adm-role-card" style={{ minWidth: 220 }}>
              <div className="row between"><strong>🏆 {t.name}</strong>{t.vip && <span className="adm-pill av-online">VIP</span>}</div>
              <p className="adm-muted" style={{ margin: '4px 0', fontSize: 12 }}>★ {t.rating.toFixed(2)} · {t.trips} courses · <span className="mono">{t.matricule}</span></p>
              {canWrite && (
                <button className={`adm-btn xs${t.vip ? '' : ' solid'}`} onClick={() => onVip(t.id, !t.vip)}>
                  {t.vip ? 'Retirer le statut VIP' : 'Attribuer statut VIP (priorité + commission réduite)'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
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
                <td>{d.name}{d.vip && <span className="adm-pill av-online" style={{ marginLeft: 6 }}>VIP</span>}</td><td className="mono">{d.matricule}</td>
                <td className={`r ${d.below ? 'neg' : ''}`}>★ {d.rating.toFixed(2)}</td>
                <td className="r">{d.trips}</td>
                <td className="r">{d.warnings > 0 ? <span className="adm-pill tr-pending">{d.warnings}</span> : '—'}</td>
                <td>{d.below ? <span className="adm-pill tr-rejected">Sous le seuil</span> : <span className="adm-pill av-online">OK</span>}</td>
                {canWrite && (
                  <td><div className="row" style={{ gap: 6 }}>
                    <button className="adm-btn xs" onClick={() => onWarn(d.id)}>Avertir</button>
                    {d.kycStatus !== 'suspended' && d.below && <button className="adm-btn xs" onClick={() => onSuspend(d.id)}>Suspendre</button>}
                    <button className="adm-btn xs" title="Bilan qualité individuel (PDF)" onClick={() => onDriverPdf(d.id)}>PDF</button>
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

const ESCALATION_LABEL: Record<string, string> = { sinistre: '🚑 Sinistre/Accident', chargeback: '💳 Fraude bancaire', harcelement: '⚠️ Harcèlement/Agression', degradation: '🔧 Dégradation véhicule' };

function DisputesSection({ disputes, canWrite, onDecide, onOpenRide, onEscalate, onQuarantine, onNote, onChargeback, onDossier, onLossCsv }: {
  disputes: Dispute[]; canWrite: boolean;
  onDecide: (id: string, s: 'investigating' | 'resolved' | 'rejected', resolution?: string, refund?: number) => void;
  onOpenRide: (rideId: string) => void;
  onEscalate: (id: string, kind: string) => void;
  onQuarantine: (id: string, on: boolean) => void;
  onNote: (id: string, text: string) => void;
  onChargeback: (id: string) => void; onDossier: (id: string) => void; onLossCsv: () => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [refunds, setRefunds] = useState<Record<string, number>>({});
  const [invNote, setInvNote] = useState<Record<string, string>>({});
  const open = disputes.filter((d) => d.status === 'open' || d.status === 'investigating');
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Litiges N1 (support) et <strong>escalades N2/N3</strong> : sinistres, fraude bancaire (chargeback),
          harcèlement, dégradation. L'ouverture d'un dossier le <strong>verrouille à l'expert</strong> (claim lock).
          La <strong>quarantaine préventive</strong> gèle les comptes et les fonds le temps de l'investigation.
          Cliquer sur la <strong>réf. course</strong> ouvre le tracé GPS (replay) et la tarification.
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Litiges</h3>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="adm-muted">{open.length} en cours · {disputes.length} au total</span>
            <button className="adm-btn xs" onClick={onLossCsv}>⬇ Matrice des pertes (CSV)</button>
          </div>
        </div>
        {disputes.length === 0 && <p className="adm-empty">Aucun litige. ✅</p>}
        <div className="stack" style={{ gap: 10 }}>
          {disputes.map((d) => (
            <div key={d.id} className="adm-dispute">
              <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{DISPUTE_KIND[d.kind] ?? d.kind}</strong>
                  <span className={`adm-pill ${DISPUTE_STATUS[d.status]?.cls}`}>{DISPUTE_STATUS[d.status]?.label}</span>
                  {d.escalation && <span className="adm-pill tr-rejected">{ESCALATION_LABEL[d.escalation] ?? d.escalation}</span>}
                  {d.lockedBy && <span className="adm-pill tr-pending" title="Dossier verrouillé (claim lock)">🔒 {d.lockedBy}</span>}
                  {d.quarantined && <span className="adm-pill tr-rejected" title="Quarantaine active">❄️ Quarantaine</span>}
                  <button className="adm-btn xs mono" onClick={() => onOpenRide(d.rideId)}>📍 {d.rideId.slice(0, 8)}</button>
                  <span className="adm-muted mono" style={{ fontSize: 11 }}>{d.clientId}</span>
                </div>
                <span className="adm-muted" style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleString('fr-FR')}</span>
              </div>
              <p style={{ margin: '8px 0', fontSize: 13 }}>{d.description}</p>
              {(d.notes ?? []).length > 0 && (
                <ul className="adm-conv-list" style={{ marginBottom: 8 }}>
                  {(d.notes ?? []).map((n, i) => <li key={i}><span>{n.author} : {n.text}</span><span className="adm-muted">{new Date(n.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></li>)}
                </ul>
              )}
              {d.resolution && <p className="adm-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>Résolution : {d.resolution}{d.refund ? ` · remboursé ${fcfa(d.refund)}` : ''} — {d.decidedBy}</p>}
              {canWrite && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                  {!d.escalation && Object.entries(ESCALATION_LABEL).map(([k, label]) => (
                    <button key={k} className="adm-btn xs" onClick={() => onEscalate(d.id, k)} title={`Escalader N2/N3 : ${label}`}>{label}</button>
                  ))}
                  {d.escalation && (
                    <>
                      <button className={`adm-btn xs${d.quarantined ? ' solid' : ''}`} onClick={() => onQuarantine(d.id, !d.quarantined)}>{d.quarantined ? 'Lever la quarantaine' : '❄️ Mettre en quarantaine'}</button>
                      <button className="adm-btn xs" onClick={() => onChargeback(d.id)}>⬇ Chargeback (PDF)</button>
                      <button className="adm-btn xs" onClick={() => onDossier(d.id)}>⬇ Dossier légal (PDF)</button>
                    </>
                  )}
                </div>
              )}
              {canWrite && d.escalation && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                  <input className="adm-inline-input" placeholder="Note d'investigation…" value={invNote[d.id] ?? ''} onChange={(e) => setInvNote((n) => ({ ...n, [d.id]: e.target.value }))} />
                  <button className="adm-btn xs" onClick={() => { if ((invNote[d.id] ?? '').trim()) { onNote(d.id, invNote[d.id]!.trim()); setInvNote((n) => ({ ...n, [d.id]: '' })); } }}>Ajouter la note</button>
                </div>
              )}
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
                    {z.surgeManual && z.surgeManual > 1 ? <span className="adm-pill tr-rejected" title="Surge manuel d'urgence">⚡ surge ×{z.surgeManual}</span> : null}
                    {!z.waitMaxMin && !z.minStandard && !z.pickupFee && !z.driverBonus && !z.dedicated && !z.surgeManual && <span className="adm-muted">—</span>}
                  </div>
                </td>
                <td><span className={`adm-pill ${z.active ? 'av-online' : 'kyc-manual_review'}`}>{z.active ? 'Actif' : 'Inactif'}</span></td>
                {canWrite && (
                  <td><div className="row" style={{ gap: 6 }}>
                    <button className="adm-btn xs" title="Surge manuel d'urgence (stade, concert…)" onClick={() => {
                      const cur = z.surgeManual ?? 1;
                      const input = window.prompt(`Surge manuel pour « ${z.name} » (1 = aucun, max 2.5, plafonné par le cap vert) :`, String(cur));
                      if (input === null) return;
                      const v = Math.min(2.5, Math.max(1, Number(input) || 1));
                      onSave({ ...z, surgeManual: v });
                    }}>⚡ Surge</button>
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

const PRIORITY_META: Record<number, { label: string; cls: string }> = {
  1: { label: 'P1 · Objet oublié', cls: 'tr-rejected' },
  2: { label: 'P2 · Facturation', cls: 'tr-pending' },
  3: { label: 'P3 · Général', cls: 'av-online' },
};

function SupportSection({ convs, stats, macros, canWrite, canPromo, onReply, onStatus, onCompensate }: {
  convs: Conversation[]; stats: SupportStats | null; macros: Macro[];
  canWrite: boolean; canPromo: boolean;
  onReply: (id: string, text: string) => void; onStatus: (id: string, s: string) => void;
  onCompensate: (clientId: string, percent: number) => void;
}) {
  const [sel, setSel] = useState<string | null>(convs[0]?.id ?? null);
  const [text, setText] = useState('');
  const [compPct, setCompPct] = useState(20);
  const conv = convs.find((c) => c.id === sel) ?? convs[0] ?? null;
  return (
    <>
      {stats && (
        <section className="adm-kpis">
          <Kpi label="Tickets ouverts" value={String(stats.open)} sub="boîte triée par priorité puis ancienneté" tone={stats.open ? 'teal' : 'muted'} />
          <Kpi label="1re réponse (moy.)" value={stats.avgFirstReplyMin != null ? `${stats.avgFirstReplyMin} min` : '—'} sub="SLA de première réponse" tone="green" />
          <Kpi label="Résolus aujourd'hui" value={String(stats.resolvedToday)} sub="tickets clos dans la journée" tone="mint" />
          <Kpi label="CSAT post-résolution" value={stats.csat != null ? `★ ${stats.csat}` : '—'} sub="satisfaction après traitement" tone="teal" />
        </section>
      )}
      <div className="adm-grid2">
        <div className="adm-card" style={{ maxHeight: 640, overflow: 'auto' }}>
          <div className="adm-card-h"><h3>File d'attente intelligente</h3><span className="adm-muted">{convs.length} · P1 objet oublié &gt; P2 facturation &gt; P3 général</span></div>
          <div className="stack" style={{ gap: 6 }}>
            {convs.length === 0 && <p className="adm-empty">Aucune conversation.</p>}
            {convs.map((c) => (
              <button key={c.id} className={`adm-conv${conv?.id === c.id ? ' on' : ''}`} onClick={() => setSel(c.id)}>
                <div className="row between">
                  <strong>{c.subject}</strong>
                  <span className="row" style={{ gap: 4 }}>
                    {c.priority && <span className={`adm-pill ${PRIORITY_META[c.priority]?.cls ?? ''}`}>{PRIORITY_META[c.priority]?.label ?? `P${c.priority}`}</span>}
                    <span className={`adm-pill s-${c.status === 'open' ? 'searching' : c.status === 'pending' ? 'in_progress' : 'completed'}`}>{convStatus(c.status)}</span>
                  </span>
                </div>
                <div className="adm-muted" style={{ fontSize: 12 }}>{c.clientId} · {c.messages.length} msg{c.csat ? ` · CSAT ★ ${c.csat}` : ''}</div>
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
              {canWrite && macros.length > 0 && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
                  {macros.map((m) => (
                    <button key={m.title} className="adm-btn xs" title={m.text} onClick={() => onReply(conv.id, m.text)}>⚡ {m.title}</button>
                  ))}
                </div>
              )}
              {canWrite && (
                <div className="adm-chat-input">
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Répondre au client…" onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onReply(conv.id, text.trim()); setText(''); } }} />
                  <button className="adm-btn solid" onClick={() => { if (text.trim()) { onReply(conv.id, text.trim()); setText(''); } }}>Envoyer</button>
                  <button className="adm-btn ghost" onClick={() => onStatus(conv.id, 'closed')}>Clore</button>
                </div>
              )}
              {canPromo && (
                <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <span className="adm-muted" style={{ fontSize: 12 }}>Geste commercial :</span>
                  <input className="adm-inline-input" style={{ width: 70 }} type="number" min={5} max={50} value={compPct} onChange={(e) => setCompPct(Number(e.target.value))} />
                  <span className="adm-muted" style={{ fontSize: 12 }}>%</span>
                  <button className="adm-btn xs solid" onClick={() => onCompensate(conv.clientId, compPct)}>🎟 Code de dédommagement (7 j, usage unique)</button>
                </div>
              )}
            </>
          ) : <p className="adm-empty">Sélectionne une conversation.</p>}
        </div>
      </div>
    </>
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

const CHANNEL_META: Record<string, string> = { push: '📲 Push', sms: '✉️ SMS', email: '📧 E-mail' };
const SEGMENT_LABEL: Record<string, string> = { tous: 'Tous', nouveaux: 'Nouveaux inscrits sans course', vip: 'Utilisateurs VIP', green: 'Adeptes 100 % électrique', inactifs: 'Inactifs 30 jours' };

function NotifySection({ broadcasts, triggers, canWrite, onSend, onTrigger }: {
  broadcasts: Announcement[]; triggers: Triggers | null; canWrite: boolean;
  onSend: (a: { audience: string; title: string; body: string; channel?: string; segment?: string; scheduledAt?: string }) => void;
  onTrigger: (t: 'battery' | 'winback') => void;
}) {
  const [audience, setAudience] = useState('clients'); const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [channel, setChannel] = useState('push'); const [segment, setSegment] = useState('tous'); const [scheduledAt, setScheduledAt] = useState('');
  const audLabel = (a: string) => ({ clients: 'Clients', drivers: 'Chauffeurs', all: 'Tous' }[a] ?? a);
  const send = () => {
    if (!title.trim() || !body.trim()) return;
    onSend({
      audience, title: title.trim(), body: body.trim(), channel, segment,
      ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
    });
    setTitle(''); setBody(''); setScheduledAt('');
  };
  return (
    <>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Studio de création multicanal</h3><span className="adm-muted">Push · SMS · E-mail — ciblage comportemental</span></div>
          <div className="price-grid">
            <label className="price-field"><span>Canal</span>
              <select className="adm-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="push">📲 Push in-app (immédiat)</option>
                <option value="sms">✉️ SMS (critique / hors-ligne)</option>
                <option value="email">📧 E-mail (newsletters, bilans)</option>
              </select>
            </label>
            <label className="price-field"><span>Destinataires</span>
              <select className="adm-select" value={audience} onChange={(e) => setAudience(e.target.value)}><option value="clients">Clients</option><option value="drivers">Chauffeurs</option><option value="all">Tous</option></select>
            </label>
            <label className="price-field"><span>Segment (hyper-ciblage)</span>
              <select className="adm-select" value={segment} onChange={(e) => setSegment(e.target.value)}>
                {Object.entries(SEGMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="price-field"><span>Planification (optionnel)</span>
              <input type="datetime-local" className="adm-select" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </label>
          </div>
          <label className="price-field" style={{ marginTop: 12 }}><span>Titre</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Wi-Fi gratuit à bord" /></label>
          <label className="price-field" style={{ marginTop: 12 }}><span>Message — balises : [Prénom], [Destination_Favorite]</span><textarea className="adm-select" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Bonjour [Prénom], voici 10 % de réduction pour votre prochain trajet vers [Destination_Favorite]…" /></label>
          <button className="adm-btn solid" style={{ marginTop: 12 }} onClick={send}>📣 {scheduledAt ? 'Programmer la campagne' : 'Diffuser maintenant'}</button>
        </div>
      )}
      {triggers && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Déclencheurs automatisés</h3><span className="adm-muted">scénarios exécutés sans intervention</span></div>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>🔋 Batterie &lt; 15 % → borne partenaire ({triggers.lowBattery.length})</strong>
                {canWrite && triggers.lowBattery.length > 0 && <button className="adm-btn xs solid" onClick={() => onTrigger('battery')}>Envoyer le guidage</button>}
              </div>
              <ul className="adm-conv-list">
                {triggers.lowBattery.map((d) => (
                  <li key={d.id}><span>{d.name} · {d.batteryPct} %</span><span className="adm-muted" style={{ fontSize: 11 }}>{d.station ?? '—'}</span></li>
                ))}
                {triggers.lowBattery.length === 0 && <li><span className="adm-muted">Aucun véhicule sous 15 %. ✅</span></li>}
              </ul>
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>💚 Win-back — inactifs 30 j ({triggers.winback.length})</strong>
                {canWrite && <button className="adm-btn xs solid" onClick={() => onTrigger('winback')}>Envoyer code retour</button>}
              </div>
              <ul className="adm-conv-list">
                {triggers.winback.map((c) => (
                  <li key={c.id}><span>{c.name ?? c.id} · {c.rides} courses</span><span className="adm-muted">{ago(c.lastSeenAt)}</span></li>
                ))}
                {triggers.winback.length === 0 && <li><span className="adm-muted">Aucun client silencieux. ✅</span></li>}
              </ul>
            </div>
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            Heures creuses recharge : {triggers.offPeak.start} h → {triggers.offPeak.end} h · bonus {triggers.offPeak.bonus} F
            (réglable dans Dispatch). Alerte météo/surge : les chauffeurs hors ligne sont prévenus quand la
            tarification dynamique s'active sur leur zone.
          </p>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Campagnes envoyées</h3><span className="adm-muted">{broadcasts.length} · délivrabilité / ouverture / clics / courses générées</span></div>
        <div className="stack" style={{ gap: 8 }}>
          {broadcasts.length === 0 && <p className="adm-empty">Aucune annonce.</p>}
          {broadcasts.map((a) => (
            <div key={a.id} className="adm-role-card">
              <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}>
                <strong>{a.title}</strong>
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <span className="adm-pill">{CHANNEL_META[a.channel ?? 'push']}</span>
                  <span className="adm-pill av-online">{audLabel(a.audience)}</span>
                  {a.segment && a.segment !== 'tous' && <span className="adm-pill tr-pending">{SEGMENT_LABEL[a.segment] ?? a.segment}</span>}
                  {a.scheduledAt && Date.parse(a.scheduledAt) > Date.now() && <span className="adm-pill tr-pending">🕒 programmée</span>}
                </span>
              </div>
              <p className="adm-muted" style={{ margin: '4px 0', fontSize: 13 }}>{a.body}</p>
              {a.stats && a.stats.sent > 0 && (
                <div className="row" style={{ gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                  <span>📤 {a.stats.sent} envoyés</span>
                  <span>✅ {a.stats.delivered} délivrés</span>
                  <span>👁 {a.stats.opened} ouverts ({a.stats.sent ? Math.round((a.stats.opened / a.stats.sent) * 100) : 0} %)</span>
                  <span>🖱 {a.stats.clicked} clics</span>
                  <span className="pos">🚗 {a.stats.rides} courses générées</span>
                </div>
              )}
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
function GreenSection({ g, ops, onPdf, onEnergyCsv }: { g: GreenReport; ops: OpsConfig | null; onPdf: () => void; onEnergyCsv: () => void }) {
  const co2 = g.co2SavedTons >= 1 ? `${g.co2SavedTons.toLocaleString('fr-FR')} t` : `${g.co2SavedKg.toLocaleString('fr-FR')} kg`;
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="CO2 économisé" value={co2} sub="vs flotte thermique équivalente" tone="green" />
        <Kpi label="Trajets 100 % électriques" value={`${g.electricShare} %`} sub={`${g.kmElectric.toLocaleString('fr-FR')} km parcourus`} tone="mint" />
        <Kpi label="Santé batteries (SoH)" value={g.fleet.avgSoh != null ? `${g.fleet.avgSoh} %` : '—'} sub="dégradation moyenne — maintenance" tone="teal" />
        <Kpi label="Batteries faibles" value={String(g.fleet.lowBattery)} sub="véhicules < 20 % (exclus du dispatch si insuffisant)" tone={g.fleet.lowBattery ? 'danger' : 'muted'} />
      </section>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Hypothèses : thermique ~150 g CO2/km · électrique ~20 g/km · hybride ~90 g/km (courses terminées).
          L'algorithme <strong>écarte automatiquement</strong> du dispatch tout électrique dont la batterie ne couvre
          pas la course demandée (~1 %/km + réserve 10 %). Incitation heures creuses{ops ? ` (${ops.offPeakStart} h → ${ops.offPeakEnd} h, bonus ${ops.offPeakBonus} F)` : ''} pour lisser les coûts d'électricité.
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Rapports & exports</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="adm-btn xs solid" onClick={onPdf}>⬇ Certificat CO2 (PDF)</button>
            <button className="adm-btn xs" onClick={onEnergyCsv}>⬇ Data énergie (Excel/CSV)</button>
          </div>
        </div>
        <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>
          Certificat d'économie de CO2 (communication institutionnelle, subventions) et export OPEX
          (km électriques, kWh estimés, coûts de recharge) pour le business plan. Les rapports ESG par
          client entreprise sont dans la session Entreprises (B2B).
        </p>
      </div>
      {(g.topGreenClients ?? []).length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Fidélisation verte — Points Carbone</h3><span className="adm-muted">passagers les plus engagés</span></div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {g.topGreenClients!.map((c) => (
              <span key={c.id} className="adm-pill av-online" title={c.id}>🌿 {c.name ?? c.id} · {c.greenPoints.toLocaleString('fr-FR')} pts</span>
            ))}
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            1 point par kilomètre 100 % électrique payé. Les paliers d'échange (réductions) se configurent avec les codes promo.
          </p>
        </div>
      )}
      {(g.chargingStations ?? []).length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Bornes de recharge partenaires</h3><span className="adm-muted">{g.chargingStations!.length} bornes · Abidjan</span></div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {g.chargingStations!.map((s) => (
              <span key={s.id} className={`adm-pill ${s.fast ? 'av-online' : ''}`} title={`${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}>
                🔌 {s.name}{s.fast ? ' · rapide' : ''}
              </span>
            ))}
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            En heures creuses, dirige les chauffeurs en batterie faible vers les bornes via une notification
            (section Notifications → audience « chauffeurs »).
          </p>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Télémétrie batteries (SoC & SoH)</h3><span className="adm-muted">{g.fleet.electric} électriques · {g.fleet.hybrid} hybrides · vert &gt; 50 % · orange 20–50 % · rouge &lt; 20 %</span></div>
        {g.fleet.batteries.length === 0 && <p className="adm-empty">Aucune télémétrie remontée (app chauffeur → POST /drivers/:id/telemetry).</p>}
        <table className="adm-table">
          <thead><tr><th>Véhicule</th><th>Matricule</th><th>État</th><th style={{ width: '34%' }}>Charge (SoC)</th><th className="r">Santé (SoH)</th></tr></thead>
          <tbody>
            {g.fleet.batteries.map((b) => {
              const soc = b.batteryPct ?? 0;
              const socCls = soc < 20 ? ' low' : soc < 50 ? ' mid' : '';
              return (
                <tr key={b.id}>
                  <td>{b.name}</td><td className="mono">{b.matricule}</td>
                  <td><span className={`adm-pill av-${b.availability}`}>{availLabel(b.availability)}</span></td>
                  <td>
                    <div className="adm-batt">
                      <div className={`adm-batt-fill${socCls}`} style={{ width: `${soc}%` }} />
                      <span className="adm-batt-label">{soc} %</span>
                    </div>
                  </td>
                  <td className={`r ${b.batteryHealthPct != null && b.batteryHealthPct < 80 ? 'neg' : ''}`}>{b.batteryHealthPct != null ? `${b.batteryHealthPct} %` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------------- Intelligence & prédiction --------------------- */
function IntelSection({ predict, conversion, churn, fraud, elasticity, canNotify, onReengage, onCopilot }: {
  predict: { hour: number; cells: PredictCell[] } | null; conversion: ConversionCell[];
  churn: ChurnReport | null; fraud: FraudReport | null; elasticity: ElasticityCell[];
  canNotify: boolean; onReengage: () => void;
  onCopilot: (q: string) => Promise<CopilotAnswer | null>;
}) {
  const [cq, setCq] = useState('');
  const [ans, setAns] = useState<CopilotAnswer | null>(null);
  const [thinking, setThinking] = useState(false);
  const ask = async () => { if (!cq.trim()) return; setThinking(true); try { setAns(await onCopilot(cq.trim())); } finally { setThinking(false); } };
  return (
    <>
      {/* Copilote génératif */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>🤖 Copilote d'administration</h3><span className="adm-muted">assistant génératif — questions en langage naturel</span></div>
        <div className="adm-chat-input">
          <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Ex. « CA électrique vs thermique », « état de la flotte »…" onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} />
          <button className="adm-btn solid" onClick={() => void ask()} disabled={thinking}>{thinking ? '…' : 'Demander'}</button>
        </div>
        {ans && <div className="adm-role-card" style={{ marginTop: 10 }}><p style={{ margin: 0, fontSize: 14 }}>{ans.answer}</p></div>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {['CA électrique vs thermique', 'chiffre d’affaires du mois', 'état de la flotte'].map((s) => (
            <button key={s} className="adm-btn xs" onClick={() => { setCq(s); }}>{s}</button>
          ))}
        </div>
      </div>

      {/* Moteur anti-fraude */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>🛡️ Détection de fraude</h3><span className="adm-muted">courses fantômes · spoofing GPS · risque transactionnel</span></div>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Courses fantômes / collusion ({fraud?.ghostRides.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(fraud?.ghostRides ?? []).map((g, i) => (
                <li key={i}><span>{g.driverName ?? g.driverId.slice(0, 8)} ↔ {g.clientId.slice(0, 12)}</span><span className="adm-pill tr-rejected">{g.count} courses</span></li>
              ))}
              {(fraud?.ghostRides.length ?? 0) === 0 && <li><span className="adm-muted">Aucune collusion détectée ✅</span></li>}
            </ul>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Spoofing GPS (téléportation) ({fraud?.gpsSpoof.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(fraud?.gpsSpoof ?? []).map((s, i) => (
                <li key={i}><span className="mono">{s.rideId.slice(0, 10)}</span><span className="adm-pill tr-rejected">saut {(s.jumpMeters / 1000).toFixed(1)} km</span></li>
              ))}
              {(fraud?.gpsSpoof.length ?? 0) === 0 && <li><span className="adm-muted">Aucun spoofing détecté ✅</span></li>}
            </ul>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Risque transactionnel ({fraud?.txRisk.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(fraud?.txRisk ?? []).map((c) => (
                <li key={c.id}><span>{c.name ?? c.id}</span><span className="adm-pill tr-pending">{c.cancellations} annul.</span></li>
              ))}
              {(fraud?.txRisk.length ?? 0) === 0 && <li><span className="adm-muted">Aucun compte à risque ✅</span></li>}
            </ul>
          </div>
        </div>
      </div>

      {/* Élasticité-prix */}
      {elasticity.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>📈 Élasticité-prix (surge neural)</h3><span className="adm-muted">multiplicateur recommandé par cellule</span></div>
          <table className="adm-table">
            <thead><tr><th>Cellule</th><th className="r">Sessions</th><th className="r">Conversion</th><th className="r">Multiplicateur optimal</th></tr></thead>
            <tbody>
              {elasticity.map((c) => (
                <tr key={c.cell}>
                  <td className="mono">{c.lat.toFixed(3)}, {c.lng.toFixed(3)}</td>
                  <td className="r">{c.sessions}</td>
                  <td className={`r ${c.rate < 30 ? 'neg' : 'pos'}`}>{c.rate} %</td>
                  <td className="r"><span className={`adm-pill ${c.recommended > 1 ? 'tr-pending' : 'av-online'}`}>×{c.recommended.toFixed(2)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="adm-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            L'IA maximise le revenu SANS casser la conversion : une zone à faible conversion n'est jamais majorée
            (elle ferait fuir les clients), une zone à forte conversion supporte un léger surge.
          </p>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Heatmap prédictive</h3><span className="adm-muted">demande attendue vers {predict ? `${String(predict.hour).padStart(2, '0')}h` : '—'} (moyenne historique)</span></div>
        {(!predict || predict.cells.length === 0) && <p className="adm-empty">Pas encore assez d'historique pour prédire — les cellules apparaîtront avec l'activité.</p>}
        {predict && predict.cells.length > 0 && (
          <table className="adm-table">
            <thead><tr><th>Cellule</th><th className="r">Demande prévue</th><th className="r">Chauffeurs sur place</th><th className="r">Manque</th><th>Recommandation</th></tr></thead>
            <tbody>
              {predict.cells.map((c) => (
                <tr key={c.cell}>
                  <td className="mono">{c.lat.toFixed(3)}, {c.lng.toFixed(3)}</td>
                  <td className="r">{c.expected}</td><td className="r">{c.supply}</td>
                  <td className={`r ${c.gap > 0 ? 'neg' : 'pos'}`}>{c.gap}</td>
                  <td>{c.gap > 0 ? <span className="adm-pill tr-pending">Diriger {c.gap} chauffeur{c.gap > 1 ? 's' : ''} en avance</span> : <span className="adm-pill av-online">Couvert</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Conversion par zone</h3><span className="adm-muted">sessions (devis) vs commandes</span></div>
        {conversion.length === 0 && <p className="adm-empty">Aucune session enregistrée pour l'instant.</p>}
        {conversion.length > 0 && (
          <table className="adm-table">
            <thead><tr><th>Cellule</th><th className="r">Sessions</th><th className="r">Commandes</th><th className="r">Taux</th><th>Diagnostic</th></tr></thead>
            <tbody>
              {conversion.map((c) => (
                <tr key={c.cell}>
                  <td className="mono">{c.lat.toFixed(3)}, {c.lng.toFixed(3)}</td>
                  <td className="r">{c.sessions}</td><td className="r">{c.orders}</td>
                  <td className={`r ${c.rate < 30 ? 'neg' : 'pos'}`}>{c.rate} %</td>
                  <td>{c.rate < 30 ? <span className="adm-pill tr-rejected">Tarif élevé ou manque de chauffeurs</span> : <span className="adm-pill av-online">Saine</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Prédiction d'attrition (churn)</h3>
          {canNotify && <button className="adm-btn xs solid" onClick={onReengage}>📣 Campagne de réengagement</button>}
        </div>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Clients réguliers silencieux ≥ 14 j ({churn?.clients.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(churn?.clients ?? []).map((c) => (
                <li key={c.id}><span>{c.name ?? c.id} · {c.rides} courses</span><span className="adm-muted">{ago(c.lastSeenAt)}</span></li>
              ))}
              {(churn?.clients.length ?? 0) === 0 && <li><span className="adm-muted">Aucun — fidélité au vert ✅</span></li>}
            </ul>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Chauffeurs inactifs ≥ 7 j ({churn?.drivers.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(churn?.drivers ?? []).map((d) => (
                <li key={d.id}><span>{d.name}</span><span className="adm-muted mono">{d.matricule}</span></li>
              ))}
              {(churn?.drivers.length ?? 0) === 0 && <li><span className="adm-muted">Aucun — flotte engagée ✅</span></li>}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------ Comptes Entreprises (B2B) ------------------- */
function CorporateSection({ accounts, canWrite, canSettle, canBook, onSave, onSettle, onInvoice, onEsg, onInvoicePdf, onImport, onBook }: {
  accounts: CorporateAccount[]; canWrite: boolean; canSettle: boolean; canBook: boolean;
  onSave: (i: { id?: string; name: string; contactEmail?: string; creditLimit: number; nif?: string; kickbackRate?: number }) => void;
  onSettle: (id: string) => void; onInvoice: (id: string) => void; onEsg: (id: string) => void;
  onInvoicePdf: (id: string) => void;
  onImport: (id: string, memberIds: string[]) => void;
  onBook: (id: string, input: { guestName: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; category: string }) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [limit, setLimit] = useState(500_000);
  const [nif, setNif] = useState('');
  const [kickback, setKickback] = useState(0);
  const doImport = (id: string) => {
    const raw = window.prompt('Import de masse — identifiants clients ORION séparés par des virgules :', 'client-1, client-2, client-3');
    if (!raw) return;
    onImport(id, raw.split(',').map((s) => s.trim()).filter(Boolean));
  };
  const doBook = (id: string) => {
    const guestName = window.prompt('Web Booker (conciergerie) — prénom du client :', '');
    if (!guestName) return;
    onBook(id, { guestName, origin: { lat: 5.3596, lng: -3.9903 }, destination: { lat: 5.2614, lng: -3.9268 }, category: 'or' });
  };
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Hôtels, sociétés, ambassades : chaque compte dispose d'une <strong>ligne de crédit mensuelle</strong>.
          Leurs employés commandent avec le <strong>code société</strong> sans paiement immédiat ; au-delà du
          plafond, la course est refusée. Facture <strong>consolidée</strong> en fin de mois (CSV compatible
          logiciels comptables), règlement avec aval de la direction.
        </p>
      </div>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Nouveau compte entreprise</h3></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Raison sociale</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hôtel Ivoire" /></label>
            <label className="price-field"><span>NIF (fiscal)</span><input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="CI-123456" /></label>
            <label className="price-field"><span>E-mail de facturation</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="compta@hotel.ci" /></label>
            <label className="price-field"><span>Ligne de crédit (F / mois)</span><input type="number" min={0} step={50000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
            <label className="price-field"><span>Rétrocommission (%)</span><input type="number" min={0} max={50} value={kickback} onChange={(e) => setKickback(Number(e.target.value))} /></label>
            <button className="adm-btn solid" onClick={() => { if (name.trim()) { onSave({ name: name.trim(), contactEmail: email.trim() || undefined, creditLimit: limit, nif: nif.trim() || undefined, kickbackRate: kickback ? kickback / 100 : undefined }); setName(''); setEmail(''); setNif(''); setKickback(0); } }}>Créer</button>
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            Filiales/départements, politiques de déplacement (horaires/zones/gammes), import de masse des
            collaborateurs, web booker conciergerie et rétrocommission d'apport d'affaires (kickback).
          </p>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Comptes</h3><span className="adm-muted">{accounts.length}</span></div>
        {accounts.length === 0 && <p className="adm-empty">Aucun compte entreprise pour l'instant.</p>}
        <table className="adm-table">
          <thead><tr><th>Société</th><th>Code</th><th className="r">Crédit consommé</th><th className="r">Plafond</th><th style={{ width: '22%' }}>Utilisation</th><th>Actions</th></tr></thead>
          <tbody>
            {accounts.map((a) => {
              const pctUsed = a.creditLimit ? Math.min(100, Math.round((a.balanceUsed / a.creditLimit) * 100)) : 0;
              return (
                <tr key={a.id}>
                  <td>{a.name}
                    <div className="adm-muted" style={{ fontSize: 11 }}>{a.contactEmail ?? '—'}{a.nif ? ` · NIF ${a.nif}` : ''}{a.parentId ? ` · filiale de ${a.parentId}` : ''}</div>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      {a.kickbackRate ? <span className="adm-pill av-online" title="Rétrocommission">↩ {Math.round(a.kickbackRate * 100)} %</span> : null}
                      {(a.members?.length ?? 0) > 0 ? <span className="adm-pill">👥 {a.members!.length}</span> : null}
                      {a.policy ? <span className="adm-pill tr-pending" title="Politique de déplacement active">🔒 politique</span> : null}
                    </div>
                  </td>
                  <td className="mono">{a.id}</td>
                  <td className="r">{fcfa(a.balanceUsed)}</td>
                  <td className="r">{fcfa(a.creditLimit)}</td>
                  <td>
                    <div className="adm-batt">
                      <div className={`adm-batt-fill${pctUsed >= 90 ? ' low' : ''}`} style={{ width: `${pctUsed}%` }} />
                      <span className="adm-batt-label">{pctUsed} %</span>
                    </div>
                  </td>
                  <td><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {canBook && <button className="adm-btn xs" title="Web Booker (conciergerie)" onClick={() => doBook(a.id)}>🛎 Booker</button>}
                    {canWrite && <button className="adm-btn xs" title="Import de masse des collaborateurs" onClick={() => doImport(a.id)}>👥 Import</button>}
                    <button className="adm-btn xs" onClick={() => onInvoice(a.id)}>⬇ CSV</button>
                    <button className="adm-btn xs" title="Facture consolidée PDF" onClick={() => onInvoicePdf(a.id)}>⬇ Facture</button>
                    <button className="adm-btn xs" title="Rapport ESG / RSE (bilan carbone certifié)" onClick={() => onEsg(a.id)}>⬇ ESG</button>
                    {canSettle && a.balanceUsed > 0 && <button className="adm-btn xs solid" onClick={() => onSettle(a.id)}>Régler</button>}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* --------------------------- Équipes & managers ----------------------- */
const SLOT_LABEL: Record<string, string> = { matin: '🌅 Matin', soir: '🌇 Soir', nuit: '🌙 Nuit' };
const MAINT_LABEL: Record<string, string> = { controle_technique: 'Contrôle technique', batterie_soh: 'Batterie (SoH)', reparation: 'Réparation', nettoyage: 'Nettoyage', assurance: 'Assurance' };

function TeamsSection({ teams, allDrivers, staffKpis, shifts, maintenance, canWrite, onSave, onDelete, onShift, onRemoveShift, onMaintenance, onResolveMaintenance, onBroadcast, onPnl, onHoursCsv, onEvalPdf }: {
  teams: Team[]; allDrivers: DriverRow[]; staffKpis: StaffKpi[]; shifts: Shift[]; maintenance: MaintenanceTicket[]; canWrite: boolean;
  onSave: (i: { id?: string; name: string; managerUsername: string; managerName?: string; driverIds?: string[] }) => void;
  onDelete: (id: string) => void;
  onShift: (i: { username: string; name: string; date: string; slot: string; zoneId?: string }) => void;
  onRemoveShift: (id: string) => void;
  onMaintenance: (i: { driverId: string; kind: string; title: string; teamId?: string }) => void;
  onResolveMaintenance: (id: string) => void;
  onBroadcast: (teamId: string, title: string, body: string) => void;
  onPnl: (teamId: string) => Promise<SquadPnl | null>;
  onHoursCsv: () => void; onEvalPdf: (username: string) => void;
}) {
  const [name, setName] = useState('');
  const [managerUsername, setManagerUsername] = useState('');
  const [managerName, setManagerName] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pnl, setPnl] = useState<Record<string, SquadPnl>>({});
  const [shiftForm, setShiftForm] = useState({ username: '', name: '', date: new Date().toISOString().slice(0, 10), slot: 'matin', zoneId: '' });
  const [maintForm, setMaintForm] = useState({ driverId: '', kind: 'controle_technique', title: '' });
  const chosen = Object.keys(selected).filter((k) => selected[k]);
  const submit = () => {
    if (!name.trim() || !managerUsername.trim()) return;
    onSave({ name: name.trim(), managerUsername: managerUsername.trim(), managerName: managerName.trim() || undefined, driverIds: chosen });
    setName(''); setManagerUsername(''); setManagerName(''); setSelected({});
  };
  const showPnl = async (teamId: string) => { const p = await onPnl(teamId); if (p) setPnl((x) => ({ ...x, [teamId]: p })); };
  const broadcast = (teamId: string) => {
    const title = window.prompt('Titre du micro-broadcast (flotte de l’équipe) :', 'Inspection propreté');
    if (!title) return;
    const body = window.prompt('Message :', 'Inspection de propreté obligatoire ce vendredi.');
    if (!body) return;
    onBroadcast(teamId, title, body);
  };
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Session <strong>coffre-fort RH</strong> (direction / responsables RH). Gère le <strong>personnel interne</strong>
          (agents, répartiteurs, auditeurs) et les <strong>squads</strong> managers (équipe d'agents + flotte confiée).
          Verrouillage auto des sessions après inactivité, traçabilité intégrale et micro-P&amp;L par sous-flotte.
        </p>
      </div>

      {/* Productivité interne (KPIs employés) */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Productivité interne (24 h)</h3><button className="adm-btn xs" onClick={onHoursCsv}>⬇ Matrice des heures (CSV)</button></div>
        {staffKpis.length === 0 && <p className="adm-empty">Aucune activité employée enregistrée sur 24 h.</p>}
        {staffKpis.length > 0 && (
          <table className="adm-table">
            <thead><tr><th>Employé</th><th>Rôle</th><th className="r">Actions</th><th className="r">Support</th><th className="r">Modération</th><th className="r">Finance</th><th className="r">Promos</th><th>Fiche</th></tr></thead>
            <tbody>
              {staffKpis.map((s) => (
                <tr key={s.actor}>
                  <td>{s.actor}</td><td className="cap">{s.role}</td>
                  <td className="r"><strong>{s.total}</strong></td><td className="r">{s.support}</td><td className="r">{s.moderation}</td><td className="r">{s.finance}</td><td className="r">{s.promos}</td>
                  <td><button className="adm-btn xs" onClick={() => onEvalPdf(s.actor)}>⬇ PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Astreintes 24/7 */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Astreintes 24/7 & affectation territoriale</h3><span className="adm-muted">{shifts.length} créneaux</span></div>
        {canWrite && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <label className="price-field"><span>Identifiant</span><input value={shiftForm.username} onChange={(e) => setShiftForm((f) => ({ ...f, username: e.target.value }))} placeholder="awa.ops" /></label>
            <label className="price-field"><span>Nom</span><input value={shiftForm.name} onChange={(e) => setShiftForm((f) => ({ ...f, name: e.target.value }))} placeholder="Awa (Dispatch)" /></label>
            <label className="price-field"><span>Date</span><input type="date" value={shiftForm.date} onChange={(e) => setShiftForm((f) => ({ ...f, date: e.target.value }))} /></label>
            <label className="price-field"><span>Tranche</span><select className="adm-select" value={shiftForm.slot} onChange={(e) => setShiftForm((f) => ({ ...f, slot: e.target.value }))}><option value="matin">Matin</option><option value="soir">Soir</option><option value="nuit">Nuit</option></select></label>
            <label className="price-field"><span>Zone (optionnel)</span><input value={shiftForm.zoneId} onChange={(e) => setShiftForm((f) => ({ ...f, zoneId: e.target.value }))} placeholder="cocody" /></label>
            <button className="adm-btn solid" onClick={() => { if (shiftForm.username && shiftForm.name) { onShift({ ...shiftForm, zoneId: shiftForm.zoneId || undefined }); setShiftForm((f) => ({ ...f, username: '', name: '' })); } }}>Planifier</button>
          </div>
        )}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {shifts.map((s) => (
            <span key={s.id} className="adm-pill" title={s.date}>{SLOT_LABEL[s.slot] ?? s.slot} · {s.name}{s.zoneId ? ` · ${s.zoneId}` : ''}{canWrite && <button className="adm-x" onClick={() => onRemoveShift(s.id)}>✕</button>}</span>
          ))}
          {shifts.length === 0 && <span className="adm-muted">Aucun créneau planifié.</span>}
        </div>
      </div>

      {/* Tickets de maintenance véhicules */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Maintenance des véhicules (logistique flotte)</h3><span className="adm-muted">{maintenance.filter((t) => t.status !== 'resolu').length} ouvert(s)</span></div>
        {canWrite && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <label className="price-field"><span>Véhicule (chauffeur)</span>
              <select className="adm-select" value={maintForm.driverId} onChange={(e) => setMaintForm((f) => ({ ...f, driverId: e.target.value }))}>
                <option value="">—</option>
                {allDrivers.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.matricule})</option>)}
              </select>
            </label>
            <label className="price-field"><span>Type</span><select className="adm-select" value={maintForm.kind} onChange={(e) => setMaintForm((f) => ({ ...f, kind: e.target.value }))}>{Object.entries(MAINT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="price-field" style={{ minWidth: 240 }}><span>Intitulé</span><input value={maintForm.title} onChange={(e) => setMaintForm((f) => ({ ...f, title: e.target.value }))} placeholder="Contrôle technique requis dans 15 jours" /></label>
            <button className="adm-btn solid" onClick={() => { if (maintForm.driverId && maintForm.title.trim()) { onMaintenance(maintForm); setMaintForm((f) => ({ ...f, title: '' })); } }}>Créer le ticket</button>
          </div>
        )}
        {maintenance.length === 0 && <p className="adm-empty">Aucun ticket de maintenance.</p>}
        <div className="stack" style={{ gap: 6 }}>
          {maintenance.map((t) => (
            <div key={t.id} className="row between" style={{ padding: '8px 10px', background: 'var(--a-panel2)', borderRadius: 8 }}>
              <div><strong style={{ fontSize: 13 }}>{MAINT_LABEL[t.kind] ?? t.kind}</strong> · {t.title}<div className="adm-muted mono" style={{ fontSize: 11 }}>{t.driverId.slice(0, 8)}{t.assignee ? ` · agent ${t.assignee}` : ''}</div></div>
              <div className="row" style={{ gap: 6 }}>
                <span className={`adm-pill ${t.status === 'resolu' ? 'av-online' : 'tr-pending'}`}>{t.status}</span>
                {canWrite && t.status !== 'resolu' && <button className="adm-btn xs" onClick={() => onResolveMaintenance(t.id)}>Résoudre</button>}
              </div>
            </div>
          ))}
        </div>
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
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="adm-btn xs" onClick={() => void showPnl(t.id)}>📊 Micro P&L</button>
                  {canWrite && <button className="adm-btn xs" onClick={() => broadcast(t.id)}>📣 Micro-broadcast</button>}
                  {canWrite && <button className="adm-btn xs" onClick={() => onDelete(t.id)}>Dissoudre</button>}
                </div>
              </div>
              {pnl[t.id] && (
                <div className="adm-mini-kpis" style={{ marginTop: 8 }}>
                  <div className="adm-mini-kpi"><span>CA flotte</span><strong>{fcfa(pnl[t.id]!.revenue)}</strong></div>
                  <div className="adm-mini-kpi"><span>Taux d'activité</span><strong>{pnl[t.id]!.activityRate} %</strong></div>
                  <div className="adm-mini-kpi"><span>Immobilisés</span><strong>{pnl[t.id]!.grounded}</strong></div>
                  <div className="adm-mini-kpi"><span>ROI estimé</span><strong className={pnl[t.id]!.roi >= 0 ? 'pos' : 'neg'}>{pnl[t.id]!.roi} %</strong></div>
                </div>
              )}
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
        Toute tentative d'accès à une session non autorisée est <strong>refusée à l'employé et signalée à la direction</strong> (DG, CFO, DAA) — voir la session « Alertes sécurité ».
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
