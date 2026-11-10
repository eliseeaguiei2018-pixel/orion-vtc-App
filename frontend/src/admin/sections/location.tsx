import { useMemo, useState } from 'react';
import { fcfa } from '../api';
import { Kpi } from '../ui';
import type {
  DriverRow, PrestigeUnit, RentalAvailabilityRow, RentalRow, RentalStats, SubInvoiceRow,
  SubPlanRow, SubStats, SubscriptionRow,
} from '../types';

/**
 * Sessions LOCATION et ABONNEMENTS de la console.
 *
 * La location Signature et l'abonnement ORION existaient côté client sans aucune
 * visibilité pour l'exploitation : personne ne pouvait voir une demande arriver,
 * affecter un chauffeur, ni savoir quelles cotisations restaient impayées. Ces deux
 * sessions comblent ce trou.
 */

const LABEL_FORMULE: Record<string, string> = {
  evenement: 'Événement & mariage',
  entreprise: 'Entreprise & institution',
  mise_a_disposition: 'Mise à disposition',
};
const LABEL_DUREE: Record<string, string> = {
  heures: 'À l’heure', journee: 'Journée', weekend: 'Week-end', semaine: 'Semaine', mois: 'Mois',
};
const LABEL_STATUT: Record<string, string> = {
  devis: 'Devis', reservee: 'Réservée', confirmee: 'Confirmée',
  en_cours: 'En cours', terminee: 'Terminée', annulee: 'Annulée',
};
/** Couleur de pastille : on réutilise les classes existantes de la console. */
const PILL_STATUT: Record<string, string> = {
  devis: '', reservee: 'av-online', confirmee: 'av-online',
  en_cours: 'av-on_trip', terminee: '', annulee: 'kyc-manual_review',
};

