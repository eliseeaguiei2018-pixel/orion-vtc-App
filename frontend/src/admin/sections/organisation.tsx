/**
 * Équipes, sessions actives et matrice des rôles.
 *
 * Extrait de Admin.tsx lors de l'audit : le fichier atteignait 3 750 lignes et
 * mélangeait types, couche réseau, orchestration et 37 composants.
 */
import { useState } from 'react';
import { fcfa } from '../api';
import type { ActiveSession, ContactHandler, DriverRow, MaintenanceTicket, Me, Shift, SquadPnl, StaffKpi, Team } from '../types';
import { ContactRapide } from '../ui';
import { NOM_PLATEFORME, type AppareilPublic } from '../../appareil';

export const SLOT_LABEL: Record<string, string> = { matin: '🌅 Matin', soir: '🌇 Soir', nuit: '🌙 Nuit' };
export const MAINT_LABEL: Record<string, string> = { controle_technique: 'Contrôle technique', batterie_soh: 'Batterie (SoH)', reparation: 'Réparation', nettoyage: 'Nettoyage', assurance: 'Assurance' };

export function TeamsSection({ teams, allDrivers, staffKpis, shifts, maintenance, canWrite, onSave, onDelete, onShift, onRemoveShift, onMaintenance, onResolveMaintenance, onBroadcast, onPnl, onHoursCsv, onEvalPdf, onContact }: {
  teams: Team[]; allDrivers: DriverRow[]; staffKpis: StaffKpi[]; shifts: Shift[]; maintenance: MaintenanceTicket[]; canWrite: boolean;
  /** Joindre le chauffeur dont le véhicule est immobilisé. */
  onContact: ContactHandler;
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
              {/* Le ticket n'affichait qu'un identifiant technique : le gestionnaire
                  voyait « a1b2c3d4 » sans savoir quel véhicule ni qui appeler. */}
              <div>
                <strong style={{ fontSize: 13 }}>{MAINT_LABEL[t.kind] ?? t.kind}</strong> · {t.title}
                <div className="adm-muted" style={{ fontSize: 11 }}>
                  {(() => {
                    const d = allDrivers.find((x) => x.id === t.driverId);
                    return d ? `${d.name} · ${d.matricule}` : `Chauffeur ${t.driverId.slice(0, 8)}`;
                  })()}
                  {t.assignee ? ` · agent ${t.assignee}` : ''}
                </div>
                <div style={{ marginTop: 4 }}>
                  <ContactRapide
                    type="chauffeur" id={t.driverId}
                    numero={allDrivers.find((x) => x.id === t.driverId)?.phone}
                    nom={allDrivers.find((x) => x.id === t.driverId)?.name}
                    onContact={onContact}
                  />
                </div>
              </div>
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
export const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
};

export function SessionsSection({ sessions, self, canWrite, onRevoke }: { sessions: ActiveSession[]; self: string | null; canWrite: boolean; onRevoke: (id: string) => void }) {
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

export const ROLE_MATRIX: { role: string; label: string; desc: string; tier?: 'exec' }[] = [
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
export function RolesSection({ me }: { me: Me }) {
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

/**
 * APPAREILS DE CONFIANCE : ordinateurs, tablettes et téléphones enrôlés avec le code de
 * synchronisation ORION. Un appareil perdu, volé, ou celui d'un employé parti se révoque
 * ici : il perd l'accès à sa requête suivante, sans changer le code pour tous les autres.
 */
export function AppareilsPanneau({ etat, canWrite, onRevoquer }: {
  etat: { appareils: AppareilPublic[]; exige: boolean; configure: boolean };
  canWrite: boolean;
  onRevoquer: (id: string) => void;
}) {
  const actifs = etat.appareils.filter((a) => a.actif);
  return (
    <div className="adm-card" data-testid="panneau-appareils">
      <div className="adm-card-h">
        <h3>Appareils de confiance</h3>
        <span className="adm-muted">{actifs.length} actif(s) · {etat.exige ? 'enrôlement exigé' : 'enrôlement facultatif'}</span>
      </div>
      {!etat.configure && <p className="adm-empty">Code de synchronisation non configuré sur ce serveur (variable ORION_CODE_SYNCHRO_EMPREINTE).</p>}
      {etat.configure && etat.appareils.length === 0 && <p className="adm-empty">Aucun appareil enrôlé pour l’instant.</p>}
      {etat.appareils.length > 0 && (
        <table className="adm-table">
          <thead><tr><th>Appareil</th><th>Plateforme</th><th>Application</th><th>Enrôlé</th><th>Dernière activité</th><th>Dernier compte</th><th>Statut</th>{canWrite && <th>Actions</th>}</tr></thead>
          <tbody>
            {etat.appareils.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.nom}</strong><div className="mono adm-muted" style={{ fontSize: 11 }}>{a.derniereIp ?? '—'}</div></td>
                <td>{NOM_PLATEFORME[a.plateforme]}</td>
                <td>{a.application === 'console' ? 'Console' : a.application === 'tableau' ? 'Tableau de bord' : 'App chauffeur'}</td>
                <td>{ago(a.enroleLe)}</td>
                <td>{a.derniereActivite ? ago(a.derniereActivite) : '—'}</td>
                <td className="mono" style={{ fontSize: 12 }}>{a.dernierCompte ?? '—'}</td>
                <td>
                  <span className={`adm-pill ${a.actif ? 'av-online' : 'tr-rejected'}`}>{a.actif ? 'Actif' : 'Révoqué'}</span>
                  {!a.actif && a.revoquePar && <div className="adm-muted" style={{ fontSize: 11 }}>par {a.revoquePar}</div>}
                </td>
                {canWrite && <td>{a.actif && <button className="adm-btn xs" onClick={() => onRevoquer(a.id)}>Révoquer</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
