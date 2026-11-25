import type { Container } from '../../container.js';
import type { Ride } from '../rides/store.js';
import type { PrimeConfig } from '../settings/service.js';
import { moisDe } from '../drivers/store.js';

/**
 * ACTIVITÉ DU MOIS ET PRIME DE PERFORMANCE — chauffeurs salariés d'ORION.
 *
 * Les chauffeurs d'ORION sont salariés, payés au mois, sur des véhicules d'ORION : il
 * n'y a ni commission ni gain par course. L'app leur montre ce qu'ils ont accompli
 * (courses, kilomètres, heures en service, recettes encaissées pour ORION, note, taux
 * d'acceptation) et où ils en sont de leur prime de performance du mois.
 */

/** Statuts d'une course réalisée (le passager est arrivé). */
const REALISEE = new Set(['completed', 'paid', 'rated']);

/** Mois `AAAA-MM` → bornes [début, fin[ en ms (Abidjan = UTC, sans heure d'été). */
export function bornesDuMois(mois: string): { debut: number; fin: number } {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return { debut: Date.UTC(a, m - 1, 1), fin: Date.UTC(a, m, 1) };
}

/** Mois demandé, s'il est valide ; sinon le mois en cours. */
export function moisValide(mois: string | undefined): string {
  return mois && /^\d{4}-(0[1-9]|1[0-2])$/.test(mois) ? mois : moisDe(Date.now());
}

/** Moment où la course a été réalisée (arrivée), à défaut sa création. */
function realiseeLe(r: Ride): number {
  const fin = r.events.find((e) => e.type === 'completed' || (e.type === 'transition' && (e.payload as { to?: string } | undefined)?.to === 'completed'));
  return Date.parse(fin?.at ?? r.createdAt);
}

export interface ActiviteMois {
  mois: string;
  courses: number;
  livraisons: number;
  km: number;
  /** Montant des courses réalisées (prix payé par les clients, encaissé pour ORION). */
  recettes: number;
  /** Espèces reçues des clients, à remettre à ORION. */
  especes: number;
  heuresService: number;
  joursActifs: number;
  note: { moyenne: number | null; nombre: number };
  offres: { recues: number; acceptees: number; refusees: number; expirees: number; tauxAcceptation: number | null };
  annulations: number;
  aujourdhui: { courses: number; km: number; recettes: number; heuresService: number };
  parJour: Array<{ jour: string; courses: number; km: number; heures: number }>;
}

/** Activité d'un chauffeur pour un mois (le mois en cours par défaut). */
export function activiteDuMois(c: Container, driverId: string, moisDemande?: string): ActiviteMois {
  const mois = moisValide(moisDemande);
  const { debut, fin } = bornesDuMois(mois);
  const d = c.drivers.get(driverId);
  const realisees = c.rides.listByDriver(driverId).filter((r) => {
    if (!REALISEE.has(r.status)) return false;
    const t = realiseeLe(r);
    return t >= debut && t < fin;
  });
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const parJour = new Map<string, { courses: number; km: number; heures: number }>();
  let km = 0, recettes = 0, especes = 0, livraisons = 0, notes = 0, totalNotes = 0;
  const auj = { courses: 0, km: 0, recettes: 0, heuresService: 0 };
  for (const r of realisees) {
    const jour = new Date(realiseeLe(r)).toISOString().slice(0, 10);
    const k = (r.quote.distanceMeters ?? 0) / 1000;
    km += k;
    recettes += r.quote.amount;
    if (r.serviceType === 'delivery') livraisons += 1;
    const paye = r.events.find((e) => e.type === 'paid')?.payload as { method?: string; amount?: number } | undefined;
    if (paye?.method === 'cash') especes += paye.amount ?? r.quote.amount;
    const note = r.events.find((e) => e.type === 'rated')?.payload as { stars?: number } | undefined;
    if (typeof note?.stars === 'number') { notes += 1; totalNotes += note.stars; }
    const j = parJour.get(jour) ?? { courses: 0, km: 0, heures: 0 };
    j.courses += 1; j.km += k;
    parJour.set(jour, j);
    if (jour === aujourdHui) { auj.courses += 1; auj.km += k; auj.recettes += r.quote.amount; }
  }
  const service = c.drivers.minutesDeService(driverId, debut, Math.min(fin, Date.now()));
  for (const [jour, minutes] of Object.entries(service.parJour)) {
    const j = parJour.get(jour) ?? { courses: 0, km: 0, heures: 0 };
    j.heures = Math.round((minutes / 60) * 10) / 10;
    parJour.set(jour, j);
    if (jour === aujourdHui) auj.heuresService = j.heures;
  }
  const offres = d?.offresParMois?.[mois] ?? { recues: 0, acceptees: 0, refusees: 0, expirees: 0 };
  const repondues = offres.acceptees + offres.refusees + offres.expirees;
  return {
    mois,
    courses: realisees.length,
    livraisons,
    km: Math.round(km * 10) / 10,
    recettes: Math.round(recettes),
    especes: Math.round(especes),
    heuresService: Math.round((service.total / 60) * 10) / 10,
    joursActifs: [...parJour.values()].filter((j) => j.courses > 0 || j.heures >= 0.5).length,
    note: { moyenne: notes ? Math.round((totalNotes / notes) * 100) / 100 : null, nombre: notes },
    offres: { ...offres, tauxAcceptation: repondues ? Math.round((offres.acceptees / repondues) * 100) : null },
    annulations: d?.annulationsParMois?.[mois] ?? 0,
    aujourdhui: { ...auj, km: Math.round(auj.km * 10) / 10 },
    parJour: [...parJour.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([jour, j]) => ({ jour, courses: j.courses, km: Math.round(j.km * 10) / 10, heures: j.heures })),
  };
}

