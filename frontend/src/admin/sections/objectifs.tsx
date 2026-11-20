import { useEffect, useState } from 'react';
import { AdminError, LIVE, adminGet, adminPut, fcfa } from '../api';

/**
 * OBJECTIFS FINANCIERS (Direction Générale) : le chiffre d'affaires visé pour la journée,
 * la semaine, le mois et l'année. Le tableau de bord trace chaque courbe face à ces
 * objectifs. Lecture pour la supervision ; modification réservée à la finance
 * (finance:write), journalisée avec l'ancienne valeur.
 */

interface Objectifs { jour: number; semaine: number; mois: number; annee: number; majLe?: string; majPar?: string }
const CHAMPS: Array<{ cle: 'jour' | 'semaine' | 'mois' | 'annee'; libelle: string }> = [
  { cle: 'jour', libelle: 'Journée' },
  { cle: 'semaine', libelle: 'Semaine' },
  { cle: 'mois', libelle: 'Mois' },
  { cle: 'annee', libelle: 'Année' },
];
const DEMO: Objectifs = { jour: 450_000, semaine: 3_000_000, mois: 13_000_000, annee: 160_000_000 };

export function ObjectifsFinanciersCarte({ peutModifier }: { peutModifier: boolean }) {
  const [obj, setObj] = useState<Objectifs | null>(null);
  const [saisie, setSaisie] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const remplir = (o: Objectifs) => { setObj(o); setSaisie(Object.fromEntries(CHAMPS.map((c) => [c.cle, String(o[c.cle])]))); };
  useEffect(() => {
    if (!LIVE) { remplir(DEMO); return; }
    adminGet<{ objectifs: Objectifs }>('/admin/objectifs').then((r) => remplir(r.objectifs)).catch(() => setMessage({ ok: false, texte: 'Objectifs illisibles pour le moment.' }));
  }, []);

  if (!obj) return null;
  const valeurs = Object.fromEntries(CHAMPS.map((c) => [c.cle, Math.round(Number((saisie[c.cle] ?? '').replace(/\s/g, '')))]));
  const invalides = CHAMPS.filter((c) => !Number.isFinite(valeurs[c.cle]) || valeurs[c.cle]! <= 0);
  const modifies = CHAMPS.filter((c) => valeurs[c.cle] !== obj[c.cle]);
  // Cohérence : un objectif hebdomadaire sous celui du jour est presque toujours une faute de frappe.
  const incoherent = !invalides.length && (valeurs.semaine! < valeurs.jour! || valeurs.mois! < valeurs.semaine! || valeurs.annee! < valeurs.mois!);

  const enregistrer = async () => {
    setEnvoi(true); setMessage(null);
    const patch = Object.fromEntries(modifies.map((c) => [c.cle, valeurs[c.cle]]));
    try {
      if (!LIVE) { remplir({ ...obj, ...patch, majLe: new Date().toISOString(), majPar: 'Démonstration' }); setMessage({ ok: true, texte: 'Objectifs mis à jour (démonstration).' }); }
      else {
        const r = await adminPut<{ objectifs: Objectifs }>('/admin/objectifs', patch);
        remplir(r.objectifs);
        setMessage({ ok: true, texte: 'Objectifs enregistrés : le tableau de bord les suit déjà.' });
      }
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof AdminError ? e.message : 'Enregistrement impossible. Réessayez.' });
    }
    setEnvoi(false);
  };

  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>🎯 Objectifs financiers</h3>
        <a className="adm-btn ghost" style={{ textDecoration: 'none' }} href="./dashboard.html#objectifs" target="_blank" rel="noopener">📺 Voir les courbes</a>
      </div>
      <p className="adm-muted" style={{ marginBottom: 12 }}>
        Chiffre d’affaires visé, en F CFA. Le tableau de bord compare chaque période à son objectif, heure par heure, jour par jour et mois par mois.
      </p>
      <div className="price-grid adm-objectifs">
        {CHAMPS.map((c) => (
          <label key={c.cle} className="price-field">
            <span>{c.libelle}</span>
            <input inputMode="numeric" value={saisie[c.cle] ?? ''} disabled={!peutModifier || envoi}
              aria-invalid={invalides.includes(c) || undefined}
              onChange={(e) => setSaisie((s) => ({ ...s, [c.cle]: e.target.value.replace(/[^\d\s]/g, '') }))} />
            <span className="adm-muted">{Number.isFinite(valeurs[c.cle]) && valeurs[c.cle]! > 0 ? fcfa(valeurs[c.cle]!) : 'Montant positif attendu'}</span>
          </label>
        ))}
      </div>
      {incoherent && <p className="adm-muted" style={{ color: 'var(--a-amber-txt)', marginTop: 10 }}>⚠️ Attention : un objectif est plus petit que celui de la période plus courte. Vérifiez la saisie.</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        {peutModifier ? (
          <button className="adm-btn solid" disabled={envoi || invalides.length > 0 || modifies.length === 0} onClick={() => void enregistrer()}>
            {envoi ? 'Enregistrement…' : 'Enregistrer les objectifs'}
          </button>
        ) : (
          <span className="adm-muted">🔒 Modification réservée à la direction financière.</span>
        )}
        {obj.majLe && <span className="adm-muted">Dernière modification : {obj.majPar ?? '—'}, le {new Date(obj.majLe).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}</span>}
        {message && <span role="status" style={{ color: message.ok ? 'var(--a-green)' : 'var(--a-danger)' }}>{message.texte}</span>}
      </div>
    </div>
  );
}
