import { useEffect, useState, useCallback } from 'react';
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
export interface SupportMsg { id: string; from: 'client' | 'agent'; author?: string; text: string; at: string }
export interface Conversation { id: string; clientId: string; subject: string; status: string; assignee?: string; messages: SupportMsg[]; createdAt: string; updatedAt: string }
export interface AuditEntry { id: string; at: string; actor: string; role: string; action: string; target?: string; details?: Record<string, unknown> }
export interface Finance { currency: string; gmv: number; revenue: number; commission: number; earnings: number; payouts: number; byTier: Record<string, { count: number; revenue: number }> }
export interface Announcement { id: string; audience: string; title: string; body: string; author: string; at: string }

/* ------------------------------- API --------------------------------- */
const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const tokenKey = 'orion.admin.token';
const getToken = () => localStorage.getItem(tokenKey) ?? 'orion-admin-dev';
const H = () => ({ 'x-admin-token': getToken(), 'content-type': 'application/json' });
async function adminGet<T>(p: string): Promise<T> { const r = await fetch(API + p, { headers: H() }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
async function adminPost<T>(p: string, b?: unknown): Promise<T> { const r = await fetch(API + p, { method: 'POST', headers: H(), body: JSON.stringify(b ?? {}) }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
async function adminPut<T>(p: string, b: unknown): Promise<T> { const r = await fetch(API + p, { method: 'PUT', headers: H(), body: JSON.stringify(b) }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
async function adminDel(p: string): Promise<void> { await fetch(API + p, { method: 'DELETE', headers: H() }); }
const fcfa = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' F';

/* --------------------------- Porte d'entrée -------------------------- */
export function Admin() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    (async () => {
      const t = localStorage.getItem(tokenKey);
      if (!t) { setChecking(false); return; }
      if (!API) { setAuthed(true); setChecking(false); return; }
      try { await adminGet('/admin/me'); setAuthed(true); } catch { localStorage.removeItem(tokenKey); }
      setChecking(false);
    })();
  }, []);
  if (checking) return <div className="adm-loading">Vérification de l'accès…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Console onLogout={() => { localStorage.removeItem(tokenKey); setAuthed(false); }} />;
}

/* --------------------------- Écran de connexion --------------------- */
function Login({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = value.trim();
    if (!token) { setErr('Saisis ton jeton administrateur.'); return; }
    setBusy(true); setErr('');
    localStorage.setItem(tokenKey, token);
    if (!API) { onDone(); return; }
    try { await adminGet('/admin/me'); onDone(); }
    catch { localStorage.removeItem(tokenKey); setErr('Jeton refusé. Accès réservé au personnel ORION.'); setBusy(false); }
  };
  return (
    <div className="adm-login">
      <form className="adm-login-card" onSubmit={submit}>
        <span className="adm-logo big" aria-hidden>
          <svg width="30" height="30" viewBox="0 0 512 512"><path d="M256 92 C 338 150 372 252 318 350 C 300 382 280 404 256 424 C 232 404 212 382 194 350 C 140 252 174 150 256 92 Z" fill="#04140d"/><g fill="#04140d"><circle cx="372" cy="120" r="15"/><circle cx="406" cy="150" r="12"/><circle cx="430" cy="186" r="9"/></g></svg>
        </span>
        <h1>ORION Admin</h1>
        <p className="adm-login-sub">Centre de contrôle — accès réservé au personnel ORION.</p>
        <label className="adm-login-label">Jeton administrateur</label>
        <input className="adm-login-input" type="password" placeholder="••••••••••••" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        {err && <div className="adm-login-err">{err}</div>}
        <button className="adm-btn solid big" type="submit" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        {!API && <p className="adm-login-demo">Mode démo — n'importe quel jeton ouvre la console (données simulées).</p>}
      </form>
    </div>
  );
}

/* ------------------------------ Navigation --------------------------- */
type Section = 'overview' | 'alerts' | 'rides' | 'drivers' | 'clients' | 'support' | 'notify' | 'pricing' | 'promos' | 'finance' | 'services' | 'audit' | 'roles';
const NAV: { id: Section; label: string; perm: string; icon: string }[] = [
  { id: 'overview', label: 'Vue d’ensemble', perm: 'overview:read', icon: '📊' },
  { id: 'alerts', label: 'Supervision SAMU', perm: 'alerts:read', icon: '🚨' },
  { id: 'support', label: 'Support & chat', perm: 'support:read', icon: '💬' },
  { id: 'notify', label: 'Notifications', perm: 'notify:read', icon: '📣' },
  { id: 'rides', label: 'Courses', perm: 'rides:read', icon: '🚗' },
  { id: 'drivers', label: 'Chauffeurs', perm: 'drivers:read', icon: '🧑‍✈️' },
  { id: 'clients', label: 'Clients', perm: 'clients:read', icon: '👥' },
  { id: 'finance', label: 'Finances', perm: 'finance:read', icon: '📈' },
  { id: 'pricing', label: 'Tarification', perm: 'pricing:read', icon: '💰' },
  { id: 'promos', label: 'Codes promo', perm: 'promos:read', icon: '🎟️' },
  { id: 'services', label: 'Services & ville', perm: 'services:read', icon: '🧩' },
  { id: 'audit', label: 'Journal', perm: 'audit:read', icon: '📜' },
  { id: 'roles', label: 'Rôles & accès', perm: 'roles:read', icon: '🛡️' },
];

/* ------------------------------- Console ----------------------------- */
function Console({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fleet, setFleet] = useState<FleetUnit[]>([]);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
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

  const loadDemo = useCallback(() => {
    setMe(DEMO.me); setOv(DEMO.overview); setAlerts(DEMO.alerts); setFleet(DEMO.fleet);
    setRides(DEMO.rides); setDrivers(DEMO.drivers); setPricing(DEMO.pricing);
    setClients(DEMO.clients); setPromos(DEMO.promos as Promo[]); setServices(DEMO.services);
    setSupport(DEMO.support as Conversation[]); setAudit(DEMO.audit as AuditEntry[]);
    setFinance(DEMO.finance); setBroadcasts(DEMO.broadcasts as Announcement[]); setLive(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!API) { loadDemo(); return; }
    try {
      const meRes = await adminGet<Me>('/admin/me');
      setMe(meRes); setLive(true);
      const has = (p: string) => meRes.permissions.includes(p);
      if (has('overview:read')) setOv(await adminGet<Overview>('/admin/overview'));
      if (has('alerts:read')) setAlerts((await adminGet<{ alerts: Alert[] }>('/admin/alerts')).alerts);
      if (has('drivers:read')) { setFleet((await adminGet<{ fleet: FleetUnit[] }>('/admin/fleet/live')).fleet); setDrivers((await adminGet<{ drivers: DriverRow[] }>('/admin/drivers')).drivers); }
      if (has('rides:read')) setRides((await adminGet<{ rides: RideRow[] }>('/admin/rides?limit=12')).rides);
      if (has('pricing:read')) setPricing((await adminGet<{ pricing: Pricing }>('/admin/pricing')).pricing);
      if (has('clients:read')) setClients((await adminGet<{ clients: Client[] }>('/admin/clients')).clients);
      if (has('promos:read')) setPromos((await adminGet<{ promos: Promo[] }>('/admin/promos')).promos);
      if (has('services:read')) setServices((await adminGet<{ config: ServicesConfig }>('/admin/services')).config);
      if (has('support:read')) setSupport((await adminGet<{ conversations: Conversation[] }>('/admin/support')).conversations);
      if (has('finance:read')) setFinance(await adminGet<Finance>('/admin/finance'));
      if (has('notify:read')) setBroadcasts((await adminGet<{ announcements: Announcement[] }>('/admin/broadcasts')).announcements);
      if (has('audit:read')) setAudit((await adminGet<{ entries: AuditEntry[] }>('/admin/audit')).entries);
    } catch { loadDemo(); }
  }, [loadDemo]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const p = API ? setInterval(() => void refresh(), 6000) : undefined;
    return () => { clearInterval(t); if (p) clearInterval(p); };
  }, [refresh]);

  const setAlertStatus = async (id: string, status: string) => {
    if (!API) { setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, status } : a))); return; }
    try { const { alert } = await adminPost<{ alert: Alert }>(`/admin/alerts/${id}/status`, { status }); setAlerts((xs) => xs.map((a) => (a.id === alert.id ? alert : a))); } catch { /* ignore */ }
  };

  const savePricing = async (patch: Partial<Pricing>) => {
    if (!API) { setPricing((p) => (p ? { ...p, ...patch, multipliers: { ...p.multipliers, ...(patch.multipliers ?? {}) } } : p)); return; }
    const { pricing: next } = await adminPut<{ pricing: Pricing }>('/admin/pricing', patch);
    setPricing(next);
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

  const exportCsv = () => {
    if (API) { window.open(`${API}/admin/rides.csv`, '_blank'); return; }
    const head = 'id,client,status,amount';
    const rows = rides.map((r) => `${r.id},${r.clientId},${r.status},${r.amount}`);
    const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'orion-courses.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const driverAction = async (id: string, kind: 'kyc' | 'availability', value: string) => {
    if (API) { try { await adminPost(`/admin/drivers/${id}/${kind}`, kind === 'kyc' ? { status: value } : { availability: value }); } catch { /* */ } }
    setDrivers((xs) => xs.map((d) => (d.id === id ? { ...d, ...(kind === 'kyc' ? { kycStatus: value, availability: value === 'suspended' ? 'offline' : d.availability } : { availability: value }) } : d)));
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
          <div className="adm-top-right">
            <span className={`adm-live ${live ? 'on' : 'demo'}`}>{live ? '● EN DIRECT' : '● MODE DÉMO'}</span>
            <span className="adm-clock">{now.toLocaleTimeString('fr-FR')}</span>
            <button className="adm-btn ghost" onClick={() => void refresh()}>Rafraîchir</button>
          </div>
        </header>

        {section === 'overview' && <OverviewSection ov={ov} fleet={fleet} openAlerts={openAlerts} />}
        {section === 'alerts' && <AlertsSection alerts={alerts} fleet={fleet} openAlerts={openAlerts} canWrite={can('alerts:write')} onStatus={setAlertStatus} />}
        {section === 'support' && <SupportSection convs={support} canWrite={can('support:write')} onReply={supportReply} onStatus={supportSetStatus} />}
        {section === 'rides' && <RidesSection rides={rides} />}
        {section === 'drivers' && <DriversSection drivers={drivers} canWrite={can('drivers:write')} onAction={driverAction} />}
        {section === 'clients' && <ClientsSection clients={clients} canWrite={can('clients:write')} onStatus={setClientStatus} />}
        {section === 'notify' && <NotifySection broadcasts={broadcasts} canWrite={can('notify:write')} onSend={sendBroadcast} />}
        {section === 'finance' && finance && <FinanceSection finance={finance} onExport={exportCsv} canExport={can('rides:read')} />}
        {section === 'pricing' && pricing && <PricingEditor pricing={pricing} canWrite={can('pricing:write')} onSave={savePricing} />}
        {section === 'promos' && <PromosSection promos={promos} canWrite={can('promos:write')} onSave={savePromo} onToggle={togglePromo} onDelete={deletePromo} />}
        {section === 'services' && services && <ServicesSection config={services} canWrite={can('services:write')} onSave={saveServices} />}
        {section === 'audit' && <AuditSection entries={audit} />}
        {section === 'roles' && <RolesSection me={me} />}
      </main>
    </div>
  );
}

