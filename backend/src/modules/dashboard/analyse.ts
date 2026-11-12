import type { Ride } from '../rides/store.js';
import type { ObjectifsFinanciers } from './objectifs.js';

/**
 * ANALYSE DU TABLEAU DE BORD : objectifs financiers et niveau des commandes.
 *
 *  - Finances : pour la journée, la semaine, le mois et l'année, le chiffre d'affaires
 *    réalisé face à l'objectif, la courbe cumulée face à celle de la période précédente
 *    et au rythme qu'exige l'objectif, la projection en fin de période.
 *  - Commandes : heure par heure (aujourd'hui, hier, moyenne des 4 mêmes jours), jour par
 *    jour (cette semaine, la précédente), sur 30 jours (tendance lissée) et mois par mois
 *    (cette année, la précédente), avec la variation de chaque tranche : hausse ou baisse.
 *
 * Le chiffre d'affaires est celui des courses et livraisons terminées, compté au moment
 * où elles se terminent. Une commande compte au moment où elle est passée, même annulée.
 *
 * Le rythme attendu d'une journée ou d'une semaine n'est pas une droite : à 9 h, une
 * journée ordinaire n'a fait qu'une petite part de son chiffre. On répartit donc
 * l'objectif selon le profil observé (heures sur 28 jours, jours sur 8 semaines), et la
 * projection de fin de période suit ce même profil.
 */

export type Periode = 'jour' | 'semaine' | 'mois' | 'annee';
export const PERIODES: Periode[] = ['jour', 'semaine', 'mois', 'annee'];
export interface Evenement { t: number; v: number }
export interface Sources { revenus: Evenement[]; commandes: Evenement[] }

const REVENU = new Set(['completed', 'paid', 'rated']);
const HEURE_MS = 3_600_000;
const JOUR_MS = 86_400_000;
const JOURS_COURTS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS_COURTS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} F`;
const pourcent = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} %`;
const variation = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : (a - b) / b);
const somme = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const cumuler = (xs: number[]) => { let s = 0; return xs.map((x) => (s += x)); };

