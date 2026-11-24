import { z } from 'zod';
import type { Container } from '../../container.js';

/**
 * SIMULATEUR DE FLOTTE du PDG (Mon poste) : les hypothèses du plan de croissance d'ORION
 * (marché visé, productivité, recharge, livraison) et les mesures RÉELLES du pilote qui
 * permettent de les recaler. Le calcul lui-même se fait dans la console, en direct ; le
 * serveur garde le plan enregistré (partagé entre les appareils de la direction) et mesure.
 */
export interface PlanFlotte {
  /** Marché VTC du district (courses par jour) — hypothèse à confirmer. */
  marcheCoursesJour: number;
  /** Part de ce marché visée par ORION (%). */
  partVisee: number;
  /** Courses par voiture et par jour (deux équipes) ; le pilote la mesure. */
  coursesParVoitureJour: number;
  /** Part de la flotte disponible aux heures de pointe (recharge, entretien, repos), en %. */
  disponibilite: number;
  /** Marge pour absorber la pointe (%). */
  margePointe: number;
  /** Répartition des voitures par gamme (%) ; l'Argent prend le reste. */
  gammes: { or: number; diamant: number };
  /** Équipes de chauffeurs par voiture, et remplaçants (%). */
  equipes: number;
  remplacants: number;
  /** Recharge : km par voiture et par jour, consommation, voitures par borne rapide… */
  kmParVoitureJour: number;
  kwhPar100: number;
  voituresParBorne: number;
  bornesParDepot: number;
  puissanceBorneKw: number;
  /** Livraison : colis par jour visés, colis par moto et par jour, part et cadence du cargo. */
  livraisonsJour: number;
  coursesParMotoJour: number;
  partCargo: number;
  coursesParCargoJour: number;
  /** Flotte de voitures prévue par ORION (calcul inverse : ce qu'elle permet de servir). */
  objectifFlotte: number;
  modifie?: { le: string; par: string };
}

export const PLAN_FLOTTE_DEFAUT: PlanFlotte = {
  marcheCoursesJour: 150_000, partVisee: 40, coursesParVoitureJour: 18, disponibilite: 85, margePointe: 25,
  gammes: { or: 20, diamant: 5 }, equipes: 2, remplacants: 10,
  kmParVoitureJour: 300, kwhPar100: 15, voituresParBorne: 9, bornesParDepot: 25, puissanceBorneKw: 60,
  livraisonsJour: 15_000, coursesParMotoJour: 25, partCargo: 1, coursesParCargoJour: 4,
  objectifFlotte: 5000,
};

export const schemaPlanFlotte = z.object({
  marcheCoursesJour: z.number().int().min(1000).max(5_000_000),
  partVisee: z.number().min(0.5).max(100),
  coursesParVoitureJour: z.number().min(1).max(60),
  disponibilite: z.number().min(30).max(100),
  margePointe: z.number().min(0).max(200),
  gammes: z.object({ or: z.number().min(0).max(100), diamant: z.number().min(0).max(100) }).refine((g) => g.or + g.diamant <= 100, 'L’Or et le Diamant dépassent 100 % de la flotte.'),
  equipes: z.number().int().min(1).max(3),
  remplacants: z.number().min(0).max(50),
  kmParVoitureJour: z.number().min(20).max(1000),
  kwhPar100: z.number().min(5).max(40),
  voituresParBorne: z.number().min(1).max(50),
  bornesParDepot: z.number().int().min(1).max(500),
  puissanceBorneKw: z.number().min(7).max(400),
  livraisonsJour: z.number().int().min(0).max(5_000_000),
  coursesParMotoJour: z.number().min(1).max(80),
  partCargo: z.number().min(0).max(100),
  coursesParCargoJour: z.number().min(0.5).max(40),
  objectifFlotte: z.number().int().min(1).max(200_000),
});

const TERMINEES = new Set(['completed', 'paid', 'rated']);
const GAMMES_VOITURE = ['argent', 'or', 'diamant'] as const;
const JOUR_MS = 24 * 3600 * 1000;

/** Médiane (null sans valeur). */
function mediane(v: number[]): number | null {
  if (v.length === 0) return null;
  const t = [...v].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m]! : (t[m - 1]! + t[m]!) / 2;
}

/**
 * Mesures du pilote sur les 7 derniers jours : flotte validée par gamme, en ligne et en
 * course maintenant, courses terminées par voiture active et par jour, part des demandes
 * restées sans chauffeur, approche médiane (acceptation → arrivée au client).
 */
export function mesuresPilote(c: Pick<Container, 'drivers' | 'rides'>, maintenant = Date.now()) {
  const chauffeurs = c.drivers.list();
  const valides = chauffeurs.filter((d) => d.kycStatus === 'active');
  const parGamme = (g: string) => valides.filter((d) => d.category === g).length;
  const voituresValidees = GAMMES_VOITURE.reduce((s, g) => s + parGamme(g), 0);
  const enLigne = chauffeurs.filter((d) => d.availability !== 'offline' && GAMMES_VOITURE.includes(d.category as never));
  const enCourse = enLigne.filter((d) => d.availability === 'on_trip');

  const fenetre = c.rides.createdSince(maintenant - 7 * JOUR_MS);
  const courses = fenetre.filter((r) => r.serviceType !== 'delivery');
  const terminees = courses.filter((r) => TERMINEES.has(r.status));
  const voituresActives = new Set(terminees.map((r) => r.driverId).filter(Boolean)).size;
  const premiere = fenetre.length ? Math.min(...fenetre.map((r) => Date.parse(r.createdAt))) : maintenant;
  const jours = Math.min(7, Math.max(1, Math.ceil((maintenant - premiere) / JOUR_MS)));
  const sansChauffeur = courses.filter((r) => r.status === 'no_driver' || r.events.some((e) => e.type === 'no_driver')).length;
  const approches = courses.map((r) => {
    const a = r.events.find((e) => e.type === 'accepted')?.at;
    const b = r.events.find((e) => e.type === 'arrived')?.at;
    return a && b ? (Date.parse(b) - Date.parse(a)) / 60000 : null;
  }).filter((m): m is number => m !== null && m >= 0 && m < 120);
  const livraisons = fenetre.filter((r) => r.serviceType === 'delivery' && TERMINEES.has(r.status)).length;
  const med = mediane(approches);

  return {
    flotte: {
      argent: parGamme('argent'), or: parGamme('or'), diamant: parGamme('diamant'),
      voitures: voituresValidees, motos: parGamme('moto'), cargos: parGamme('cargo'),
    },
    enLigne: enLigne.length,
    enCourse: enCourse.length,
    /** Part des voitures en ligne occupées maintenant (%), null si aucune en ligne. */
    occupation: enLigne.length ? Math.round((enCourse.length / enLigne.length) * 100) : null,
    jours,
    coursesTerminees: terminees.length,
    livraisonsTerminees: livraisons,
    voituresActives,
    /** Courses terminées par voiture active et par jour — null tant que le pilote n'a rien mesuré. */
    coursesParVoitureJour: voituresActives ? Math.round((terminees.length / voituresActives / jours) * 10) / 10 : null,
    sansChauffeurPct: courses.length ? Math.round((sansChauffeur / courses.length) * 1000) / 10 : null,
    approcheMedianeMin: med === null ? null : Math.round(med * 10) / 10,
    demandes: courses.length,
  };
}
