import { randomInt } from 'node:crypto';
import type { Container } from '../../container.js';
import type { LatLng } from '../../core/geo.js';
import { genMatricule } from '../drivers/store.js';

/**
 * TEST DE CHARGE : prépare une flotte et une clientèle de test réalistes.
 *
 * Des milliers de conducteurs en ligne, répartis dans les communes d'Abidjan selon leur
 * poids réel (Yopougon, Cocody, Abobo d'abord), sur toutes les gammes (Bronze à
 * Diamant, motos de livraison), et des milliers de clients nommés. Les commandes, elles,
 * passent ensuite par les VRAIES routes publiques (devis, commande, SOS) : le test mesure
 * la plateforme telle qu'elle tourne, pas un raccourci.
 *
 * Jamais disponible en production (voir la route) : on ne fabrique pas de faux
 * conducteurs sur un serveur qui sert de vrais clients.
 */

/** Communes d'Abidjan : centre et poids dans la demande. */
export const COMMUNES: Array<{ nom: string; centre: LatLng; poids: number }> = [
  { nom: 'Yopougon', centre: { lat: 5.3365, lng: -4.0760 }, poids: 18 },
  { nom: 'Cocody', centre: { lat: 5.3600, lng: -3.9870 }, poids: 17 },
  { nom: 'Abobo', centre: { lat: 5.4200, lng: -4.0180 }, poids: 13 },
  { nom: 'Adjamé', centre: { lat: 5.3560, lng: -4.0230 }, poids: 9 },
  { nom: 'Plateau', centre: { lat: 5.3230, lng: -4.0190 }, poids: 8 },
  { nom: 'Marcory', centre: { lat: 5.3040, lng: -3.9830 }, poids: 8 },
  { nom: 'Koumassi', centre: { lat: 5.2960, lng: -3.9530 }, poids: 7 },
  { nom: 'Treichville', centre: { lat: 5.2960, lng: -4.0060 }, poids: 6 },
  { nom: 'Riviera', centre: { lat: 5.3700, lng: -3.9520 }, poids: 6 },
  { nom: 'Port-Bouët', centre: { lat: 5.2560, lng: -3.9400 }, poids: 5 },
  { nom: 'Deux Plateaux', centre: { lat: 5.3780, lng: -3.9990 }, poids: 5 },
];
const POIDS_TOTAL = COMMUNES.reduce((s, c) => s + c.poids, 0);

const PRENOMS = ['Aya', 'Konan', 'Awa', 'Yao', 'Fatou', 'Koffi', 'Mariam', 'Ibrahim', 'Adjoua', 'Moussa', 'Aminata', 'Serge', 'Affoué', 'Seydou',
  'Grâce', 'Didier', 'Bintou', 'Hervé', 'Salimata', 'Arsène', 'Akissi', 'Lacina', 'Nadège', 'Yacouba', 'Christelle', 'Ousmane', 'Ange', 'Kadidja'];
const NOMS = ['Kouassi', 'Yao', 'Koné', 'Traoré', 'Ouattara', 'Coulibaly', 'Diallo', 'Bamba', 'Kouamé', 'Touré', 'Cissé', 'Diomandé', 'Kouadio',
  'N’Guessan', 'Assi', 'Gbagbo', 'Sanogo', 'Doumbia', 'Aka', 'Brou', 'Tanoh', 'Konaté', 'Soro', 'Fofana'];

/** Gammes de la flotte de test : la moto (livraison) en plus des quatre niveaux de course. */
const GAMMES: Array<{ categorie: string; poids: number }> = [
  { categorie: 'bronze', poids: 40 }, { categorie: 'argent', poids: 24 }, { categorie: 'or', poids: 12 },
  { categorie: 'diamant', poids: 6 }, { categorie: 'moto', poids: 18 },
];