function debutJour(d: Date | number): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function ajouterJours(d: Date | number, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function debutSemaine(d: Date): Date { const x = debutJour(d); return ajouterJours(x, -((x.getDay() + 6) % 7)); }

/** Courses et livraisons → commandes (à la création) et chiffre d'affaires (à la fin). */
export function evenementsDe(rides: Ride[]): Sources {
  const revenus: Evenement[] = [];
  const commandes: Evenement[] = [];
  for (const r of rides) {
    commandes.push({ t: Date.parse(r.createdAt), v: 1 });
    if (REVENU.has(r.status)) {
      const fin = r.events.find((e) => e.type === 'completed')?.at ?? r.createdAt;
      revenus.push({ t: Date.parse(fin), v: r.quote.amount });
    }
  }
  return { revenus, commandes };
}

interface Tranche { libelle: string; debut: number; fin: number; precDebut: number; precFin: number }
interface Fenetre { debut: number; fin: number; precDebut: number; precFin: number; tranches: Tranche[] }

/** Découpage d'une période en tranches (heures, jours, mois) et de la période précédente. */
function fenetre(p: Periode, maintenant: Date): Fenetre {
  if (p === 'jour') {
    const d = +debutJour(maintenant);
    const pd = +debutJour(ajouterJours(d, -1));
    return {
      debut: d, fin: +ajouterJours(d, 1), precDebut: pd, precFin: d,
      tranches: Array.from({ length: 24 }, (_, h) => ({ libelle: `${h} h`, debut: d + h * HEURE_MS, fin: d + (h + 1) * HEURE_MS, precDebut: pd + h * HEURE_MS, precFin: pd + (h + 1) * HEURE_MS })),
    };
  }
  if (p === 'semaine') {
    const d = debutSemaine(maintenant);
    const pd = ajouterJours(d, -7);
    return {
      debut: +d, fin: +ajouterJours(d, 7), precDebut: +pd, precFin: +d,
      tranches: JOURS_COURTS.map((l, i) => ({ libelle: l, debut: +ajouterJours(d, i), fin: +ajouterJours(d, i + 1), precDebut: +ajouterJours(pd, i), precFin: +ajouterJours(pd, i + 1) })),
    };
  }
  if (p === 'mois') {
    const a = maintenant.getFullYear();
    const m = maintenant.getMonth();
    const d = new Date(a, m, 1);
    const pd = new Date(a, m - 1, 1);
    const nb = new Date(a, m + 1, 0).getDate();
    return {
      debut: +d, fin: +new Date(a, m + 1, 1), precDebut: +pd, precFin: +d,
      tranches: Array.from({ length: nb }, (_, i) => ({
        libelle: `${i + 1}`, debut: +ajouterJours(d, i), fin: +ajouterJours(d, i + 1),
        // Jour i du mois précédent (vide si ce mois-là était plus court).
        precDebut: Math.min(+ajouterJours(pd, i), +d), precFin: Math.min(+ajouterJours(pd, i + 1), +d),
      })),
    };
  }
  const a = maintenant.getFullYear();
  return {
    debut: +new Date(a, 0, 1), fin: +new Date(a + 1, 0, 1), precDebut: +new Date(a - 1, 0, 1), precFin: +new Date(a, 0, 1),
    tranches: MOIS_COURTS.map((l, i) => ({
      libelle: l, debut: +new Date(a, i, 1), fin: +new Date(a, i + 1, 1),
      precDebut: +new Date(a - 1, i, 1), precFin: +new Date(a - 1, i + 1, 1),
    })),
  };
}

/** Indice de la tranche contenant `t`, par recherche dichotomique (tranches contiguës). */
function indice(tranches: Tranche[], t: number, prec: boolean): number {
  let lo = 0;
  let hi = tranches.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tr = tranches[mid]!;
    const deb = prec ? tr.precDebut : tr.debut;
    const fin = prec ? tr.precFin : tr.fin;
    if (t < deb) hi = mid - 1;
    else if (t >= fin) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Somme par tranche, pour la période courante et la précédente. `precedentPartiel` compte,
 * pour chaque tranche précédente, ce qui s'était passé au même instant relatif que
 * maintenant dans la tranche en cours : comparer une heure entamée à une heure pleine
 * annoncerait une baisse qui n'en est pas une.
 */
function parTranche(f: Fenetre, evts: Evenement[], maintenant: number) {
  const courant = f.tranches.map(() => 0);
  const precedent = f.tranches.map(() => 0);
  const precedentPartiel = f.tranches.map(() => 0);
  const enCours = maintenant >= f.fin ? f.tranches.length - 1 : indice(f.tranches, maintenant, false);
  const ecouleDansTranche = enCours >= 0 ? maintenant - f.tranches[enCours]!.debut : 0;
  const ecouleDansPeriode = maintenant - f.debut;
  let precedentMemeMoment = 0;
  for (const e of evts) {
    if (e.t >= f.debut && e.t < f.fin) {
      if (e.t > maintenant) continue;
      const i = indice(f.tranches, e.t, false);
      if (i >= 0) courant[i]! += e.v;
    } else if (e.t >= f.precDebut && e.t < f.precFin) {
      const i = indice(f.tranches, e.t, true);
      if (i < 0) continue;
      precedent[i]! += e.v;
      if (e.t - f.tranches[i]!.precDebut <= ecouleDansTranche) precedentPartiel[i]! += e.v;
      if (e.t - f.precDebut <= ecouleDansPeriode) precedentMemeMoment += e.v;
    }
  }
  return { courant, precedent, precedentPartiel, enCours, precedentMemeMoment };
}

/**
 * Part de l'activité d'une période habituellement réalisée à la fin de chaque tranche,
 * apprise sur les périodes passées. Sans historique : une droite.
 */
function profil(f: Fenetre, p: Periode, revenus: Evenement[], maintenant: Date): number[] {
  const lineaire = f.tranches.map((tr) => (tr.fin - f.debut) / (f.fin - f.debut));
  if (p !== 'jour' && p !== 'semaine') return lineaire;
  const poids = f.tranches.map(() => 0);
  const fin = p === 'jour' ? +debutJour(maintenant) : +debutSemaine(maintenant);
  const debut = p === 'jour' ? +ajouterJours(fin, -28) : +ajouterJours(fin, -56);
  for (const e of revenus) {
    if (e.t < debut || e.t >= fin) continue;
    const d = new Date(e.t);
    poids[p === 'jour' ? d.getHours() : (d.getDay() + 6) % 7]! += e.v;
  }
  const total = somme(poids);
  if (total <= 0) return lineaire;
  return cumuler(poids).map((x) => x / total);
}

/** Part attendue de la période à l'instant `maintenant`, au sein de la tranche en cours. */
function partAttendue(f: Fenetre, cumul: number[], enCours: number, maintenant: number): number {
  if (maintenant >= f.fin) return 1;
  if (enCours < 0) return 0;
  const tr = f.tranches[enCours]!;
  const avant = enCours > 0 ? cumul[enCours - 1]! : 0;
  return avant + (cumul[enCours]! - avant) * ((maintenant - tr.debut) / (tr.fin - tr.debut));
}

export type StatutObjectif = 'en_avance' | 'dans_les_temps' | 'en_retard';
export interface PointCourbe { libelle: string; courant: number | null; precedent: number; objectif: number; montant: number | null; montantPrecedent: number }
export interface AnalysePeriode {
  objectif: number; realise: number; progression: number; fractionEcoulee: number;
  rythmeAttendu: number; statut: StatutObjectif; projection: number | null; projectionRatio: number | null;
  precedentMemeMoment: number; precedentTotal: number; variation: number | null; reste: number;
  courbe: PointCourbe[];
}
export interface PointCommandes { libelle: string; courant: number | null; precedent: number; variation: number | null; enCours?: boolean; moyenne?: number }

export function analyser(sources: Sources, objectifs: ObjectifsFinanciers, maintenant = new Date(), historiqueDemo = false) {
  const now = +maintenant;
  const { revenus, commandes } = sources;

  /* ------------------------------ Finances ------------------------------ */
  const finances = {} as Record<Periode, AnalysePeriode>;
  for (const p of PERIODES) {
    const f = fenetre(p, maintenant);
    const objectif = objectifs[p];
    const { courant, precedent, enCours, precedentMemeMoment } = parTranche(f, revenus, now);
    const cumulProfil = profil(f, p, revenus, maintenant);
    const part = partAttendue(f, cumulProfil, enCours, now);
    const fraction = Math.min(1, Math.max(0, (now - f.debut) / (f.fin - f.debut)));
    const realise = somme(courant);
    const rythme = objectif * part;
    const ratio = rythme > 0 ? realise / rythme : 1;
    const statut: StatutObjectif = ratio >= 1.05 ? 'en_avance' : ratio >= 0.95 ? 'dans_les_temps' : 'en_retard';
    // Trop tôt dans la période, une projection ne veut rien dire.
    const projection = part >= 0.06 ? Math.round(realise / part) : null;
    const cumulCourant = cumuler(courant);
    const cumulPrecedent = cumuler(precedent);
    finances[p] = {
      objectif, realise: Math.round(realise), progression: objectif ? realise / objectif : 0,
      fractionEcoulee: fraction, rythmeAttendu: Math.round(rythme), statut,
      projection, projectionRatio: projection !== null && objectif ? projection / objectif : null,
      precedentMemeMoment: Math.round(precedentMemeMoment), precedentTotal: Math.round(somme(precedent)),
      variation: variation(realise, precedentMemeMoment), reste: Math.max(0, Math.round(objectif - realise)),
      courbe: f.tranches.map((tr, i) => ({
        libelle: tr.libelle,
        courant: i <= enCours ? Math.round(cumulCourant[i]!) : null,
        precedent: Math.round(cumulPrecedent[i]!),
        objectif: Math.round(objectif * cumulProfil[i]!),
        montant: i <= enCours ? Math.round(courant[i]!) : null,
        montantPrecedent: Math.round(precedent[i]!),
      })),
    };
  }

  /* ------------------------------ Commandes ------------------------------ */
  /** Tranches passées et en cours ; celle en cours se compare au même instant de la précédente. */
  const serie = (p: Periode): PointCommandes[] => {
    const f = fenetre(p, maintenant);
    const t = parTranche(f, commandes, now);
    return f.tranches.map((tr, i) => {
      const passe = i <= t.enCours;
      const courant = passe ? t.courant[i]! : null;
      const reference = i === t.enCours ? t.precedentPartiel[i]! : t.precedent[i]!;
      return { libelle: tr.libelle, courant, precedent: t.precedent[i]!, variation: passe ? variation(courant, reference) : null, ...(i === t.enCours ? { enCours: true } : {}) };
    });
  };

  // Heure par heure, avec la moyenne des 4 mêmes jours de semaine précédents.
  const parHeure = serie('jour');
  const moyenne4 = Array.from({ length: 24 }, () => 0);
  for (let k = 1; k <= 4; k++) {
    const d = +debutJour(ajouterJours(maintenant, -7 * k));
    const f = +debutJour(ajouterJours(d, 1));
    for (const e of commandes) if (e.t >= d && e.t < f) moyenne4[new Date(e.t).getHours()]! += 0.25;
  }
  parHeure.forEach((h, i) => { h.moyenne = Math.round(moyenne4[i]! * 10) / 10; });
  const parJour = serie('semaine');
  const parMois = serie('annee');

  // 30 derniers jours (aujourd'hui compris, entamé) et moyenne glissante sur 7 jours pleins.
  const aujourdhui = +debutJour(maintenant);
  const jours37 = Array.from({ length: 37 }, (_, i) => +ajouterJours(aujourdhui, i - 36));
  const quotidien = Array.from({ length: 37 }, () => 0);
  // Aujourd'hui, entamé, se compare au même jour de la semaine passée jusqu'à la même heure.
  const ilYa7 = jours37[29]!;
  const ilYa7MemeHeure = ilYa7 + (now - aujourdhui);
  let partielIlYa7 = 0;
  for (const e of commandes) {
    if (e.t < jours37[0]! || e.t > now) continue;
    const i = jours37.indexOf(+debutJour(e.t));
    if (i >= 0) quotidien[i]! += 1;
    if (e.t >= ilYa7 && e.t <= ilYa7MemeHeure) partielIlYa7 += 1;
  }
  const trenteJours = Array.from({ length: 30 }, (_, k) => {
    const i = k + 7;
    const d = new Date(jours37[i]!);
    const partiel = i === 36;
    // Pour aujourd'hui, la moyenne porte sur les 7 jours pleins qui précèdent.
    const fenetre7 = partiel ? quotidien.slice(i - 7, i) : quotidien.slice(i - 6, i + 1);
    return {
      libelle: `${d.getDate()}/${d.getMonth() + 1}`, jour: JOURS_COURTS[(d.getDay() + 6) % 7]!,
      commandes: quotidien[i]!, moyenne7: Math.round((somme(fenetre7) / 7) * 10) / 10,
      semainePrecedente: quotidien[i - 7]!, variation: variation(quotidien[i]!, partiel ? partielIlYa7 : quotidien[i - 7]!),
      ...(partiel ? { enCours: true } : {}),
    };
  });

  /* ------------------------------ À retenir ------------------------------ */
  const aRetenir: Array<{ genre: 'objectif' | 'hausse' | 'baisse' | 'pic' | 'info'; texte: string }> = [];
  const fj = finances.jour;
  aRetenir.push({
    genre: fj.statut === 'en_retard' ? 'baisse' : 'objectif',
    texte: `Aujourd’hui : ${fcfa(fj.realise)} encaissés sur un objectif de ${fcfa(fj.objectif)}, soit ${Math.round(fj.progression * 100)} %`
      + (fj.projection !== null ? `. Au rythme actuel : environ ${fcfa(fj.projection)} en fin de journée.` : '.'),
  });
  const fm = finances.mois;
  // Le mois n'est rappelé que s'il s'écarte du rythme : sa carte dit déjà le reste.
  if (fm.statut !== 'dans_les_temps') aRetenir.push({
    genre: fm.statut === 'en_retard' ? 'baisse' : 'objectif',
    texte: `Ce mois : ${Math.round(fm.progression * 100)} % de l’objectif atteints à ${Math.round(fm.fractionEcoulee * 100)} % du mois, `
      + (fm.statut === 'en_retard' ? `en retard sur le rythme attendu. Reste ${fcfa(fm.reste)} à réaliser.` : fm.statut === 'en_avance' ? 'en avance sur le rythme attendu.' : 'dans les temps.'),
  });
  const heuresPleines = parHeure.filter((h) => h.courant !== null && !h.enCours);
  const pic = parHeure.filter((h) => h.courant !== null).reduce<PointCommandes | null>((m, h) => (!m || (h.courant ?? 0) > (m.courant ?? 0) ? h : m), null);
  if (pic && (pic.courant ?? 0) >= 3) aRetenir.push({ genre: 'pic', texte: `Heure la plus chargée aujourd’hui : ${pic.libelle}, avec ${pic.courant} commandes.` });
  const comparables = heuresPleines.filter((h) => h.variation !== null && Math.max(h.courant ?? 0, h.precedent) >= 4);
  const hausse = comparables.reduce<PointCommandes | null>((m, h) => (!m || h.variation! > m.variation! ? h : m), null);
  const baisse = comparables.reduce<PointCommandes | null>((m, h) => (!m || h.variation! < m.variation! ? h : m), null);
  if (hausse && hausse.variation! > 0.05) aRetenir.push({ genre: 'hausse', texte: `Plus forte hausse : ${hausse.libelle}, ${pourcent(hausse.variation!)} par rapport à hier (${hausse.precedent} → ${hausse.courant} commandes).` });
  if (baisse && baisse.variation! < -0.05) aRetenir.push({ genre: 'baisse', texte: `Plus forte baisse : ${baisse.libelle}, ${pourcent(baisse.variation!)} par rapport à hier (${baisse.precedent} → ${baisse.courant} commandes).` });
  // 7 jours pleins (jusqu'à hier) face aux 7 précédents.
  const sept = somme(quotidien.slice(29, 36));
  const septAvant = somme(quotidien.slice(22, 29));
  const tendance = variation(sept, septAvant);
  if (tendance !== null) aRetenir.push({ genre: tendance >= 0 ? 'hausse' : 'baisse', texte: `Sur les 7 derniers jours : ${sept.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} commandes, ${pourcent(tendance)} par rapport aux 7 jours d’avant.` });
  // Jour de la semaine le plus chargé, en moyenne sur les 4 dernières semaines pleines.
  const parJourSemaine = Array.from({ length: 7 }, () => 0);
  const debut28 = +ajouterJours(aujourdhui, -28);
  for (const e of commandes) if (e.t >= debut28 && e.t < aujourdhui) parJourSemaine[new Date(e.t).getDay()]! += 1;
  const meilleur = parJourSemaine.indexOf(Math.max(...parJourSemaine));
  if (parJourSemaine[meilleur]! > 0) aRetenir.push({ genre: 'info', texte: `Le ${JOURS_LONGS[meilleur]} est le jour le plus chargé : ${Math.round(parJourSemaine[meilleur]! / 4)} commande${parJourSemaine[meilleur]! / 4 >= 1.5 ? 's' : ''} en moyenne sur 4 semaines.` });

  return {
    genereLe: maintenant.toISOString(),
    devise: 'XOF',
    historiqueDemo,
    objectifs,
    finances,
    commandes: { parHeure, parJour, trenteJours, parMois, heureCourante: maintenant.getHours(), jourCourant: JOURS_LONGS[maintenant.getDay()]! },
    aRetenir,
  };
}

export type AnalyseTableau = ReturnType<typeof analyser>;

/* ------------------------- Historique de démonstration ------------------------- */

/** Générateur pseudo-aléatoire déterministe : le même jour donne toujours les mêmes chiffres. */
function mulberry32(graine: number) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Profil d'une journée à Abidjan : pointe du matin, creux de midi, forte pointe du soir.
const PROFIL_HEURES = [0.3, 0.2, 0.15, 0.1, 0.15, 0.5, 1.6, 3.2, 3.6, 2.4, 1.8, 1.9, 2.4, 2.2, 1.7, 1.8, 2.3, 3.3, 3.8, 3.2, 2.4, 1.8, 1.2, 0.7];
const CUMUL_HEURES = cumuler(PROFIL_HEURES).map((x) => x / somme(PROFIL_HEURES));
// Dimanche → samedi : le vendredi et le samedi sont les plus chargés.
const FACTEUR_JOUR = [0.8, 0.92, 0.95, 0.97, 1.0, 1.15, 1.18];
const FACTEUR_MOIS = [0.95, 0.97, 1.0, 1.0, 0.98, 0.97, 0.96, 0.93, 1.0, 1.02, 1.04, 1.12];

/**
 * Historique synthétique, réservé au développement et aux démonstrations (jamais en
 * production) : sans lui, un serveur qui vient de démarrer montre des courbes vides.
 * Les volumes visent les objectifs par défaut, avec une croissance d'environ 28 % par an.
 * Chaque jour est tiré d'une graine fixe : les chiffres ne bougent pas d'un appel à l'autre.
 */
export function historiqueDemo(jours: number, maintenant = new Date()): Sources {
  const revenus: Evenement[] = [];
  const commandes: Evenement[] = [];
  const now = +maintenant;
  const aujourdhui = debutJour(maintenant);
  for (let k = jours; k >= 0; k--) {
    const jour = ajouterJours(aujourdhui, -k);
    const alea = mulberry32(Math.round(+jour / JOUR_MS) * 2_654_435_761);
    const croissance = 1 / (1 + 0.28 * (k / 365));
    const volume = Math.round(150 * croissance * FACTEUR_JOUR[jour.getDay()]! * FACTEUR_MOIS[jour.getMonth()]! * (0.86 + 0.28 * alea()));
    for (let n = 0; n < volume; n++) {
      const u = alea();
      const h = Math.max(0, CUMUL_HEURES.findIndex((c) => u <= c));
      const t = +jour + h * HEURE_MS + Math.floor(alea() * HEURE_MS);
      const livraison = alea() < 0.24;
      const annulee = alea() < 0.07;
      const r = alea();
      const montant = livraison ? 1000 + Math.round((r * 1500) / 50) * 50
        : r > 0.97 ? 9000 + Math.round((alea() * 6000) / 50) * 50
          : 1800 + Math.round((r * r * 5200) / 50) * 50;
      const fin = t + (12 + Math.floor(alea() * 25)) * 60_000;
      if (t <= now) commandes.push({ t, v: 1 });
      if (!annulee && fin <= now) revenus.push({ t: fin, v: montant });
    }
  }
  return { revenus, commandes };
}
