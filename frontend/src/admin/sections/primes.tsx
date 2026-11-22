import { useEffect, useState } from 'react';
import { adminGet, adminPut, AdminError, fcfa, LIVE } from '../api';

/**
 * PRIMES DE PERFORMANCE — chauffeurs salariés.
 *
 * La direction règle la grille (paliers de courses, conditions de qualité, bonus) ; chaque
 * chauffeur voit sa progression en direct dans son app (onglet Prime). Ici : la prime estimée
 * de chaque chauffeur pour le mois, le total, et la grille elle-même.
 */
interface Grille {
  actif: boolean;
  paliers: Array<{ courses: number; montant: number }>;
  noteMin: number; tauxAcceptationMin: number; annulationsMax: number;
  bonusExcellence: { note: number; minNotes: number; montant: number };
  bonusAssiduite: { heures: number; montant: number };
}
interface LignePrime {
  id: string; name: string; matricule: string; category: string;
  courses: number; heures: number; note: number | null; tauxAcceptation: number | null; annulations: number;
  palier: { courses: number; montant: number } | null; conditionsTenues: boolean; montant: number;
}
interface Reponse { mois: string; grille: Grille; chauffeurs: LignePrime[]; total: number }

const DEMO: Reponse = {
  mois: new Date().toISOString().slice(0, 7),
  grille: {
    actif: true, paliers: [{ courses: 100, montant: 15000 }, { courses: 160, montant: 30000 }, { courses: 220, montant: 50000 }],
    noteMin: 4.6, tauxAcceptationMin: 85, annulationsMax: 4,
    bonusExcellence: { note: 4.9, minNotes: 30, montant: 10000 }, bonusAssiduite: { heures: 200, montant: 10000 },
  },
  chauffeurs: [
    { id: 'd1', name: 'Konan Yao', matricule: 'ORION-CI-4821', category: 'or', courses: 168, heures: 204, note: 4.92, tauxAcceptation: 93, annulations: 1, palier: { courses: 160, montant: 30000 }, conditionsTenues: true, montant: 50000 },
    { id: 'd2', name: 'Awa Diomandé', matricule: 'ORION-CI-3317', category: 'argent', courses: 121, heures: 176, note: 4.71, tauxAcceptation: 88, annulations: 2, palier: { courses: 100, montant: 15000 }, conditionsTenues: true, montant: 15000 },
    { id: 'd3', name: 'Serge Aka', matricule: 'ORION-CI-4820', category: 'diamant', courses: 97, heures: 150, note: 4.4, tauxAcceptation: 79, annulations: 6, palier: null, conditionsTenues: false, montant: 0 },
  ],
  total: 65000,
};

