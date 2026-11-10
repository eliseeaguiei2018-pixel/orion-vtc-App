import { useEffect, useRef, useState, useCallback } from 'react';
import { DEMO } from './demo';
import { API, LIVE, AdminError, H, PAGE_SIZE, adminDel, adminGet, adminPost, adminPut, clearSession, expKey, fcfa, logout, onUnauthorized, setCsrf, setDemoSession, pageSlice, reportResponse, safePost, safePut, sessionValid, setAdminErrorSink } from './api';
import { AuditSection, CorporateSection, FinanceSection, GlobalSearch, GreenSection, IntelSection, NotifySection, PricingEditor, PromosSection, ServicesSection, SupportSection, TreasurySection, ZonesSection } from './sections/business';
import { ClientsSection, DispatchSection, DisputesSection, DriversSection, ForensicDrawer, QualitySection, ReservationsCard, RidesSection } from './sections/operations';
import { RolesSection, SessionsSection, TeamsSection } from './sections/organisation';
import { OverviewSection, SamuSection, SecuritySection, SosDrawer } from './sections/supervision';
import { RentalSection, SubscriptionsSection } from './sections/location';
import type { ActiveSession, Alert, Amortization, Announcement, AuditEntry, CashDebtor, ChurnReport, Client, ClientDetail, Conversation, ConversionCell, CopilotAnswer, CorporateAccount, CsatReport, Dispute, DriverDetail, DriverRow, ElasticityCell, ExpenseTicket, ExpiringDoc, Finance, FleetUnit, FraudReport, GatewayStatus, GreenReport, Liquidity, Macro, MaintenanceTicket, Me, OpsConfig, Overview, PageMeta, PredictCell, Pricing, PrestigeUnit, Promo, QualityRow, QualityTop, RentalAvailabilityRow, RentalRow, RentalStats, Reservation, RideForensic, RideRow, SearchResults, SecurityAttempt, ServicesConfig, ShadowPricing, Shift, SimResult, SosChat, SosDossier, SquadPnl, StaffKpi, Stats, SubInvoiceRow, SubPlanRow, SubStats, SubscriptionRow, SupportMsg, SupportStats, Team, Transfer, Triggers, Zone } from './types';
import { ClientDrawer, DriverDrawer } from './ui';




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

interface LoginResponse { token: string; expiresAt: string; account: Me;
  /** Preuve anti-CSRF à recopier en en-tête (le jeton, lui, reste en cookie HttpOnly). */
  csrfToken?: string }

