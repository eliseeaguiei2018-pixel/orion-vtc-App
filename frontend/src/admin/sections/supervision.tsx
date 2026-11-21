/**
 * Vue d'ensemble, tendances, salle SAMU et alertes de sécurité.
 *
 * Extrait de Admin.tsx lors de l'audit : le fichier atteignait 3 750 lignes et
 * mélangeait types, couche réseau, orchestration et 37 composants.
 */
import { useState, type CSSProperties } from 'react';
import { SosCarte, SupervisionMap } from '../SupervisionMap';
import { LIVE, adminGet, fcfa } from '../api';
import type { Alert, ContactLigne, ContactUrgence, FleetUnit, Overview, SecurityAttempt, SosDossier, Stats } from '../types';
import { AvatarChauffeur, Drawer, Kpi, statusLabel } from '../ui';
import { lienTel } from '../../telephone';

export function OverviewSection({ ov, fleet, openAlerts, stats, statsDays, onStatsDays, onAlerte }: { ov: Overview; fleet: FleetUnit[]; openAlerts: Alert[]; stats: Stats | null; statsDays: number; onStatsDays: (d: number) => void; onAlerte?: (id: string) => void }) {
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="Courses actives" value={String(ov.rides.active)} sub={`${ov.rides.total} au total`} tone="green" />
        <Kpi
          label="Chauffeurs en ligne"
          value={String(ov.drivers.online)}
          sub={ov.drivers.muets ? `${ov.drivers.onTrip} en course · ${ov.drivers.muets} sans position récente` : `${ov.drivers.onTrip} en course`}
          tone={ov.drivers.muets ? 'danger' : 'teal'}
        />
        <Kpi label="Revenu (courses)" value={fcfa(ov.finance.revenue)} sub={`Commission ${fcfa(ov.finance.commission)}`} tone="mint" />
        <Kpi label="Alertes ouvertes" value={String(openAlerts.length)} sub={`${ov.safety.total} au total`} tone={openAlerts.length ? 'danger' : 'muted'} />
      </section>
      {stats && <TrendsChart stats={stats} statsDays={statsDays} onStatsDays={onStatsDays} />}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Supervision de la flotte · Abidjan</h3><span className="adm-muted">{fleet.length} véhicules · temps réel</span></div>
        <SupervisionMap fleet={fleet} alerts={openAlerts} onAlerte={onAlerte} />
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
  sos: 'SOS', crash: 'Accident', deviation: 'Déviation d’itinéraire',
  immobilisation: 'Immobilisation anormale', mot_sensible: 'Mot sensible (avis)',
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

export function SamuSection({ alerts, fleet, openAlerts, canWrite, contacts, onClaim, onOpen, onSaveContact, onDeleteContact }: {
  alerts: Alert[]; fleet: FleetUnit[]; openAlerts: Alert[]; canWrite: boolean;
  contacts: ContactUrgence[];
  onClaim: (id: string) => void; onOpen: (id: string) => void;
  onSaveContact: (c: { id?: string; label: string; numero: string; categorie?: 'secours' | 'interne' | 'partenaire'; actif?: boolean; note?: string }) => void;
  onDeleteContact: (id: string) => void;
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
        <div className="adm-card"><div className="adm-card-h"><h3>Carte tactique · Abidjan</h3><span className="adm-muted">SAMU 185 · Police 170 · Pompiers 180 · cliquez une alerte pour ouvrir son dossier</span></div><SupervisionMap fleet={fleet} alerts={openAlerts} onAlerte={onOpen} /></div>
        <div className="adm-card">
          <div className="adm-card-h"><h3>File de triage</h3><span className="adm-muted">{openAlerts.length} ouverte(s)</span></div>
          <div className="adm-alert-list">
            {alerts.length === 0 && <p className="adm-empty">Aucune alerte. Tout est calme.</p>}
            {alerts.map((a) => {
              const open = a.status !== 'resolved' && a.status !== 'cancelled';
              const lvl = LEVEL_META[a.level ?? 'rouge']!;
              return (
                <div key={a.id} className={`adm-alert ${a.status}${open ? ` ${lvl.cls}` : ''}`}>
                  <div className="adm-alert-top">
                    <span className={`adm-pill ${lvl.cls}`}>{lvl.label}</span>
                    <span className={`adm-tag ${a.kind}`}>{SOS_KIND[a.kind] ?? a.kind}</span>
                    {open && <span className="samu-sla mono" title="Temps écoulé depuis le déclenchement (SLA)">{sla(a)}</span>}
                    <span className={`adm-status ${a.status}`}>{a.sealed ? 'Scellée' : statusLabel(a.status)}</span>
                  </div>
                  <div className="adm-alert-meta">
                    {a.zoneName ?? 'Zone inconnue'}{a.impactG ? ` · impact ${a.impactG} g` : ''}
                    {' · '}
                    {a.userName
                      ? <>{a.userKind === 'chauffeur' ? 'chauffeur' : 'usager'} <strong>{a.userName}</strong>{a.userPhone ? ` · ${a.userPhone}` : ''}</>
                      : <>usager non identifié</>}
                    {a.agent ? <> · <strong>pris en charge : {a.agent}</strong></> : ' · non assignée'}
                  </div>
                  {/* Joindre la personne sans ouvrir le dossier : une seconde compte. */}
                  {open && a.userPhone && (
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <a className="adm-btn xs solid" href={lienTel(a.userPhone) ?? undefined}>Appeler</a>
                      <a className="adm-btn xs" href={`sms:${a.userPhone}`}>SMS</a>
                    </div>
                  )}
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
      <RepertoireUrgence contacts={contacts} canWrite={canWrite} onSave={onSaveContact} onDelete={onDeleteContact} />
    </div>
  );
}

const CAT_REP: Record<string, string> = { secours: 'Secours', interne: 'ORION', partenaire: 'Partenaire' };

/**
 * RÉPERTOIRE D'URGENCE — éditable par l'équipe.
 *
 * Un numéro d'astreinte change, un garage partenaire change, un assureur change. Si
 * ces numéros vivent dans le code, le poste de crise travaille un jour avec un
 * répertoire périmé. Ils se corrigent donc ici, et les numéros de secours nationaux
 * ne peuvent pas être supprimés par mégarde — seulement désactivés.
 */
function RepertoireUrgence({ contacts, canWrite, onSave, onDelete }: {
  contacts: ContactUrgence[]; canWrite: boolean;
  onSave: (c: { id?: string; label: string; numero: string; categorie?: 'secours' | 'interne' | 'partenaire'; actif?: boolean; note?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [numero, setNumero] = useState('');
  const [categorie, setCategorie] = useState<'interne' | 'partenaire'>('partenaire');
  const [note, setNote] = useState('');

  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Répertoire d’urgence</h3>
        <span className="adm-muted">{contacts.filter((c) => c.actif).length} ligne(s) active(s) sur {contacts.length}</span>
      </div>
      <table className="adm-table sm">
        <thead><tr><th>Ligne</th><th>Catégorie</th><th>Numéro</th><th>Précision</th><th>État</th>{canWrite && <th>Actions</th>}</tr></thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} style={{ opacity: c.actif ? 1 : 0.55 }}>
              <td><strong>{c.label}</strong></td>
              <td><span className="adm-pill">{CAT_REP[c.categorie] ?? c.categorie}</span></td>
              <td className="mono">
                {canWrite ? (
                  <input
                    className="adm-input-num" style={{ width: 160, textAlign: 'left' }} defaultValue={c.numero}
                    aria-label={`Numéro de ${c.label}`} inputMode="tel" autoComplete="off"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.numero) onSave({ id: c.id, label: c.label, numero: v }); }}
                  />
                ) : c.numero}
              </td>
              <td className="adm-muted">{c.note ?? '—'}</td>
              <td>
                {canWrite ? (
                  <button className={`adm-btn xs${c.actif ? ' solid' : ''}`}
                    onClick={() => onSave({ id: c.id, label: c.label, numero: c.numero, actif: !c.actif })}>
                    {c.actif ? 'Active' : 'Désactivée'}
                  </button>
                ) : <span className="adm-pill">{c.actif ? 'Active' : 'Désactivée'}</span>}
              </td>
              {canWrite && (
                <td>
                  {c.categorie === 'secours'
                    ? <span className="adm-muted" style={{ fontSize: 11 }}>Numéro national — non supprimable</span>
                    : <button className="adm-btn xs" onClick={() => onDelete(c.id)}>Supprimer</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canWrite && (
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="price-field"><span>Intitulé</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Clinique partenaire" /></label>
          <label className="price-field"><span>Numéro</span><input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="+225…" /></label>
          <label className="price-field"><span>Catégorie</span>
            <select className="adm-select" value={categorie} onChange={(e) => setCategorie(e.target.value as 'interne' | 'partenaire')}>
              <option value="partenaire">Partenaire</option>
              <option value="interne">ORION (interne)</option>
            </select>
          </label>
          <label className="price-field"><span>Précision</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Urgences 24/7" /></label>
          <button className="adm-btn solid" disabled={label.trim().length < 2 || numero.trim().length < 3}
            onClick={() => { onSave({ label: label.trim(), numero: numero.trim(), categorie, note: note.trim() || undefined }); setLabel(''); setNumero(''); setNote(''); }}>
            Ajouter au répertoire
          </button>
        </div>
      )}
    </div>
  );
}

/* -------- Dossier SAMU : identification, télémétrie, chat, clôture ----- */
/** Fiche du répertoire d'urgence à appeler pour chaque service demandé par l'agent automatique. */
const FICHE_DEMANDE: Record<string, string[]> = {
  samu: ['samu'], police: ['police', 'police-111'], pompiers: ['pompiers'], depannage: ['remorquage', 'garage'],
};

/**
 * Ce que l'agent ORION automatique a compris de la situation, et ce qu'il demande au
 * centre : c'est le centre qui prévient le SAMU, la police ou les pompiers — jamais la
 * personne en détresse. Chaque demande se traite d'un geste, et la personne le voit.
 */
function DemandesAgent({ d, canWrite, onContact, onFaite }: {
  d: SosDossier; canWrite: boolean;
  onContact: (alertId: string, p: { canal: 'appel'; contactId?: string; numero?: string; label?: string }) => void;
  onFaite: (alertId: string, cle: string) => void;
}) {
  const a = d.alert;
  const demandes = a.demandes ?? [];
  if (!a.resume && demandes.length === 0) return null;
  const ouverte = a.status !== 'resolved' && a.status !== 'cancelled';
  const journal = d.journalContacts ?? [];
  return (
    <>
      <h4 className="adm-drawer-sec">Agent ORION automatique</h4>
      {a.resume && <p className="samu-resume">{a.resume}</p>}
      {demandes.length === 0
        ? <p className="adm-muted" style={{ fontSize: 12 }}>Aucune demande pour l’instant : l’agent qualifie la situation avec la personne.</p>
        : (
          <ul className="samu-demandes">
            {demandes.map((x, i) => {
              const fiches = FICHE_DEMANDE[x.cle] ?? [];
              const appels = journal.filter((j) => fiches.includes(j.contactId));
              const joint = appels.some((j) => j.issue === 'joint');
              const etat = joint ? 'Joint' : appels.some((j) => j.issue === 'tentative') ? 'Appel en cours' : appels.length ? 'Sans réponse' : x.traiteeLe ? `Fait${x.traiteePar ? ` · ${x.traiteePar}` : ''}` : 'À faire';
              const fait = joint || Boolean(x.traiteeLe);
              return (
                <li key={`${x.cle}-${i}`} className={fait ? 'fait' : 'a-faire'}>
                  <span className="grow">
                    <strong>{x.label}{x.numero ? ` — ${x.numero}` : ''}</strong>
                    <span className="adm-muted">{x.raison}</span>
                  </span>
                  <span className={`adm-pill ${fait ? 'av-online' : 'tr-rejected'}`}>{etat}</span>
                  {canWrite && ouverte && !fait && (fiches.length > 0
                    ? <button className="adm-btn solid" onClick={() => onContact(a.id, { canal: 'appel', contactId: (d.contacts ?? []).find((c) => fiches.includes(c.id))?.id ?? fiches[0], numero: x.numero, label: x.label })}>Appeler</button>
                    : <button className="adm-btn" onClick={() => onFaite(a.id, x.cle)}>Marquer fait</button>)}
                </li>
              );
            })}
          </ul>
        )}
    </>
  );
}

export function SosDrawer({ d, canWrite, onClose, onMessage, onCloseAlert, onPdf, onCsv, onContact, onIssue, onDemandeFaite }: {
  d: SosDossier; canWrite: boolean; onClose: () => void;
  /** Une demande interne de l'agent automatique est traitée (chauffeur joint, course arrêtée…). */
  onDemandeFaite: (alertId: string, cle: string) => void;
  onMessage: (id: string, text: string) => void;
  onCloseAlert: (id: string, note: string) => void;
  onPdf: (id: string) => void; onCsv: (id: string) => void;
  /** Mise en relation : consigne la tentative et ouvre le combiné de l'opérateur. */
  onContact: (alertId: string, p: { canal: 'appel' | 'sms' | 'whatsapp'; contactId?: string; numero?: string; label?: string; message?: string }) => void;
  /** Issue de l'appel, renseignée juste après. */
  onIssue: (alertId: string, entryId: string, issue: 'joint' | 'non_joint' | 'messagerie', compteRendu?: string) => void;
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
        <span className="adm-pill">SLA {sla(a)}</span>
        {a.agent && <span className="adm-pill av-online">Agent : {a.agent}</span>}
        {a.sealed && <span className="adm-pill tr-rejected">Scellé</span>}
      </div>

      <DemandesAgent d={d} canWrite={canWrite} onContact={onContact} onFaite={onDemandeFaite} />

      <h4 className="adm-drawer-sec">Fiche véhicule (à dicter à la police)</h4>
      {d.vehicle ? (
        <div className="samu-plate">
          <div className="samu-plate-no mono">{d.vehicle.plate}</div>
          <div className="adm-muted">{d.vehicle.model} · {d.vehicle.color} · {d.vehicle.engine === 'electric' ? '100 % Électrique (batterie haute tension)' : d.vehicle.engine === 'hybrid' ? 'Hybride (batterie haute tension)' : 'Thermique'}</div>
        </div>
      ) : <p className="adm-muted">Aucun véhicule associé.</p>}

      <h4 className="adm-drawer-sec">Chauffeur & passager</h4>
      <div className="adm-mini-kpis">
        <div className="adm-mini-kpi"><span>Chauffeur</span><strong>{d.driver?.name ?? '—'}</strong></div>
        <div className="adm-mini-kpi"><span>Tél. / permis</span><strong style={{ fontSize: 12 }}>{d.driver?.phone ?? 'n/c'} · {d.driver?.licenseNo ?? 'n/c'}</strong></div>
        <div className="adm-mini-kpi"><span>Batterie chauffeur</span><strong>{d.driver ? `${d.driver.phoneBatteryPct} %` : '—'}</strong></div>
        <div className="adm-mini-kpi"><span>Batterie passager</span><strong>{d.passenger.phoneBatteryPct} %</strong></div>
      </div>
      {/* Photo du chauffeur : la personne à décrire aux secours et à la police. */}
      {d.driver?.photoUrl && (
        <div className="adm-passager">
          <AvatarChauffeur photoUrl={d.driver.photoUrl} name={d.driver.name} taille={56} />
          <span><strong>{d.driver.name}</strong> · <span className="mono">{d.driver.matricule}</span><br /><span className="adm-muted">Photo du chauffeur, à transmettre aux secours</span></span>
        </div>
      )}
      {/* Photo du passager : la personne à retrouver, à décrire à la police ou au SAMU. */}
      {d.passenger.photo && (
        <div className="adm-passager">
          <img src={d.passenger.photo} alt={`Photo de ${d.passenger.name ?? 'la passagère ou du passager'}`} />
          <span><strong>{d.passenger.name ?? 'Passager'}</strong><br /><span className="adm-muted">Photo de profil, à transmettre aux secours</span></span>
        </div>
      )}
      {d.assurance?.inscrit && <DossierMedicalUrgence alerteId={a.id} agent={a.agent} ouverte={open} />}
      <p className="adm-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        Passager : {d.passenger.name ?? d.passenger.id} · {d.passenger.phone ?? 'tél. n/c'} · {d.passenger.lastRides.length} trajets récents
        {d.passenger.lastRides.length < 2 ? ' — compte récent (vérifier fraude)' : ''}
      </p>

      <h4 className="adm-drawer-sec">Télémétrie live (rafraîchie chaque seconde)</h4>
      <div className="adm-mini-kpis">
        <div className="adm-mini-kpi"><span>Vitesse estimée</span><strong>{d.telemetry.speedEstimateKmh ?? '—'} km/h</strong></div>
        <div className="adm-mini-kpi"><span>Points GPS</span><strong>{d.telemetry.points}</strong></div>
        {/* Le lieu en clair d'abord (à dicter aux secours), les coordonnées ensuite. */}
        <div className="adm-mini-kpi"><span>Position</span><strong style={{ fontSize: 13 }}>{a.zoneName ?? 'Lieu inconnu'}</strong><span className="mono" style={{ fontSize: 11 }}>{a.location.lat.toFixed(5)}, {a.location.lng.toFixed(5)}</span></div>
      </div>
      {pts.length > 1 && d.ride && (
        <>
          <p className="adm-muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>Itinéraire sur la carte : trajet réel (rouge) vs trajet direct (pointillés), position de l’alerte :</p>
          <SosCarte ride={d.ride} alerte={a.location} repli={<SosTrace ride={d.ride} />} />
        </>
      )}

      <PosteContact dossier={d} canWrite={canWrite} onContact={onContact} onIssue={onIssue} />

      <h4 className="adm-drawer-sec">Chat sécurisé discret</h4>
      <div className="adm-chat" style={{ maxHeight: 160 }}>
        {(a.chat ?? []).length === 0 && <p className="adm-muted" style={{ fontSize: 12 }}>Aucun message. Utilisez un message pré-enregistré — silencieux côté usager.</p>}
        {(a.chat ?? []).map((m, i) => (
          <div key={i} className={`adm-bubble ${m.from === 'agent' ? 'agent' : 'client'}`}>
            <div className="adm-bubble-txt">{m.text}</div>
            <div className="adm-bubble-meta">{m.from === 'agent' ? `${m.author ?? 'Agent'}${m.auto ? ' (automatique)' : ''}` : 'Usager'} · {new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
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
            <input value={text} aria-label="Message à l’usager" onChange={(e) => setText(e.target.value)} placeholder="Message libre (discret)…" onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onMessage(a.id, text.trim()); setText(''); } }} />
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
          <textarea className="adm-select" rows={3} aria-label="Rapport d’incident" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Résumé factuel de l’incident, actions menées, issue… (10 caractères min.)" />
          <button className="adm-btn solid" style={{ marginTop: 8 }} disabled={note.trim().length < 10} onClick={() => onCloseAlert(a.id, note.trim())}>
            Clore & sceller le dossier
          </button>
          <p className="adm-muted" style={{ fontSize: 11, marginTop: 6 }}>Après scellement, le dossier n’est plus lisible que par la direction.</p>
        </>
      )}
      {a.closingNote && <p className="adm-muted" style={{ fontSize: 12, marginTop: 8 }}>Note de synthèse : {a.closingNote}</p>}
    </Drawer>
  );
}


const CANAL_LABEL: Record<string, string> = { appel: 'Appel', sms: 'SMS', whatsapp: 'WhatsApp' };
const ISSUE_LABEL: Record<string, string> = {
  tentative: 'En cours', joint: 'Joint', non_joint: 'Injoignable', messagerie: 'Messagerie',
};
const CATEGORIE_LABEL: Record<string, string> = {
  secours: 'Secours', interne: 'ORION', partenaire: 'Partenaire', course: 'Personnes de la course',
};
const ORDRE_CATEGORIES = ['secours', 'course', 'interne', 'partenaire'] as const;

/**
 * POSTE DE CONTACT DE L'OPÉRATEUR SOS.
 *
 * Les numéros étaient de simples étiquettes : l'opérateur les lisait et composait à la
 * main, sans qu'aucune trace ne reste. Ici, chaque ligne est joignable en un clic, la
 * tentative est consignée avant la composition, et l'issue se renseigne juste après.
 * Le registre qui en résulte est la pièce produite à l'assureur, à la police ou au juge.
 */
/* ====================== ORION ASSURANCE : DOSSIER MÉDICAL ======================= */

interface FicheMedicale {
  identite: { nom: string; prenoms: string; dateNaissance: string; sexe?: 'F' | 'M' };
  piece: { type: 'cni' | 'passeport'; numero: string; expiration: string };
  cmu?: string;
  sante: {
    groupeSanguin: string; antecedents: string[]; autresAntecedents?: string; allergies?: string; traitements?: string;
    anticoagulants: boolean; stimulateurCardiaque: boolean; reactionAllergiqueGrave: boolean;
  };
  urgence: { nom: string; lien: string; telephone: string };
  medecin?: { nom: string; telephone?: string };
}

const ANTECEDENT: Record<string, string> = {
  asthme: 'Asthme', hypertension: 'Hypertension', diabete: 'Diabète', drepanocytose: 'Drépanocytose',
  epilepsie: 'Épilepsie', cardiaque: 'Maladie cardiaque', renale: 'Maladie rénale', coagulation: 'Trouble de la coagulation',
  grossesse: 'Grossesse en cours', mobilite_reduite: 'Mobilité réduite',
};

const FICHE_DEMO: FicheMedicale = {
  identite: { nom: 'Koné', prenoms: 'Awa', dateNaissance: '1994-03-12', sexe: 'F' },
  piece: { type: 'cni', numero: 'CI004821736', expiration: '2031-05-30' },
  cmu: '1 94 03 12 0482 17',
  sante: { groupeSanguin: 'O+', antecedents: ['asthme'], allergies: 'Pénicilline', traitements: 'Ventoline en cas de crise', anticoagulants: false, stimulateurCardiaque: false, reactionAllergiqueGrave: true },
  urgence: { nom: 'Ibrahim Koné', lien: 'Frère', telephone: '+225 07 11 22 33 44' },
};

/** « +2250758421963 » → « +225 07 58 42 19 63 » : un numéro lisible se dicte sans erreur. */
const telLisible = (n: string) => {
  const m = n.replace(/\s/g, '').match(/^(\+225)(\d{10})$/);
  return m ? `${m[1]} ${m[2]!.replace(/(\d{2})(?=\d)/g, '$1 ')}` : n;
};

const ageDe = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / (365.25 * 24 * 3600e3));

/**
 * Le dossier de premiers secours du client, chiffré sur le serveur. Il ne s'ouvre que
 * pour l'agent qui a PRIS EN CHARGE l'alerte en cours ; chaque ouverture est inscrite au
 * journal et annoncée au client. Rien n'est conservé dans le navigateur : fermer le
 * tiroir efface la fiche de l'écran.
 */
function DossierMedicalUrgence({ alerteId, agent, ouverte }: { alerteId: string; agent?: string; ouverte: boolean }) {
  const [fiche, setFiche] = useState<FicheMedicale | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const ouvrir = async () => {
    setCharge(true); setErreur(null);
    try {
      const r = LIVE ? await adminGet<{ inscrit: boolean; fiche: FicheMedicale | null }>(`/admin/sos/${alerteId}/dossier-medical`) : { inscrit: true, fiche: FICHE_DEMO };
      if (!r.fiche) setErreur('Le client n’a plus de dossier ORION Assurance.');
      setFiche(r.fiche);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Accès refusé.');
    } finally { setCharge(false); }
  };
  if (!ouverte) return null;
  const sa = fiche?.sante;
  const vigilances = sa ? [
    ...sa.antecedents.map((x) => ANTECEDENT[x] ?? x),
    ...(sa.anticoagulants ? ['Sous anticoagulant : risque hémorragique'] : []),
    ...(sa.stimulateurCardiaque ? ['Porteur d’un stimulateur cardiaque'] : []),
    ...(sa.reactionAllergiqueGrave ? ['Antécédent de réaction allergique grave'] : []),
  ] : [];
  return (
    <div className="adm-medical">
      <div className="adm-medical-h">
        <span className="adm-medical-ico" aria-hidden>✚</span>
        <div>
          <strong>ORION Assurance · dossier de premiers secours</strong>
          <span className="adm-muted">Chiffré · réservé à l’agent qui gère l’alerte · chaque ouverture est journalisée et signalée au client</span>
        </div>
      </div>
      {!fiche && (
        <>
          {!agent && <p className="adm-muted" style={{ fontSize: 12, margin: '8px 0 0' }}>Prenez d’abord l’alerte en charge pour ouvrir le dossier.</p>}
          <button className="adm-btn solid adm-medical-btn" disabled={charge} onClick={() => void ouvrir()}>
            {charge ? 'Déchiffrement…' : 'Ouvrir le dossier médical (consultation journalisée)'}
          </button>
          {erreur && <p className="adm-medical-err" role="alert">{erreur}</p>}
        </>
      )}
      {fiche && sa && (
        <div className="adm-medical-corps">
          <div className="adm-medical-groupe"><span>Groupe sanguin</span><strong>{sa.groupeSanguin === 'inconnu' ? '?' : sa.groupeSanguin}</strong></div>
          <div className="adm-medical-id">
            <strong>{fiche.identite.prenoms} {fiche.identite.nom.toUpperCase()}</strong>
            <span>{ageDe(fiche.identite.dateNaissance)} ans{fiche.identite.sexe ? ` · ${fiche.identite.sexe === 'F' ? 'Femme' : 'Homme'}` : ''}</span>
            <span className="adm-muted">{fiche.piece.type === 'cni' ? 'CNI' : 'Passeport'} {fiche.piece.numero}{fiche.cmu ? ` · CMU ${fiche.cmu}` : ''}</span>
          </div>
          <div className="adm-medical-vig">
            <span>À signaler au SAMU</span>
            {vigilances.length ? <ul>{vigilances.map((v) => <li key={v}>{v}</li>)}</ul> : <p className="adm-muted">Aucun problème de santé déclaré.</p>}
            {sa.autresAntecedents && <p><em>{sa.autresAntecedents}</em></p>}
          </div>
          <div className="adm-mini-kpis">
            <div className="adm-mini-kpi"><span>Allergies</span><strong style={{ fontSize: 12 }}>{sa.allergies || 'Aucune déclarée'}</strong></div>
            <div className="adm-mini-kpi"><span>Traitements</span><strong style={{ fontSize: 12 }}>{sa.traitements || 'Aucun déclaré'}</strong></div>
          </div>
          <div className="adm-medical-contact">
            <span>Personne à prévenir</span>
            <strong>{fiche.urgence.nom} · {fiche.urgence.lien}</strong>
            <a className="adm-btn xs solid" href={lienTel(fiche.urgence.telephone) ?? undefined}>{telLisible(fiche.urgence.telephone)}</a>
            {fiche.medecin && <span className="adm-muted">Médecin : {fiche.medecin.nom}{fiche.medecin.telephone ? ` · ${telLisible(fiche.medecin.telephone)}` : ''}</span>}
          </div>
          <button className="adm-btn ghost xs" onClick={() => setFiche(null)}>Masquer le dossier</button>
        </div>
      )}
    </div>
  );
}

function PosteContact({ dossier, canWrite, onContact, onIssue }: {
  dossier: SosDossier; canWrite: boolean;
  onContact: (alertId: string, p: { canal: 'appel' | 'sms' | 'whatsapp'; contactId?: string; numero?: string; label?: string; message?: string }) => void;
  onIssue: (alertId: string, entryId: string, issue: 'joint' | 'non_joint' | 'messagerie', compteRendu?: string) => void;
}) {
  const [libre, setLibre] = useState('');
  const [message, setMessage] = useState('');
  const a = dossier.alert;
  // Repli : si le serveur est d'une version antérieure, on affiche au moins les secours.
  const lignes: ContactLigne[] = dossier.contacts ?? Object.entries(dossier.emergencyNumbers).map(([k, v]) => ({
    id: k, label: k.toUpperCase(), numero: v, categorie: 'secours' as const, note: null,
  }));
  const journal = dossier.journalContacts ?? [];
  /*
   * Ce que les secours doivent savoir, rédigé d'avance : position GPS (lien carte),
   * passager, véhicule, chauffeur. L'agent n'a plus à dicter ni recopier quoi que ce
   * soit — un SMS ou un WhatsApp vers le SAMU ou la police part complet.
   */
  const pos = dossier.alert.location;
  const messageSecours = [
    `ORION · SOS ${dossier.alert.id.slice(0, 8)}${dossier.alert.zoneName ? ` · ${dossier.alert.zoneName}` : ''}`,
    `Position : https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`,
    `Passager : ${dossier.passenger.name ?? dossier.passenger.id}${dossier.passenger.phone ? ` ${dossier.passenger.phone}` : ''}`,
    dossier.vehicle ? `Véhicule : ${dossier.vehicle.plate} ${dossier.vehicle.model}` : null,
    dossier.driver ? `Chauffeur : ${dossier.driver.name}${dossier.driver.phone ? ` ${dossier.driver.phone}` : ''}` : null,
  ].filter(Boolean).join(' — ');
  const dejaJoint = (id: string) => journal.some((e) => e.contactId === id && e.issue === 'joint');

  return (
    <>
      <h4 className="adm-drawer-sec">Poste de contact — joindre immédiatement</h4>
      {!canWrite && <p className="adm-muted" style={{ fontSize: 12 }}>Lecture seule : vous ne pouvez pas déclencher de mise en relation.</p>}

      {ORDRE_CATEGORIES.map((cat) => {
        const groupe = lignes.filter((l) => l.categorie === cat);
        if (groupe.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 10 }}>
            <span className="adm-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {CATEGORIE_LABEL[cat]}
            </span>
            <div className="adm-contact-grid">
              {groupe.map((l) => (
                <div key={l.id} className={`adm-contact${cat === 'secours' ? ' urgent' : ''}${dejaJoint(l.id) ? ' joint' : ''}`}>
                  <div className="adm-contact-id">
                    <strong>{l.label}</strong>
                    <span className="adm-muted mono">{l.numero}</span>
                    {l.note && <span className="adm-muted" style={{ fontSize: 11 }}>{l.note}</span>}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="adm-btn xs solid" disabled={!canWrite} title={`Appeler ${l.label}`}
                      onClick={() => onContact(a.id, { canal: 'appel', contactId: l.id, numero: l.numero, label: l.label })}>Appeler</button>
                    <button className="adm-btn xs" disabled={!canWrite} title={cat === 'secours' ? `Envoyer la position et le dossier par SMS à ${l.label}` : `SMS à ${l.label}`}
                      onClick={() => onContact(a.id, { canal: 'sms', contactId: l.id, numero: l.numero, label: l.label, message: message || (cat === 'secours' ? messageSecours : undefined) })}>SMS</button>
                    <button className="adm-btn xs" disabled={!canWrite} title={cat === 'secours' ? `Envoyer la position et le dossier par WhatsApp à ${l.label}` : `WhatsApp à ${l.label}`}
                      onClick={() => onContact(a.id, { canal: 'whatsapp', contactId: l.id, numero: l.numero, label: l.label, message: message || (cat === 'secours' ? messageSecours : undefined) })}>WhatsApp</button>
                  </div>
                </div>
              ))}
            </div>
            {cat === 'secours' && (
              <p className="adm-muted" style={{ fontSize: 11.5, margin: '6px 2px 0' }}>
                / vers un secours transmet : « {messageSecours} »
              </p>
            )}
          </div>
        );
      })}

      {canWrite && (
        <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <input className="adm-select" style={{ flex: '1 1 150px' }} aria-label="Numéro libre à prévenir" inputMode="tel" placeholder="Numéro libre (+225…)"
            value={libre} onChange={(e) => setLibre(e.target.value)} />
          <input className="adm-select" style={{ flex: '2 1 220px' }} aria-label="Message joint au SMS ou WhatsApp" placeholder="Message joint au SMS / WhatsApp (facultatif)"
            value={message} onChange={(e) => setMessage(e.target.value)} />
          <button className="adm-btn xs solid" disabled={libre.trim().length < 3}
            onClick={() => { onContact(a.id, { canal: 'appel', numero: libre.trim(), label: 'Numéro libre' }); setLibre(''); }}>
            Composer
          </button>
        </div>
      )}

      <h4 className="adm-drawer-sec">Registre des contacts ({journal.length})</h4>
      {journal.length === 0 ? (
        <p className="adm-muted" style={{ fontSize: 12 }}>Aucun contact encore tenté sur ce dossier.</p>
      ) : (
        <table className="adm-table sm">
          <thead><tr><th>Heure</th><th>Destinataire</th><th>Canal</th><th>Agent</th><th>Issue</th></tr></thead>
          <tbody>
            {journal.map((e) => (
              <tr key={e.id}>
                <td className="mono">{new Date(e.at).toLocaleTimeString('fr-FR')}</td>
                <td>{e.label}<br /><span className="adm-muted mono">{e.numero}</span></td>
                <td>{CANAL_LABEL[e.canal] ?? e.canal}</td>
                <td>{e.agent}</td>
                <td>
                  {e.issue === 'tentative' && canWrite ? (
                    <div className="row" style={{ gap: 4 }}>
                      <button className="adm-btn xs" onClick={() => onIssue(a.id, e.id, 'joint')}>Joint</button>
                      <button className="adm-btn xs" onClick={() => onIssue(a.id, e.id, 'messagerie')}>Messagerie</button>
                      <button className="adm-btn xs" onClick={() => onIssue(a.id, e.id, 'non_joint')}>Injoignable</button>
                    </div>
                  ) : (
                    <span className={`adm-pill ${e.issue === 'joint' ? 'av-online' : e.issue === 'non_joint' ? 'kyc-manual_review' : ''}`}>
                      {ISSUE_LABEL[e.issue] ?? e.issue}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
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
        {attempts.length === 0 && <p className="adm-empty">Aucune tentative signalée.</p>}
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