const libelleMois = (m: string) => {
  const [a, mm] = m.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(a, mm - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const decaler = (m: string, n: number) => {
  const [a, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, mm - 1 + n, 1)).toISOString().slice(0, 7);
};

export function PrimesSection({ peutRegler, version }: { peutRegler: boolean; version: number }) {
  const courant = new Date().toISOString().slice(0, 7);
  const [mois, setMois] = useState(courant);
  const [donnees, setDonnees] = useState<Reponse | null>(null);
  const [grille, setGrille] = useState<Grille | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!LIVE) { setDonnees(DEMO); setGrille((g) => g ?? DEMO.grille); return; }
    let actif = true;
    void adminGet<Reponse>(`/admin/primes?mois=${mois}`).then((r) => { if (actif) { setDonnees(r); setGrille((g) => g ?? r.grille); } }).catch(() => undefined);
    return () => { actif = false; };
  }, [mois, version]);

  const enregistrer = async () => {
    if (!grille) return;
    setEnvoi(true); setMessage('');
    try {
      if (LIVE) {
        const r = await adminPut<{ grille: Grille }>('/admin/primes/grille', grille);
        setGrille(r.grille);
        setDonnees(await adminGet<Reponse>(`/admin/primes?mois=${mois}`));
      }
      setMessage('Grille enregistrée : les chauffeurs voient la nouvelle grille dans leur app.');
    } catch (e) {
      setMessage(e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu.');
    } finally { setEnvoi(false); }
  };

  const majPalier = (i: number, champ: 'courses' | 'montant', v: number) =>
    setGrille((g) => (g ? { ...g, paliers: g.paliers.map((p, j) => (j === i ? { ...p, [champ]: v } : p)) } : g));
  const n = (v: string) => Number(v.replace(',', '.')) || 0;

  return (
    <>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Primes de performance</h3>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <button className="adm-btn xs" aria-label="Mois précédent" onClick={() => setMois(decaler(mois, -1))}>‹</button>
            <strong style={{ minWidth: 130, textAlign: 'center' }}>{libelleMois(mois)}</strong>
            <button className="adm-btn xs" aria-label="Mois suivant" disabled={mois >= courant} onClick={() => setMois(decaler(mois, 1))}>›</button>
          </div>
        </div>
        <div className="adm-mini-kpis">
          <div className="adm-mini-kpi"><span>Total estimé du mois</span><strong>{fcfa(donnees?.total ?? 0)}</strong></div>
          <div className="adm-mini-kpi"><span>Chauffeurs primés</span><strong>{donnees?.chauffeurs.filter((c) => c.montant > 0).length ?? 0} / {donnees?.chauffeurs.length ?? 0}</strong></div>
          <div className="adm-mini-kpi"><span>Conditions non tenues</span><strong>{donnees?.chauffeurs.filter((c) => !c.conditionsTenues).length ?? 0}</strong></div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="adm-table">
            <thead><tr><th>Chauffeur</th><th className="r">Courses</th><th className="r">Heures</th><th className="r">Note</th><th className="r">Acceptation</th><th className="r">Annul.</th><th>Palier</th><th className="r">Prime estimée</th></tr></thead>
            <tbody>
              {(donnees?.chauffeurs ?? []).map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong><br /><span className="adm-muted mono" style={{ fontSize: 11 }}>{c.matricule} · {c.category}</span></td>
                  <td className="r">{c.courses}</td>
                  <td className="r">{c.heures.toLocaleString('fr-FR')} h</td>
                  <td className="r">{c.note !== null ? `★ ${c.note.toFixed(2)}` : '—'}</td>
                  <td className="r">{c.tauxAcceptation !== null ? `${c.tauxAcceptation} %` : '—'}</td>
                  <td className="r">{c.annulations}</td>
                  <td>{c.palier ? `${c.palier.courses} courses` : <span className="adm-muted">—</span>}{!c.conditionsTenues && <><br /><span className="adm-pill tr-rejected" style={{ fontSize: 11 }}>Condition non tenue</span></>}</td>
                  <td className="r"><strong>{fcfa(c.montant)}</strong></td>
                </tr>
              ))}
              {donnees && donnees.chauffeurs.length === 0 && <tr><td colSpan={8} className="adm-muted">Aucun chauffeur validé pour le moment.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {grille && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Grille de la prime</h3><span className="adm-muted">{peutRegler ? 'Modifiable par la direction' : 'Lecture seule'}</span></div>
          <fieldset disabled={!peutRegler || envoi} style={{ border: 'none', padding: 0, margin: 0 }}>
            <label className="adm-case"><input type="checkbox" checked={grille.actif} onChange={(e) => setGrille({ ...grille, actif: e.target.checked })} /><span>Prime de performance active ce mois-ci</span></label>
            <div className="adm-muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>Paliers : nombre de courses réalisées dans le mois → montant (F CFA)</div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {grille.paliers.map((p, i) => (
                <div key={i} className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
                  <label className="price-field"><span>Courses</span><input type="number" min={1} value={p.courses} onChange={(e) => majPalier(i, 'courses', n(e.target.value))} /></label>
                  <label className="price-field"><span>Montant (F)</span><input type="number" min={0} step={500} value={p.montant} onChange={(e) => majPalier(i, 'montant', n(e.target.value))} /></label>
                  {grille.paliers.length > 1 && <button type="button" className="adm-btn xs" aria-label="Retirer ce palier" onClick={() => setGrille({ ...grille, paliers: grille.paliers.filter((_, j) => j !== i) })}>Retirer</button>}
                </div>
              ))}
              {grille.paliers.length < 8 && <button type="button" className="adm-btn xs" onClick={() => setGrille({ ...grille, paliers: [...grille.paliers, { courses: (grille.paliers[grille.paliers.length - 1]?.courses ?? 100) + 60, montant: (grille.paliers[grille.paliers.length - 1]?.montant ?? 15000) + 15000 }] })}>Ajouter un palier</button>}
            </div>
            <div className="adm-muted" style={{ fontSize: 12, margin: '14px 0 8px' }}>Conditions de qualité (toutes requises)</div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <label className="price-field"><span>Note moyenne minimale</span><input type="number" min={0} max={5} step={0.1} value={grille.noteMin} onChange={(e) => setGrille({ ...grille, noteMin: n(e.target.value) })} /></label>
              <label className="price-field"><span>Acceptation minimale (%)</span><input type="number" min={0} max={100} value={grille.tauxAcceptationMin} onChange={(e) => setGrille({ ...grille, tauxAcceptationMin: n(e.target.value) })} /></label>
              <label className="price-field"><span>Annulations tolérées</span><input type="number" min={0} max={100} value={grille.annulationsMax} onChange={(e) => setGrille({ ...grille, annulationsMax: n(e.target.value) })} /></label>
            </div>
            <div className="adm-muted" style={{ fontSize: 12, margin: '14px 0 8px' }}>Bonus</div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <label className="price-field"><span>Excellence : note ≥</span><input type="number" min={0} max={5} step={0.1} value={grille.bonusExcellence.note} onChange={(e) => setGrille({ ...grille, bonusExcellence: { ...grille.bonusExcellence, note: n(e.target.value) } })} /></label>
              <label className="price-field"><span>sur au moins (notes)</span><input type="number" min={0} value={grille.bonusExcellence.minNotes} onChange={(e) => setGrille({ ...grille, bonusExcellence: { ...grille.bonusExcellence, minNotes: n(e.target.value) } })} /></label>
              <label className="price-field"><span>Montant (F)</span><input type="number" min={0} step={500} value={grille.bonusExcellence.montant} onChange={(e) => setGrille({ ...grille, bonusExcellence: { ...grille.bonusExcellence, montant: n(e.target.value) } })} /></label>
              <label className="price-field"><span>Assiduité : heures en service ≥</span><input type="number" min={0} max={744} value={grille.bonusAssiduite.heures} onChange={(e) => setGrille({ ...grille, bonusAssiduite: { ...grille.bonusAssiduite, heures: n(e.target.value) } })} /></label>
              <label className="price-field"><span>Montant (F)</span><input type="number" min={0} step={500} value={grille.bonusAssiduite.montant} onChange={(e) => setGrille({ ...grille, bonusAssiduite: { ...grille.bonusAssiduite, montant: n(e.target.value) } })} /></label>
            </div>
          </fieldset>
          {peutRegler && <button className="adm-btn solid" style={{ marginTop: 14 }} disabled={envoi} onClick={() => void enregistrer()}>{envoi ? 'Enregistrement…' : 'Enregistrer la grille'}</button>}
          {message && <p className="adm-muted" role="status" style={{ marginTop: 8 }}>{message}</p>}
        </div>
      )}
    </>
  );
}
