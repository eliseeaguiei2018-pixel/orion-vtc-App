import { useMemo, useState } from 'react';
import { fcfa } from '../api';
import { Kpi } from '../ui';
import type { ExecutiveBoard, Mouvement, MouvementPage } from '../types';

/**
 * SESSION DIRECTION GÉNÉRALE — le poste de travail du PDG.
 *
 * Les chiffres d'ORION vivaient éclatés : les courses dans une session, les
 * abonnements dans une autre, les locations, les notes de frais, les virements et les
 * litiges chacun chez eux. Chaque directeur voyait sa part, personne ne voyait le tout.
 *
 * Cette session ne fait pas que montrer des chiffres : elle met en haut ce qui ATTEND
 * une décision du PDG, puis ce qui demande son attention, puis le détail de chaque
 * mouvement d'argent. On ouvre sa session et on sait quoi faire.
 */

const CAT_LABEL: Record<string, string> = {
  course: 'Courses', livraison: 'Livraisons', abonnement: 'Abonnements', location: 'Locations',
  entreprise: 'Comptes entreprise', reversement_chauffeur: 'Reversements chauffeurs',
  note_de_frais: 'Notes de frais', virement: 'Virements', remboursement: 'Remboursements litiges',
  assurance: 'ORION Assurance',
};

const TYPE_DECISION: Record<string, string> = {
  virement: '🏦 Virement', note_de_frais: '🧾 Note de frais', litige: '⚖️ Litige',
  impaye: '💳 Impayé', tarif: '🏷️ Tarif', securite: '🛑 Sécurité',
};

const GRAVITE_CLS: Record<string, string> = {
  critique: 'lvl-rouge', attention: 'lvl-orange', info: '',
};

const dt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const jourCourt = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/** Courbe entrées / sorties : le pouls de la trésorerie, lisible d'un coup d'œil. */
function CourbeTresorerie({ serie }: { serie: ExecutiveBoard['serie'] }) {
  const max = Math.max(1, ...serie.map((d) => Math.max(d.entrees, d.sorties)));
  const W = 760;
  const H = 150;
  const pas = serie.length > 1 ? W / (serie.length - 1) : W;
  const ligne = (cle: 'entrees' | 'sorties') =>
    serie.map((d, i) => `${i === 0 ? 'M' : 'L'} ${(i * pas).toFixed(1)} ${(H - (d[cle] / max) * (H - 12)).toFixed(1)}`).join(' ');

  return (
    <div className="adm-courbe">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 150 }} role="img"
        aria-label="Entrées et sorties quotidiennes">
        <path d={ligne('entrees')} fill="none" stroke="var(--a-green2)" strokeWidth={2} />
        <path d={ligne('sorties')} fill="none" stroke="#ff6470" strokeWidth={2} strokeDasharray="4 3" />
      </svg>
      <div className="row between" style={{ fontSize: 11.5, marginTop: 4 }}>
        <span className="adm-muted">{serie[0] ? jourCourt(serie[0].date) : ''}</span>
        <span>
          <span style={{ color: 'var(--a-green2)' }}>— Entrées</span>{'  '}
          <span style={{ color: '#ff6470' }}>-- Sorties</span>{'  '}
          <span className="adm-muted">max {fcfa(max)}</span>
        </span>
        <span className="adm-muted">{serie.length ? jourCourt(serie[serie.length - 1]!.date) : ''}</span>
      </div>
    </div>
  );
}

