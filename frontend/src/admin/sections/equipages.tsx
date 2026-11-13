import { useMemo, useState } from 'react';
import { ContactRapide, Kpi, availLabel, kycLabel } from '../ui';
import type { ContactHandler, CrewTableau, DossierEquipage, EquipageRow, RequeteChauffeur } from '../types';

/**
 * SESSION ÉQUIPAGES — le dossier des chauffeurs ORION, et leurs requêtes.
 *
 * Les informations d'un chauffeur étaient éparpillées sur six sessions. Pour
 * répondre à « combien a-t-il gagné ce mois, et où en est sa demande de prêt ? »,
 * il fallait toutes les ouvrir et faire l'addition de tête.
 *
 * Ici, un matricule suffit. C'est aussi la session où les chauffeurs déposent ce
 * qu'ils demandent à l'entreprise — et où l'on voit ce qui n'a pas reçu de réponse.
 */

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const dt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const jour = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });

const SEV_CLS: Record<string, string> = { critique: 'lvl-rouge', eleve: 'lvl-orange', moyen: 'lvl-jaune' };
const SEV_LABEL: Record<string, string> = { critique: 'Critique', eleve: 'Élevé', moyen: 'Moyen', info: 'Information' };
const STATUT_CLS: Record<string, string> = {
  deposee: 'tr-pending', instruite: 'tr-pending', accordee: 'tr-approved',
  refusee: 'tr-rejected', versee: 'tr-approved', cloturee: '',
};

/** Types de requête et ce qu'ils demandent comme informations. */
const TYPES = [
  { id: 'pret', label: 'Prêt', montant: true, echeances: true },
  { id: 'avance', label: 'Avance sur revenus', montant: true, echeances: false },
  { id: 'conge', label: 'Congé', montant: false, echeances: false, dates: true },
  { id: 'materiel', label: 'Matériel', montant: true, echeances: false },
  { id: 'reparation', label: 'Réparation', montant: true, echeances: false },
  { id: 'reclamation', label: 'Réclamation', montant: false, echeances: false },
  { id: 'document', label: 'Document administratif', montant: false, echeances: false },
];

