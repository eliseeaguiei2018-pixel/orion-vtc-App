/**
 * Courses, réservations, dispatch, qualité, litiges, chauffeurs et clients.
 *
 * Extrait de Admin.tsx lors de l'audit : le fichier atteignait 3 750 lignes et
 * mélangeait types, couche réseau, orchestration et 37 composants.
 */
import { useState, type CSSProperties } from 'react';
import { fcfa } from '../api';
import type { Client, ContactHandler, CsatReport, Dispute, DriverRow, ExpiringDoc, OpsConfig, PageMeta, QualityRow, QualityTop, Reservation, RideForensic, RideRow, SimResult } from '../types';
import { AvatarChauffeur, ContactRapide, Drawer, Kpi, Pager, kycLabel, rideStatusLabel, trafficLabel } from '../ui';

export const REASSIGNABLE = new Set(['searching', 'no_driver', 'accepted', 'driver_en_route', 'arrived']);
export const ACTIVE_RIDE = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress']);
export const ANOMALY_LABEL: Record<string, string> = {
  detour: '🔴 Détour majeur', attente_longue: '🟠 Attente longue',
  sans_chauffeur: '🟠 Sans chauffeur', immobile: '🔴 Immobile',
};

export function RidesSection({ rides, meta, onPage, canWrite, onReassign, onOpen, onForce, onDest, onContact }: {
  rides: RideRow[]; meta: PageMeta; onPage: (p: number) => void; canWrite: boolean;
  onReassign: (id: string) => void; onOpen: (id: string) => void;
  onForce: (id: string, action: 'complete' | 'cancel') => void; onDest: (id: string) => void;
  /** Joindre le passager, le chauffeur ou le contact de confiance d'une course. */
  onContact: ContactHandler;
}) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Courses (radar temps réel)</h3><span className="adm-muted">{meta.total} · anomalies en surbrillance · cliquer = fiche (tracé GPS, tarif)</span></div>
      <table className="adm-table">
        <thead><tr><th>Course</th><th>Passager</th><th>Chauffeur</th><th>Statut</th><th>Anomalie</th><th>Trafic</th><th className="r">Montant</th>{canWrite && <th>Interventions</th>}</tr></thead>
        <tbody>
          {rides.map((r) => (
            <tr key={r.id} className={`adm-row-click${r.anomaly ? ' anomaly' : ''}`} onClick={() => onOpen(r.id)}>
              <td className="mono">{r.id.slice(0, 8)}{r.paymentMethod && <><br /><span className="adm-muted" style={{ fontSize: 11 }}>{r.paymentMethod}</span></>}</td>
              <td onClick={(e) => e.stopPropagation()}>
                {r.clientName ?? r.clientId.slice(0, 10)}
                <div style={{ marginTop: 3 }}>
                  <ContactRapide type="course" id={r.id} numero={r.clientPhone} nom={r.clientName ?? r.clientId} onContact={onContact} />
                </div>
                {r.trustedContact && (
                  <div style={{ marginTop: 3 }}>
                    <span className="adm-muted" style={{ fontSize: 11 }}>Contact de confiance : {r.trustedContact.name}</span>
                    <ContactRapide type="course" id={r.id} numero={r.trustedContact.phone} nom={r.trustedContact.name} onContact={onContact} />
                  </div>
                )}
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                {r.driverName ?? '—'}
                {r.driverName && (
                  <div style={{ marginTop: 3 }}>
                    <ContactRapide type="course" id={r.id} numero={r.driverPhone} nom={r.driverName} onContact={onContact} />
                  </div>
                )}
              </td>
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
export const RES_STATUS: Record<string, { label: string; cls: string }> = {
  planifiee: { label: 'Planifiée', cls: 'tr-pending' },
  assignee: { label: 'Chauffeur assigné', cls: 'tr-approved' },
  lancee: { label: 'Lancée', cls: 'av-online' },
  annulee: { label: 'Annulée', cls: 'tr-rejected' },
};
export function ReservationsCard({ reservations, canWrite, onAssign, onCancel }: {
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
export const STRATEGIES: { id: OpsConfig['strategy']; label: string; desc: string }[] = [
  { id: 'nearest', label: 'Le plus proche', desc: 'Minimise l’attente du client. Recommandé en ville.' },
  { id: 'longest_idle', label: 'Le plus ancien en attente', desc: 'Équité de revenus entre chauffeurs (FIFO global).' },
  { id: 'zone_queue', label: 'File d’attente par zone', desc: 'FIFO dans les zones denses (aéroport, gares) — plus proche ailleurs.' },
];

export function DispatchSection({ ops, onSave, onSimulate, onConfigPdf, onMatrixCsv }: {
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
export function QualitySection({ q, csat, top, canWrite, onWarn, onSuspend, onSaveOps, onVip, onMatrixCsv, onDriverPdf }: {
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
export const DISPUTE_KIND: Record<string, string> = { objet_perdu: '🧳 Objet perdu', trajet: '🗺️ Contestation trajet', facturation: '🧾 Facturation', comportement: '⚠️ Comportement' };
export const DISPUTE_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Ouvert', cls: 'tr-pending' },
  investigating: { label: 'En instruction', cls: 'tr-pending' },
  resolved: { label: 'Résolu', cls: 'tr-approved' },
  rejected: { label: 'Rejeté', cls: 'tr-rejected' },
};

export const ESCALATION_LABEL: Record<string, string> = { sinistre: '🚑 Sinistre/Accident', chargeback: '💳 Fraude bancaire', harcelement: '⚠️ Harcèlement/Agression', degradation: '🔧 Dégradation véhicule' };

export function DisputesSection({ disputes, clients, canWrite, onDecide, onOpenRide, onEscalate, onQuarantine, onNote, onChargeback, onDossier, onLossCsv, onContact }: {
  /** Fiches clients, pour retrouver le numéro du plaignant. */
  clients: Client[];
  /** Joindre le client — un litige se dénoue souvent en deux minutes au téléphone. */
  onContact: ContactHandler;
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
                  <span className="adm-muted mono" style={{ fontSize: 11 }}>{clients.find((x) => x.id === d.clientId)?.name ?? d.clientId}</span>
                  {/* Un litige se dénoue souvent en deux minutes au téléphone. */}
                  <ContactRapide
                    type="client" id={d.clientId}
                    numero={clients.find((x) => x.id === d.clientId)?.phone}
                    nom={clients.find((x) => x.id === d.clientId)?.name ?? d.clientId}
                    onContact={onContact}
                  />
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
export function ForensicDrawer({ f, onClose }: { f: RideForensic; onClose: () => void }) {
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

export const KYC_COLUMNS: { id: string; label: string }[] = [
  { id: 'draft', label: 'Nouveau dossier' },
  { id: 'docs_submitted', label: 'Documents en analyse' },
  { id: 'manual_review', label: 'Entretien / formation' },
  { id: 'approved', label: 'En attente d’activation' },
  { id: 'active', label: 'Actifs' },
  { id: 'suspended', label: 'Suspendus / rejetés' },
];
export const LOYALTY_LABEL: Record<string, string> = { bronze: '🥉 Bronze', silver: '🥈 Silver', gold: '🥇 Gold' };

export function DriversSection({ drivers, expiring, canWrite, onAction, onSuspend, onLoyalty, onOpen, meta, onPage, onContract, onFleetCsv, onContact }: {
  drivers: DriverRow[]; expiring: ExpiringDoc[]; canWrite: boolean;
  onAction: (id: string, kind: 'kyc' | 'availability', value: string) => void;
  onSuspend: (id: string) => void; onLoyalty: (id: string, tier: string) => void;
  onOpen: (id: string) => void; meta: PageMeta; onPage: (p: number) => void;
  onContract: (id: string) => void; onFleetCsv: () => void;
  /** Joindre le chauffeur depuis sa ligne — la tentative est consignée. */
  onContact: ContactHandler;
}) {
  const [kanban, setKanban] = useState(false);
  return (
    <>
      {expiring.length > 0 && (
        <div className="adm-card" style={{ borderColor: 'var(--a-danger)' }}>
          <div className="adm-card-h"><h3>⚠️ Documents expirant sous 30 jours</h3><span className="adm-muted">{expiring.length} véhicule(s)</span></div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {expiring.map((e) => (
              <span key={e.id} className={`adm-pill ${e.daysLeft <= 7 ? 'tr-rejected' : 'tr-pending'}`}>{e.name} · assurance J-{e.daysLeft}</span>
            ))}
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Chauffeurs</h3>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="adm-muted">{meta.total}</span>
            <div className="adm-seg"><button className={`adm-seg-b${!kanban ? ' on' : ''}`} onClick={() => setKanban(false)}>Table</button><button className={`adm-seg-b${kanban ? ' on' : ''}`} onClick={() => setKanban(true)}>Pipeline KYC</button></div>
            <button className="adm-btn xs" onClick={onFleetCsv}>⬇ Matrice flotte (CSV)</button>
          </div>
        </div>
        {kanban ? (
          <div className="kanban">
            {KYC_COLUMNS.map((col) => {
              const items = drivers.filter((d) => d.kycStatus === col.id);
              return (
                <div key={col.id} className="kanban-col">
                  <div className="kanban-h">{col.label}<span className="adm-pill">{items.length}</span></div>
                  {items.map((d) => (
                    <button key={d.id} className="kanban-card" onClick={() => onOpen(d.id)}>
                      <strong>{d.name}</strong>
                      <div className="adm-muted mono" style={{ fontSize: 11 }}>{d.matricule} · {d.category}</div>
                      {d.suspensionReason && <div className="adm-muted" style={{ fontSize: 11, color: 'var(--a-danger)' }}>{d.suspensionReason}</div>}
                    </button>
                  ))}
                  {items.length === 0 && <span className="adm-muted" style={{ fontSize: 12 }}>—</span>}
                </div>
              );
            })}
          </div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>Nom</th><th>Matricule</th><th>Niveau</th><th>KYC</th><th>Fidélité</th><th className="r">Solde</th><th className="r">Note</th><th className="r" title="Courses annulées par le chauffeur lui-même">Annul.</th><th>Joindre</th>{canWrite && <th>Actions</th>}</tr></thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id} className="adm-row-click" onClick={() => onOpen(d.id)}>
                  <td><span className="row" style={{ gap: 8, alignItems: 'center' }}><AvatarChauffeur photoUrl={d.photoUrl} name={d.name} />{d.name}{d.vip && <span className="adm-pill av-online">VIP</span>}</span></td><td className="mono">{d.matricule}</td><td className="cap">{d.category}</td>
                  <td><span className={`adm-pill kyc-${d.kycStatus}`}>{kycLabel(d.kycStatus)}</span></td>
                  <td>{d.loyaltyTier ? <span className="adm-pill">{LOYALTY_LABEL[d.loyaltyTier] ?? d.loyaltyTier}</span> : <span className="adm-muted">—</span>}{(d.electricRides ?? 0) > 0 && <span className="adm-muted" style={{ fontSize: 11, display: 'block' }}>{d.electricRides} élec.</span>}</td>
                  <td className="r">{fcfa(d.balance)}</td><td className="r">★ {d.rating.toFixed(2)}</td>
                  <td className="r">{(d.cancellations ?? 0) > 0 ? <span className={`adm-pill ${(d.cancellations ?? 0) >= 5 ? 'tr-rejected' : 'tr-pending'}`}>{d.cancellations}</span> : <span className="adm-muted">0</span>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <ContactRapide type="chauffeur" id={d.id} numero={d.phone} nom={d.name} onContact={onContact} />
                  </td>
                  {canWrite && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {d.kycStatus !== 'active' && <button className="adm-btn xs solid" onClick={() => onAction(d.id, 'kyc', 'active')}>Approuver</button>}
                        {d.kycStatus !== 'suspended'
                          ? <button className="adm-btn xs" onClick={() => onSuspend(d.id)}>Suspendre</button>
                          : <button className="adm-btn xs" onClick={() => onAction(d.id, 'kyc', 'active')}>Réactiver</button>}
                        <button className="adm-btn xs" title="Fidélité (commission réduite)" onClick={() => onLoyalty(d.id, 'gold')}>🏅</button>
                        <button className="adm-btn xs" title="Contrat de partenariat PDF" onClick={() => onContract(d.id)}>📄</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!kanban && <Pager meta={meta} onPage={onPage} />}
      </div>
    </>
  );
}

export const VIP_LABEL: Record<string, string> = { gold: '⭐ Gold', platinum: '💎 Platinum' };
export function ClientsSection({ clients, canWrite, onStatus, onOpen, meta, onPage, onVip, onBlacklist, onNoShow, onLtvCsv, onBehaviorPdf, onContact }: {
  clients: Client[]; canWrite: boolean; onStatus: (id: string, s: string) => void; onOpen: (id: string) => void;
  meta: PageMeta; onPage: (p: number) => void;
  onVip: (id: string, tier: string, noSurgeLock: boolean) => void; onBlacklist: (id: string) => void; onNoShow: (id: string) => void;
  onLtvCsv: () => void; onBehaviorPdf: () => void;
  /** Joindre le client depuis sa ligne — la tentative est consignée. */
  onContact: ContactHandler;
}) {
  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Clients (CRM 360°)</h3>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="adm-muted">{meta.total}</span>
          <button className="adm-btn xs" onClick={onLtvCsv}>⬇ LTV/CAC (CSV)</button>
          <button className="adm-btn xs" onClick={onBehaviorPdf}>⬇ Comportement (PDF)</button>
        </div>
      </div>
      <table className="adm-table">
        <thead><tr><th>Client</th><th>Téléphone</th><th>Joindre</th><th>VIP</th><th className="r">Courses</th><th>Statut</th>{canWrite && <th>Actions</th>}</tr></thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="adm-row-click" onClick={() => onOpen(c.id)}>
              <td>{c.name ?? c.id}<div className="mono adm-muted" style={{ fontSize: 11 }}>{c.id}{(c.greenPoints ?? 0) > 0 ? ` · 🌿 ${c.greenPoints}` : ''}</div></td>
              <td>{c.phone ?? '—'}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <ContactRapide type="client" id={c.id} numero={c.phone} nom={c.name ?? c.id} onContact={onContact} />
              </td>
              <td>{c.vipTier && c.vipTier !== 'standard' ? <span className="adm-pill av-online">{VIP_LABEL[c.vipTier] ?? c.vipTier}</span> : <span className="adm-muted">—</span>}</td>
              <td className="r">{c.rides}</td>
              <td><span className={`adm-pill ${c.status === 'blocked' ? 'kyc-manual_review' : 'av-online'}`}>{c.status === 'blocked' ? 'Bloqué' : 'Actif'}</span></td>
              {canWrite && (
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <button className="adm-btn xs" title="Verrouiller VIP no-surge" onClick={() => onVip(c.id, 'platinum', true)}>💎</button>
                    <button className="adm-btn xs" title="Frais de no-show (GPS)" onClick={() => onNoShow(c.id)}>🚫</button>
                    {c.status === 'blocked'
                      ? <button className="adm-btn xs solid" onClick={() => onStatus(c.id, 'active')}>Débloquer</button>
                      : <button className="adm-btn xs" title="Liste noire (IMEI/e-mail/tél.)" onClick={() => onBlacklist(c.id)}>Bannir</button>}
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

export const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export const pct = (f: number) => (f === 1 ? 'neutre' : `${f > 1 ? '+' : ''}${Math.round((f - 1) * 100)} %`);