export function DirectionSection({ board, livre, jours, onJours, canAct, onAller, onPageLivre, onFiltreLivre, onExportCsv, onRapportPdf }: {
  board: ExecutiveBoard | null;
  livre: MouvementPage | null;
  jours: number;
  onJours: (j: number) => void;
  canAct: boolean;
  /** Ouvre la session où la décision se traite réellement. */
  onAller: (section: string) => void;
  onPageLivre: (p: number) => void;
  onFiltreLivre: (f: { sens?: 'entree' | 'sortie'; categorie?: string }) => void;
  onExportCsv: () => void;
  onRapportPdf: () => void;
}) {
  const [sens, setSens] = useState<'' | 'entree' | 'sortie'>('');
  const [categorie, setCategorie] = useState('');

  const categories = useMemo(
    () => Object.keys(board?.consolidation.parCategorie ?? {}).sort((a, b) => (CAT_LABEL[a] ?? a).localeCompare(CAT_LABEL[b] ?? b, 'fr')),
    [board],
  );

  if (!board) return <p className="adm-muted">Consolidation en cours…</p>;
  const c = board.consolidation;

  const appliquerFiltre = (s: typeof sens, cat: string) => {
    setSens(s); setCategorie(cat);
    onFiltreLivre({ sens: s || undefined, categorie: cat || undefined });
  };

  return (
    <>
      {/* 1. CE QUI ATTEND LE PDG — en premier, avant tout chiffre. */}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Ce qui attend votre décision</h3>
          <span className="adm-muted">{board.decisions.length} dossier(s)</span>
        </div>
        {board.decisions.length === 0 ? (
          <p className="adm-empty">Rien ne vous est bloqué. ✅</p>
        ) : (
          <table className="adm-table">
            <thead><tr><th>Type</th><th>Dossier</th><th className="r">Montant</th><th>En attente depuis</th><th>Traiter</th></tr></thead>
            <tbody>
              {board.decisions.map((d) => (
                <tr key={`${d.type}-${d.id}`}>
                  <td>{TYPE_DECISION[d.type] ?? d.type}</td>
                  <td>{d.libelle}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>{d.montant ? fcfa(d.montant) : '—'}</td>
                  <td className="adm-muted">{dt(d.depuis)}</td>
                  <td><button className="adm-btn xs solid" onClick={() => onAller(d.section)}>Ouvrir la session</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 2. ALERTES */}
      {board.alertes.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Alertes de direction</h3></div>
          <div className="adm-alert-list">
            {board.alertes.map((a) => (
              <div key={a.id} className={`adm-alert ${GRAVITE_CLS[a.gravite] ?? ''}`}>
                <div className="adm-alert-top">
                  <span className={`adm-pill ${GRAVITE_CLS[a.gravite] ?? ''}`}>{a.gravite.toUpperCase()}</span>
                  <strong>{a.titre}</strong>
                </div>
                <div className="adm-alert-meta">{a.detail}</div>
                {a.section && (
                  <div className="adm-alert-actions">
                    <button className="adm-btn xs" onClick={() => onAller(a.section!)}>Aller à la session concernée</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. CONSOLIDATION */}
      <div className="adm-kpis">
        <Kpi label="Entrées en caisse" value={fcfa(c.entrees)} sub={`sur ${jours} jours`} tone="green" />
        <Kpi label="Sorties de caisse" value={fcfa(c.sorties)} sub="reversements, virements, frais" tone={c.sorties > c.entrees ? 'red' : 'blue'} />
        <Kpi label="Solde de la période" value={fcfa(c.solde)} sub={c.solde >= 0 ? 'excédent' : 'déficit'} tone={c.solde >= 0 ? 'green' : 'red'} />
        <Kpi label="Revenu ORION" value={fcfa(c.revenu)} sub={`GMV ${fcfa(c.gmv)}`} tone="green" />
      </div>
      <div className="adm-kpis">
        <Kpi label="Revenu récurrent" value={fcfa(c.mrr)} sub="abonnements actifs / mois" tone="green" />
        <Kpi label="Dû aux chauffeurs" value={fcfa(c.dusChauffeurs)} sub="soldes non encore retirés" tone="blue" />
        <Kpi label="Espèces chez les chauffeurs" value={fcfa(c.especesChauffeurs)} sub={`${fcfa(c.dettesEspeces)} de commission due`} tone={c.dettesEspeces > 0 ? 'red' : 'blue'} />
        <Kpi label="TVA collectée" value={fcfa(c.tvaCollectee)} sub="à reverser à l’État — pas du revenu" tone="blue" />
      </div>

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Pouls de la trésorerie</h3>
          <div className="row" style={{ gap: 8 }}>
            {[7, 30, 90].map((j) => (
              <button key={j} className={`adm-btn xs${j === jours ? ' solid' : ''}`} onClick={() => onJours(j)}>{j} j</button>
            ))}
            <button className="adm-btn xs" onClick={onExportCsv}>⬇ Grand livre (CSV)</button>
            <button className="adm-btn xs solid" onClick={onRapportPdf}>⬇ Rapport exécutif (PDF)</button>
          </div>
        </div>
        <CourbeTresorerie serie={board.serie} />
        <p className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>
          Les courses réglées <strong>en espèces</strong> n’apparaissent pas en entrée : l’argent va
          du client au chauffeur en main propre, ORION ne reçoit rien et le chauffeur lui doit la
          commission. Les compter en caisse gonflerait une trésorerie qui n’existe pas.
        </p>
      </div>

      {/* 4. RÉPARTITION */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Répartition par nature</h3></div>
        <table className="adm-table">
          <thead><tr><th>Nature</th><th className="r">Entrées</th><th className="r">Sorties</th><th className="r">Net</th><th className="r">Mouvements</th><th>Détail</th></tr></thead>
          <tbody>
            {categories.map((cat) => {
              const v = c.parCategorie[cat]!;
              return (
                <tr key={cat}>
                  <td><strong>{CAT_LABEL[cat] ?? cat}</strong></td>
                  <td className="r pos">{v.entrees ? fcfa(v.entrees) : '—'}</td>
                  <td className="r neg">{v.sorties ? fcfa(v.sorties) : '—'}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>{fcfa(v.entrees - v.sorties)}</td>
                  <td className="r">{v.nombre}</td>
                  <td><button className="adm-btn xs" onClick={() => appliquerFiltre('', cat)}>Voir les lignes</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 5. GRAND LIVRE */}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Grand livre — chaque mouvement d’argent</h3>
          <div className="row" style={{ gap: 8 }}>
            <select className="adm-select" value={sens} onChange={(e) => appliquerFiltre(e.target.value as typeof sens, categorie)}>
              <option value="">Entrées et sorties</option>
              <option value="entree">Entrées seules</option>
              <option value="sortie">Sorties seules</option>
            </select>
            <select className="adm-select" value={categorie} onChange={(e) => appliquerFiltre(sens, e.target.value)}>
              <option value="">Toutes natures</option>
              {categories.map((cat) => <option key={cat} value={cat}>{CAT_LABEL[cat] ?? cat}</option>)}
            </select>
            <span className="adm-muted">{livre?.total ?? 0} ligne(s)</span>
          </div>
        </div>
        {!livre || livre.mouvements.length === 0 ? (
          <p className="adm-empty">Aucun mouvement sur cette période.</p>
        ) : (
          <>
            <table className="adm-table">
              <thead><tr><th>Date</th><th>Nature</th><th>Libellé</th><th>Contrepartie</th><th className="r">Montant</th><th>Caisse</th><th>Référence</th></tr></thead>
              <tbody>
                {livre.mouvements.map((m: Mouvement) => (
                  <tr key={m.id}>
                    <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{dt(m.at)}</td>
                    <td>{CAT_LABEL[m.categorie] ?? m.categorie}</td>
                    <td>{m.libelle}{m.statut && <><br /><span className="adm-muted">{m.statut}</span></>}</td>
                    <td className="adm-muted">{m.contrepartie ?? '—'}</td>
                    <td className={`r ${m.sens === 'entree' ? 'pos' : 'neg'}`} style={{ whiteSpace: 'nowrap' }}>
                      {m.sens === 'entree' ? '+' : '−'} {fcfa(m.montant)}
                    </td>
                    <td>
                      {m.sens === 'sortie' || m.enCaisse
                        ? <span className="adm-pill av-online">Caisse</span>
                        : <span className="adm-pill kyc-manual_review" title="Encaissé en main propre par le chauffeur">Hors caisse</span>}
                    </td>
                    <td className="mono adm-muted">{m.reference?.slice(0, 10) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="adm-pager">
              <span className="adm-muted">
                Total du filtre : <strong style={{ color: 'var(--a-green)' }}>+{fcfa(livre.entrees)}</strong> en caisse ·
                <strong style={{ color: 'var(--a-amber)' }}> −{fcfa(livre.sorties)}</strong> de sorties · page {livre.page} / {livre.pages}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button className="adm-btn xs" disabled={livre.page <= 1} onClick={() => onPageLivre(livre.page - 1)}>← Précédent</button>
                <button className="adm-btn xs" disabled={livre.page >= livre.pages} onClick={() => onPageLivre(livre.page + 1)}>Suivant →</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 6. DÉCISIONS DES DIRECTEURS */}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Décisions récentes des directeurs</h3>
          <span className="adm-muted">tarifs, zones, commissions, suspensions, trésorerie</span>
        </div>
        {board.recentes.length === 0 ? <p className="adm-muted">Aucune décision sensible récente.</p> : (
          <table className="adm-table sm">
            <thead><tr><th>Date</th><th>Auteur</th><th>Rôle</th><th>Décision</th><th>Détail</th></tr></thead>
            <tbody>
              {board.recentes.map((r, i) => (
                <tr key={i}>
                  <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{dt(r.at)}</td>
                  <td><strong>{r.actor}</strong></td>
                  <td className="adm-muted">{r.role}</td>
                  <td className="mono">{r.action}</td>
                  <td className="adm-muted" style={{ fontSize: 11.5 }}>
                    {r.details ? Object.entries(r.details).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 7. EFFECTIF */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>ORION en un coup d’œil</h3><span className="adm-muted">au {dt(board.generatedAt)}</span></div>
        <div className="adm-mini-kpis">
          <div className="adm-mini-kpi"><span>Employés console</span><strong>{board.effectif.employes}</strong></div>
          <div className="adm-mini-kpi"><span>Chauffeurs</span><strong>{board.effectif.chauffeurs}</strong></div>
          <div className="adm-mini-kpi"><span>En ligne maintenant</span><strong>{board.effectif.chauffeursEnLigne}</strong></div>
          <div className="adm-mini-kpi"><span>Clients</span><strong>{board.effectif.clients}</strong></div>
          <div className="adm-mini-kpi"><span>Abonnés actifs</span><strong>{board.effectif.abonnes}</strong></div>
          <div className="adm-mini-kpi"><span>Encours entreprises</span><strong>{fcfa(c.encoursEntreprises)}</strong></div>
        </div>
        {!canAct && (
          <p className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>
            Vous consultez cette session en lecture. Les décisions se prennent depuis les sessions concernées.
          </p>
        )}
      </div>
    </>
  );
}
