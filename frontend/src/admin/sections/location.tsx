import { useMemo, useState } from 'react';
import { fcfa } from '../api';
import { ContactRapide, Kpi } from '../ui';
import type {
  ContactHandler, DriverRow, PrestigeUnit, RentalAvailabilityRow, RentalRow, RentalStats,
  RentalTarif, RentalTarifEtat, SubInvoiceRow, SubPlanRow, SubStats, SubscriptionRow,
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

export function RentalSection({ reservations, fleet, stats, dispos, drivers, canWrite, onAssign, onStatus, onCancel, onBon, onContact }: {
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
  /** Joindre l'organisateur, ou le chauffeur affecté — tentative consignée. */
  onContact: ContactHandler;
}) {
  const [formule, setFormule] = useState('');
  const [statut, setStatut] = useState('');
  const [choixChauffeur, setChoixChauffeur] = useState<Record<string, string>>({});

  const vues = useMemo(
    () => reservations.filter((r) => (!formule || r.formula === formule) && (!statut || r.status === statut)),
    [reservations, formule, statut],
  );
  const dispoDe = (id: string) => dispos.find((d) => d.vehicleId === id);
  /**
   * Chauffeurs affectables : tous sauf les suspendus, les mieux notés en tête. On ne
   * restreint PAS au seul statut « actif » : une liste vide sans explication est le
   * pire des cas — l'exploitant croit qu'il n'y a personne alors que le filtre est
   * simplement trop étroit. Le statut KYC reste affiché dans la liste.
   */
  const eligibles = useMemo(
    () => drivers.filter((d) => d.kycStatus !== 'suspended').sort((a, b) => b.rating - a.rating),
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
            <select className="adm-select" aria-label="Filtrer par formule" value={formule} onChange={(e) => setFormule(e.target.value)}>
              <option value="">Toutes les formules</option>
              {Object.entries(LABEL_FORMULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="adm-select" aria-label="Filtrer par statut" value={statut} onChange={(e) => setStatut(e.target.value)}>
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
                <th>Client / société</th><th>Joindre</th><th className="r">Total</th><th>Statut</th><th>Chauffeur</th>
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
                      {r.societe?.bonCommande && <><br /><span className="adm-muted">Bon de commande <span className="mono">{r.societe.bonCommande}</span></span></>}
                      {r.lieu && <><br /><span className="adm-muted">{r.lieu}</span></>}
                    </td>
                    <td>
                      <ContactRapide
                        type="location" id={r.id}
                        numero={r.contact?.telephone} nom={r.contact?.nom ?? r.societe?.nom}
                        onContact={onContact}
                      />
                    </td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>{fcfa(r.total)}</td>
                    <td><span className={`adm-pill ${PILL_STATUT[r.status] ?? ''}`}>{LABEL_STATUT[r.status] ?? r.status}</span></td>
                    <td>
                      {chauffeur ? (
                        <>
                          {chauffeur.name}<br /><span className="adm-muted mono">{chauffeur.matricule}</span>
                          <div style={{ marginTop: 4 }}>
                            <ContactRapide type="chauffeur" id={chauffeur.id} numero={chauffeur.phone} nom={chauffeur.name} onContact={onContact} />
                          </div>
                        </>
                      ) : <span className="adm-muted">à affecter</span>}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          {modifiable && (
                            <>
                              {eligibles.length === 0 ? (
                                <span className="adm-muted">Aucun chauffeur affectable (tous suspendus ou flotte vide)</span>
                              ) : (
                                <>
                                  <select
                                    className="adm-select"
                                    aria-label="Chauffeur affecté"
                                    value={choixChauffeur[r.id] ?? r.driverId ?? ''}
                                    onChange={(e) => setChoixChauffeur((c) => ({ ...c, [r.id]: e.target.value }))}
                                  >
                                    <option value="">Chauffeur…</option>
                                    {eligibles.map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {d.name} · ★ {d.rating.toFixed(1)} · {d.kycStatus === 'active' ? 'validé' : d.kycStatus}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    className="adm-btn xs"
                                    disabled={!choixChauffeur[r.id]}
                                    onClick={() => onAssign(r.id, choixChauffeur[r.id]!)}
                                  >Affecter</button>
                                </>
                              )}
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

export function SubscriptionsSection({ plans, subscriptions, invoices, stats, canWrite, clients, onPayInvoice, onEcheances, onResilier, onContact }: {
  /** Fiches clients, pour retrouver le numéro de l'abonné. */
  clients: Array<{ id: string; name?: string; phone?: string }>;
  /** Relancer un impayé suppose de pouvoir joindre l'abonné. */
  onContact: ContactHandler;
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
  /** « gold » ne veut rien dire pour un exploitant : on affiche le nom commercial. */
  const nomForfait = (id: string) => plans.find((p) => p.id === id)?.label ?? id;

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
              <tr><th>Client</th><th>Joindre</th><th>Forfait</th><th>Échéance</th><th className="r">Quota du jour</th><th className="r">Pris en charge</th><th>État</th>{canWrite && <th>Actions</th>}</tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => {
                const echu = Date.parse(s.renewsAt) <= Date.now();
                const etat = s.cancelledAt ? 'Résilié' : !s.active ? 'Suspendu' : echu ? 'Échu' : 'Actif';
                const pill = etat === 'Actif' ? 'av-online' : etat === 'Résilié' ? '' : 'kyc-manual_review';
                return (
                  <tr key={s.id}>
                    <td>{clients.find((c) => c.id === s.userId)?.name ?? <span className="mono">{s.userId}</span>}</td>
                    <td>
                      <ContactRapide
                        type="client" id={s.userId}
                        numero={clients.find((c) => c.id === s.userId)?.phone}
                        nom={clients.find((c) => c.id === s.userId)?.name ?? s.userId}
                        onContact={onContact}
                      />
                    </td>
                    <td>{nomForfait(s.plan)}</td>
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
            <select className="adm-select" aria-label="Filtrer les factures" value={filtre} onChange={(e) => setFiltre(e.target.value)}>
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
                  <td>{nomForfait(f.plan)}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>{fcfa(f.amount)}</td>
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

/* ------------------------- Barème de location ------------------------- */

/** Un champ numérique du barème, avec son unité et son explication. */
function ChampTarif({ label, aide, valeur, suffixe, pas = 1, onChange }: {
  label: string; aide?: string; valeur: number; suffixe?: string; pas?: number; onChange: (v: number) => void;
}) {
  return (
    <label className="price-field" title={aide}>
      <span>{label}{suffixe ? ` (${suffixe})` : ''}</span>
      <input type="number" step={pas} value={valeur} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/**
 * ÉDITEUR DU BARÈME DE LOCATION.
 *
 * Les prix journaliers et tout le barème vivaient en dur dans le code : il fallait un
 * développeur pour ajuster un tarif. C'est une décision commerciale — elle appartient
 * à l'équipe. Chaque modification est bornée côté serveur, journalisée avec son auteur,
 * et prend effet sur le devis suivant, sans redéploiement.
 */
export function RentalTarifsSection({ etat, canWrite, onSave, onReset }: {
  etat: RentalTarifEtat | null;
  canWrite: boolean;
  onSave: (patch: { tarif?: Partial<RentalTarif> & { coefs?: Partial<RentalTarif['coefs']> }; vehicules?: Record<string, { prixJour?: number; exemplaires?: number; actif?: boolean }> }) => void;
  onReset: () => void;
}) {
  const [brouillon, setBrouillon] = useState<RentalTarifEtat | null>(null);
  // On repart de l'état serveur à chaque rafraîchissement tant que rien n'est modifié.
  const courant = brouillon ?? etat;
  if (!courant) return <p className="adm-muted">Chargement du barème…</p>;

  const t = courant.tarif;
  const modifie = brouillon !== null;
  const majT = (patch: Partial<RentalTarif>) => setBrouillon({ ...courant, tarif: { ...t, ...patch } });
  const majCoef = (cle: keyof RentalTarif['coefs'], v: number) =>
    setBrouillon({ ...courant, tarif: { ...t, coefs: { ...t.coefs, [cle]: v } } });
  const majVeh = (id: string, patch: Partial<PrestigeUnit & { actif: boolean }>) =>
    setBrouillon({ ...courant, vehicules: courant.vehicules.map((v) => (v.id === id ? { ...v, ...patch } : v)) });

  const enregistrer = () => {
    if (!etat) return;
    // On n'envoie que les véhicules RÉELLEMENT modifiés : le journal doit montrer la
    // décision, pas une liste de valeurs réécrites à l'identique.
    const vehicules: Record<string, { prixJour?: number; exemplaires?: number; actif?: boolean }> = {};
    for (const v of courant.vehicules) {
      const ref = etat.vehicules.find((x) => x.id === v.id);
      if (!ref) continue;
      const d: { prixJour?: number; exemplaires?: number; actif?: boolean } = {};
      if (v.prixJour !== ref.prixJour) d.prixJour = v.prixJour;
      if (v.exemplaires !== ref.exemplaires) d.exemplaires = v.exemplaires;
      if (v.actif !== ref.actif) d.actif = v.actif;
      if (Object.keys(d).length) vehicules[v.id] = d;
    }
    onSave({ tarif: t, vehicules: Object.keys(vehicules).length ? vehicules : undefined });
    setBrouillon(null);
  };

  /** Simulation : ce que coûte une journée nue avec le barème en cours d'édition. */
  const exemple = courant.vehicules.find((v) => v.actif) ?? courant.vehicules[0];

  return (
    <>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Prix des véhicules Signature</h3>
          <span className="adm-muted">
            {courant.origine.modifieLe
              ? `Dernier ajustement : ${new Date(courant.origine.modifieLe).toLocaleString('fr-FR')}${courant.origine.modifiePar ? ` · ${courant.origine.modifiePar}` : ''}`
              : 'Barème d’origine (jamais ajusté)'}
          </span>
        </div>
        <table className="adm-table">
          <thead>
            <tr><th>Modèle</th><th>Classe</th><th className="r">Prix / jour (F)</th><th className="r">Exemplaires</th><th>Proposé à la location</th></tr>
          </thead>
          <tbody>
            {courant.vehicules.map((v) => (
              <tr key={v.id}>
                <td><strong>{v.name}</strong><br /><span className="adm-muted">{v.places} places · {v.autonomieKm} km</span></td>
                <td><span className="adm-pill">{v.classe === 'presidentielle' ? 'Présidentielle' : 'Signature'}</span></td>
                <td className="r">
                  <input
                    className="adm-input-num" type="number" step={5000} value={v.prixJour} disabled={!canWrite}
                    onChange={(e) => majVeh(v.id, { prixJour: Number(e.target.value) })}
                  />
                </td>
                <td className="r">
                  <input
                    className="adm-input-num" type="number" step={1} min={0} value={v.exemplaires} disabled={!canWrite}
                    onChange={(e) => majVeh(v.id, { exemplaires: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <button
                    className={`adm-btn xs${v.actif ? ' solid' : ''}`} disabled={!canWrite}
                    onClick={() => majVeh(v.id, { actif: !v.actif })}
                  >{v.actif ? 'En vente' : 'Retiré'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="adm-muted" style={{ marginTop: 10, fontSize: 12 }}>
          Un modèle « retiré » disparaît aussitôt de l’application cliente sans être supprimé :
          utile pour une immobilisation, une révision ou un modèle pas encore livré.
        </p>
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Durées et majorations</h3></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <ChampTarif label="Journée" aide="Multiplicateur du prix journée (référence = 1)" valeur={t.coefs.journee} pas={0.05} onChange={(v) => majCoef('journee', v)} />
          <ChampTarif label="Week-end" aide="Deux jours" valeur={t.coefs.weekend} pas={0.1} onChange={(v) => majCoef('weekend', v)} />
          <ChampTarif label="Semaine" aide="Sept jours — dégressif" valeur={t.coefs.semaine} pas={0.1} onChange={(v) => majCoef('semaine', v)} />
          <ChampTarif label="Mois" aide="Trente jours — contrat entreprise" valeur={t.coefs.mois} pas={0.5} onChange={(v) => majCoef('mois', v)} />
          <ChampTarif label="Part horaire" suffixe="du prix journée" aide="17 % par heure par défaut, plafonné au tarif journée" valeur={t.ratioHeure} pas={0.01} onChange={(v) => majT({ ratioHeure: v })} />
          <ChampTarif label="Heures min." valeur={t.minHeures} onChange={(v) => majT({ minHeures: v })} />
          <ChampTarif label="Heures max." valeur={t.maxHeures} onChange={(v) => majT({ maxHeures: v })} />
          <ChampTarif label="Mobilisation jour J" suffixe="part" aide="Majoration quand la location démarre le jour même" valeur={t.majorationJourJ} pas={0.01} onChange={(v) => majT({ majorationJourJ: v })} />
          <ChampTarif label="Remise cortège" suffixe="part" aide="Remise sur chaque véhicule supplémentaire" valeur={t.remiseCortege} pas={0.01} onChange={(v) => majT({ remiseCortege: v })} />
          <ChampTarif label="Caution" suffixe="part du HT" aide="Restituée à la restitution du véhicule" valeur={t.tauxCaution} pas={0.01} onChange={(v) => majT({ tauxCaution: v })} />
          <ChampTarif label="Délai express min." suffixe="min" aide="Flotte libre" valeur={t.delaiExpressMin} onChange={(v) => majT({ delaiExpressMin: v })} />
          <ChampTarif label="Délai express max." suffixe="min" aide="Flotte chargée" valeur={t.delaiExpressMax} onChange={(v) => majT({ delaiExpressMax: v })} />
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Options et kilométrage</h3></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <ChampTarif label="Décoration florale" suffixe="F" valeur={t.decoration} pas={5000} onChange={(v) => majT({ decoration: v })} />
          <ChampTarif label="Tapis rouge" suffixe="F" valeur={t.tapisRouge} pas={5000} onChange={(v) => majT({ tapisRouge: v })} />
          <ChampTarif label="Hôtesse / jour" suffixe="F" valeur={t.hotesse} pas={5000} onChange={(v) => majT({ hotesse: v })} />
          <ChampTarif label="Escorte & ouvreur" suffixe="F" valeur={t.escorte} pas={5000} onChange={(v) => majT({ escorte: v })} />
          <ChampTarif label="Plaque personnalisée" suffixe="F" valeur={t.plaque} pas={5000} onChange={(v) => majT({ plaque: v })} />
          <ChampTarif label="Second chauffeur" suffixe="F" valeur={t.secondChauffeur} pas={5000} onChange={(v) => majT({ secondChauffeur: v })} />
          <ChampTarif label="Rafraîchissements" suffixe="F" valeur={t.rafraichissements} pas={5000} onChange={(v) => majT({ rafraichissements: v })} />
          <ChampTarif label="Km inclus / jour" valeur={t.kmInclusParJour} pas={10} onChange={(v) => majT({ kmInclusParJour: v })} />
          <ChampTarif label="Km supplémentaire" suffixe="F" valeur={t.prixKmSupp} pas={50} onChange={(v) => majT({ prixKmSupp: v })} />
          <ChampTarif label="Km illimité" suffixe="part" aide="Majoration du poste véhicule" valeur={t.majorationKmIllimite} pas={0.01} onChange={(v) => majT({ majorationKmIllimite: v })} />
        </div>

        {exemple && (
          <p className="adm-muted" style={{ marginTop: 12, fontSize: 12.5 }}>
            Simulation — {exemple.name}, journée nue : <strong>{fcfa(Math.round(exemple.prixJour * t.coefs.journee))}</strong> ·
            week-end : <strong>{fcfa(Math.round(exemple.prixJour * t.coefs.weekend))}</strong> ·
            semaine : <strong>{fcfa(Math.round(exemple.prixJour * t.coefs.semaine))}</strong> ·
            3 h : <strong>{fcfa(Math.round(exemple.prixJour * Math.min(3 * t.ratioHeure, 1)))}</strong>
          </p>
        )}

        {canWrite && (
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button className="adm-btn solid" disabled={!modifie} onClick={enregistrer}>
              {modifie ? 'Appliquer le nouveau barème' : 'Aucune modification'}
            </button>
            {modifie && <button className="adm-btn" onClick={() => setBrouillon(null)}>Annuler mes changements</button>}
            <button className="adm-btn ghost" onClick={onReset}>Revenir au barème d’origine</button>
          </div>
        )}
        {modifie && (
          <p className="adm-muted" style={{ marginTop: 8, fontSize: 12 }}>
            Rien n’est enregistré tant que vous n’avez pas appliqué. Le changement sera
            journalisé à votre nom et prendra effet sur le devis suivant.
          </p>
        )}
      </div>
    </>
  );
}