const dt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function RentalSection({ reservations, fleet, stats, dispos, drivers, canWrite, onAssign, onStatus, onCancel, onBon }: {
  reservations: RentalRow[];
  fleet: PrestigeUnit[];
  stats: RentalStats | null;
  dispos: RentalAvailabilityRow[];
  drivers: DriverRow[];
  canWrite: boolean;
  onAssign: (id: string, driverId: string) => void;
  onStatus: (id: string, status: string, note?: string) => void;
  onCancel: (id: string, raison?: string) => void;
  onBon: (id: string) => void;
}) {
  const [formule, setFormule] = useState('');
  const [statut, setStatut] = useState('');
  const [choixChauffeur, setChoixChauffeur] = useState<Record<string, string>>({});

  const vues = useMemo(
    () => reservations.filter((r) => (!formule || r.formula === formule) && (!statut || r.status === statut)),
    [reservations, formule, statut],
  );
  const dispoDe = (id: string) => dispos.find((d) => d.vehicleId === id);
  /** Les locations Signature sont servies par les chauffeurs les mieux notés. */
  const eligibles = useMemo(
    () => drivers.filter((d) => d.kycStatus === 'active' || d.kycStatus === 'approved').sort((a, b) => b.rating - a.rating),
    [drivers],
  );

  return (
    <>
      {stats && (
        <div className="adm-kpis">
          <Kpi label="Dossiers" value={String(stats.total)} sub={`${stats.aVenir} à venir`} tone="blue" />
          <Kpi label="Chiffre d’affaires" value={fcfa(stats.chiffreAffaires)} sub="hors annulations" tone="green" />
          <Kpi label="Flotte engagée" value={`${Math.round(stats.tauxOccupation * 100)} %`} sub="véhicules Signature immobilisés" tone={stats.tauxOccupation > 0.8 ? 'red' : 'blue'} />
          <Kpi label="Événements" value={String(stats.parFormule['evenement'] ?? 0)} sub={`${stats.parFormule['entreprise'] ?? 0} entreprise · ${stats.parFormule['mise_a_disposition'] ?? 0} mise à dispo.`} tone="green" />
        </div>
      )}

      {/* Disponibilité du jour : ce que l'exploitation peut promettre MAINTENANT. */}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Flotte Signature — disponibilité des prochaines 24 h</h3>
          <span className="adm-muted">{fleet.length} modèle(s)</span>
        </div>
        <table className="adm-table">
          <thead>
            <tr>
              <th>Modèle</th><th>Classe</th><th className="r">Places</th><th className="r">Autonomie</th>
              <th className="r">Prix / jour</th><th className="r">Disponibles</th><th>Mise à disposition</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((v) => {
              const d = dispoDe(v.id);
              const restants = d?.restants ?? v.exemplaires;
              return (
                <tr key={v.id}>
                  <td><strong>{v.name}</strong><br /><span className="adm-muted">{v.atouts[0]}</span></td>
                  <td><span className={`adm-pill ${v.classe === 'presidentielle' ? 'cap' : ''}`}>{v.classe === 'presidentielle' ? 'Présidentielle' : 'Signature'}</span></td>
                  <td className="r">{v.places}</td>
                  <td className="r">{v.autonomieKm} km</td>
                  <td className="r">{fcfa(v.prixJour)}</td>
                  <td className="r"><strong className={restants === 0 ? 'neg' : 'pos'}>{restants} / {v.exemplaires}</strong></td>
                  <td>{d && d.delaiMinutes > 0 ? `≈ ${d.delaiMinutes} min` : restants === 0 ? 'Complet' : 'Sur réservation'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Dossiers de location</h3>
          <div className="row" style={{ gap: 8 }}>
            <select className="adm-select" value={formule} onChange={(e) => setFormule(e.target.value)}>
              <option value="">Toutes les formules</option>
              {Object.entries(LABEL_FORMULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="adm-select" value={statut} onChange={(e) => setStatut(e.target.value)}>
              <option value="">Tous les statuts</option>
              {Object.entries(LABEL_STATUT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="adm-muted">{vues.length}</span>
          </div>
        </div>
        {vues.length === 0 ? <p className="adm-muted">Aucun dossier pour ce filtre.</p> : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Dossier</th><th>Formule</th><th>Véhicule</th><th>Début</th>
                <th>Client / société</th><th className="r">Total</th><th>Statut</th><th>Chauffeur</th>
                {canWrite && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {vues.map((r) => {
                const chauffeur = r.driverId ? drivers.find((d) => d.id === r.driverId) : undefined;
                const modifiable = r.status === 'reservee' || r.status === 'confirmee' || r.status === 'en_cours';
                return (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td>{LABEL_FORMULE[r.formula] ?? r.formula}<br /><span className="adm-muted">{LABEL_DUREE[r.duree] ?? r.duree}{r.heures ? ` · ${r.heures} h` : ''}</span></td>
                    <td>{r.vehicle.name}{r.options.cortege > 0 && <><br /><span className="adm-muted">+ {r.options.cortege} cortège</span></>}</td>
                    <td>{dt(r.debut)}{r.jourJ && <><br /><span className="adm-pill av-on_trip">Jour J</span></>}</td>
                    <td>
                      {r.societe?.nom ?? r.contact?.nom ?? r.userId}
                      {r.societe?.bonCommande && <><br /><span className="adm-muted mono">BC {r.societe.bonCommande}</span></>}
                      {r.lieu && <><br /><span className="adm-muted">{r.lieu}</span></>}
                    </td>
                    <td className="r">{fcfa(r.total)}</td>
                    <td><span className={`adm-pill ${PILL_STATUT[r.status] ?? ''}`}>{LABEL_STATUT[r.status] ?? r.status}</span></td>
                    <td>
                      {chauffeur ? <>{chauffeur.name}<br /><span className="adm-muted mono">{chauffeur.matricule}</span></> : <span className="adm-muted">à affecter</span>}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          {modifiable && (
                            <>
                              <select
                                className="adm-select"
                                value={choixChauffeur[r.id] ?? r.driverId ?? ''}
                                onChange={(e) => setChoixChauffeur((c) => ({ ...c, [r.id]: e.target.value }))}
                              >
                                <option value="">Chauffeur…</option>
                                {eligibles.map((d) => <option key={d.id} value={d.id}>{d.name} · ★ {d.rating.toFixed(1)}</option>)}
                              </select>
                              <button
                                className="adm-btn xs"
                                disabled={!choixChauffeur[r.id]}
                                onClick={() => onAssign(r.id, choixChauffeur[r.id]!)}
                              >Affecter</button>
                            </>
                          )}
                          {r.status === 'reservee' && <button className="adm-btn xs" onClick={() => onStatus(r.id, 'confirmee')}>Confirmer</button>}
                          {r.status === 'confirmee' && <button className="adm-btn xs" onClick={() => onStatus(r.id, 'en_cours')}>Démarrer</button>}
                          {r.status === 'en_cours' && <button className="adm-btn xs solid" onClick={() => onStatus(r.id, 'terminee')}>Clôturer</button>}
                          <button className="adm-btn xs" onClick={() => onBon(r.id)}>Bon PDF</button>
                          {modifiable && <button className="adm-btn xs" onClick={() => onCancel(r.id, 'annulation ORION')}>Annuler</button>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const LABEL_FACTURE: Record<string, string> = { en_attente: 'En attente', payee: 'Payée', echouee: 'Échec' };
const PILL_FACTURE: Record<string, string> = { en_attente: 'cap', payee: 'av-online', echouee: 'kyc-manual_review' };

export function SubscriptionsSection({ plans, subscriptions, invoices, stats, canWrite, onPayInvoice, onEcheances, onResilier }: {
  plans: SubPlanRow[];
  subscriptions: SubscriptionRow[];
  invoices: SubInvoiceRow[];
  stats: SubStats | null;
  canWrite: boolean;
  onPayInvoice: (id: string) => void;
  onEcheances: () => void;
  onResilier: (userId: string) => void;
}) {
  const [filtre, setFiltre] = useState('');
  const vues = useMemo(() => invoices.filter((f) => !filtre || f.status === filtre), [invoices, filtre]);

  return (
    <>
      {stats && (
        <div className="adm-kpis">
          <Kpi label="Abonnés actifs" value={String(stats.actifs)} sub={`${stats.total} compte(s) au total`} tone="green" />
          <Kpi label="Revenu récurrent" value={fcfa(stats.mrr)} sub="par mois, abonnés à jour" tone="green" />
          <Kpi label="Impayés" value={String(stats.impayees)} sub={fcfa(stats.montantImpaye)} tone={stats.impayees > 0 ? 'red' : 'blue'} />
          <Kpi label="Valeur rendue" value={fcfa(stats.totalCouvert)} sub={`${stats.coursesCouvertes} course(s) prise(s) en charge`} tone="blue" />
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Forfaits</h3>
          {canWrite && <button className="adm-btn" onClick={onEcheances}>Traiter les échéances</button>}
        </div>
        <table className="adm-table">
          <thead>
            <tr><th>Forfait</th><th className="r">Courses / jour</th><th className="r">Plafond / course</th><th className="r">Prix mensuel</th><th>Niveaux</th><th className="r">Abonnés</th></tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.label}</strong></td>
                <td className="r">{p.ridesPerDay}</td>
                <td className="r">{fcfa(p.perRideCap)}</td>
                <td className="r">{fcfa(p.monthlyPrice)}</td>
                <td>{p.tiers.join(' · ')}</td>
                <td className="r">{stats?.parPlan[p.id] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Abonnés</h3><span className="adm-muted">{subscriptions.length}</span></div>
        {subscriptions.length === 0 ? <p className="adm-muted">Aucun abonné.</p> : (
          <table className="adm-table">
            <thead>
              <tr><th>Client</th><th>Forfait</th><th>Échéance</th><th className="r">Quota du jour</th><th className="r">Pris en charge</th><th>État</th>{canWrite && <th>Actions</th>}</tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => {
                const echu = Date.parse(s.renewsAt) <= Date.now();
                const etat = s.cancelledAt ? 'Résilié' : !s.active ? 'Suspendu' : echu ? 'Échu' : 'Actif';
                const pill = etat === 'Actif' ? 'av-online' : etat === 'Résilié' ? '' : 'kyc-manual_review';
                return (
                  <tr key={s.id}>
                    <td className="mono">{s.userId}</td>
                    <td>{s.plan}</td>
                    <td>{dt(s.renewsAt)}{s.autoRenew && <><br /><span className="adm-muted">renouvellement auto.</span></>}</td>
                    <td className="r">{s.usedToday} / {s.ridesPerDay}</td>
                    <td className="r">{fcfa(s.totalCouvert)}<br /><span className="adm-muted">{s.coursesCouvertes} course(s)</span></td>
                    <td><span className={`adm-pill ${pill}`}>{etat}</span></td>
                    {canWrite && (
                      <td>
                        {!s.cancelledAt && <button className="adm-btn xs" onClick={() => onResilier(s.userId)}>Résilier</button>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Factures d’abonnement</h3>
          <div className="row" style={{ gap: 8 }}>
            <select className="adm-select" value={filtre} onChange={(e) => setFiltre(e.target.value)}>
              <option value="">Toutes</option>
              {Object.entries(LABEL_FACTURE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="adm-muted">{vues.length}</span>
          </div>
        </div>
        {vues.length === 0 ? <p className="adm-muted">Aucune facture.</p> : (
          <table className="adm-table">
            <thead>
              <tr><th>Facture</th><th>Client</th><th>Forfait</th><th className="r">Montant</th><th>Émise</th><th>Statut</th>{canWrite && <th>Actions</th>}</tr>
            </thead>
            <tbody>
              {vues.map((f) => (
                <tr key={f.id}>
                  <td className="mono">{f.id}</td>
                  <td className="mono">{f.userId}</td>
                  <td>{f.plan}</td>
                  <td className="r">{fcfa(f.amount)}</td>
                  <td>{dt(f.emiseLe)}</td>
                  <td>
                    <span className={`adm-pill ${PILL_FACTURE[f.status] ?? ''}`}>{LABEL_FACTURE[f.status] ?? f.status}</span>
                    {f.motifEchec && <><br /><span className="adm-muted">{f.motifEchec}</span></>}
                  </td>
                  {canWrite && (
                    <td>
                      {f.status !== 'payee' && <button className="adm-btn xs solid" onClick={() => onPayInvoice(f.id)}>Encaisser</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
