import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NonConnecte, lireAnalyse } from './donnees';
import type { AnalysePeriode, AnalyseTableau, Periode, StatutObjectif } from './types';

/**
 * OBJECTIFS ET TENDANCES : la vue « finances et activité » du tableau de bord.
 *
 *  - Quatre objectifs (jour, semaine, mois, année) : réalisé, rythme attendu, projection,
 *    comparaison à la période précédente au même moment.
 *  - La courbe du chiffre d'affaires cumulé de la période choisie, face à la période
 *    précédente et au rythme qu'exige l'objectif.
 *  - Le niveau des commandes (par heure, par jour, sur 30 jours, par mois) et, tranche par
 *    tranche, la hausse ou la baisse par rapport à la période de comparaison.
 *
 * Les courbes se recalculent toutes les 30 s et dès qu'une commande, une course terminée
 * ou un paiement arrive en direct.
 */

const PERIODES: Periode[] = ['jour', 'semaine', 'mois', 'annee'];
const NOMS: Record<Periode, { titre: string; onglet: string; courant: string; precedent: string; court: string }> = {
  jour: { titre: 'Objectif du jour', onglet: 'Jour', courant: 'Aujourd’hui', precedent: 'Hier', court: 'vs hier' },
  semaine: { titre: 'Objectif de la semaine', onglet: 'Semaine', courant: 'Cette semaine', precedent: 'Semaine passée', court: 'vs sem. passée' },
  mois: { titre: 'Objectif du mois', onglet: 'Mois', courant: 'Ce mois', precedent: 'Mois dernier', court: 'vs mois dernier' },
  annee: { titre: 'Objectif de l’année', onglet: 'Année', courant: 'Cette année', precedent: 'Année dernière', court: 'vs an dernier' },
};
const STATUT: Record<StatutObjectif, { libelle: string; classe: string }> = {
  en_avance: { libelle: 'En avance', classe: 'bon' },
  dans_les_temps: { libelle: 'Dans les temps', classe: 'neutre' },
  en_retard: { libelle: 'En retard', classe: 'attention' },
};
const JOURS_LONGS: Record<string, string> = { lun: 'lundi', mar: 'mardi', mer: 'mercredi', jeu: 'jeudi', ven: 'vendredi', sam: 'samedi', dim: 'dimanche' };
const MOIS_LONGS: Record<string, string> = { janv: 'janvier', 'févr': 'février', mars: 'mars', avr: 'avril', mai: 'mai', juin: 'juin', juil: 'juillet', 'août': 'août', sept: 'septembre', oct: 'octobre', nov: 'novembre', 'déc': 'décembre' };

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const signe = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} %`;
/** Montants d'axe : 450 k, 1,5 M. */
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : `${Math.round(n)}`);
const pl = (n: number, mot: string) => `${n.toLocaleString('fr-FR')} ${mot}${n > 1 ? 's' : ''}`;

/** Pas d'axe « rond » (1, 2, 2,5, 5 × 10ⁿ) et maximum arrondi au pas supérieur. */
function axe(max: number, nb = 4): { max: number; pas: number } {
  const brut = Math.max(max, 1) / nb;
  const p10 = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((k) => k >= brut) ?? 10 * p10;
  return { max: Math.ceil(max / pas) * pas || pas, pas };
}

/** Largeur réelle du conteneur : les graphiques sont tracés au pixel, le texte reste net. */
function useLargeur<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [l, setL] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setL(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((e) => setL(Math.floor(e[0]?.contentRect.width ?? el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, l];
}

/** Hauteur de la fenêtre : sur un écran mural de 1080 px, tout doit tenir sans défiler. */
function useHauteurEcran(): number {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const maj = () => setH(window.innerHeight);
    window.addEventListener('resize', maj);
    return () => window.removeEventListener('resize', maj);
  }, []);
  return h;
}
const borne = (min: number, v: number, max: number) => Math.round(Math.min(max, Math.max(min, v)));

const chemin = (pts: Array<[number, number]>) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');

export function Objectifs({ signal, onNonConnecte }: { signal: number; onNonConnecte: () => void }) {
  const [a, setA] = useState<AnalyseTableau | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [periode, setPeriode] = useState<Periode>('jour');
  const [vue, setVue] = useState<VueCommandes>('heure');
  const [tableauCA, setTableauCA] = useState(false);
  const [tableauCmd, setTableauCmd] = useState(false);

  const charger = useCallback(async () => {
    try {
      setA(await lireAnalyse());
      setErreur(null);
    } catch (e) {
      if (e instanceof NonConnecte) onNonConnecte();
      else setErreur('Analyse indisponible : nouvelle tentative dans 30 secondes.');
    }
  }, [onNonConnecte]);

  useEffect(() => {
    void charger();
    const t = window.setInterval(() => void charger(), 30_000);
    return () => window.clearInterval(t);
  }, [charger]);
  // Une commande, une course terminée, un paiement : les courbes suivent.
  useEffect(() => {
    if (!signal) return;
    const t = window.setTimeout(() => void charger(), 1500);
    return () => window.clearTimeout(t);
  }, [signal, charger]);

  if (!a) return <div className="tb-chargement">{erreur ?? 'Calcul des objectifs et des tendances…'}</div>;
  const f = a.finances[periode];
  const noms = NOMS[periode];
  return (
    <main className="ob">
      {erreur && <div className="tb-erreur" role="status">{erreur}</div>}
      <div className="ob-cartes" role="group" aria-label="Objectifs financiers : choisir la période de la courbe">
        {PERIODES.map((p) => <CarteObjectif key={p} p={p} f={a.finances[p]} choisie={p === periode} onChoisir={() => setPeriode(p)} />)}
      </div>

      <section className="tb-panneau ob-ca" aria-label="Chiffre d'affaires cumulé">
        <div className="tb-panneau-h">
          <h2>Chiffre d’affaires cumulé · {noms.courant.toLowerCase()}</h2>
          <Segments label="Période" valeur={periode} onChange={setPeriode} options={PERIODES.map((p) => [p, NOMS[p].onglet])} />
        </div>
        <div className="ob-sous">
          <div className="tb-legende">
            <span><Trait style="courant" />{noms.courant}</span>
            <span><Trait style="precedent" />{noms.precedent}</span>
            <span><Trait style="objectif" />Rythme de l’objectif</span>
          </div>
          <BoutonTableau actif={tableauCA} onClick={() => setTableauCA((x) => !x)} />
        </div>
        {tableauCA ? <TableCA f={f} periode={periode} /> : <CourbeCA f={f} periode={periode} />}
      </section>

      <section className="tb-panneau ob-retenir" aria-label="Ce qu'il faut retenir">
        <div className="tb-panneau-h"><h2>Ce qu’il faut retenir</h2>{a.historiqueDemo && <span className="ob-demo" title="Un historique fictif complète les vraies courses pour lire les tendances. Jamais en production.">Historique de démonstration</span>}</div>
        <ListePoints points={a.aRetenir} />
      </section>

      <section className="tb-panneau ob-commandes" aria-label="Niveau des commandes">
        <div className="tb-panneau-h">
          <h2>Niveau des commandes</h2>
          <Segments label="Découpage" valeur={vue} onChange={setVue} options={[['heure', 'Par heure'], ['jour', 'Par jour'], ['30j', '30 jours'], ['mois', 'Par mois']]} />
        </div>
        <CourbeCommandes a={a} vue={vue} tableau={tableauCmd} basculer={() => setTableauCmd((x) => !x)} />
      </section>
    </main>
  );
}

/** La liste défile si elle est trop longue pour l'écran ; un fondu le signale. */
function ListePoints({ points }: { points: AnalyseTableau['aRetenir'] }) {
  const ref = useRef<HTMLUListElement>(null);
  const [deborde, setDeborde] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = () => setDeborde(el.scrollHeight > el.clientHeight + 2 && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    mesurer();
    el.addEventListener('scroll', mesurer);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(mesurer) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', mesurer); ro?.disconnect(); };
  }, [points]);
  return (
    <ul ref={ref} className={`ob-points${deborde ? ' deborde' : ''}`} tabIndex={deborde ? 0 : undefined}>
      {points.map((x, i) => (
        <li key={i} className={x.genre}>
          <span className="ob-point-ico" aria-hidden>{ICONE_POINT[x.genre]}</span>
          <span>{x.texte}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ Cartes objectifs ------------------------------ */

function CarteObjectif({ p, f, choisie, onChoisir }: { p: Periode; f: AnalysePeriode; choisie: boolean; onChoisir: () => void }) {
  const s = STATUT[f.statut];
  const rythme = f.objectif ? f.rythmeAttendu / f.objectif : 0;
  const atteint = f.progression >= 1;
  return (
    <button type="button" className={`ob-carte${choisie ? ' choisie' : ''}`} aria-pressed={choisie} onClick={onChoisir}>
      <span className="ob-carte-h">
        <span className="ob-carte-titre">{NOMS[p].titre}</span>
        <span className={`ob-statut ${atteint ? 'bon' : s.classe}`}>{atteint ? <IcoCoche /> : ICONE_STATUT[f.statut]}{atteint ? 'Atteint' : s.libelle}</span>
      </span>
      <span className="ob-carte-val">{fcfa(f.realise)}</span>
      <span className="ob-carte-sur">sur {fcfa(f.objectif)} · <strong>{pct(f.progression)}</strong></span>
      <span className="ob-jauge" role="meter" aria-valuemin={0} aria-valuemax={f.objectif} aria-valuenow={f.realise} aria-label={`${NOMS[p].titre} : ${pct(f.progression)} atteints, rythme attendu ${pct(rythme)}`}>
        <span className="ob-jauge-plein" style={{ width: `${Math.min(100, f.progression * 100)}%` }} />
        <span className="ob-jauge-rythme" style={{ left: `${Math.min(100, rythme * 100)}%` }} />
      </span>
      <span className="ob-carte-rythme">Rythme attendu à ce stade : {pct(rythme)}</span>
      <span className="ob-carte-pied">
        <span>{f.projection !== null ? <>Projection <strong>{fcfa(f.projection)}</strong></> : 'Projection : trop tôt'}</span>
        <Variation v={f.variation} suffixe={NOMS[p].court} />
      </span>
    </button>
  );
}

function Variation({ v, suffixe }: { v: number | null; suffixe?: string }) {
  if (v === null) return <span className="ob-var neutre">—{suffixe ? ` ${suffixe}` : ''}</span>;
  const hausse = v >= 0;
  return (
    <span className={`ob-var ${hausse ? 'hausse' : 'baisse'}`}>
      <span className="ob-var-fleche" aria-hidden>{hausse ? '▲' : '▼'}</span>
      {signe(v)}{suffixe ? ` ${suffixe}` : ''}
      <span className="tb-sr">{hausse ? ' (hausse)' : ' (baisse)'}</span>
    </span>
  );
}

/* --------------------------- Courbe du chiffre d'affaires --------------------------- */

function titreTranche(periode: Periode, libelle: string, i: number): string {
  if (periode === 'jour') return `De ${i} h à ${i + 1} h`;
  if (periode === 'semaine') return JOURS_LONGS[libelle] ?? libelle;
  if (periode === 'mois') return `Le ${libelle}`;
  return MOIS_LONGS[libelle] ?? libelle;
}

function CourbeCA({ f, periode }: { f: AnalysePeriode; periode: Periode }) {
  const [ref, L] = useLargeur<HTMLDivElement>();
  const [survol, setSurvol] = useState<number | null>(null);
  const noms = NOMS[periode];
  const vh = useHauteurEcran();
  const etroit = L < 620;
  const H = etroit ? borne(200, L * 0.62, 260) : borne(210, (vh - 560) * 0.48, 340);
  const m = { g: 52, d: etroit ? 14 : 112, h: 18, b: 26 };
  const w = Math.max(10, L - m.g - m.d);
  const h = H - m.h - m.b;
  const n = f.courbe.length;
  const enCours = f.courbe.reduce((k, p, i) => (p.courant !== null ? i : k), -1);
  const { max, pas } = axe(Math.max(f.objectif, ...f.courbe.map((p) => Math.max(p.precedent, p.courant ?? 0))) * 1.04, 5);
  const x = (i: number) => m.g + ((i + 1) / n) * w;
  const fracTranche = Math.min(1, Math.max(0, f.fractionEcoulee * n - enCours));
  const xMaintenant = m.g + ((enCours + fracTranche) / n) * w;
  const xPoint = (i: number) => (i === enCours && f.fractionEcoulee < 1 ? xMaintenant : x(i));
  const y = (v: number) => m.h + h - (v / max) * h;
  const origine: [number, number] = [m.g, y(0)];
  const ptsCourant: Array<[number, number]> = [origine, ...f.courbe.slice(0, enCours + 1).map((p, i) => [xPoint(i), y(p.courant ?? 0)] as [number, number])];
  const ptsPrecedent: Array<[number, number]> = [origine, ...f.courbe.map((p, i) => [x(i), y(p.precedent)] as [number, number])];
  const ptsObjectif: Array<[number, number]> = [origine, ...f.courbe.map((p, i) => [x(i), y(p.objectif)] as [number, number])];
  const dernier = ptsCourant[ptsCourant.length - 1]!;
  const aire = `${chemin(ptsCourant)}L${dernier[0].toFixed(1)},${y(0).toFixed(1)}Z`;
  const ticksY = Array.from({ length: Math.round(max / pas) + 1 }, (_, k) => k * pas);

  // Étiquettes d'axe horizontal selon la période.
  const etiquettesX: Array<{ x: number; t: string }> = periode === 'jour'
    ? Array.from({ length: 9 }, (_, k) => ({ x: m.g + ((k * 3) / 24) * w, t: `${k * 3} h` })).filter((_, k) => !etroit || k % 2 === 0)
    : periode === 'mois'
      ? f.courbe.map((p, i) => ({ x: m.g + ((i + 0.5) / n) * w, t: p.libelle })).filter((_, i) => [0, 4, 9, 14, 19, 24, 29].includes(i))
      : f.courbe.map((p, i) => ({ x: m.g + ((i + 0.5) / n) * w, t: p.libelle })).filter((_, i) => !etroit || periode !== 'annee' || i % 2 === 0);

  // Étiquettes directes en bout de ligne, écartées si elles se chevauchent.
  const finObj = y(f.courbe[n - 1]!.objectif);
  const finPrec = y(f.courbe[n - 1]!.precedent);
  let yObj = finObj;
  let yPrec = finPrec;
  if (Math.abs(yObj - yPrec) < 32) {
    const milieu = (yObj + yPrec) / 2;
    const haut = yObj <= yPrec;
    yObj = milieu + (haut ? -16 : 16);
    yPrec = milieu + (haut ? 16 : -16);
  }

  const p = survol !== null ? f.courbe[survol] : null;
  const xs = survol !== null ? xPoint(survol) : 0;
  const bouger = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width) * n);
    setSurvol(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="tb-graph ob-graph" ref={ref}>
      {L > 0 && (
        <svg width={L} height={H} role="img" aria-label={`Chiffre d'affaires cumulé, ${noms.courant.toLowerCase()} : ${fcfa(f.realise)} sur un objectif de ${fcfa(f.objectif)}`}>
          <defs>
            <linearGradient id="ob-aire" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--serie-actuelle)', stopOpacity: 0.22 }} />
              <stop offset="1" style={{ stopColor: 'var(--serie-actuelle)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {ticksY.map((v) => (
            <g key={v}>
              <line x1={m.g} x2={m.g + w} y1={y(v)} y2={y(v)} className={v === 0 ? 'ob-base' : 'tb-grille-l'} />
              <text x={m.g - 8} y={y(v) + 4} className="tb-axe" textAnchor="end">{compact(v)}</text>
            </g>
          ))}
          {etiquettesX.map((e) => <text key={e.t + e.x} x={e.x} y={H - 6} className="tb-axe" textAnchor="middle">{e.t}</text>)}
          {/* Niveau de l'objectif, en référence discrète. */}
          <line x1={m.g} x2={m.g + w} y1={y(f.objectif)} y2={y(f.objectif)} className="ob-ref-objectif" />
          <path d={chemin(ptsPrecedent)} className="ob-l-precedent" />
          <path d={chemin(ptsObjectif)} className="ob-l-objectif" />
          {enCours >= 0 && <path d={aire} fill="url(#ob-aire)" />}
          {enCours >= 0 && <path d={chemin(ptsCourant)} className="ob-l-courant" />}
          {enCours >= 0 && f.fractionEcoulee < 1 && (
            <g>
              <line x1={xMaintenant} x2={xMaintenant} y1={m.h - 6} y2={y(0)} className="ob-maintenant" />
              <text x={xMaintenant} y={m.h - 8} className="ob-maintenant-t" textAnchor="middle">maintenant</text>
            </g>
          )}
          {enCours >= 0 && (
            <g>
              <circle cx={dernier[0]} cy={dernier[1]} r={5.5} className="ob-point-courant" />
              <text x={dernier[0] - 10} y={dernier[1] - 12} className="ob-val-courant" textAnchor="end">{fcfa(f.realise)}</text>
            </g>
          )}
          {!etroit && (
            <g>
              <text x={m.g + w + 10} y={yObj - 2} className="ob-etiq-nom">Objectif</text>
              <text x={m.g + w + 10} y={yObj + 13} className="ob-etiq-val">{fcfa(f.objectif)}</text>
              <text x={m.g + w + 10} y={yPrec - 2} className="ob-etiq-nom">{noms.precedent}</text>
              <text x={m.g + w + 10} y={yPrec + 13} className="ob-etiq-val">{fcfa(f.precedentTotal)}</text>
            </g>
          )}
          {p && (
            <g pointerEvents="none">
              <line x1={xs} x2={xs} y1={m.h} y2={y(0)} className="ob-curseur" />
              <circle cx={x(survol!)} cy={y(p.precedent)} r={4.5} className="ob-point-precedent" />
              <circle cx={x(survol!)} cy={y(p.objectif)} r={4} className="ob-point-objectif" />
              {p.courant !== null && <circle cx={xs} cy={y(p.courant)} r={5.5} className="ob-point-courant" />}
            </g>
          )}
          <rect x={m.g} y={m.h} width={w} height={h} fill="transparent" onMouseMove={bouger} onMouseLeave={() => setSurvol(null)} />
        </svg>
      )}
      {p && (
        <div className={`tb-infobulle ob-bulle${xs > L * 0.62 ? ' gauche' : ''}`} style={{ left: xs, top: m.h }}>
          <strong>{titreTranche(periode, p.libelle, survol!)}</strong>
          {p.courant !== null && <span><Trait style="courant" />{noms.courant} : <b>{fcfa(p.courant)}</b></span>}
          <span><Trait style="precedent" />{noms.precedent} : <b>{fcfa(p.precedent)}</b></span>
          <span><Trait style="objectif" />Objectif à ce stade : <b>{fcfa(p.objectif)}</b></span>
          <em>Sur la tranche : {p.montant !== null ? fcfa(p.montant) : '—'} · {noms.precedent.toLowerCase()} : {fcfa(p.montantPrecedent)}</em>
          {p.courant !== null && <em>{p.courant >= p.objectif ? 'Au-dessus' : 'En dessous'} du rythme de l’objectif de {fcfa(Math.abs(p.courant - p.objectif))}</em>}
        </div>
      )}
    </div>
  );
}

