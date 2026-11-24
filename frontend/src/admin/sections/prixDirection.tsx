import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminError, LIVE, adminGet, adminPost } from '../api';

/**
 * PRIX DES COURSES ET DES LIVRAISONS — réglage de la direction, dans Mon poste du PDG.
 *
 * Un seul curseur monte ou baisse TOUS les prix des courses et des livraisons d'un pourcentage. Il s'applique au
 * prix de l'Argent ; l'Or et le Diamant gardent leur écart de la grille ORION (+5 % et +15 %,
 * +10 % et +20 % hors d'Abidjan), réglable ici aussi. Le serveur l'applique à chaque nouveau
 * devis : les apps client et chauffeur suivent aussitôt, sans nouvelle version. Les courses
 * déjà commandées gardent leur prix fixe.
 */
interface Grille { or: number; diamant: number }
interface EtatPrix {
  ajustementPct: number;
  bornes: { min: number; max: number };
  majorationsPct: Grille;
  majorationsPctHorsAbidjan: Grille;
  modifie: { le: string; par: string } | null;
  exemples: Array<{ trajet: string; km: number; prix: Record<'argent' | 'or' | 'diamant', number>; sansAjustement: Record<'argent' | 'or' | 'diamant', number> }>;
  /** Le même réglage s'applique aux livraisons (moto express et voiture, livrées dès que possible). */
  livraisons?: Array<{ trajet: string; prix: Record<'moto' | 'voiture', number>; sansAjustement: Record<'moto' | 'voiture', number> }>;
}

