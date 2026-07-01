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

/* ------------------------------- API --------------------------------- */
const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const tokenKey = 'orion.admin.token';
const getToken = () => localStorage.getItem(tokenKey) ?? 'orion-admin-dev';
const H = () => ({ 'x-admin-token': getToken(), 'content-type': 'application/json' });
async function adminGet<T>(p: string): Promise<T> { const r = await fetch(API + p, { headers: H() }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
async function adminPost<T>(p: string, b?: unknown): Promise<T> { const r = await fetch(API + p, { method: 'POST', headers: H(), body: JSON.stringify(b ?? {}) }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
async function adminPut<T>(p: string, b: unknown): Promise<T> { const r = await fetch(API + p, { method: 'PUT', headers: H(), body: JSON.stringify(b) }); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; }
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
type Section = 'overview' | 'alerts' | 'rides' | 'drivers' | 'pricing' | 'roles';
const NAV: { id: Section; label: string; perm: string; icon: string }[] = [
  { id: 'overview', label: 'Vue d’ensemble', perm: 'overview:read', icon: '📊' },
  { id: 'alerts', label: 'Supervision SAMU', perm: 'alerts:read', icon: '🚨' },
  { id: 'rides', label: 'Courses', perm: 'rides:read', icon: '🚗' },
  { id: 'drivers', label: 'Chauffeurs', perm: 'drivers:read', icon: '🧑‍✈️' },
  { id: 'pricing', label: 'Tarification', perm: 'pricing:read', icon: '💰' },
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
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [section, setSection] = useState<Section>('overview');

  const loadDemo = useCallback(() => {
    setMe(DEMO.me); setOv(DEMO.overview); setAlerts(DEMO.alerts); setFleet(DEMO.fleet);
    setRides(DEMO.rides); setDrivers(DEMO.drivers); setPricing(DEMO.pricing); setLive(false);
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
        {section === 'rides' && <RidesSection rides={rides} />}
        {section === 'drivers' && <DriversSection drivers={drivers} />}
        {section === 'pricing' && pricing && <PricingEditor pricing={pricing} canWrite={can('pricing:write')} onSave={savePricing} />}
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

function DriversSection({ drivers }: { drivers: DriverRow[] }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Chauffeurs</h3><span className="adm-muted">{drivers.length}</span></div>
      <table className="adm-table">
        <thead><tr><th>Nom</th><th>Matricule</th><th>Niveau</th><th>KYC</th><th>État</th><th className="r">Solde</th><th className="r">Note</th></tr></thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td><td className="mono">{d.matricule}</td><td className="cap">{d.category}</td>
              <td><span className={`adm-pill kyc-${d.kycStatus}`}>{kycLabel(d.kycStatus)}</span></td>
              <td><span className={`adm-pill av-${d.availability}`}>{availLabel(d.availability)}</span></td>
              <td className="r">{fcfa(d.balance)}</td><td className="r">★ {d.rating.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