export function EquipagesSection({
  lignes, total, tableau, dossier, onOuvrir, onFermer, onRechercher, onContact,
  onDeposer, onInstruire, onDecider, onVerser, onRembourser, onCreerAcces,
  droits,
}: {
  lignes: EquipageRow[];
  /** Nombre total de chauffeurs trouvés ; la liste affichée peut en être une partie. */
  total?: number;
  tableau: CrewTableau | null;
  dossier: DossierEquipage | null;
  onOuvrir: (driverId: string) => void;
  onFermer: () => void;
  onRechercher: (q: string) => void;
  onContact: ContactHandler;
  onDeposer: (driverId: string, p: Record<string, unknown>) => void;
  onInstruire: (id: string, avis: 'favorable' | 'defavorable', note: string) => void;
  onDecider: (id: string, decision: 'accord' | 'refus', montantAccorde: number | undefined, note: string) => void;
  onVerser: (id: string, canal: string) => void;
  onRembourser: (id: string, montant: number) => void;
  onCreerAcces: (driverId: string, nom: string, matricule: string) => void;
  droits: { instruire: boolean; decider: boolean; verser: boolean; comptes: boolean };
}) {
  const [q, setQ] = useState('');

  return (
    <>
      {tableau && (
        <div className="adm-kpis">
          <Kpi label="Effectif" value={String(tableau.effectif.total)} sub={`${tableau.effectif.enService} en service · ${tableau.effectif.avecAcces} avec un accès console`} tone="teal" />
          <Kpi label="Requêtes à traiter" value={String(tableau.attente.aInstruire.length + tableau.attente.aDecider.length + tableau.attente.aVerser.length)} sub={`${tableau.attente.aInstruire.length} à instruire · ${tableau.attente.aDecider.length} à décider · ${tableau.attente.aVerser.length} à verser`} tone={tableau.attente.aDecider.length ? 'blue' : 'green'} />
          <Kpi label="Encours prêts & avances" value={fcfa(tableau.encoursPrets)} sub={`${fcfa(tableau.requetes.verseeCeMois)} versés ce mois-ci`} tone="blue" />
          <Kpi label="Délai moyen de réponse" value={`${tableau.requetes.delaiMoyenHeures} h`} sub={tableau.sansEquipe ? `${tableau.sansEquipe} chauffeur(s) sans équipe` : 'Tous rattachés à une équipe'} tone={tableau.requetes.delaiMoyenHeures > 72 ? 'red' : 'green'} />
        </div>
      )}

      {/* Ce qui attend un geste, en haut : c'est la raison d'ouvrir la session. */}
      {tableau && (tableau.attente.aInstruire.length + tableau.attente.aDecider.length + tableau.attente.aVerser.length) > 0 && (
        <FileRequetes
          attente={tableau.attente}
          droits={droits}
          onOuvrir={onOuvrir}
          onInstruire={onInstruire}
          onDecider={onDecider}
          onVerser={onVerser}
        />
      )}

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Équipages ORION</h3>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="adm-input"
              style={{ minWidth: 240 }}
              placeholder="Matricule, nom ou téléphone…"
              value={q}
              onChange={(e) => { setQ(e.target.value); onRechercher(e.target.value); }}
            />
            <span className="adm-muted">{total && total > lignes.length
              ? `${lignes.length} premiers sur ${total.toLocaleString('fr-FR')} chauffeurs : affinez la recherche`
              : `${lignes.length} chauffeur(s)`}</span>
          </div>
        </div>
        {lignes.length === 0 ? (
          <p className="adm-empty">Aucun chauffeur ne correspond.</p>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Matricule</th><th>Chauffeur</th><th>Équipe</th><th>État</th>
                <th className="r">Courses</th><th className="r">Revenus</th><th className="r">Reste dû</th>
                <th>Requêtes</th><th>Accès</th><th>Dossier</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.driverId}>
                  <td className="mono"><strong>{l.matricule}</strong></td>
                  <td>
                    {l.name}
                    <br />
                    <ContactRapide type="chauffeur" id={l.driverId} numero={l.phone} nom={l.name} onContact={onContact} />
                  </td>
                  <td className="adm-muted">{l.teamName ?? <span className="adm-pill lvl-jaune">Sans équipe</span>}</td>
                  <td>
                    <span className={`adm-status ${l.availability}`}>{availLabel(l.availability)}</span>
                    {l.kycStatus !== 'active' && l.kycStatus !== 'approved' && (
                      <><br /><span className="adm-pill lvl-orange">{kycLabel(l.kycStatus)}</span></>
                    )}
                  </td>
                  <td className="r">{l.courses}</td>
                  <td className="r">{fcfa(l.revenus)}</td>
                  <td className={`r ${l.resteDu > 0 ? 'neg' : ''}`}>{l.resteDu > 0 ? fcfa(l.resteDu) : '—'}</td>
                  <td>{l.requetesOuvertes > 0 ? <span className="adm-pill tr-pending">{l.requetesOuvertes} en cours</span> : <span className="adm-muted">—</span>}</td>
                  <td>
                    {l.aUnAcces
                      ? <span className="adm-pill av-online">Oui</span>
                      : droits.comptes
                        ? <button className="adm-btn xs" onClick={() => onCreerAcces(l.driverId, l.name, l.matricule)}>Créer</button>
                        : <span className="adm-muted">Non</span>}
                  </td>
                  <td><button className="adm-btn xs solid" onClick={() => onOuvrir(l.driverId)}>Ouvrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dossier && (
        <DossierChauffeur
          d={dossier}
          droits={droits}
          onFermer={onFermer}
          onContact={onContact}
          onDeposer={onDeposer}
          onInstruire={onInstruire}
          onDecider={onDecider}
          onVerser={onVerser}
          onRembourser={onRembourser}
        />
      )}
    </>
  );
}

