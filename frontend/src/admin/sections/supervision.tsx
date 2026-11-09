/**
 * Vue d'ensemble, tendances, salle SAMU et alertes de sécurité.
 *
 * Extrait de Admin.tsx lors de l'audit : le fichier atteignait 3 750 lignes et
 * mélangeait types, couche réseau, orchestration et 37 composants.
 */
import { useState, type CSSProperties } from 'react';
import { SupervisionMap } from '../SupervisionMap';
import { fcfa } from '../api';
import type { Alert, FleetUnit, Overview, SecurityAttempt, SosDossier, Stats } from '../types';
import { Drawer, Kpi, statusLabel } from '../ui';

export function OverviewSection({ ov, fleet, openAlerts, stats, statsDays, onStatsDays }: { ov: Overview; fleet: FleetUnit[]; openAlerts: Alert[]; stats: Stats | null; statsDays: number; onStatsDays: (d: number) => void }) {
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

export function TrendsChart({ stats, statsDays, onStatsDays }: { stats: Stats; statsDays: number; onStatsDays: (d: number) => void }) {
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
export const SOS_KIND: Record<string, string> = {
  sos: '🆘 SOS', crash: '🚨 Accident', deviation: '🧭 Déviation d’itinéraire',
  immobilisation: '⏸ Immobilisation anormale', mot_sensible: '⚠️ Mot sensible (avis)',
};
export const LEVEL_META: Record<string, { label: string; cls: string }> = {
  rouge: { label: 'ROUGE', cls: 'lvl-rouge' },
  orange: { label: 'ORANGE', cls: 'lvl-orange' },
  jaune: { label: 'JAUNE', cls: 'lvl-jaune' },
};
/** Chronomètre SLA : temps écoulé depuis le déclenchement (mm:ss / h min). */
export const sla = (a: Alert) => {
  const s = a.slaSeconds ?? Math.max(0, Math.round((Date.now() - Date.parse(a.createdAt)) / 1000));
  if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};

export function SamuSection({ alerts, fleet, openAlerts, canWrite, onClaim, onOpen }: {
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
export function SosDrawer({ d, canWrite, onClose, onMessage, onCloseAlert, onPdf, onCsv }: {
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
export function SosTrace({ ride }: { ride: NonNullable<SosDossier['ride']> }) {
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
export function SecuritySection({ attempts }: { attempts: SecurityAttempt[] }) {
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