function TableCA({ f, periode }: { f: AnalysePeriode; periode: Periode }) {
  const noms = NOMS[periode];
  return (
    <div className="ob-table-boite">
      <table className="ob-table">
        <caption className="tb-sr">Chiffre d’affaires cumulé, {noms.courant.toLowerCase()}</caption>
        <thead><tr><th>Tranche</th><th>{noms.courant} (cumul)</th><th>{noms.precedent} (cumul)</th><th>Rythme de l’objectif</th><th>Sur la tranche</th></tr></thead>
        <tbody>
          {f.courbe.map((p, i) => (
            <tr key={p.libelle}>
              <td>{titreTranche(periode, p.libelle, i)}</td>
              <td>{p.courant !== null ? fcfa(p.courant) : '—'}</td>
              <td>{fcfa(p.precedent)}</td>
              <td>{fcfa(p.objectif)}</td>
              <td>{p.montant !== null ? fcfa(p.montant) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Niveau des commandes ------------------------------ */

type VueCommandes = 'heure' | 'jour' | '30j' | 'mois';
interface PointSerie { libelle: string; titre: string; courant: number | null; precedent: number | null; reference: number | null; variation: number | null; enCours?: boolean }
interface Series { points: PointSerie[]; courant: string; precedent?: string; reference?: string; comparaison: string; pasEtiquette: number }

function series(a: AnalyseTableau, vue: VueCommandes): Series {
  const c = a.commandes;
  if (vue === 'heure') {
    return {
      points: c.parHeure.map((p, i) => ({ libelle: p.libelle, titre: `De ${i} h à ${i + 1} h`, courant: p.courant, precedent: p.precedent, reference: p.moyenne ?? null, variation: p.variation, enCours: p.enCours })),
      courant: 'Aujourd’hui', precedent: 'Hier', reference: `Moyenne des 4 derniers ${c.jourCourant}s`, comparaison: 'par rapport à hier', pasEtiquette: 3,
    };
  }
  if (vue === 'jour') {
    return {
      points: c.parJour.map((p) => ({ libelle: p.libelle, titre: JOURS_LONGS[p.libelle] ?? p.libelle, courant: p.courant, precedent: p.precedent, reference: null, variation: p.variation, enCours: p.enCours })),
      courant: 'Cette semaine', precedent: 'Semaine passée', comparaison: 'par rapport à la semaine passée', pasEtiquette: 1,
    };
  }
  if (vue === '30j') {
    return {
      points: c.trenteJours.map((p) => ({ libelle: p.libelle, titre: `${JOURS_LONGS[p.jour] ?? p.jour} ${p.libelle}`, courant: p.commandes, precedent: null, reference: p.moyenne7, variation: p.variation, enCours: p.enCours })),
      courant: 'Commandes du jour', reference: 'Moyenne sur 7 jours', comparaison: 'par rapport au même jour de la semaine d’avant', pasEtiquette: 5,
    };
  }
  return {
    points: c.parMois.map((p) => ({ libelle: p.libelle, titre: MOIS_LONGS[p.libelle] ?? p.libelle, courant: p.courant, precedent: p.precedent, reference: null, variation: p.variation, enCours: p.enCours })),
    courant: 'Cette année', precedent: 'Année dernière', comparaison: 'par rapport à l’année dernière', pasEtiquette: 1,
  };
}

function CourbeCommandes({ a, vue, tableau, basculer }: { a: AnalyseTableau; vue: VueCommandes; tableau: boolean; basculer: () => void }) {
  const s = series(a, vue);
  return (
    <>
      <div className="ob-sous">
        <div className="tb-legende">
          <span><Trait style="courant" />{s.courant}</span>
          {s.precedent && <span><Trait style="precedent" />{s.precedent}</span>}
          {s.reference && <span><Trait style="objectif" />{s.reference}</span>}
          <span><i className="ob-carre hausse" />Hausse</span>
          <span><i className="ob-carre baisse" />Baisse</span>
        </div>
        <BoutonTableau actif={tableau} onClick={basculer} />
      </div>
      {tableau ? <TableCommandes s={s} /> : <GraphCommandes s={s} />}
    </>
  );
}

/** Moins de 4 commandes de part et d'autre : la variation n'est pas significative. */
const faible = (p: PointSerie) => Math.max(p.courant ?? 0, p.precedent ?? p.reference ?? 0) < 4;

function GraphCommandes({ s }: { s: Series }) {
  const [ref, L] = useLargeur<HTMLDivElement>();
  const [survol, setSurvol] = useState<number | null>(null);
  const vh = useHauteurEcran();
  const etroit = L < 620;
  const n = s.points.length;
  const m = { g: 52, d: 14, h: 14 };
  const w = Math.max(10, L - m.g - m.d);
  const hHaut = etroit ? 150 : borne(120, (vh - 560) * 0.3, 210);
  const ecart = 30;
  const hBas = etroit ? 76 : borne(64, (vh - 560) * 0.15, 100);
  const H = m.h + hHaut + ecart + hBas + 24;
  const pas = w / n;
  const xc = (i: number) => m.g + (i + 0.5) * pas;
  const valeurs = s.points.flatMap((p) => [p.courant ?? 0, p.precedent ?? 0, p.reference ?? 0]);
  const { max, pas: pasY } = axe(Math.max(4, ...valeurs) * 1.05, 3);
  const y = (v: number) => m.h + hHaut - (v / max) * hHaut;
  const ticksY = Array.from({ length: Math.round(max / pasY) + 1 }, (_, k) => k * pasY);

  // Variation : échelle symétrique autour de 0. Les tranches à très faible volume (la nuit,
  // 1 commande contre 3) ne fixent pas l'échelle : elles tasseraient toutes les autres.
  // Une barre qui dépasse est écrêtée ; l'infobulle donne la valeur exacte.
  const significatives = s.points.filter((p) => p.variation !== null && !faible(p)).map((p) => Math.abs(p.variation!)).sort((a, b) => a - b);
  const p90 = significatives.length ? significatives[Math.floor((significatives.length - 1) * 0.9)]! : 0.25;
  const varMax = Math.min(1, Math.max(0.25, Math.ceil(p90 * 4) / 4));
  const y0 = m.h + hHaut + ecart + hBas / 2;
  const yv = (v: number) => y0 - (Math.max(-varMax, Math.min(varMax, v)) / varMax) * (hBas / 2);
  const larg = Math.max(3, Math.min(26, pas * 0.56));

  const pleins = s.points.map((p, i) => ({ p, i })).filter(({ p }) => p.courant !== null && !p.enCours);
  const enCours = s.points.findIndex((p) => p.enCours);
  const ligneCourant = chemin(pleins.map(({ p, i }) => [xc(i), y(p.courant!)]));
  const precedent = s.points.some((p) => p.precedent !== null) ? chemin(s.points.map((p, i) => [xc(i), y(p.precedent ?? 0)])) : null;
  const reference = s.points.some((p) => p.reference !== null) ? chemin(s.points.map((p, i) => [xc(i), y(p.reference ?? 0)])) : null;
  const dernierPlein = pleins[pleins.length - 1];
  const aire = pleins.length > 1 ? `${ligneCourant}L${xc(dernierPlein!.i).toFixed(1)},${y(0)}L${xc(pleins[0]!.i).toFixed(1)},${y(0)}Z` : '';
  const pointsVisibles = n <= 12;
  const valeursSurBarres = n <= 12 && !etroit;

  const p = survol !== null ? s.points[survol] : null;
  const bouger = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSurvol(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };
  const pasEtiq = etroit ? s.pasEtiquette * 2 : s.pasEtiquette;

  return (
    <div className="tb-graph ob-graph" ref={ref}>
      {L > 0 && (
        <svg width={L} height={H} role="img" aria-label={`Niveau des commandes : ${s.courant.toLowerCase()}${s.precedent ? ` comparé à ${s.precedent.toLowerCase()}` : ''}, avec la hausse ou la baisse de chaque tranche`}>
          <defs>
            <linearGradient id="ob-aire-cmd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--serie-actuelle)', stopOpacity: 0.16 }} />
              <stop offset="1" style={{ stopColor: 'var(--serie-actuelle)', stopOpacity: 0 }} />
            </linearGradient>
            {(['hausse', 'baisse'] as const).map((sens) => (
              <pattern key={sens} id={`ob-hachures-${sens}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" style={{ fill: `var(--${sens})`, opacity: 0.3 }} />
                <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: `var(--${sens})` }} strokeWidth="3" />
              </pattern>
            ))}
          </defs>
          {/* Panneau haut : le niveau des commandes. */}
          {ticksY.map((v) => (
            <g key={v}>
              <line x1={m.g} x2={m.g + w} y1={y(v)} y2={y(v)} className={v === 0 ? 'ob-base' : 'tb-grille-l'} />
              <text x={m.g - 8} y={y(v) + 4} className="tb-axe" textAnchor="end">{v}</text>
            </g>
          ))}
          {aire && <path d={aire} fill="url(#ob-aire-cmd)" />}
          {precedent && <path d={precedent} className="ob-l-precedent" />}
          {reference && <path d={reference} className="ob-l-objectif" />}
          <path d={ligneCourant} className="ob-l-courant" />
          {enCours >= 0 && s.points[enCours]!.courant !== null && (
            <g>
              {dernierPlein && <path d={chemin([[xc(dernierPlein.i), y(dernierPlein.p.courant!)], [xc(enCours), y(s.points[enCours]!.courant!)]])} className="ob-l-courant entame" />}
              <circle cx={xc(enCours)} cy={y(s.points[enCours]!.courant!)} r={5} className="ob-point-entame" />
              <text x={xc(enCours)} y={y(s.points[enCours]!.courant!) - 10} className="ob-maintenant-t" textAnchor="middle">en cours</text>
            </g>
          )}
          {pointsVisibles && pleins.map(({ p: q, i }) => <circle key={i} cx={xc(i)} cy={y(q.courant!)} r={4} className="ob-point-courant" />)}

          {/* Panneau bas : hausse ou baisse de chaque tranche. */}
          <text x={m.g} y={y0 - hBas / 2 - 12} className="ob-titre-bas">Hausse ou baisse, {s.comparaison}</text>
          <line x1={m.g} x2={m.g + w} y1={y0} y2={y0} className="ob-milieu" />
          <text x={m.g - 8} y={y0 + 4} className="tb-axe" textAnchor="end">0</text>
          <text x={m.g - 8} y={y0 - hBas / 2 + 8} className="tb-axe" textAnchor="end">{signe(varMax)}</text>
          <text x={m.g - 8} y={y0 + hBas / 2} className="tb-axe" textAnchor="end">{signe(-varMax)}</text>
          {s.points.map((q, i) => {
            if (q.variation === null) return null;
            const v = q.variation;
            const haut = v >= 0;
            const yb = yv(v);
            const hb = Math.max(1.5, Math.abs(yb - y0) - 1);
            const xb = xc(i) - larg / 2;
            const r = Math.min(4, hb, larg / 2);
            // Bout arrondi du côté de la valeur, base droite contre la ligne du zéro (2 px d'écart).
            const d = haut
              ? `M${xb},${y0 - 1} V${y0 - 1 - hb + r} Q${xb},${y0 - 1 - hb} ${xb + r},${y0 - 1 - hb} H${xb + larg - r} Q${xb + larg},${y0 - 1 - hb} ${xb + larg},${y0 - 1 - hb + r} V${y0 - 1} Z`
              : `M${xb},${y0 + 1} V${y0 + 1 + hb - r} Q${xb},${y0 + 1 + hb} ${xb + r},${y0 + 1 + hb} H${xb + larg - r} Q${xb + larg},${y0 + 1 + hb} ${xb + larg},${y0 + 1 + hb - r} V${y0 + 1} Z`;
            return (
              <g key={i} className={`ob-barre ${haut ? 'hausse' : 'baisse'}${q.enCours ? ' entame' : ''}${faible(q) ? ' faible' : ''}`}>
                <path d={d} fill={q.enCours ? `url(#ob-hachures-${haut ? 'hausse' : 'baisse'})` : 'currentColor'} />
                {Math.abs(v) > varMax && <path d={`M${xb + 1},${haut ? y0 - hb + 3 : y0 + hb - 3} h${larg - 2}`} className="ob-ecrete" />}
                {valeursSurBarres && <text x={xc(i)} y={haut ? y0 - hb - 6 : y0 + hb + 13} className="ob-val-barre" textAnchor="middle">{signe(v)}</text>}
              </g>
            );
          })}
          {s.points.map((q, i) => (i % pasEtiq === 0 || (n <= 12)) && (
            <text key={i} x={xc(i)} y={H - 6} className={`tb-axe${q.enCours ? ' ob-axe-fort' : ''}`} textAnchor="middle">{q.libelle}</text>
          ))}

          {p && (
            <g pointerEvents="none">
              <rect x={xc(survol!) - pas / 2} y={m.h} width={pas} height={H - m.h - 20} className="ob-colonne" />
              {p.courant !== null && <circle cx={xc(survol!)} cy={y(p.courant)} r={5.5} className="ob-point-courant" />}
              {p.precedent !== null && <circle cx={xc(survol!)} cy={y(p.precedent)} r={4.5} className="ob-point-precedent" />}
            </g>
          )}
          <rect x={m.g} y={m.h} width={w} height={H - m.h - 20} fill="transparent" onMouseMove={bouger} onMouseLeave={() => setSurvol(null)} />
        </svg>
      )}
      {p && (
        <div className={`tb-infobulle ob-bulle${xc(survol!) > L * 0.62 ? ' gauche' : ''}`} style={{ left: xc(survol!), top: m.h }}>
          <strong>{p.titre}{p.enCours ? ' · en cours' : ''}</strong>
          <span><Trait style="courant" />{s.courant} : <b>{p.courant !== null ? pl(p.courant, 'commande') : 'à venir'}</b></span>
          {p.precedent !== null && s.precedent && <span><Trait style="precedent" />{s.precedent} : <b>{pl(p.precedent, 'commande')}</b></span>}
          {p.reference !== null && s.reference && <span><Trait style="objectif" />{s.reference} : <b>{p.reference.toLocaleString('fr-FR')}</b></span>}
          {p.variation !== null && <span className="ob-bulle-var"><Variation v={p.variation} /> {s.comparaison}</span>}
          {p.enCours && <em>Tranche entamée : comparée au même instant de la période de comparaison.</em>}
          {p.variation !== null && faible(p) && <em>Volume trop faible pour que la variation soit significative.</em>}
        </div>
      )}
    </div>
  );
}

function TableCommandes({ s }: { s: Series }) {
  return (
    <div className="ob-table-boite">
      <table className="ob-table">
        <caption className="tb-sr">Niveau des commandes, {s.comparaison}</caption>
        <thead><tr><th>Tranche</th><th>{s.courant}</th>{s.precedent && <th>{s.precedent}</th>}{s.reference && <th>{s.reference}</th>}<th>Hausse ou baisse</th></tr></thead>
        <tbody>
          {s.points.map((p) => (
            <tr key={p.libelle}>
              <td>{p.titre}{p.enCours ? ' (en cours)' : ''}</td>
              <td>{p.courant ?? '—'}</td>
              {s.precedent && <td>{p.precedent ?? '—'}</td>}
              {s.reference && <td>{p.reference?.toLocaleString('fr-FR') ?? '—'}</td>}
              <td><Variation v={p.variation} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Petits éléments ------------------------------ */

function Segments<T extends string>({ label, valeur, options, onChange }: { label: string; valeur: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="ob-segments" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={v === valeur} className={v === valeur ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function BoutonTableau({ actif, onClick }: { actif: boolean; onClick: () => void }) {
  return (
    <button type="button" className="ob-bouton-tableau" aria-pressed={actif} onClick={onClick}>
      {actif ? <><IcoCourbe /> Voir la courbe</> : <><IcoTableau /> Voir les chiffres</>}
    </button>
  );
}

/** Échantillon de trait pour les légendes : plein, tirets ou pointillés. */
function Trait({ style }: { style: 'courant' | 'precedent' | 'objectif' }) {
  return (
    <svg width="22" height="8" className="ob-trait" aria-hidden>
      <line x1="1" x2="21" y1="4" y2="4" className={`ob-l-${style}`} />
    </svg>
  );
}

const Svg = ({ children, t = 16 }: { children: React.ReactNode; t?: number }) => (
  <svg viewBox="0 0 24 24" width={t} height={t} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoCoche = () => <Svg t={13}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
const IcoHausse = () => <Svg t={13}><path d="M4 17l6-6 4 4 6-7M14 8h6v6" /></Svg>;
const IcoBaisse = () => <Svg t={13}><path d="M4 7l6 6 4-4 6 7M14 16h6v-6" /></Svg>;
const IcoEgal = () => <Svg t={13}><path d="M5 12h14" /></Svg>;
const IcoCible = () => <Svg><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" /></Svg>;
const IcoPic = () => <Svg><path d="M3 20h18M6 16l4-8 3 5 2-3 3 6" /></Svg>;
const IcoCalendrier = () => <Svg><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></Svg>;
const IcoTableau = () => <Svg t={14}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M4 14.5h16M10 5v14" /></Svg>;
const IcoCourbe = () => <Svg t={14}><path d="M4 18l5-6 4 3 7-9" /></Svg>;
const ICONE_STATUT: Record<StatutObjectif, React.ReactNode> = { en_avance: <IcoHausse />, dans_les_temps: <IcoEgal />, en_retard: <IcoBaisse /> };
const ICONE_POINT: Record<AnalyseTableau['aRetenir'][number]['genre'], React.ReactNode> = {
  objectif: <IcoCible />, hausse: <Svg><path d="M4 17l6-6 4 4 6-7M14 8h6v6" /></Svg>, baisse: <Svg><path d="M4 7l6 6 4-4 6 7M14 16h6v-6" /></Svg>, pic: <IcoPic />, info: <IcoCalendrier />,
};
