/**
 * Primitives d'interface partagées par les sections (pagination, indicateurs, tiroirs, libellés).
 *
 * Extrait de Admin.tsx lors de l'audit : le fichier atteignait 3 750 lignes et
 * mélangeait types, couche réseau, orchestration et 37 composants.
 */
import { type ReactNode } from 'react';
import { API, fcfa } from './api';
import type { ClientDetail, DriverDetail, PageMeta } from './types';

export function Pager({ meta, onPage }: { meta: PageMeta; onPage: (p: number) => void }) {
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

/**
 * BOUTONS DE MISE EN RELATION — réutilisables dans toutes les sessions.
 *
 * Le besoin n'est pas propre au poste SOS : un agent du support, un gestionnaire de
 * flotte ou un chargé de location doivent pouvoir joindre quelqu'un depuis la ligne
 * qu'ils ont sous les yeux. Sans numéro, les boutons sont désactivés et le disent —
 * plutôt qu'une icône qui ne fait rien.
 */
export function ContactRapide({ type, id, numero, nom, onContact }: {
  type: 'sos' | 'course' | 'client' | 'chauffeur' | 'support' | 'location' | 'entreprise';
  id: string;
  numero?: string | null;
  nom?: string | null;
  onContact: (p: { dossierType: string; dossierId: string; canal: 'appel' | 'sms' | 'whatsapp'; numero: string; label: string }) => void;
}) {
  if (!numero) {
    return <span className="adm-muted" style={{ fontSize: 11 }} title="Aucun numéro enregistré">n° inconnu</span>;
  }
  const base = { dossierType: type, dossierId: id, numero, label: nom ?? numero };
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="adm-btn xs solid" title={`Appeler ${nom ?? numero}`} onClick={() => onContact({ ...base, canal: 'appel' })}>Appeler</button>
      <button className="adm-btn xs" title={`SMS à ${nom ?? numero}`} onClick={() => onContact({ ...base, canal: 'sms' })}>SMS</button>
      <button className="adm-btn xs" title={`WhatsApp à ${nom ?? numero}`} onClick={() => onContact({ ...base, canal: 'whatsapp' })}>WhatsApp</button>
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`adm-kpi ${tone}`}>
      <span className="adm-kpi-label">{label}</span>
      <span className="adm-kpi-value">{value}</span>
      <span className="adm-kpi-sub">{sub}</span>
    </div>
  );
}