export interface ConditionPrime { id: 'note' | 'acceptation' | 'annulations'; libelle: string; valeur: number | null; seuil: number; ok: boolean; enAttente: boolean }
export interface BonusPrime { id: 'excellence' | 'assiduite'; libelle: string; montant: number; acquis: boolean; progression: number; detail: string }
export interface PrimeMois {
  mois: string;
  actif: boolean;
  courses: number;
  paliers: PrimeConfig['paliers'];
  palier: { courses: number; montant: number } | null;
  prochain: { courses: number; montant: number; reste: number } | null;
  conditions: ConditionPrime[];
  bonus: BonusPrime[];
  /** Ce que le chauffeur toucherait si le mois s'arrêtait maintenant. */
  montantEstime: number;
  /** Ce qu'il toucherait au palier le plus haut, conditions tenues et bonus acquis. */
  montantMax: number;
  /** Le mois est-il clos (prime définitive) ? */
  clos: boolean;
  activite: ActiviteMois;
}

const fmtNote = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** Prime de performance d'un chauffeur pour un mois, d'après la grille réglée en console. */
export function primeDuMois(c: Container, driverId: string, moisDemande?: string): PrimeMois {
  const grille = c.settings.getOps().prime;
  const activite = activiteDuMois(c, driverId, moisDemande);
  const { fin } = bornesDuMois(activite.mois);
  const clos = Date.now() >= fin;
  const paliers = grille.paliers;
  const atteints = paliers.filter((p) => activite.courses >= p.courses);
  const palier = atteints[atteints.length - 1] ?? null;
  const suivant = paliers.find((p) => activite.courses < p.courses);

  // Conditions de qualité : tant qu'il n'y a pas de données (aucune note, aucune offre),
  // la condition est « en attente », pas perdue.
  const conditions: ConditionPrime[] = [];
  if (grille.noteMin > 0) {
    const v = activite.note.moyenne;
    conditions.push({ id: 'note', libelle: `Note moyenne d'au moins ${fmtNote(grille.noteMin)}`, valeur: v, seuil: grille.noteMin, ok: v === null || v >= grille.noteMin, enAttente: v === null });
  }
  if (grille.tauxAcceptationMin > 0) {
    const v = activite.offres.tauxAcceptation;
    conditions.push({ id: 'acceptation', libelle: `Au moins ${grille.tauxAcceptationMin} % d'offres acceptées`, valeur: v, seuil: grille.tauxAcceptationMin, ok: v === null || v >= grille.tauxAcceptationMin, enAttente: v === null });
  }
  conditions.push({ id: 'annulations', libelle: `${grille.annulationsMax} annulation${grille.annulationsMax > 1 ? 's' : ''} au plus`, valeur: activite.annulations, seuil: grille.annulationsMax, ok: activite.annulations <= grille.annulationsMax, enAttente: false });
  const conditionsTenues = conditions.every((x) => x.ok);

  const be = grille.bonusExcellence;
  const ba = grille.bonusAssiduite;
  const bonus: BonusPrime[] = [];
  if (be.montant > 0) {
    const n = activite.note;
    const acquis = n.moyenne !== null && n.moyenne >= be.note && n.nombre >= be.minNotes;
    bonus.push({
      id: 'excellence', libelle: 'Bonus excellence', montant: be.montant, acquis,
      progression: be.minNotes > 0 ? Math.min(1, n.nombre / be.minNotes) : 1,
      detail: `Note d'au moins ${fmtNote(be.note)} sur ${be.minNotes} notes ou plus (${n.nombre} note${n.nombre > 1 ? 's' : ''}${n.moyenne !== null ? `, ${fmtNote(n.moyenne)}` : ''})`,
    });
  }
  if (ba.montant > 0) {
    const h = activite.heuresService;
    bonus.push({
      id: 'assiduite', libelle: 'Bonus assiduité', montant: ba.montant, acquis: h >= ba.heures,
      progression: ba.heures > 0 ? Math.min(1, h / ba.heures) : 1,
      detail: `${ba.heures} h en service dans le mois (${h.toLocaleString('fr-FR')} h)`,
    });
  }
  const actif = grille.actif;
  const montantEstime = !actif || !conditionsTenues ? 0
    : (palier?.montant ?? 0) + bonus.filter((b) => b.acquis).reduce((s, b) => s + b.montant, 0);
  const montantMax = !actif ? 0 : (paliers[paliers.length - 1]?.montant ?? 0) + bonus.reduce((s, b) => s + b.montant, 0);
  return {
    mois: activite.mois, actif, courses: activite.courses, paliers,
    palier, prochain: suivant ? { ...suivant, reste: suivant.courses - activite.courses } : null,
    conditions, bonus, montantEstime, montantMax, clos, activite,
  };
}