/* --------------------------- Porte d'entrée -------------------------- */
export function Admin() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    (async () => {
      if (!sessionValid()) { clearSession(); setChecking(false); return; }
      if (!LIVE) { setAuthed(true); setChecking(false); return; }
      try { await adminGet('/admin/me'); setAuthed(true); } catch { clearSession(); }
      setChecking(false);
    })();
  }, []);
  if (checking) return <div className="adm-loading">Vérification de l'accès…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Console onLogout={() => { void logout().then(() => setAuthed(false)); }} />;
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
    if (!LIVE) { setDemoSession(); localStorage.setItem(expKey, String(Date.now() + 12 * 3600e3)); onDone(); return; }
    try {
      const res = await fetch(`${API}/admin/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // Le serveur répond avec le cookie de session HttpOnly : il faut l'accepter.
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password, ...(mfa && code.trim() ? { code: code.trim() } : {}) }),
      });
      if (res.status === 429) { setErr('Compte temporairement verrouillé (trop de tentatives). Réessaie plus tard.'); setBusy(false); return; }
      if (!res.ok) { setErr(mfa ? 'Code 2FA invalide.' : 'Identifiants refusés. Accès réservé au personnel ORION.'); setBusy(false); return; }
      const data = (await res.json()) as LoginResponse & { mfaRequired?: boolean };
      if (data.mfaRequired) { setMfa(true); setBusy(false); return; } // mot de passe OK → code demandé
      // Le jeton N'EST PLUS stocké : il vit dans un cookie HttpOnly, hors de portée
      // de JavaScript. On ne garde que l'échéance et la preuve anti-CSRF.
      if (data.csrfToken) setCsrf(data.csrfToken);
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
type Section = 'overview' | 'alerts' | 'rental' | 'subscriptions' | 'rides' | 'drivers' | 'clients' | 'support' | 'notify' | 'pricing' | 'zones' | 'promos' | 'finance' | 'treasury' | 'dispatch' | 'quality' | 'disputes' | 'green' | 'teams' | 'intel' | 'b2b' | 'services' | 'audit' | 'sessions' | 'security' | 'roles';
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
  { id: 'rental', label: 'Location Signature', perm: 'rental:read', icon: '💎' },
  { id: 'subscriptions', label: 'Abonnements', perm: 'rental:read', icon: '🎫' },
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
  // S12-S15
  const [expiring, setExpiring] = useState<ExpiringDoc[]>([]);
  const [cashDebt, setCashDebt] = useState<CashDebtor[]>([]);
  const [gateways, setGateways] = useState<GatewayStatus[]>([]);
  const [expenses, setExpenses] = useState<ExpenseTicket[]>([]);
  const [liquidity, setLiquidity] = useState<Liquidity | null>(null);
  const [amortization, setAmortization] = useState<Amortization | null>(null);
  // Location Signature & abonnements ORION
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [prestige, setPrestige] = useState<PrestigeUnit[]>([]);
  const [rentalStats, setRentalStats] = useState<RentalStats | null>(null);
  const [rentalDispos, setRentalDispos] = useState<RentalAvailabilityRow[]>([]);
  const [subPlans, setSubPlans] = useState<SubPlanRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [subInvoices, setSubInvoices] = useState<SubInvoiceRow[]>([]);
  const [subStats, setSubStats] = useState<SubStats | null>(null);
  /** Modale « accès refusé » : session verrouillée, tentative signalée à la direction. */
  const [denied, setDenied] = useState<string | null>(null);
  /** Bandeau d'erreur serveur (opération refusée ou indisponible) — non bloquant. */
  const [notice, setNotice] = useState<string | null>(null);
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
    setExpiring(DEMO.expiring as ExpiringDoc[]); setCashDebt(DEMO.cashDebt as CashDebtor[]); setGateways(DEMO.gateways as GatewayStatus[]);
    setExpenses(DEMO.expenses as ExpenseTicket[]); setLiquidity(DEMO.liquidity as Liquidity); setAmortization(DEMO.amortization as Amortization);
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
    setRentals(DEMO.rentals); setPrestige(DEMO.prestige); setRentalStats(DEMO.rentalStats); setRentalDispos(DEMO.rentalDispos);
    setSubPlans(DEMO.subPlans); setSubscriptions(DEMO.subscriptions); setSubInvoices(DEMO.subInvoices); setSubStats(DEMO.subStats);
    setLive(false);
  }, [statsDays, ridesPage, driversPage, clientsPage]);

  const refresh = useCallback(async () => {
    if (!LIVE) { loadDemo(); return; }
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
        setExpiring((await adminGet<{ drivers: ExpiringDoc[] }>('/admin/drivers/expiring')).drivers);
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
      if (has('finance:read')) {
        setFinance(await adminGet<Finance>('/admin/finance'));
        setCashDebt((await adminGet<{ debtors: CashDebtor[] }>('/admin/finance/cash-debt')).debtors);
        setGateways((await adminGet<{ gateways: GatewayStatus[] }>('/admin/finance/gateways')).gateways);
        setExpenses((await adminGet<{ tickets: ExpenseTicket[] }>('/admin/expenses')).tickets);
      }
      if (has('treasury:read')) {
        setTransfers((await adminGet<{ transfers: Transfer[] }>('/admin/treasury')).transfers);
        setLiquidity(await adminGet<Liquidity>('/admin/liquidity'));
        setAmortization(await adminGet<Amortization>('/admin/treasury/amortization'));
      }
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
      if (has('rental:read')) {
        const loc = await adminGet<{ reservations: RentalRow[]; fleet: PrestigeUnit[]; stats: RentalStats; disponibilites: RentalAvailabilityRow[] }>('/admin/rental');
        setRentals(loc.reservations); setPrestige(loc.fleet); setRentalStats(loc.stats); setRentalDispos(loc.disponibilites);
        const abo = await adminGet<{ plans: SubPlanRow[]; subscriptions: SubscriptionRow[]; invoices: SubInvoiceRow[]; stats: SubStats }>('/admin/subscriptions');
        setSubPlans(abo.plans); setSubscriptions(abo.subscriptions); setSubInvoices(abo.invoices); setSubStats(abo.stats);
      }
      if (has('audit:read')) setAudit((await adminGet<{ entries: AuditEntry[] }>('/admin/audit')).entries);
    } catch { loadDemo(); }
  }, [loadDemo, statsDays, ridesPage, driversPage, clientsPage]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const p = LIVE ? setInterval(() => void refresh(), 6000) : undefined;
    return () => { clearInterval(t); if (p) clearInterval(p); };
  }, [refresh]);

  // Rend VISIBLE tout refus ou erreur d'appel à l'API. Exigence transversale : un 403
  // doit afficher à l'employé qu'il n'a pas le droit d'agir sans autorisation de la
  // direction (le serveur a déjà notifié DG, CFO, DAA). Les autres erreurs passent en
  // bandeau, afin qu'aucune opération refusée ne paraisse avoir réussi.
  useEffect(() => {
    setAdminErrorSink((e) => { if (e.isDenied) setDenied(e.message); else setNotice(e.message); });
    return () => setAdminErrorSink(() => {});
  }, []);
  // Le bandeau d'erreur s'effface de lui-même (l'employé peut aussi le fermer).
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(id);
  }, [notice]);

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
    if (!LIVE) { alert('Disponible avec le backend connecté — le document est généré côté serveur.'); return; }
    try {
      const res = await fetch(API + path, { headers: H(), credentials: 'include' });
      if (res.status === 401) { onUnauthorized(); return; }
      // Refus/erreur : on remonte le message du serveur (403 → message de la direction)
      // au lieu d'un avertissement générique, et on ne télécharge rien.
      if (!res.ok) { await reportResponse(res); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    } catch (e) { if (!(e instanceof AdminError)) setNotice('Document indisponible : serveur injoignable.'); }
  };

  /* --------------- Session SAMU : triage, prise en charge, clôture --------------- */
  const claimSos = async (id: string) => {
    if (!LIVE) { setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, agent: me?.name, status: 'acknowledged' } : a))); return; }
    try { await adminPost(`/admin/sos/${id}/claim`); void refresh(); }
    catch { alert('Alerte déjà prise en charge par un autre agent (verrou nominatif).'); }
  };
  const openSos = async (id: string) => {
    if (!LIVE) { setSosSel(DEMO.sosDossier(id) as SosDossier); return; }
    try { setSosSel(await adminGet<SosDossier>(`/admin/sos/${id}`)); }
    catch { alert('Dossier scellé — accès réservé à la direction.'); }
  };
  const sosMessage = async (id: string, text: string) => {
    if (LIVE) { try { await adminPost(`/admin/sos/${id}/message`, { text }); } catch { alert('Crise gérée par un autre agent.'); return; } }
    const msg: SosChat = { from: 'agent', author: me?.name, text, at: new Date().toISOString() };
    setSosSel((s) => (s && s.alert.id === id ? { ...s, alert: { ...s.alert, chat: [...(s.alert.chat ?? []), msg] } } : s));
  };
  const closeSos = async (id: string, note: string) => {
    if (LIVE) {
      try { await adminPost(`/admin/sos/${id}/close`, { note }); }
      catch { alert('Clôture refusée : note de synthèse trop courte, ou vous n’êtes pas l’agent gestionnaire.'); return; }
    }
    setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, status: 'resolved', sealed: true, closingNote: note } : a)));
    setSosSel(null);
  };

  /* ------ Accès non autorisé : refus affiché + signalement direction ------ */
  const openLocked = async (sectionId: string, label: string) => {
    if (LIVE) { try { await adminPost('/admin/access-denied', { section: sectionId }); } catch { /* déjà signalé côté serveur */ } }
    setDenied(`Vous n’avez pas le droit d’accéder à la session « ${label} » sans autorisation de la direction. Cette tentative vient d’être signalée à la direction (DG, CFO, DAA).`);
  };

  const savePricing = async (patch: Partial<Pricing>) => {
    if (!LIVE) { setPricing((p) => (p ? { ...p, ...patch, multipliers: { ...p.multipliers, ...(patch.multipliers ?? {}) } } : p)); return; }
    const { pricing: next } = await adminPut<{ pricing: Pricing }>('/admin/pricing', patch);
    setPricing(next);
  };

  const saveZone = async (zn: Zone) => {
    if (!LIVE) { setZones((xs) => (xs.some((z) => z.id === zn.id) ? xs.map((z) => (z.id === zn.id ? zn : z)) : [...xs, zn])); return; }
    const { zone } = await adminPut<{ zone: Zone }>('/admin/zones', zn);
    setZones((xs) => (xs.some((z) => z.id === zone.id) ? xs.map((z) => (z.id === zone.id ? zone : z)) : [...xs, zone]));
  };
  const toggleZone = async (id: string, active: boolean) => {
    if (LIVE && !(await safePost(`/admin/zones/${id}/active`, { active }))) return;
    setZones((xs) => xs.map((z) => (z.id === id ? { ...z, active } : z)));
  };
  const deleteZone = async (id: string) => {
    if (LIVE) await adminDel(`/admin/zones/${id}`);
    setZones((xs) => xs.filter((z) => z.id !== id));
  };
  const resetZones = async () => {
    if (!LIVE) { setZones(DEMO.zones as Zone[]); return; }
    const { zones: next } = await adminPost<{ zones: Zone[] }>('/admin/zones/reset');
    setZones(next);
  };

  const setClientStatus = async (id: string, status: string) => {
    if (!LIVE) { setClients((xs) => xs.map((c) => (c.id === id ? { ...c, status } : c))); return; }
    try { await adminPost(`/admin/clients/${id}/status`, { status }); setClients((xs) => xs.map((c) => (c.id === id ? { ...c, status } : c))); } catch { /* ignore */ }
  };

  const savePromo = async (p: { code: string; kind: 'percent' | 'amount'; value: number; maxUses?: number }) => {
    if (!LIVE) { setPromos((xs) => { const id = p.code.toUpperCase(); const ex = xs.find((x) => x.id === id); const np: Promo = { id, kind: p.kind, value: p.value, active: ex?.active ?? true, uses: ex?.uses ?? 0, maxUses: p.maxUses, createdAt: ex?.createdAt ?? new Date().toISOString() }; return ex ? xs.map((x) => (x.id === id ? np : x)) : [np, ...xs]; }); return; }
    const { promo } = await adminPut<{ promo: Promo }>('/admin/promos', p);
    setPromos((xs) => (xs.some((x) => x.id === promo.id) ? xs.map((x) => (x.id === promo.id ? promo : x)) : [promo, ...xs]));
  };
  const togglePromo = async (code: string, active: boolean) => {
    if (!LIVE) { setPromos((xs) => xs.map((x) => (x.id === code ? { ...x, active } : x))); return; }
    try { await adminPost(`/admin/promos/${code}/active`, { active }); setPromos((xs) => xs.map((x) => (x.id === code ? { ...x, active } : x))); } catch { /* */ }
  };
  const deletePromo = async (code: string) => {
    if (LIVE) await adminDel(`/admin/promos/${code}`);
    setPromos((xs) => xs.filter((x) => x.id !== code));
  };

  const saveServices = async (patch: Partial<ServicesConfig>) => {
    if (!LIVE) { setServices((s) => (s ? { ...s, ...patch, services: { ...s.services, ...(patch.services ?? {}) } } : s)); return; }
    const { config } = await adminPut<{ config: ServicesConfig }>('/admin/services', patch);
    setServices(config);
  };

  const supportReply = async (convId: string, text: string) => {
    const msg: SupportMsg = { id: Math.random().toString(36).slice(2, 8), from: 'agent', author: me?.name, text, at: new Date().toISOString() };
    if (LIVE && !(await safePost(`/admin/support/${convId}/reply`, { text }))) return;
    setSupport((xs) => xs.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg], status: 'pending' } : c)));
  };
  const supportSetStatus = async (convId: string, status: string) => {
    if (LIVE && !(await safePost(`/admin/support/${convId}/status`, { status }))) return;
    setSupport((xs) => xs.map((c) => (c.id === convId ? { ...c, status } : c)));
  };

  const sendBroadcast = async (a: { audience: string; title: string; body: string; channel?: string; segment?: string; scheduledAt?: string }) => {
    const local: Announcement = {
      id: Math.random().toString(36).slice(2, 8), author: me?.name ?? 'Admin', at: new Date().toISOString(),
      ...a, channel: (a.channel as Announcement['channel']) ?? 'push',
      stats: { sent: 1240, delivered: 1203, opened: 662, clicked: 199, rides: 53 },
    };
    // Sur refus/erreur, on n'ajoute PAS l'annonce localement : elle n'a pas été diffusée.
    if (LIVE) {
      try { const { announcement } = await adminPost<{ announcement: Announcement }>('/admin/broadcast', a); setBroadcasts((xs) => [announcement, ...xs]); }
      catch { /* déjà signalé à l'employé */ }
      return;
    }
    setBroadcasts((xs) => [local, ...xs]);
  };

  // Déclencheurs automatisés (batterie < 15 %, win-back 30 j).
  const runTrigger = async (trigger: 'battery' | 'winback') => {
    if (!LIVE) { alert(trigger === 'battery' ? 'Guidage borne envoyé aux véhicules < 15 % (démo).' : 'Campagne win-back envoyée avec un code RETOUR-XXXX (démo).'); return; }
    try {
      const r = await adminPost<{ sent: number; code?: string }>('/admin/notify/triggers/run', { trigger });
      alert(`${r.sent} notification(s) envoyée(s)${r.code ? ` · code ${r.code}` : ''}.`);
      void refresh();
    } catch { /* */ }
  };

  // Code promotionnel personnalisé de dédommagement (support).
  const compensate = async (clientId: string, percent: number) => {
    if (!LIVE) { alert(`Code DESOLE-${Math.random().toString(36).slice(2, 6).toUpperCase()} (-${percent} %) envoyé à ${clientId} (démo).`); return; }
    try {
      const { promo } = await adminPost<{ promo: { id: string } }>('/admin/promos/compensation', { clientId, percent, days: 7 });
      alert(`Code ${promo.id} (-${percent} %, 7 jours) envoyé dans l’app de ${clientId}.`);
    } catch { /* */ }
  };

  // Clôture forcée / ajustement de destination en vol (centre d'intervention manuelle).
  const forceRide = async (id: string, action: 'complete' | 'cancel') => {
    if (!LIVE) { setRides((xs) => xs.map((r) => (r.id === id ? { ...r, status: action === 'complete' ? 'completed' : 'cancelled' } : r))); return; }
    try { await adminPost(`/admin/rides/${id}/force`, { action }); void refresh(); } catch { /* déjà terminée */ }
  };
  const changeDestination = async (id: string) => {
    const input = window.prompt('Nouvelle destination — latitude, longitude :', '5.3600, -3.9850');
    if (!input) return;
    const [lat, lng] = input.split(',').map((s) => Number(s.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { alert('Coordonnées invalides.'); return; }
    if (!LIVE) { alert('Destination mise à jour, devis recalculé (démo).'); return; }
    try {
      const r = await adminPut<{ ride: { amount: number } }>(`/admin/rides/${id}/destination`, { lat, lng });
      alert(`Destination mise à jour — nouveau prix fixe : ${fcfa(r.ride.amount)}.`);
      void refresh();
    } catch { alert('Destination modifiable uniquement en course active.'); }
  };

  // Réservations à l'avance : assignation / annulation.
  const assignReservation = async (id: string) => {
    if (!LIVE) { setReservations((xs) => xs.map((r) => (r.id === id ? { ...r, status: 'assignee', driverName: 'Serge Aka', punctualityAlert: false } : r))); return; }
    try { await adminPost(`/admin/reservations/${id}/assign`); void refresh(); }
    catch { alert('Aucun chauffeur disponible pour cette réservation.'); }
  };
  const cancelReservation = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/reservations/${id}/cancel`))) return;
    setReservations((xs) => xs.map((r) => (r.id === id ? { ...r, status: 'annulee' } : r)));
  };

  /* ---------------- Location Signature & abonnements ---------------- */
  // Chaque écriture passe par safePost : si le serveur refuse, l'affichage N'EST PAS
  // modifié. Une location affichée « confirmée » alors que le serveur l'a refusée
  // laisserait un client sans véhicule le jour de son mariage.
  const assignRental = async (id: string, driverId: string) => {
    if (LIVE && !(await safePost(`/admin/rental/${id}/assign`, { driverId }))) return;
    setRentals((xs) => xs.map((r) => (r.id === id ? { ...r, driverId } : r)));
  };
  const setRentalStatus = async (id: string, status: string, note?: string) => {
    if (LIVE && !(await safePost(`/admin/rental/${id}/status`, { status, note }))) return;
    setRentals((xs) => xs.map((r) => (r.id === id ? { ...r, status } : r)));
  };
  const cancelRental = async (id: string, raison?: string) => {
    if (LIVE && !(await safePost(`/admin/rental/${id}/annuler`, { raison }))) return;
    setRentals((xs) => xs.map((r) => (r.id === id ? { ...r, status: 'annulee' } : r)));
  };
  const paySubInvoice = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/subscriptions/invoices/${id}/payer`, { method: 'cash' }))) return;
    setSubInvoices((xs) => xs.map((f) => (f.id === id ? { ...f, status: 'payee', payeeLe: new Date().toISOString() } : f)));
  };
  const runEcheances = async () => {
    if (LIVE && !(await safePost('/admin/subscriptions/echeances'))) return;
    void refresh();
  };
  const cancelSub = async (userId: string) => {
    if (LIVE && !(await safePost(`/admin/subscriptions/${userId}/resilier`, {}))) return;
    setSubscriptions((xs) => xs.map((x) => (x.userId === userId ? { ...x, active: false, cancelledAt: new Date().toISOString() } : x)));
  };

  // Programme VIP / Top Driver (priorité dispatch + commission réduite).
  const setVip = async (id: string, vip: boolean) => {
    if (LIVE && !(await safePost(`/admin/drivers/${id}/vip`, { vip }))) return;
    setQTop((xs) => xs.map((t) => (t.id === id ? { ...t, vip } : t)));
  };

  // Shadow mode : simulation d'une configuration hypothétique de dispatch.
  const simulate = async (patch: { maxEtaMinutes?: number; radiusMaxKm?: number }): Promise<{ current: SimResult; proposed: SimResult } | null> => {
    if (!LIVE) return DEMO.simulate(patch);
    try { return await adminPost<{ current: SimResult; proposed: SimResult }>('/admin/dispatch/simulate', patch); }
    catch { return null; }
  };

  /* --- S8 Équipes / RH : shifts, maintenance, micro-broadcast, P&L --- */
  const assignShift = async (input: { username: string; name: string; date: string; slot: string; zoneId?: string }) => {
    if (LIVE) { if (!(await safePut('/admin/shifts', input))) return; void refresh(); return; }
    setShifts((xs) => [...xs, { id: Math.random().toString(36).slice(2, 8), createdAt: new Date().toISOString(), ...input } as Shift]);
  };
  const removeShift = async (id: string) => {
    if (LIVE) await adminDel(`/admin/shifts/${id}`);
    setShifts((xs) => xs.filter((s) => s.id !== id));
  };
  const openMaintenance = async (input: { driverId: string; kind: string; title: string; teamId?: string }) => {
    if (LIVE) { if (!(await safePost('/admin/maintenance', input))) return; void refresh(); return; }
    setMaintenance((xs) => [{ id: Math.random().toString(36).slice(2, 8), status: 'ouvert', createdAt: new Date().toISOString(), ...input } as MaintenanceTicket, ...xs]);
  };
  const resolveMaintenance = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/maintenance/${id}/resolve`))) return;
    setMaintenance((xs) => xs.map((t) => (t.id === id ? { ...t, status: 'resolu' } : t)));
  };
  const microBroadcast = async (teamId: string, title: string, body: string) => {
    if (!LIVE) { alert(`Micro-broadcast envoyé à la flotte de l'équipe (démo).`); return; }
    try { const r = await adminPost<{ sent: number }>(`/admin/teams/${teamId}/broadcast`, { title, body }); alert(`${r.sent} chauffeur(s) de la flotte notifié(s).`); }
    catch { /* */ }
  };
  const loadSquadPnl = async (teamId: string): Promise<SquadPnl | null> => {
    if (!LIVE) return DEMO.squadPnl(teamId);
    try { return (await adminGet<{ pnl: SquadPnl }>(`/admin/teams/${teamId}/pnl`)).pnl; } catch { return null; }
  };

  /* --- S9 IA : copilote conversationnel --- */
  const askCopilot = async (q: string): Promise<CopilotAnswer | null> => {
    if (!LIVE) return DEMO.copilot(q);
    try { return await adminPost<CopilotAnswer>('/admin/copilot', { q }); } catch { return null; }
  };

  /* --- S10 B2B : import de masse, web booker --- */
  const importMembers = async (id: string, memberIds: string[]) => {
    if (!LIVE) { alert(`${memberIds.length} collaborateur(s) importé(s) (démo).`); return; }
    try { const r = await adminPost<{ added: number }>(`/admin/corporate/${id}/members`, { memberIds }); alert(`${r.added} nouveau(x) collaborateur(s) rattaché(s).`); void refresh(); }
    catch { /* */ }
  };
  const webBook = async (id: string, input: { guestName: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; category: string }) => {
    if (!LIVE) { alert(`Course conciergerie réservée pour ${input.guestName} (démo). SMS de suivi GPS + plaque envoyé.`); return; }
    try { const r = await adminPost<{ booking: { amount: number } }>(`/admin/corporate/${id}/book`, input); alert(`Course réservée pour ${input.guestName} — ${fcfa(r.booking.amount)}. SMS de suivi envoyé.`); void refresh(); }
    catch { alert('Réservation refusée (politique entreprise ou crédit dépassé).'); }
  };

  /* --- S11 Litiges : escalade, quarantaine, notes --- */
  const escalateDispute = async (id: string, kind: string) => {
    if (LIVE) { try { await adminPost(`/admin/disputes/${id}/escalate`, { kind }); void refresh(); return; } catch { alert('Dossier déjà verrouillé par un autre expert.'); return; } }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, escalation: kind, lockedBy: me?.name, status: 'investigating' } : d)));
  };
  const quarantineDispute = async (id: string, on: boolean) => {
    if (LIVE) { if (!(await safePost(`/admin/disputes/${id}/quarantine`, { on }))) return; void refresh(); return; }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, quarantined: on } : d)));
  };
  const noteDispute = async (id: string, text: string) => {
    if (LIVE) { try { await adminPost(`/admin/disputes/${id}/note`, { text }); void refresh(); return; } catch { alert('Note réservée à l’expert gestionnaire.'); return; } }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, notes: [...(d.notes ?? []), { author: me?.name ?? 'Expert', text, at: new Date().toISOString() }] } : d)));
  };

  /* --- S12 Chauffeur : suspension motivée, fidélité --- */
  const suspendDriver = async (id: string) => {
    const reason = window.prompt('Motif de suspension (obligatoire — trace légale) :', '');
    if (!reason?.trim()) return;
    if (LIVE) { if (!(await safePost(`/admin/drivers/${id}/kyc`, { status: 'suspended', reason: reason.trim() }))) return; void refresh(); return; }
    setDrivers((xs) => xs.map((d) => (d.id === id ? { ...d, kycStatus: 'suspended', availability: 'offline', suspensionReason: reason.trim() } : d)));
  };
  const setLoyalty = async (id: string, tier: string) => {
    const pct = window.prompt('Commission personnalisée (%) — laisser vide pour aucune :', '10');
    const override = pct?.trim() ? Number(pct) / 100 : null;
    if (LIVE) { if (!(await safePost(`/admin/drivers/${id}/loyalty`, { loyaltyTier: tier, commissionOverride: override }))) return; void refresh(); return; }
    setDrivers((xs) => xs.map((d) => (d.id === id ? { ...d, loyaltyTier: tier } : d)));
  };

  /* --- S13 Client : VIP, blacklist, no-show --- */
  const setClientVip = async (id: string, tier: string, noSurgeLock: boolean) => {
    if (LIVE && !(await safePost(`/admin/clients/${id}/vip`, { vipTier: tier, noSurgeLock }))) return;
    alert(`Client ${id} → ${tier}${noSurgeLock ? ' · no-surge verrouillé' : ''}.`);
  };
  const blacklistClient = async (id: string) => {
    const imei = window.prompt('Liste noire — IMEI de l’appareil (bloque la réinscription) :', '');
    if (imei === null) return;
    if (LIVE && !(await safePost(`/admin/clients/${id}/blacklist`, { imei, reason: 'Bannissement manuel' }))) return;
    setClients((xs) => xs.map((c) => (c.id === id ? { ...c, status: 'blocked' } : c)));
    setClientSel((c) => (c && c.id === id ? { ...c, status: 'blocked' } : c));
  };
  const noShowFee = async (id: string) => {
    const fee = window.prompt('Frais de no-show à prélever (F CFA) — vérifiés au GPS :', '1000');
    if (!fee) return;
    if (LIVE && !(await safePost(`/admin/clients/${id}/noshow`, { fee: Number(fee) }))) return;
    alert(`Frais de no-show de ${fcfa(Number(fee))} prélevés sur ${id}.`);
  };

  /* --- S16 Tarification : shadow pricing --- */
  const shadowPricing = async (patch: { baseFactor: number; perKmFactor: number }): Promise<ShadowPricing | null> => {
    if (!LIVE) { const base = 1263500; const sim = Math.round(base * (0.5 * patch.baseFactor + 0.5 * patch.perKmFactor)); return { sampled: 60, realRevenue: base, simulatedRevenue: sim, impactPercent: Math.round(((sim - base) / base) * 1000) / 10 }; }
    try { return await adminPost<ShadowPricing>('/admin/pricing/shadow', patch); } catch { return null; }
  };

  /* --- S14 Finances : gateways, notes de frais --- */
  const toggleGateway = async (method: string, enabled: boolean) => {
    if (LIVE && !(await safePost('/admin/finance/gateways', { method, enabled }))) return;
    setGateways((xs) => xs.map((g) => (g.method === method ? { ...g, enabled } : g)));
  };
  const decideExpense = async (id: string, decision: 'approve' | 'reject' | 'info') => {
    if (LIVE) { if (!(await safePost(`/admin/expenses/${id}/decide`, { decision }))) return; void refresh(); return; }
    setExpenses((xs) => xs.map((t) => (t.id === id ? { ...t, status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'info_requested', credited: decision === 'approve' } : t)));
  };
  const newExpense = async () => {
    const amount = window.prompt('Montant de l’avance demandée (F CFA) :', '50000');
    if (!amount) return;
    const description = window.prompt('Justification :', 'Campagne marketing terrain');
    if (!description) return;
    if (LIVE) { try { await adminPost('/admin/expenses', { amount: Number(amount), category: 'marketing', neededDate: new Date().toISOString(), description }); void refresh(); return; } catch { alert('Compte gelé (justificatif en retard) ou non autorisé.'); return; } }
    setExpenses((xs) => [{ id: Math.random().toString(36).slice(2, 8), requesterType: 'employee', requesterId: me?.name ?? 'moi', requesterName: me?.name ?? 'Moi', amount: Number(amount), category: 'marketing', neededDate: new Date().toISOString(), description, status: 'pending', createdAt: new Date().toISOString() }, ...xs]);
  };

  /** Télécharge un CSV : via l'API (avec session JWT) ou généré localement (démo). */
  const downloadCsv = async (path: string, filename: string, local: () => string) => {
    let content: string;
    if (LIVE) {
      try {
        const res = await fetch(API + path, { headers: H(), credentials: 'include' });
        if (res.status === 401) { onUnauthorized(); return; }
        // Sans ce contrôle, un refus (403) écrivait le corps d'erreur JSON DANS le
        // fichier : l'employé repartait avec un export corrompu au lieu de voir le refus.
        if (!res.ok) { await reportResponse(res); return; }
        content = await res.text();
      } catch (e) {
        if (e instanceof AdminError) return; // déjà signalé
        content = local();                   // réseau coupé : export local de secours
      }
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
    if (LIVE && !(await safePost(`/admin/drivers/${id}/${kind}`, kind === 'kyc' ? { status: value } : { availability: value }))) return;
    setDrivers((xs) => xs.map((d) => (d.id === id ? { ...d, ...(kind === 'kyc' ? { kycStatus: value, availability: value === 'suspended' ? 'offline' : d.availability } : { availability: value }) } : d)));
  };

  const openDriver = async (id: string) => {
    if (!LIVE) { setDriverSel(DEMO.driverDetail(id, drivers)); return; }
    try { setDriverSel((await adminGet<{ driver: DriverDetail }>(`/admin/drivers/${id}`)).driver); }
    catch { setDriverSel(DEMO.driverDetail(id, drivers)); }
  };
  const openClient = async (id: string) => {
    if (!LIVE) { setClientSel(DEMO.clientDetail(id, clients)); return; }
    try { setClientSel((await adminGet<{ client: ClientDetail }>(`/admin/clients/${id}`)).client); }
    catch { setClientSel(DEMO.clientDetail(id, clients)); }
  };

  // --- Trésorerie (double validation) ---
  const requestTransfer = async (input: { amount: number; destination: string; reason: string }) => {
    if (!LIVE) {
      const local: Transfer = { id: Math.random().toString(36).slice(2, 10), currency: 'XOF', status: 'pending', requestedBy: me?.name ?? 'CFO', requestedRole: me?.role ?? 'cfo', createdAt: new Date().toISOString(), ...input };
      setTransfers((xs) => [local, ...xs]); return;
    }
    try { const { transfer } = await adminPost<{ transfer: Transfer }>('/admin/treasury/request', input); setTransfers((xs) => [transfer, ...xs]); } catch { /* */ }
  };
  const decideTransfer = async (id: string, action: 'approve' | 'reject', note?: string) => {
    if (!LIVE) {
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
    if (!LIVE) return DEMO.search(q);
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
    if (!LIVE) { setOps((o) => (o ? { ...o, ...patch } : o)); setQuality((q) => (q ? { ...q, threshold: patch.minRating ?? q.threshold, autoWarn: patch.autoWarn ?? q.autoWarn } : q)); return; }
    try { const { ops: next } = await adminPut<{ ops: OpsConfig }>('/admin/dispatch', patch); setOps(next); } catch { /* */ }
  };

  const warnDriver = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/drivers/${id}/warn`))) return;
    setQuality((q) => (q ? { ...q, drivers: q.drivers.map((d) => (d.id === id ? { ...d, warnings: d.warnings + 1 } : d)) } : q));
  };

  // Réassignation manuelle d'une course (auto : re-matching selon la règle courante).
  const reassignRide = async (id: string) => {
    if (!LIVE) { setRides((xs) => xs.map((r) => (r.id === id ? { ...r, driverName: 'Serge Aka', matricule: 'ORION-CI-4820', status: 'accepted' } : r))); return; }
    try { await adminPost(`/admin/rides/${id}/reassign`); void refresh(); } catch { /* aucun chauffeur dispo */ }
  };

  // Instruction d'un litige : fiche complète de la course (tracé GPS + tarif).
  const openForensic = async (rideId: string) => {
    if (!LIVE) { setForensic(DEMO.rideForensic(rideId)); return; }
    try { setForensic(await adminGet<RideForensic>(`/admin/rides/${rideId}`)); }
    catch { setForensic(DEMO.rideForensic(rideId)); }
  };

  const decideDispute = async (id: string, status: 'investigating' | 'resolved' | 'rejected', resolution?: string, refund?: number) => {
    if (LIVE && !(await safePost(`/admin/disputes/${id}/status`, { status, resolution, refund }))) return;
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, status, resolution: resolution ?? d.resolution, refund: refund ?? d.refund, decidedBy: me?.name, decidedAt: new Date().toISOString() } : d)));
  };

  // Équipes : création/mise à jour + affectation de flotte.
  const saveTeam = async (input: { id?: string; name: string; managerUsername: string; managerName?: string; driverIds?: string[] }) => {
    if (!LIVE) {
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
    if (LIVE) await adminDel(`/admin/teams/${id}`);
    setTeams((xs) => xs.filter((t) => t.id !== id));
  };

  // B2B : comptes entreprises (ligne de crédit, facture, règlement).
  const saveCorporate = async (input: { id?: string; name: string; contactEmail?: string; creditLimit: number }) => {
    if (!LIVE) {
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
    if (LIVE && !(await safePost(`/admin/corporate/${id}/settle`))) return;
    setCorporate((xs) => xs.map((a) => (a.id === id ? { ...a, balanceUsed: 0 } : a)));
  };
  const exportInvoice = (id: string) => void downloadCsv(`/admin/corporate/${id}/invoice`, `facture-${id}.csv`, () => {
    const acc = corporate.find((a) => a.id === id);
    return `"Facture ORION — ${acc?.name ?? id}"\ncourse,date,client,statut,montant_fcfa\n"TOTAL",,,,"${acc?.balanceUsed ?? 0}"`;
  });

  // Bilan carbone PDF (via session JWT).
  const downloadCarbonPdf = async () => {
    if (!LIVE) { alert('Disponible avec le backend connecté — le PDF est généré côté serveur.'); return; }
    try {
      const res = await fetch(`${API}/admin/green/report.pdf`, { headers: H(), credentials: 'include' });
      if (res.status === 401) { onUnauthorized(); return; }
      // Sans ce contrôle, un refus téléchargeait le corps d'erreur JSON en guise de PDF.
      if (!res.ok) { await reportResponse(res); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'orion-bilan-carbone.pdf'; a.click(); URL.revokeObjectURL(url);
    } catch { setNotice('Bilan carbone indisponible : serveur injoignable.'); }
  };

  // Campagne de réengagement (churn) → diffusion clients avec code promo.
  const reengage = () => void sendBroadcast({
    audience: 'clients',
    title: 'Tu nous manques 💚',
    body: 'Reviens rouler vert avec ORION : -20 % sur ta prochaine course avec le code RETOUR20.',
  });

  // Révoque une session (l'employé est déconnecté immédiatement).
  const revokeSess = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/sessions/${id}/revoke`))) return;
    setSessions((xs) => xs.map((s) => (s.id === id ? { ...s, revoked: true } : s)));
    if (id === selfSession) { void logout().then(() => window.location.reload()); } // on s'est déconnecté soi-même
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
        {section === 'drivers' && <DriversSection drivers={drivers} expiring={expiring} canWrite={can('drivers:write')} onAction={driverAction} onSuspend={suspendDriver} onLoyalty={setLoyalty} onOpen={openDriver} meta={driversMeta} onPage={setDriversPage} onContract={(id) => void downloadFile(`/admin/drivers/${id}/contract.pdf`, `orion-contrat-${id.slice(0, 8)}.pdf`)} onFleetCsv={() => void downloadCsv('/admin/fleet.csv', 'orion-flotte.csv', () => 'matricule,nom,motorisation')} />}
        {section === 'clients' && <ClientsSection clients={clients} canWrite={can('clients:write')} onStatus={setClientStatus} onOpen={openClient} meta={clientsMeta} onPage={setClientsPage} onVip={setClientVip} onBlacklist={blacklistClient} onNoShow={noShowFee} onLtvCsv={() => void downloadCsv('/admin/clients.csv', 'orion-clients-ltv.csv', () => 'client,nom')} onBehaviorPdf={() => void downloadFile('/admin/clients/behavior.pdf', 'orion-comportement-clients.pdf')} />}
        {section === 'notify' && <NotifySection broadcasts={broadcasts} triggers={triggers} canWrite={can('notify:write')} onSend={sendBroadcast} onTrigger={runTrigger} />}
        {section === 'finance' && finance && <FinanceSection finance={finance} ops={ops} cashDebt={cashDebt} gateways={gateways} expenses={expenses} onExport={exportCsv} canExport={can('rides:read')} canWrite={can('pricing:write')} canGateway={can('services:write')} canApprove={can('treasury:request')} onSaveOps={saveOps} onToggleGateway={toggleGateway} onDecideExpense={decideExpense} onNewExpense={newExpense} onPayouts={() => void downloadCsv('/admin/payouts.csv', 'orion-payouts.csv', () => 'matricule,nom,solde')} />}
        {section === 'treasury' && <TreasurySection transfers={transfers} meName={me.name} liquidity={liquidity} amortization={amortization} canRequest={can('treasury:request')} canApprove={can('treasury:approve')} onRequest={requestTransfer} onDecide={decideTransfer} onExport={exportTreasuryCsv} onReportPdf={() => void downloadFile('/admin/treasury/report.pdf', 'orion-tresorerie-executif.pdf')} />}
        {section === 'pricing' && pricing && <PricingEditor pricing={pricing} canWrite={can('pricing:write')} onSave={savePricing} onShadow={shadowPricing} onMatrixCsv={() => void downloadCsv('/admin/pricing/matrix.csv', 'orion-matrice-tarifaire.csv', () => 'zone,facteur_zone')} />}
        {section === 'zones' && <ZonesSection zones={zones} canWrite={can('pricing:write')} onSave={saveZone} onToggle={toggleZone} onDelete={deleteZone} onReset={resetZones} onMatrixCsv={() => void downloadCsv('/admin/zones/matrix.csv', 'orion-matrice-zones.csv', () => 'zone_depart,zone_arrivee,forfait_fcfa')} />}
        {section === 'promos' && <PromosSection promos={promos} canWrite={can('promos:write')} onSave={savePromo} onToggle={togglePromo} onDelete={deletePromo} />}
        {section === 'services' && services && <ServicesSection config={services} canWrite={can('services:write')} onSave={saveServices} />}
        {section === 'rental' && (
          <RentalSection
            reservations={rentals} fleet={prestige} stats={rentalStats} dispos={rentalDispos} drivers={drivers}
            canWrite={can('rental:write')}
            onAssign={assignRental} onStatus={setRentalStatus} onCancel={cancelRental}
            onBon={(id) => void downloadFile(`/admin/rental/${id}/bon.pdf`, `orion-location-${id}.pdf`)}
          />
        )}
        {section === 'subscriptions' && (
          <SubscriptionsSection
            plans={subPlans} subscriptions={subscriptions} invoices={subInvoices} stats={subStats}
            canWrite={can('rental:write')}
            onPayInvoice={paySubInvoice} onEcheances={runEcheances} onResilier={cancelSub}
          />
        )}
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

      {/* Bandeau d'erreur serveur : l'opération n'a PAS été enregistrée. */}
      {notice && (
        <div className="adm-notice" role="alert">
          <span>⚠️ {notice}</span>
          <button className="adm-notice-x" onClick={() => setNotice(null)} aria-label="Fermer">✕</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Sections ----------------------------- */

