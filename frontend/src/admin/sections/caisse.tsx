import { useMemo, useState } from 'react';
import { Kpi } from '../ui';
import type { CaisseConsolidation, CaisseEtat, CaisseReferentiel } from '../types';

/**
 * CAISSE NOMINATIVE — le poste de travail d'une trésorière.
 *
 * Une partie de l'argent d'ORION arrive en espèces, passe par les mains d'une
 * personne, et se compte à la main en fin de journée. Tant que cette étape n'est pas
 * outillée, elle se fait sur un cahier — et le rapport financier ignore une part
 * réelle des encaissements.
 *
 * L'écran suit exactement le geste réel : on ouvre avec un fond, on encaisse au fil
 * de la journée, on compte les billets, on constate l'écart, on verse en banque.
 */

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const dt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function CaisseSection({
  maCaisse, caisses, consolidation, referentiel, peutTenir, peutValider,
  onOuvrir, onEncaisser, onDecaisser, onArreter, onValider, onVoir,
}: {
  maCaisse: CaisseEtat | null;
  caisses: CaisseEtat[];
  consolidation: CaisseConsolidation | null;
  referentiel: CaisseReferentiel | null;
  peutTenir: boolean;
  peutValider: boolean;
  onOuvrir: (fondDeCaisse: number, emplacement: string) => void;
  onEncaisser: (id: string, p: Record<string, unknown>) => void;
  onDecaisser: (id: string, p: Record<string, unknown>) => void;
  onArreter: (id: string, p: Record<string, unknown>) => void;
  onValider: (id: string) => void;
  onVoir: (id: string) => void;
}) {
  return (
    <>
      {consolidation && (
        <div className="adm-kpis">
          <Kpi label="Espèces en caisse" value={fcfa(consolidation.especesEnCaisse)} sub={`${consolidation.caissesOuvertes} caisse(s) ouverte(s)`} tone="teal" />
          <Kpi label="Encaissé sur 30 jours" value={fcfa(consolidation.encaisseSurPeriode)} sub={`${fcfa(consolidation.verseEnBanque)} versés en banque`} tone="green" />
          <Kpi label="Écart cumulé" value={fcfa(consolidation.ecartCumule)} sub={consolidation.ecartCumule < 0 ? 'manquants constatés aux arrêtés' : 'excédents constatés'} tone={consolidation.ecartCumule < 0 ? 'red' : 'green'} />
          <Kpi label="Arrêtés non validés" value={String(consolidation.arretesNonValides)} sub="sans contrôle de second niveau" tone={consolidation.arretesNonValides ? 'blue' : 'green'} />
        </div>
      )}

      {peutTenir && (maCaisse ? (
        <MaCaisse
          c={maCaisse}
          referentiel={referentiel}
          onEncaisser={onEncaisser}
          onDecaisser={onDecaisser}
          onArreter={onArreter}
        />
      ) : (
        <OuvrirCaisse onOuvrir={onOuvrir} />
      ))}

      {consolidation && consolidation.parTresorier.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Par trésorier</h3>
            <span className="adm-muted">l’écart suit la personne — un manquant répété n’est plus une erreur de comptage</span>
          </div>
          <table className="adm-table sm">
            <thead><tr><th>Trésorier</th><th className="r">Encaissé</th><th className="r">Écart cumulé</th><th className="r">Arrêtés</th></tr></thead>
            <tbody>
              {consolidation.parTresorier.map((t) => (
                <tr key={t.titulaire}>
                  <td>{t.titulaireNom}<br /><span className="adm-muted mono" style={{ fontSize: 11.5 }}>{t.titulaire}</span></td>
                  <td className="r">{fcfa(t.encaisse)}</td>
                  <td className={`r ${t.ecart < 0 ? 'neg' : t.ecart > 0 ? 'pos' : ''}`}>{t.ecart === 0 ? '—' : fcfa(t.ecart)}</td>
                  <td className="r">{t.arretes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-h"><h3>Caisses</h3><span className="adm-muted">{caisses.length} au total</span></div>
        {caisses.length === 0 ? (
          <p className="adm-empty">Aucune caisse ouverte pour l’instant.</p>
        ) : (
          <table className="adm-table">
            <thead>
              <tr><th>Titulaire</th><th>Emplacement</th><th>Ouverte le</th><th>État</th><th className="r">Compté</th><th className="r">Écart</th><th className="r">Versé</th><th>Contrôle</th></tr>
            </thead>
            <tbody>
              {caisses.map((c) => (
                <tr key={c.id}>
                  <td>{c.titulaireNom}</td>
                  <td className="adm-muted">{c.emplacement ?? '—'}</td>
                  <td className="adm-muted">{dt(c.ouverteLe)}</td>
                  <td><span className={`adm-pill ${c.statut === 'ouverte' ? 'av-online' : ''}`}>{c.statut === 'ouverte' ? 'Ouverte' : 'Arrêtée'}</span></td>
                  <td className="r">{c.montantCompte !== undefined ? fcfa(c.montantCompte) : '—'}</td>
                  <td className={`r ${(c.ecart ?? 0) < 0 ? 'neg' : (c.ecart ?? 0) > 0 ? 'pos' : ''}`}>
                    {c.ecart === undefined ? '—' : fcfa(c.ecart)}
                    {c.motifEcart && <><br /><span className="adm-muted" style={{ fontSize: 11 }}>{c.motifEcart}</span></>}
                  </td>
                  <td className="r">{c.verseEnBanque !== undefined ? fcfa(c.verseEnBanque) : '—'}</td>
                  <td>
                    {c.statut === 'arretee' && !c.valideLe && peutValider && (
                      <button className="adm-btn xs solid" onClick={() => onValider(c.id)}>Valider</button>
                    )}
                    {c.valideLe && <span className="adm-pill tr-approved">Validé · {c.validePar}</span>}
                    {c.statut === 'ouverte' && <button className="adm-btn xs" onClick={() => onVoir(c.id)}>Journal</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function OuvrirCaisse({ onOuvrir }: { onOuvrir: (fond: number, emplacement: string) => void }) {
  const [fond, setFond] = useState('50000');
  const [lieu, setLieu] = useState('');
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Ouvrir ma caisse</h3><span className="adm-muted">une seule caisse ouverte par personne</span></div>
      <p className="adm-muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        Deux tiroirs simultanés au même nom, et plus personne ne sait où est l’argent.
        Déclarez le fond de caisse réellement présent au départ.
      </p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ maxWidth: 180 }}>
          <span>Fond de caisse (F)</span>
          <input className="adm-input adm-input-num" type="number" min={0} value={fond} onChange={(e) => setFond(e.target.value)} />
        </label>
        <label className="field grow" style={{ minWidth: 220 }}>
          <span>Emplacement</span>
          <input className="adm-input" value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Siège — Plateau, comptoir Aéroport…" />
        </label>
        <button className="adm-btn solid" onClick={() => onOuvrir(Number(fond) || 0, lieu)}>Ouvrir la caisse</button>
      </div>
    </div>
  );
}

function MaCaisse({ c, referentiel, onEncaisser, onDecaisser, onArreter }: {
  c: CaisseEtat;
  referentiel: CaisseReferentiel | null;
  onEncaisser: (id: string, p: Record<string, unknown>) => void;
  onDecaisser: (id: string, p: Record<string, unknown>) => void;
  onArreter: (id: string, p: Record<string, unknown>) => void;
}) {
  const origines = referentiel?.origines ?? {};
  const sorties = referentiel?.sorties ?? {};
  const coupures = referentiel?.coupures ?? [10000, 5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10, 5];
  const tolere = referentiel?.ecartTolere ?? 500;

  const [montant, setMontant] = useState('');
  const [origine, setOrigine] = useState('commission_chauffeur');
  const [tiers, setTiers] = useState('');
  const [reference, setReference] = useState('');
  const [sMontant, setSMontant] = useState('');
  const [sType, setSType] = useState('versement_banque');
  const [sNote, setSNote] = useState('');

  const [comptage, setComptage] = useState<Record<number, string>>({});
  const [motifEcart, setMotifEcart] = useState('');
  const [verse, setVerse] = useState('');

  const compte = useMemo(
    () => coupures.reduce((n, k) => n + (Number(comptage[k] ?? 0) || 0) * k, 0),
    [comptage, coupures],
  );
  const ecart = compte - c.soldeTheorique;
  const motifObligatoire = Math.abs(ecart) > tolere;

  return (
    <div className="adm-card">
      <div className="adm-card-h">
        <h3>Ma caisse</h3>
        <span className="adm-muted">{c.emplacement ?? 'emplacement non précisé'} · ouverte le {dt(c.ouverteLe)}</span>
      </div>

      <div className="adm-kpis" style={{ margin: 0 }}>
        <Kpi label="Fond de caisse" value={fcfa(c.fondDeCaisse)} sub="au départ" tone="blue" />
        <Kpi label="Encaissé" value={fcfa(c.entrees)} sub={`${c.mouvements.filter((m) => m.sens === 'entree').length} entrée(s)`} tone="green" />
        <Kpi label="Sorti" value={fcfa(c.sorties)} sub={`${c.mouvements.filter((m) => m.sens === 'sortie').length} sortie(s)`} tone="teal" />
        <Kpi label="Devrait être en caisse" value={fcfa(c.soldeTheorique)} sub="à confronter au comptage" tone="teal" />
      </div>

      {/* Encaisser / décaisser */}
      <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 14 }}>
        <div style={{ flex: 1, minWidth: 300 }}>
          <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>ENCAISSER</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ maxWidth: 140 }}>
              <span>Montant (F)</span>
              <input className="adm-input adm-input-num" type="number" min={0} value={montant} onChange={(e) => setMontant(e.target.value)} />
            </label>
            <label className="field" style={{ minWidth: 190 }}>
              <span>Origine</span>
              <select className="adm-select" value={origine} onChange={(e) => setOrigine(e.target.value)}>
                {Object.entries(origines).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="field grow" style={{ minWidth: 170 }}>
              <span>De qui</span>
              <input className="adm-input" value={tiers} onChange={(e) => setTiers(e.target.value)} placeholder="Konan Yao (AB-114-CI)" />
            </label>
            <label className="field" style={{ maxWidth: 140 }}>
              <span>Référence</span>
              <input className="adm-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="dossier" />
            </label>
            <button
              className="adm-btn solid"
              onClick={() => {
                if (!Number(montant)) { alert('Indiquez le montant encaissé.'); return; }
                onEncaisser(c.id, { montant: Number(montant), origine, tiers: tiers || undefined, reference: reference || undefined });
                setMontant(''); setTiers(''); setReference('');
              }}
            >
              Encaisser
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 300 }}>
          <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>SORTIR DE LA CAISSE</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ maxWidth: 140 }}>
              <span>Montant (F)</span>
              <input className="adm-input adm-input-num" type="number" min={0} value={sMontant} onChange={(e) => setSMontant(e.target.value)} />
            </label>
            <label className="field" style={{ minWidth: 190 }}>
              <span>Motif</span>
              <select className="adm-select" value={sType} onChange={(e) => setSType(e.target.value)}>
                {Object.entries(sorties).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="field grow" style={{ minWidth: 170 }}>
              <span>Précision</span>
              <input className="adm-input" value={sNote} onChange={(e) => setSNote(e.target.value)} />
            </label>
            <button
              className="adm-btn"
              onClick={() => {
                if (!Number(sMontant)) { alert('Indiquez le montant sorti.'); return; }
                onDecaisser(c.id, { montant: Number(sMontant), sortie: sType, note: sNote || undefined });
                setSMontant(''); setSNote('');
              }}
            >
              Sortir
            </button>
          </div>
          <p className="adm-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            On ne sort pas plus que ce que contient le tiroir : une caisse négative n’existe pas.
          </p>
        </div>
      </div>

      {/* Comptage et arrêté */}
      <div className="adm-card" style={{ margin: '14px 0 0', background: 'transparent' }}>
        <div className="adm-card-h">
          <h3>Arrêté de caisse</h3>
          <span className="adm-muted">comptez les billets, l’écart sera constaté tel quel</span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {coupures.map((k) => (
            <label key={k} className="field" style={{ width: 96 }}>
              <span>{k.toLocaleString('fr-FR')} F</span>
              <input
                className="adm-input adm-input-num"
                type="number"
                min={0}
                value={comptage[k] ?? ''}
                onChange={(e) => setComptage({ ...comptage, [k]: e.target.value })}
              />
            </label>
          ))}
        </div>

        <div className="row between" style={{ marginTop: 12, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <span className="adm-muted" style={{ fontSize: 12 }}>Compté</span>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fcfa(compte)}</div>
          </div>
          <div>
            <span className="adm-muted" style={{ fontSize: 12 }}>Attendu</span>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fcfa(c.soldeTheorique)}</div>
          </div>
          <div>
            <span className="adm-muted" style={{ fontSize: 12 }}>Écart</span>
            <div className={`${ecart < 0 ? 'neg' : ecart > 0 ? 'pos' : ''}`} style={{ fontSize: 22, fontWeight: 700 }}>
              {ecart === 0 ? '0 F' : fcfa(ecart)}
            </div>
          </div>
        </div>

        {motifObligatoire && (
          <p className="adm-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Écart supérieur à {fcfa(tolere)} : un motif écrit est obligatoire.
            Un manquant sans explication n’est pas un arrêté, c’est un trou.
          </p>
        )}

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <label className="field grow" style={{ minWidth: 260 }}>
            <span>Motif de l’écart{motifObligatoire ? ' (obligatoire)' : ''}</span>
            <input className="adm-input" value={motifEcart} onChange={(e) => setMotifEcart(e.target.value)} placeholder="Rendu de monnaie erroné sur une location, client reparti." />
          </label>
          <label className="field" style={{ maxWidth: 170 }}>
            <span>Versé en banque (F)</span>
            <input className="adm-input adm-input-num" type="number" min={0} value={verse} onChange={(e) => setVerse(e.target.value)} />
          </label>
          <button
            className="adm-btn solid"
            disabled={compte === 0 && c.soldeTheorique !== 0}
            onClick={() => {
              if (motifObligatoire && !motifEcart.trim()) { alert('Un motif écrit est obligatoire pour cet écart.'); return; }
              const payload: Record<string, unknown> = {
                comptage: Object.fromEntries(coupures.map((k) => [k, Number(comptage[k] ?? 0) || 0]).filter(([, v]) => (v as number) > 0)),
                motifEcart: motifEcart.trim() || undefined,
              };
              if (verse) payload.verseEnBanque = Number(verse);
              onArreter(c.id, payload);
            }}
          >
            Arrêter la caisse
          </button>
        </div>
      </div>

      {/* Journal */}
      <div style={{ marginTop: 14 }}>
        <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>JOURNAL DE LA CAISSE ({c.mouvements.length})</p>
        {c.mouvements.length === 0 ? (
          <p className="adm-muted" style={{ fontSize: 12.5 }}>Aucun mouvement pour l’instant.</p>
        ) : (
          <table className="adm-table sm">
            <thead><tr><th>Heure</th><th>Sens</th><th>Motif</th><th>Tiers</th><th className="r">Montant</th></tr></thead>
            <tbody>
              {c.mouvements.map((m) => (
                <tr key={m.id}>
                  <td className="adm-muted">{dt(m.at)}</td>
                  <td><span className={`adm-pill ${m.sens === 'entree' ? 'tr-approved' : 'tr-pending'}`}>{m.sens === 'entree' ? 'Entrée' : 'Sortie'}</span></td>
                  <td>{m.origine ? origines[m.origine] ?? m.origine : m.sortie ? sorties[m.sortie] ?? m.sortie : '—'}{m.note ? <><br /><span className="adm-muted" style={{ fontSize: 11.5 }}>{m.note}</span></> : null}</td>
                  <td className="adm-muted">{m.tiers ?? '—'}</td>
                  <td className={`r ${m.sens === 'entree' ? 'pos' : 'neg'}`}>{m.sens === 'entree' ? '+' : '−'}{fcfa(m.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