/* ------------------------------ Sections ----------------------------- */
function OverviewSection({ ov, fleet, openAlerts }: { ov: Overview; fleet: FleetUnit[]; openAlerts: Alert[] }) {
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="Courses actives" value={String(ov.rides.active)} sub={`${ov.rides.total} au total`} tone="green" />
        <Kpi label="Chauffeurs en ligne" value={String(ov.drivers.online)} sub={`${ov.drivers.onTrip} en course`} tone="teal" />
        <Kpi label="Revenu (courses)" value={fcfa(ov.finance.revenue)} sub={`Commission ${fcfa(ov.finance.commission)}`} tone="mint" />
        <Kpi label="Alertes ouvertes" value={String(openAlerts.length)} sub={`${ov.safety.total} au total`} tone={openAlerts.length ? 'danger' : 'muted'} />
      </section>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Supervision de la flotte</h3><span className="adm-muted">{fleet.length} véhicules · temps réel</span></div>
        <SupervisionMap fleet={fleet} alerts={openAlerts} />
        <div className="adm-legend"><span><i className="dot green" /> Disponible</span><span><i className="dot amber" /> En course</span><span><i className="dot red pulse" /> Alerte SAMU</span></div>
      </div>
    </>
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

function RidesSection({ rides }: { rides: RideRow[] }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Courses récentes</h3><span className="adm-muted">{rides.length}</span></div>
      <table className="adm-table">
        <thead><tr><th>Course</th><th>Chauffeur</th><th>Statut</th><th>Trafic</th><th className="r">Montant</th></tr></thead>
        <tbody>
          {rides.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id.slice(0, 8)}</td><td>{r.driverName ?? '—'}</td>
              <td><span className={`adm-pill s-${r.status}`}>{rideStatusLabel(r.status)}</span></td>
              <td>{trafficLabel(r.trafficLevel)}</td><td className="r">{fcfa(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriversSection({ drivers, canWrite, onAction }: { drivers: DriverRow[]; canWrite: boolean; onAction: (id: string, kind: 'kyc' | 'availability', value: string) => void }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Chauffeurs</h3><span className="adm-muted">{drivers.length}</span></div>
      <table className="adm-table">
        <thead><tr><th>Nom</th><th>Matricule</th><th>Niveau</th><th>KYC</th><th>État</th><th className="r">Solde</th><th className="r">Note</th>{canWrite && <th>Actions</th>}</tr></thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td><td className="mono">{d.matricule}</td><td className="cap">{d.category}</td>
              <td><span className={`adm-pill kyc-${d.kycStatus}`}>{kycLabel(d.kycStatus)}</span></td>
              <td><span className={`adm-pill av-${d.availability}`}>{availLabel(d.availability)}</span></td>
              <td className="r">{fcfa(d.balance)}</td><td className="r">★ {d.rating.toFixed(2)}</td>
              {canWrite && (
                <td>
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
    </div>
  );
}

function ClientsSection({ clients, canWrite, onStatus }: { clients: Client[]; canWrite: boolean; onStatus: (id: string, s: string) => void }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Clients</h3><span className="adm-muted">{clients.length}</span></div>
      <table className="adm-table">
        <thead><tr><th>Client</th><th>Téléphone</th><th className="r">Courses</th><th>Statut</th>{canWrite && <th>Actions</th>}</tr></thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td>{c.name ?? c.id}<div className="mono adm-muted" style={{ fontSize: 11 }}>{c.id}</div></td>
              <td>{c.phone ?? '—'}</td><td className="r">{c.rides}</td>
              <td><span className={`adm-pill ${c.status === 'blocked' ? 'kyc-manual_review' : 'av-online'}`}>{c.status === 'blocked' ? 'Bloqué' : 'Actif'}</span></td>
              {canWrite && (
                <td>{c.status === 'blocked'
                  ? <button className="adm-btn xs solid" onClick={() => onStatus(c.id, 'active')}>Débloquer</button>
                  : <button className="adm-btn xs" onClick={() => onStatus(c.id, 'blocked')}>Bloquer</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
const ROLE_MATRIX: { role: string; label: string; desc: string }[] = [
  { role: 'super_admin', label: 'Super Admin', desc: 'Accès total — tout le système ORION.' },
  { role: 'ops', label: 'Opérations / Dispatch', desc: 'Courses, chauffeurs, supervision SAMU.' },
  { role: 'finance', label: 'Finance', desc: 'Tarification (prix), revenus, courses.' },
  { role: 'support', label: 'Support client', desc: 'Courses, clients, alertes (lecture).' },
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
      <p className="adm-muted" style={{ marginTop: 14, fontSize: 12 }}>Les comptes et rôles se configurent côté serveur (ADMIN_ACCOUNTS). En production : SSO/JWT + audit log immuable.</p>
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

const statusLabel = (s: string) => ({ raised: 'Levée', dispatched: 'Dispatchée', acknowledged: 'Prise en charge', resolved: 'Résolue', cancelled: 'Annulée' }[s] ?? s);
const rideStatusLabel = (s: string) => ({ searching: 'Recherche', accepted: 'Acceptée', driver_en_route: 'En approche', arrived: 'Arrivé', in_progress: 'En course', completed: 'Terminée', paid: 'Payée', rated: 'Notée', cancelled: 'Annulée', no_driver: 'Sans chauffeur' }[s] ?? s);
const trafficLabel = (s: string) => ({ fluid: '🟢 Fluide', dense: '🟠 Dense', jam: '🔴 Bouchon' }[s] ?? s);
const kycLabel = (s: string) => ({ draft: 'Brouillon', docs_submitted: 'Docs reçus', manual_review: 'Revue', approved: 'Approuvé', active: 'Actif', suspended: 'Suspendu' }[s] ?? s);
const availLabel = (s: string) => ({ offline: 'Hors-ligne', online: 'En ligne', on_trip: 'En course', paused: 'Pause' }[s] ?? s);