const fcfa = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n)} F`;
const arrondi50 = (n: number) => Math.round(n / 50) * 50;
const signe = (p: number) => (p > 0 ? `+${p}` : `${p}`).replace('.', ',');

/** Aperçu local (même règle que le serveur) : Argent ajusté, puis supplément de chaque gamme. */
function apercu(argentBase: number, pct: number, g: Grille): Record<'argent' | 'or' | 'diamant', number> {
  const argent = arrondi50(argentBase * (1 + pct / 100));
  const supOr = g.or > 0 ? Math.max(arrondi50((argent * g.or) / 100), 50) : 0;
  const calculeD = arrondi50((argent * g.diamant) / 100);
  const supDiamant = g.diamant > g.or ? Math.max(calculeD, supOr + 50) : calculeD;
  return { argent, or: argent + supOr, diamant: argent + supDiamant };
}

export function PrixDirection() {
  const [etat, setEtat] = useState<EtatPrix | null>(null);
  const [pct, setPct] = useState(0);
  const [grille, setGrille] = useState<Grille>({ or: 5, diamant: 15 });
  const [grilleHors, setGrilleHors] = useState<Grille>({ or: 10, diamant: 20 });
  const [confirmer, setConfirmer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null);

  const recevoir = useCallback((e: EtatPrix) => {
    setEtat(e); setPct(e.ajustementPct); setGrille(e.majorationsPct); setGrilleHors(e.majorationsPctHorsAbidjan);
  }, []);
  useEffect(() => {
    if (!LIVE) return;
    void adminGet<EtatPrix>('/admin/direction/prix').then(recevoir).catch(() => setMessage({ texte: 'Le serveur n’a pas répondu.', erreur: true }));
  }, [recevoir]);

  const modifie = etat !== null && (pct !== etat.ajustementPct || grille.or !== etat.majorationsPct.or || grille.diamant !== etat.majorationsPct.diamant
    || grilleHors.or !== etat.majorationsPctHorsAbidjan.or || grilleHors.diamant !== etat.majorationsPctHorsAbidjan.diamant);
  const grilleValide = grille.diamant >= grille.or && grilleHors.diamant >= grilleHors.or;
  const lignes = useMemo(() => (etat?.exemples ?? []).map((ex) => ({ ...ex, nouveau: apercu(ex.sansAjustement.argent, pct, grille) })), [etat, pct, grille]);
  // Livraisons : le même pourcentage, sur le prix de base de chaque formule.
  const livraisons = useMemo(() => (etat?.livraisons ?? []).map((ex) => ({
    ...ex, nouveau: { moto: arrondi50(ex.sansAjustement.moto * (1 + pct / 100)), voiture: arrondi50(ex.sansAjustement.voiture * (1 + pct / 100)) },
  })), [etat, pct]);

  if (!LIVE) return null;
  const bornes = etat?.bornes ?? { min: -50, max: 100 };
  const borner = (v: number) => Math.min(bornes.max, Math.max(bornes.min, Math.round(v * 10) / 10));

  const appliquer = async (valeurs: { ajustementPct: number; majorationsPct: Grille; majorationsPctHorsAbidjan: Grille }) => {
    setEnvoi(true); setMessage(null);
    try {
      const e = await adminPost<EtatPrix>('/admin/direction/prix', valeurs);
      recevoir(e);
      setConfirmer(false);
      setMessage({ texte: `Appliqué : prix ${e.ajustementPct === 0 ? 'normaux' : `${signe(e.ajustementPct)} %`} sur toutes les nouvelles courses et livraisons. Les apps client et ORION Pro l’ont reçu.` });
    } catch (e) {
      setMessage({ texte: e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu. Rien n’a changé.', erreur: true });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="adm-card adm-prix-direction">
      <div className="adm-card-h">
        <h3>Prix des courses et livraisons</h3>
        <span className="adm-muted">réglage de la direction · effet immédiat sur toutes les apps</span>
      </div>

      <div className="adm-prix-reglage">
        <div className="adm-prix-valeur">
          <strong className={pct > 0 ? 'hausse' : pct < 0 ? 'baisse' : ''}>{pct === 0 ? 'Prix normaux' : `${signe(pct)} %`}</strong>
          <span className="adm-muted">{pct === 0 ? 'grille ORION sans ajustement' : pct > 0 ? 'courses et livraisons augmentent' : 'courses et livraisons baissent'}</span>
        </div>
        <div className="adm-prix-boutons" role="group" aria-label="Ajuster les prix">
          {[-5, -1, 1, 5].map((d) => (
            <button key={d} type="button" className="adm-btn" onClick={() => setPct((p) => borner(p + d))}>{d > 0 ? `+${d}` : d} %</button>
          ))}
        </div>
        <input type="range" className="adm-prix-curseur" min={-30} max={50} step={1} value={Math.max(-30, Math.min(50, pct))}
          onChange={(e) => setPct(borner(Number(e.target.value)))} aria-label="Ajustement des prix en pour cent" />
        <label className="adm-prix-saisie">Valeur exacte
          <input className="adm-input mono" inputMode="decimal" value={String(pct).replace('.', ',')}
            onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v)) setPct(borner(v)); }} />
          <span>%</span>
        </label>
      </div>

      <div className="adm-prix-grille">
        <div>
          <h4>Écart entre les gammes · Abidjan</h4>
          <p className="adm-muted">Grille ORION : Or +5 %, Diamant +15 % au-dessus de l’Argent.</p>
          <ChampPct libelle="Or" valeur={grille.or} onChange={(v) => setGrille((g) => ({ ...g, or: v }))} />
          <ChampPct libelle="Diamant" valeur={grille.diamant} onChange={(v) => setGrille((g) => ({ ...g, diamant: v }))} />
        </div>
        <div>
          <h4>Hors d’Abidjan</h4>
          <p className="adm-muted">Grille ORION : Or +10 %, Diamant +20 %.</p>
          <ChampPct libelle="Or" valeur={grilleHors.or} onChange={(v) => setGrilleHors((g) => ({ ...g, or: v }))} />
          <ChampPct libelle="Diamant" valeur={grilleHors.diamant} onChange={(v) => setGrilleHors((g) => ({ ...g, diamant: v }))} />
        </div>
      </div>
      {!grilleValide && <p className="adm-erreur" role="alert">Le Diamant doit rester au moins au niveau de l’Or.</p>}

      {lignes.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table adm-prix-exemples">
            <thead><tr><th>Trajet type (hors trafic et forte demande)</th><th>Argent</th><th>Or</th><th>Diamant</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.trajet}>
                  <td>{l.trajet} <span className="adm-muted">· {String(l.km).replace('.', ',')} km</span></td>
                  {(['argent', 'or', 'diamant'] as const).map((g) => (
                    <td key={g} className="mono">
                      <strong>{fcfa(l.nouveau[g])}</strong>
                      {l.nouveau[g] !== l.prix[g] && <span className="adm-prix-avant">{fcfa(l.prix[g])}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {livraisons.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table adm-prix-exemples">
            <thead><tr><th>Livraison, même trajet (dès que possible, sans option)</th><th>Moto express</th><th>Voiture</th></tr></thead>
            <tbody>
              {livraisons.map((l) => (
                <tr key={l.trajet}>
                  <td>{l.trajet}</td>
                  {(['moto', 'voiture'] as const).map((f) => (
                    <td key={f} className="mono">
                      <strong>{fcfa(l.nouveau[f])}</strong>
                      {l.nouveau[f] !== l.prix[f] && <span className="adm-prix-avant">{fcfa(l.prix[f])}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {etat?.modifie && <p className="adm-muted adm-prix-trace">Dernier réglage : {new Date(etat.modifie.le).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} par {etat.modifie.par}</p>}
      {message && <p className={message.erreur ? 'adm-erreur' : 'adm-ok'} role="status">{message.texte}</p>}

      {confirmer ? (
        <div className="adm-prix-confirmer" role="alertdialog" aria-label="Confirmer le changement de prix">
          <p><strong>{pct === 0 ? 'Revenir aux prix normaux' : `Prix ${signe(pct)} %`}</strong> pour toutes les nouvelles courses et livraisons, dès maintenant. Celles déjà commandées gardent leur prix.</p>
          <div className="adm-dialogue-actions">
            <button type="button" className="adm-btn" onClick={() => setConfirmer(false)} disabled={envoi}>Annuler</button>
            <button type="button" className="adm-btn solid" disabled={envoi}
              onClick={() => void appliquer({ ajustementPct: pct, majorationsPct: grille, majorationsPctHorsAbidjan: grilleHors })}>
              {envoi ? 'Application…' : 'Confirmer et appliquer'}
            </button>
          </div>
        </div>
      ) : (
        <div className="adm-dialogue-actions">
          {etat && etat.ajustementPct !== 0 && (
            <button type="button" className="adm-btn" disabled={envoi} onClick={() => { setPct(0); setConfirmer(true); }}>Revenir aux prix normaux</button>
          )}
          <button type="button" className="adm-btn solid" disabled={!modifie || !grilleValide || envoi} onClick={() => setConfirmer(true)}>Appliquer à toutes les courses</button>
        </div>
      )}
    </div>
  );
}

function ChampPct({ libelle, valeur, onChange }: { libelle: string; valeur: number; onChange: (v: number) => void }) {
  return (
    <label className="adm-prix-champ">
      <span>{libelle}</span>
      <input className="adm-input mono" inputMode="decimal" value={String(valeur).replace('.', ',')}
        onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v)) onChange(Math.min(100, Math.max(0, v))); }} />
      <span>%</span>
    </label>
  );
}