const tirer = <T extends { poids: number }>(liste: T[], total = liste.reduce((s, x) => s + x.poids, 0)): T => {
  let r = Math.random() * total;
  for (const x of liste) { r -= x.poids; if (r <= 0) return x; }
  return liste[liste.length - 1]!;
};
/** Écart gaussien (Box-Muller) : les conducteurs se concentrent au cœur des communes. */
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

export function pointDansAbidjan(ecart = 0.011): { point: LatLng; commune: string } {
  const c = tirer(COMMUNES, POIDS_TOTAL);
  return { point: { lat: c.centre.lat + gauss() * ecart, lng: c.centre.lng + gauss() * ecart }, commune: c.nom };
}

export const nomIvoirien = () => `${PRENOMS[randomInt(PRENOMS.length)]} ${NOMS[randomInt(NOMS.length)]}`;

export interface PreparationCharge {
  conducteurs: number;
  parGamme: Record<string, number>;
  clients: string[];
  dureeMs: number;
}

/** Identifiants créés par le test, pour les distinguer dans les mesures. */
export const IDS_CHARGE = { conducteurs: new Set<string>(), clients: new Set<string>() };

export async function preparerCharge(c: Container, demande: { conducteurs: number; clients: number }): Promise<PreparationCharge> {
  const debut = Date.now();
  const parGamme: Record<string, number> = {};
  const base = IDS_CHARGE.conducteurs.size;
  for (let i = 0; i < demande.conducteurs; i += 1) {
    const { categorie } = tirer(GAMMES);
    const id = `charge-conducteur-${String(base + i).padStart(6, '0')}`;
    const d = c.drivers.upsert({
      id,
      name: nomIvoirien(),
      matricule: genMatricule(),
      category: categorie,
      phone: `+22507${String(randomInt(10_000_000, 99_999_999))}`,
      kycStatus: 'active',
      availability: 'offline',
      ratingAvg: Math.round((4.5 + Math.random() * 0.5) * 100) / 100,
      ratingCount: randomInt(20, 1500),
      ...(categorie === 'moto' ? { vehicleModel: 'Scooter électrique', engine: 'electric' as const } : {}),
    });
    await c.drivers.goOnline(d.id, pointDansAbidjan().point);
    IDS_CHARGE.conducteurs.add(d.id);
    parGamme[categorie] = (parGamme[categorie] ?? 0) + 1;
  }
  const clients: string[] = [];
  const baseClients = IDS_CHARGE.clients.size;
  for (let i = 0; i < demande.clients; i += 1) {
    const id = `charge-client-${String(baseClients + i).padStart(6, '0')}`;
    c.clients.touch(id, { name: nomIvoirien(), phone: `+22505${String(randomInt(10_000_000, 99_999_999))}` });
    IDS_CHARGE.clients.add(id);
    clients.push(id);
  }
  return { conducteurs: demande.conducteurs, parGamme, clients, dureeMs: Date.now() - debut };
}

const ALERTE_OUVERTE = new Set(['raised', 'dispatched', 'acknowledged']);

/** Mesures de la plateforme : serveur, calcul d'itinéraire, et volume métier en cours. */
export function mesuresPlateforme(c: Container) {
  // Compteurs tenus par le magasin des courses : aucun parcours de l'historique.
  const actives = c.rides.nombreActives;
  const total = c.rides.nombre;
  const conducteurs = c.drivers.list();
  const alertes = c.safety.list();
  return {
    genereLe: new Date().toISOString(),
    serveur: c.mesures.instantane(),
    routage: c.routage.etat(),
    // Bus entre instances : mode (local ou Redis), connexion, messages reçus, envoyés, perdus.
    tempsReel: c.realtime.etatBus(),
    plateforme: {
      coursesActives: actives,
      coursesTotal: total,
      conducteursEnLigne: conducteurs.filter((d) => d.availability !== 'offline').length,
      conducteursEnCourse: conducteurs.filter((d) => d.availability === 'on_trip').length,
      alertesOuvertes: alertes.filter((a) => ALERTE_OUVERTE.has(a.status)).length,
      alertesTotal: alertes.length,
    },
  };
}