/* --------------------------- Fiches détaillées ----------------------- */
export function Drawer({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
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

export const ledgerLabel = (t: string) => ({ ride_earning: 'Gain course', commission: 'Commission', payout: 'Retrait', topup: 'Recharge', adjustment: 'Ajustement' }[t] ?? t);

/**
 * Photo du chauffeur (adresse signée remise par le serveur), sinon ses initiales :
 * reconnaître la personne au premier coup d'œil, dans toutes les sessions.
 */
export function AvatarChauffeur({ photoUrl, name, taille = 32 }: { photoUrl?: string | null; name: string; taille?: number }) {
  const initiales = name.trim().split(/\s+/).map((x) => x[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const style = { width: taille, height: taille, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' as const, border: '1px solid var(--a-line, rgba(127,127,127,.25))' };
  return photoUrl
    ? <img src={`${API}${photoUrl}`} alt={`Photo de ${name}`} style={style} />
    : <span aria-hidden="true" style={{ ...style, display: 'inline-grid', placeItems: 'center', fontSize: taille * 0.38, fontWeight: 600, background: 'var(--a-soft, rgba(0,168,101,.12))', color: 'var(--a-accent, #00a865)' }}>{initiales}</span>;
}

export function DriverDrawer({ d, onClose }: { d: DriverDetail; onClose: () => void }) {
  return (
    <Drawer title={d.name} sub={d.matricule} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 10px' }}><AvatarChauffeur photoUrl={d.photoUrl} name={d.name} taille={88} /></div>
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
        <div className="adm-mini-kpi"><span>Annulations (chauffeur)</span><strong>{d.cancellations ?? 0}</strong></div>
        {d.offres && <div className="adm-mini-kpi"><span>Offres acceptées</span><strong>{d.offres.acceptees}/{d.offres.recues}{d.offres.expirees ? ` · ${d.offres.expirees} manquée(s)` : ''}</strong></div>}
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

/** Qui a annulé, et pourquoi : sans motif, une annulation ne disait rien à la console. */
const PAR_LABEL: Record<string, string> = { client: 'Par le client', systeme: 'Par ORION', chauffeur: 'Par le chauffeur', inconnu: 'Auteur non tracé' };
const MOTIF_LABEL: Record<string, string> = {
  attente_longue: 'chauffeur trop long', chauffeur_immobile: 'chauffeur immobile', changement_plan: 'changement d’avis',
  erreur_adresse: 'erreur d’adresse', autre_transport: 'autre moyen trouvé', chauffeur_demande: 'demandé par le chauffeur',
  securite: 'ne se sentait pas en sécurité', autre: 'autre raison', aucun_chauffeur: 'aucun chauffeur disponible',
};

export function ClientDrawer({ c, onClose, onOpenSupport }: { c: ClientDetail; onClose: () => void; onOpenSupport: () => void }) {
  return (
    <Drawer title={c.deletedAt ? 'Compte supprimé' : (c.name ?? c.id)} sub={c.id} onClose={onClose}>
      <div className="adm-client-tete">
        {c.photo
          ? <img className="adm-client-photo" src={c.photo} alt={`Photo de ${c.name ?? 'ce client'}`} />
          : <span className="adm-client-photo vide">{(c.name ?? '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>}
        <div className="adm-drawer-tags" style={{ margin: 0 }}>
          <span className={`adm-pill ${c.status === 'blocked' ? 'kyc-manual_review' : 'av-online'}`}>{c.status === 'blocked' ? 'Bloqué' : 'Actif'}</span>
          {c.phone && <span className="adm-pill">{c.phone}{c.phoneVerifiedAt ? ' · vérifié ✓' : ' · non vérifié'}</span>}
          {c.email && <span className="adm-pill">{c.email}</span>}
          {!c.photo && !c.deletedAt && <span className="adm-pill">sans photo</span>}
          {c.deletedAt && <span className="adm-pill kyc-manual_review">supprimé à sa demande</span>}
        </div>
      </div>
      <div className="adm-mini-kpis">
        <div className="adm-mini-kpi"><span>Dépensé</span><strong>{fcfa(c.spent)}</strong></div>
        <div className="adm-mini-kpi"><span>Courses</span><strong>{c.terminees ?? c.rides} terminée(s){c.terminees !== undefined && c.rides !== c.terminees ? ` / ${c.rides} commandée(s)` : ''}</strong></div>
        <div className="adm-mini-kpi"><span>Annulées par le client</span><strong>{c.cancellations ?? 0}{c.warnings ? ` · ${c.warnings} avert.` : ''}</strong></div>
        <div className="adm-mini-kpi"><span>Conversations</span><strong>{c.conversations.length}</strong></div>
      </div>
      <h4 className="adm-drawer-sec">Dernières courses</h4>
      {c.recentRides.length === 0 ? <p className="adm-muted">Aucune course.</p> : (
        <table className="adm-table sm">
          <thead><tr><th>Course</th><th>Statut</th><th>Annulation</th><th className="r">Montant</th></tr></thead>
          <tbody>{c.recentRides.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id.slice(0, 10)}</td>
              <td>{rideStatusLabel(r.status)}</td>
              <td>{r.annulation
                ? <>{PAR_LABEL[r.annulation.par] ?? r.annulation.par}{r.annulation.motif ? ` · ${MOTIF_LABEL[r.annulation.motif] ?? r.annulation.motif}` : ''}{r.annulation.frais ? ` · ${fcfa(r.annulation.frais)}` : ' · gratuite'}</>
                : <span className="adm-muted">—</span>}</td>
              <td className="r">{fcfa(r.amount)}</td>
            </tr>
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

export const statusLabel = (s: string) => ({ raised: 'Reçue · à prendre', dispatched: 'Secours alertés', acknowledged: 'Prise en charge', resolved: 'Résolue', cancelled: 'Annulée' }[s] ?? s);
export const rideStatusLabel = (s: string) => ({ searching: 'Recherche', accepted: 'Acceptée', driver_en_route: 'En approche', arrived: 'Arrivé', in_progress: 'En course', completed: 'Terminée', paid: 'Payée', rated: 'Notée', cancelled: 'Annulée', no_driver: 'Sans chauffeur' }[s] ?? s);
export const trafficLabel = (s: string) => ({ fluid: 'Fluide', dense: 'Dense', jam: 'Bouchon' }[s] ?? s);
export const kycLabel = (s: string) => ({ draft: 'Brouillon', docs_submitted: 'Docs reçus', manual_review: 'Revue', approved: 'Approuvé', active: 'Actif', suspended: 'Suspendu' }[s] ?? s);
export const availLabel = (s: string) => ({ offline: 'Hors-ligne', online: 'En ligne', on_trip: 'En course', paused: 'Pause' }[s] ?? s);