/* ------------------- Ce qui attend un geste, par étape ------------------- */
function FileRequetes({ attente, droits, onOuvrir, onInstruire, onDecider, onVerser }: {
  attente: CrewTableau['attente'];
  droits: { instruire: boolean; decider: boolean; verser: boolean };
  onOuvrir: (driverId: string) => void;
  onInstruire: (id: string, avis: 'favorable' | 'defavorable', note: string) => void;
  onDecider: (id: string, decision: 'accord' | 'refus', montantAccorde: number | undefined, note: string) => void;
  onVerser: (id: string, canal: string) => void;
}) {
  const colonnes: Array<{ titre: string; aide: string; liste: RequeteChauffeur[]; actif: boolean; rendu: (r: RequeteChauffeur) => JSX.Element }> = [
    {
      titre: 'À instruire', aide: 'avis du chef d’équipe', liste: attente.aInstruire, actif: droits.instruire,
      rendu: (r) => (
        <div className="row" style={{ gap: 6 }}>
          <button className="adm-btn xs solid" onClick={() => onInstruire(r.id, 'favorable', prompt('Avis favorable — motif :') ?? '')}>Favorable</button>
          <button className="adm-btn xs" onClick={() => onInstruire(r.id, 'defavorable', prompt('Avis défavorable — motif :') ?? '')}>Défavorable</button>
        </div>
      ),
    },
    {
      titre: 'À décider', aide: 'direction financière', liste: attente.aDecider, actif: droits.decider,
      rendu: (r) => (
        <div className="row" style={{ gap: 6 }}>
          <button
            className="adm-btn xs solid"
            onClick={() => {
              // Accorder moins que demandé est une décision, pas un refus déguisé.
              const saisi = prompt(`Montant accordé (demandé : ${r.montant ? fcfa(r.montant) : '—'}) :`, String(r.montant ?? ''));
              if (saisi === null) return;
              onDecider(r.id, 'accord', saisi ? Number(saisi) : undefined, prompt('Note de décision :') ?? '');
            }}
          >
            Accorder
          </button>
          <button className="adm-btn xs" onClick={() => onDecider(r.id, 'refus', undefined, prompt('Motif du refus :') ?? '')}>Refuser</button>
        </div>
      ),
    },
    {
      titre: 'À verser', aide: 'trésorerie', liste: attente.aVerser, actif: droits.verser,
      rendu: (r) => (
        <button
          className="adm-btn xs solid"
          onClick={() => {
            const canal = prompt('Canal de versement (espèces, orange_money, wave, mtn_momo, virement) :', 'orange_money');
            if (canal) onVerser(r.id, canal);
          }}
        >
          Verser {r.montantAccorde ? fcfa(r.montantAccorde) : ''}
        </button>
      ),
    },
  ];

  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Requêtes en attente</h3>
        <span className="adm-muted">un chauffeur sans réponse cesse de demander, puis de faire confiance</span>
      </div>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {colonnes.map((c) => (
          <div key={c.titre} style={{ flex: 1, minWidth: 280 }}>
            <p className="adm-muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
              <strong>{c.titre}</strong> — {c.aide} ({c.liste.length})
            </p>
            {c.liste.length === 0 ? (
              <p className="adm-muted" style={{ fontSize: 12.5 }}>Rien en attente ✅</p>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {c.liste.slice(0, 6).map((r) => (
                  <div key={r.id} className="adm-role-card">
                    <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span>
                        <strong>{r.typeLabel}</strong>
                        {r.montant ? <> · {fcfa(r.montant)}</> : null}
                        <br />
                        <span className="adm-muted" style={{ fontSize: 12 }}>{r.driverName} · {r.matricule}</span>
                      </span>
                      <button className="adm-btn xs" onClick={() => onOuvrir(r.driverId)}>Dossier</button>
                    </div>
                    <p style={{ margin: '6px 0', fontSize: 12.5 }}>{r.motif}</p>
                    {r.avisNote && <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Avis {r.avis} — {r.avisNote}</p>}
                    {c.actif
                      ? c.rendu(r)
                      : <span className="adm-muted" style={{ fontSize: 12 }}>Vous n’avez pas ce droit.</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Dossier chauffeur ----------------------------- */
function DossierChauffeur({ d, droits, onFermer, onContact, onDeposer, onInstruire, onDecider, onVerser, onRembourser }: {
  d: DossierEquipage;
  droits: { instruire: boolean; decider: boolean; verser: boolean };
  onFermer: () => void;
  onContact: ContactHandler;
  onDeposer: (driverId: string, p: Record<string, unknown>) => void;
  onInstruire: (id: string, avis: 'favorable' | 'defavorable', note: string) => void;
  onDecider: (id: string, decision: 'accord' | 'refus', montantAccorde: number | undefined, note: string) => void;
  onVerser: (id: string, canal: string) => void;
  onRembourser: (id: string, montant: number) => void;
}) {
  const [type, setType] = useState('avance');
  const [montant, setMontant] = useState('');
  const [echeances, setEcheances] = useState('3');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [motif, setMotif] = useState('');

  const meta = useMemo(() => TYPES.find((t) => t.id === type) ?? TYPES[0]!, [type]);

  const deposer = () => {
    if (motif.trim().length < 3) { alert('Indiquez le motif de la requête.'); return; }
    onDeposer(d.identite.driverId, {
      type,
      montant: meta.montant && montant ? Number(montant) : undefined,
      echeances: meta.echeances ? Number(echeances) : undefined,
      du: meta.dates ? du : undefined,
      au: meta.dates ? au : undefined,
      motif: motif.trim(),
    });
    setMontant(''); setMotif(''); setDu(''); setAu('');
  };

  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>{d.identite.name} <span className="mono adm-muted">{d.identite.matricule}</span></h3>
        <div className="row" style={{ gap: 8 }}>
          <ContactRapide type="chauffeur" id={d.identite.driverId} numero={d.identite.phone} nom={d.identite.name} onContact={onContact} />
          <button className="adm-btn xs" onClick={onFermer}>Fermer</button>
        </div>
      </div>

      {d.alertes.length > 0 && (
        <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
          {d.alertes.map((a, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <span className={`adm-pill ${SEV_CLS[a.severite] ?? ''}`}>{SEV_LABEL[a.severite] ?? a.severite}</span>
              <span style={{ fontSize: 13 }}>{a.texte}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>IDENTITÉ & VÉHICULE</p>
          <dl className="adm-constat-corps">
            <dt>Gamme</dt><dd>{d.identite.category} · note {d.identite.rating.toFixed(1)} ({d.identite.trips} courses)</dd>
            <dt>Dossier</dt><dd>{kycLabel(d.identite.kycStatus)} · {availLabel(d.identite.availability)}</dd>
            <dt>Véhicule</dt><dd>{d.vehicule.model ?? 'non renseigné'} {d.vehicule.plate ? `· ${d.vehicule.plate}` : ''} {d.vehicule.color ? `· ${d.vehicule.color}` : ''}</dd>
            <dt>Batterie</dt><dd>{d.vehicule.batteryPct !== undefined ? `${d.vehicule.batteryPct} %` : '—'}{d.vehicule.batteryHealthPct !== undefined ? ` · santé ${d.vehicule.batteryHealthPct} %` : ''}</dd>
            <dt>Assurance</dt><dd>{d.identite.insuranceExpiry ?? 'non renseignée'}</dd>
            <dt>Équipe</dt><dd>{d.equipe ? <>{d.equipe.name}{d.equipe.mission ? ` — ${d.equipe.mission}` : ''}<br /><span className="adm-muted">chef : {d.equipe.managerName ?? d.equipe.managerUsername}</span></> : 'Non rattaché'}</dd>
            <dt>Accès console</dt><dd>{d.acces ? <>{d.acces.username} · {d.acces.active ? 'actif' : 'désactivé'}{d.acces.lastLoginAt ? ` · dernière connexion ${dt(d.acces.lastLoginAt)}` : ' · jamais connecté'}</> : 'Aucun'}</dd>
          </dl>
        </div>

        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>ACTIVITÉ SUR {d.activite.periodeJours} JOURS</p>
          <dl className="adm-constat-corps">
            <dt>Courses</dt><dd>{d.activite.courses} terminées · {d.activite.coursesAnnulees} annulées · {d.activite.kilometres} km</dd>
            <dt>Jours travaillés</dt><dd>{d.activite.joursTravailles}</dd>
            <dt>Note période</dt><dd>{d.activite.nbNotes > 0 ? `${d.activite.noteMoyenne.toFixed(1)} (${d.activite.nbNotes} avis)` : 'aucun avis'}</dd>
            <dt>Ses revenus</dt><dd className="pos">{fcfa(d.activite.revenus)}</dd>
            <dt>Commission ORION</dt><dd>{fcfa(d.activite.commissionVersee)}</dd>
          </dl>

          <p className="adm-muted" style={{ margin: '10px 0 6px', fontSize: 12 }}>ARGENT</p>
          <dl className="adm-constat-corps">
            <dt>Solde portefeuille</dt><dd className={d.argent.solde < 0 ? 'neg' : 'pos'}>{fcfa(d.argent.solde)}</dd>
            <dt>Dette espèces</dt><dd className={d.argent.detteEspeces > 0 ? 'neg' : ''}>{fcfa(d.argent.detteEspeces)}<br /><span className="adm-muted" style={{ fontSize: 11.5 }}>commission encaissée en liquide, jamais passée en caisse</span></dd>
            <dt>Prêts & avances</dt><dd className={d.argent.resteDu > 0 ? 'neg' : ''}>{d.argent.resteDu > 0 ? `${fcfa(d.argent.resteDu)} restant dû` : 'rien en cours'}</dd>
          </dl>
        </div>
      </div>

      {/* Dépôt d'une requête : au guichet, ou par le chauffeur lui-même. */}
      <div className="adm-card" style={{ margin: '14px 0 0', background: 'transparent' }}>
        <div className="adm-card-h"><h3>Déposer une requête</h3><span className="adm-muted">prêt, avance, congé, matériel, réclamation…</span></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ minWidth: 190 }}>
            <span>Type</span>
            <select className="adm-select" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          {meta.montant && (
            <label className="field" style={{ maxWidth: 150 }}>
              <span>Montant (F)</span>
              <input className="adm-input adm-input-num" type="number" min={0} value={montant} onChange={(e) => setMontant(e.target.value)} />
            </label>
          )}
          {meta.echeances && (
            <label className="field" style={{ maxWidth: 120 }}>
              <span>Échéances</span>
              <input className="adm-input adm-input-num" type="number" min={1} max={12} value={echeances} onChange={(e) => setEcheances(e.target.value)} />
            </label>
          )}
          {meta.dates && (
            <>
              <label className="field" style={{ maxWidth: 160 }}><span>Du</span><input className="adm-input" type="date" value={du} onChange={(e) => setDu(e.target.value)} /></label>
              <label className="field" style={{ maxWidth: 160 }}><span>Au</span><input className="adm-input" type="date" value={au} onChange={(e) => setAu(e.target.value)} /></label>
            </>
          )}
          <label className="field grow" style={{ minWidth: 240 }}>
            <span>Motif</span>
            <input className="adm-input" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. réparation de la toiture avant les pluies" />
          </label>
          <button className="adm-btn solid" onClick={deposer}>Déposer</button>
        </div>
      </div>

      {d.requetes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>SES REQUÊTES ({d.requetes.length})</p>
          <div className="stack" style={{ gap: 10 }}>
            {d.requetes.map((r) => (
              <div key={r.id} className="adm-role-card">
                <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong>{r.typeLabel}</strong>
                    <span className={`adm-pill ${STATUT_CLS[r.statut] ?? ''}`}>{r.statutLabel}</span>
                    {r.montantAccorde !== undefined && r.montant !== undefined && r.montantAccorde !== r.montant && (
                      <span className="adm-muted" style={{ fontSize: 12 }}>demandé {fcfa(r.montant)} · accordé {fcfa(r.montantAccorde)}</span>
                    )}
                    {r.montantAccorde === undefined && r.montant !== undefined && <span>{fcfa(r.montant)}</span>}
                  </span>
                  <span className="adm-muted" style={{ fontSize: 12 }}>{dt(r.createdAt)}</span>
                </div>
                <p style={{ margin: '6px 0', fontSize: 13 }}>{r.motif}</p>
                {r.du && <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>Du {jour(r.du)} au {r.au ? jour(r.au) : '—'}</p>}
                {r.avisNote && <p className="adm-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Avis {r.avis} de {r.avisPar} : {r.avisNote}</p>}
                {r.decisionNote && <p className="adm-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Décision de {r.decidePar} : {r.decisionNote}</p>}
                {r.verseLe && <p className="adm-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Versé le {dt(r.verseLe)} par {r.versePar} ({r.canalVersement})</p>}

                {r.plan && r.plan.length > 0 && (
                  <table className="adm-table sm" style={{ marginTop: 8 }}>
                    <thead><tr><th>Échéance</th><th className="r">Montant</th><th>Due le</th><th>État</th></tr></thead>
                    <tbody>
                      {r.plan.map((e) => (
                        <tr key={e.numero}>
                          <td>{e.numero}</td>
                          <td className="r">{fcfa(e.montant)}</td>
                          <td>{jour(e.dueDate)}</td>
                          <td>
                            {e.payeeLe
                              ? <span className="adm-pill tr-approved">Payée</span>
                              : Date.parse(e.dueDate) < Date.now()
                                ? <span className="adm-pill tr-rejected">En retard</span>
                                : <span className="adm-muted">À venir</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {r.statut === 'deposee' && droits.instruire && (
                    <>
                      <button className="adm-btn xs solid" onClick={() => onInstruire(r.id, 'favorable', prompt('Avis favorable — motif :') ?? '')}>Avis favorable</button>
                      <button className="adm-btn xs" onClick={() => onInstruire(r.id, 'defavorable', prompt('Avis défavorable — motif :') ?? '')}>Avis défavorable</button>
                    </>
                  )}
                  {r.statut === 'instruite' && droits.decider && (
                    <>
                      <button
                        className="adm-btn xs solid"
                        onClick={() => {
                          const saisi = prompt(`Montant accordé (demandé : ${r.montant ? fcfa(r.montant) : '—'}) :`, String(r.montant ?? ''));
                          if (saisi === null) return;
                          onDecider(r.id, 'accord', saisi ? Number(saisi) : undefined, prompt('Note de décision :') ?? '');
                        }}
                      >
                        Accorder
                      </button>
                      <button className="adm-btn xs" onClick={() => onDecider(r.id, 'refus', undefined, prompt('Motif du refus :') ?? '')}>Refuser</button>
                    </>
                  )}
                  {r.statut === 'accordee' && droits.verser && (
                    <button
                      className="adm-btn xs solid"
                      onClick={() => {
                        const canal = prompt('Canal de versement :', 'orange_money');
                        if (canal) onVerser(r.id, canal);
                      }}
                    >
                      Verser
                    </button>
                  )}
                  {r.statut === 'versee' && r.plan && droits.verser && (
                    <button
                      className="adm-btn xs"
                      onClick={() => {
                        const m = prompt('Montant remboursé (F) :');
                        if (m) onRembourser(r.id, Number(m));
                      }}
                    >
                      Enregistrer un remboursement
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 14 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>DERNIÈRES ÉCRITURES</p>
          <ul className="adm-conv-list">
            {d.argent.dernieresEcritures.length === 0 && <li><span className="adm-muted">Aucune écriture.</span></li>}
            {d.argent.dernieresEcritures.map((e, i) => (
              <li key={i}>
                <span>{e.note || e.type}</span>
                <span className={e.amount < 0 ? 'neg' : 'pos'}>{fcfa(e.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>LITIGES & MAINTENANCE</p>
          <ul className="adm-conv-list">
            {d.litiges.length === 0 && d.maintenance.length === 0 && <li><span className="adm-muted">Rien à signaler ✅</span></li>}
            {d.litiges.map((l) => <li key={l.id}><span>⚖️ {l.description.slice(0, 60)}</span><span className="adm-pill">{l.status}</span></li>)}
            {d.maintenance.map((m) => <li key={m.id}><span>🔧 {m.title}</span><span className="adm-pill">{m.status}</span></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
