import { useEffect, useMemo, useState, useCallback } from 'react';
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

/* ------------------------------- API --------------------------------- */
const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const tokenKey = 'orion.admin.token';
const getToken = () => localStorage.getItem(tokenKey) ?? 'orion-admin-dev';

async function adminGet<T>(path: string): Promise<T> {
  const r = await fetch(API + path, { headers: { 'x-admin-token': getToken() } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}
async function adminPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'x-admin-token': getToken(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}

const fcfa = (n: number) => n.toLocaleString('fr-FR') + ' F';

/* ------------------------------- Vue --------------------------------- */
export function Admin() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fleet, setFleet] = useState<FleetUnit[]>([]);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const loadDemo = useCallback(() => {
    setOv(DEMO.overview); setAlerts(DEMO.alerts); setFleet(DEMO.fleet);
    setRides(DEMO.rides); setDrivers(DEMO.drivers); setLive(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!API) { loadDemo(); return; }
    try {
      const [o, a, f, r, d] = await Promise.all([
        adminGet<Overview>('/admin/overview'),
        adminGet<{ alerts: Alert[] }>('/admin/alerts'),
        adminGet<{ fleet: FleetUnit[] }>('/admin/fleet/live'),
        adminGet<{ rides: RideRow[] }>('/admin/rides?limit=12'),
        adminGet<{ drivers: DriverRow[] }>('/admin/drivers'),
      ]);
      setOv(o); setAlerts(a.alerts); setFleet(f.fleet); setRides(r.rides); setDrivers(d.drivers); setLive(true);
    } catch {
      loadDemo(); // repli démo (backend non joignable)
    }
  }, [loadDemo]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const p = API ? setInterval(() => void refresh(), 5000) : undefined;
    return () => { clearInterval(t); if (p) clearInterval(p); };
  }, [refresh]);

  const openAlerts = useMemo(() => alerts.filter((a) => a.status !== 'resolved' && a.status !== 'cancelled'), [alerts]);

  const setAlertStatus = async (id: string, status: string) => {
    if (!API) { setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, status } : a))); return; }
    try { const { alert } = await adminPost<{ alert: Alert }>(`/admin/alerts/${id}/status`, { status }); setAlerts((xs) => xs.map((a) => (a.id === alert.id ? alert : a))); } catch { /* ignore */ }
  };

  if (!ov) return <div className="adm-loading">Chargement de la console…</div>;

  return (
    <div className="adm">
      <header className="adm-top">
        <div className="adm-brand">
          <span className="adm-logo" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 512 512"><path d="M256 92 C 338 150 372 252 318 350 C 300 382 280 404 256 424 C 232 404 212 382 194 350 C 140 252 174 150 256 92 Z" fill="#04140d"/><g fill="#04140d"><circle cx="372" cy="120" r="15"/><circle cx="406" cy="150" r="12"/><circle cx="430" cy="186" r="9"/></g></svg>
          </span>
          <div>
            <strong>ORION Admin</strong>
            <span className="adm-sub">Supervision & SAMU · Abidjan</span>
          </div>
        </div>
        <div className="adm-top-right">
          <span className={`adm-live ${live ? 'on' : 'demo'}`}>{live ? '● EN DIRECT' : '● MODE DÉMO'}</span>
          <span className="adm-clock">{now.toLocaleTimeString('fr-FR')}</span>
          <button className="adm-btn ghost" onClick={() => void refresh()}>Rafraîchir</button>
        </div>
      </header>

      {/* KPIs */}
      <section className="adm-kpis">
        <Kpi label="Courses actives" value={String(ov.rides.active)} sub={`${ov.rides.total} au total`} tone="green" />
        <Kpi label="Chauffeurs en ligne" value={String(ov.drivers.online)} sub={`${ov.drivers.onTrip} en course`} tone="teal" />
        <Kpi label="Revenu (courses)" value={fcfa(ov.finance.revenue)} sub={`Commission ${fcfa(ov.finance.commission)}`} tone="mint" />
        <Kpi label="Alertes ouvertes" value={String(openAlerts.length)} sub={`${ov.safety.total} au total`} tone={openAlerts.length ? 'danger' : 'muted'} />
      </section>

      <section className="adm-grid">
        {/* Carte supervision */}
        <div className="adm-card adm-mapcard">
          <div className="adm-card-h"><h3>Supervision de la flotte</h3><span className="adm-muted">{fleet.length} véhicules · temps réel</span></div>
          <SupervisionMap fleet={fleet} alerts={openAlerts} />
          <div className="adm-legend">
            <span><i className="dot green" /> Disponible</span>
            <span><i className="dot amber" /> En course</span>
            <span><i className="dot red pulse" /> Alerte SAMU</span>
          </div>
        </div>

        {/* File SAMU */}
        <div className="adm-card adm-alerts">
          <div className="adm-card-h"><h3>Supervision SAMU</h3><span className="adm-muted">SAMU 185 · Police 170</span></div>
          <div className="adm-alert-list">
            {alerts.length === 0 && <p className="adm-empty">Aucune alerte. Tout est calme. ✅</p>}
            {alerts.map((a) => (
              <div key={a.id} className={`adm-alert ${a.status}`}>
                <div className="adm-alert-top">
                  <span className={`adm-tag ${a.kind}`}>{a.kind === 'crash' ? '🚨 Accident' : '🆘 SOS'}</span>
                  <span className="adm-alert-zone">{a.zoneName ?? 'Zone inconnue'}{a.impactG ? ` · ${a.impactG}g` : ''}</span>
                  <span className={`adm-status ${a.status}`}>{statusLabel(a.status)}</span>
                </div>
                <div className="adm-alert-meta">
                  Client {a.userId.slice(0, 8)} · {new Date(a.createdAt).toLocaleTimeString('fr-FR')} · SAMU {a.dispatchedTo.join(', ')}
                </div>
                {a.status !== 'resolved' && a.status !== 'cancelled' && (
                  <div className="adm-alert-actions">
                    <button className="adm-btn xs" onClick={() => void setAlertStatus(a.id, 'acknowledged')}>Prendre en charge</button>
                    <button className="adm-btn xs solid" onClick={() => void setAlertStatus(a.id, 'resolved')}>Résolue</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Courses récentes */}
        <div className="adm-card">
          <div className="adm-card-h"><h3>Courses récentes</h3></div>
          <table className="adm-table">
            <thead><tr><th>Course</th><th>Chauffeur</th><th>Statut</th><th>Trafic</th><th className="r">Montant</th></tr></thead>
            <tbody>
              {rides.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id.slice(0, 8)}</td>
                  <td>{r.driverName ?? '—'}</td>
                  <td><span className={`adm-pill s-${r.status}`}>{rideStatusLabel(r.status)}</span></td>
                  <td>{trafficLabel(r.trafficLevel)}</td>
                  <td className="r">{fcfa(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Chauffeurs */}
        <div className="adm-card">
          <div className="adm-card-h"><h3>Chauffeurs</h3><span className="adm-muted">{drivers.length}</span></div>
          <table className="adm-table">
            <thead><tr><th>Nom</th><th>Matricule</th><th>Niveau</th><th>KYC</th><th>État</th><th className="r">Note</th></tr></thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="mono">{d.matricule}</td>
                  <td className="cap">{d.category}</td>
                  <td><span className={`adm-pill kyc-${d.kycStatus}`}>{kycLabel(d.kycStatus)}</span></td>
                  <td><span className={`adm-pill av-${d.availability}`}>{availLabel(d.availability)}</span></td>
                  <td className="r">★ {d.rating.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <footer className="adm-foot">ORION · Console de supervision — accès restreint (jeton administrateur). RBAC & audit en production.</footer>
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
