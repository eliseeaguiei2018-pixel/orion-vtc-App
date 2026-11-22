import { useEffect, useState } from 'react';
import type { LatLng } from './types';
import { itineraire, variantesOrion, type ItineraireRoute } from './api';
import { itineraireGoogle, variantesGoogle } from './itineraireGoogle';
import { classerItineraires, meilleureVoieNormale, viasDeContournement, type Peage } from './routesAbidjan';
import { PEAGES_TARIF } from './tarifServeur';
import { dansLeDelai } from './servicesGoogle';

/**
 * PONT À PÉAGE OU VOIE NORMALE (app cliente).
 *
 * Quand le trajet peut passer par un péage (pont Henri-Konan-Bédié, 4ᵉ pont, autoroute de
 * Bassam…), le client choisit : par le péage — souvent plus court — ou par la voie normale.
 * Le prix suit l'itinéraire choisi : sa distance par la route, plus le péage s'il y en a un
 * (le péage n'est pas majoré par la gamme). Le serveur fait le même calcul
 * (`estimatePrice`, champs `itineraire`, `peages`, `routeMeters`).
 *
 * Les itinéraires viennent de Google (variantes et route sans péage), sinon du calcul
 * routier d'ORION (variantes d'OSRM). Google ne sait pas que les ponts d'Abidjan sont payants :
 * ses variantes passent toutes par le pont. La voie normale est alors cherchée par les points
 * de contournement de chaque péage (Plateau, Adjamé, ancienne route de Bassam), essayés en
 * même temps, puis, à défaut, parmi les variantes d'ORION. Un tracé est rangé « par le
 * péage » s'il passe à moins de 90 m d'un poste.
 */
export type ChoixItineraire = 'peage' | 'normal';
export interface OptionItineraire {
  choix: ChoixItineraire;
  route: ItineraireRoute;
  peages: Peage[];
  /** Montant des péages franchis (réglage de la console), F CFA. */
  montantPeage: number;
}
export interface Itineraires {
  peage: OptionItineraire | null;
  normal: OptionItineraire | null;
  /** Le plus rapide des deux : choisi par défaut. */
  defaut: ChoixItineraire;
}

const connus = new Map<string, Itineraires | null>();
const enCours = new Map<string, Promise<Itineraires | null>>();
const cle = (points: LatLng[]): string => points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');

const option = (choix: ChoixItineraire, route: ItineraireRoute, peages: Peage[]): OptionItineraire => ({
  choix, route, peages,
  montantPeage: peages.reduce((t, p) => t + (PEAGES_TARIF.find((x) => x.id === p.id)?.montant ?? p.montant), 0),
});

async function calculer(points: LatLng[]): Promise<Itineraires | null> {
  // Google d'abord (variantes + route qui évite les péages) ; sans Google, ORION.
  let routes: ItineraireRoute[] = await variantesGoogle(points).catch(() => []);
  if (routes.length === 0) routes = await variantesOrion(points).catch(() => []);
  if (routes.length === 0) { const r = await itineraire(points); if (r) routes = [r]; }
  if (routes.length === 0) return null;
  let { peage, normal } = classerItineraires(routes, PEAGES_TARIF as Peage[]);
  // Aucune voie normale proposée : on la cherche par les points de contournement des péages
  // franchis (tous essayés en même temps), puis parmi les variantes d'ORION.
  if (peage && !normal) {
    const liste = PEAGES_TARIF as Peage[];
    const detours = viasDeContournement(peage.peages).map((via) => [points[0]!, ...via, ...points.slice(1)]);
    const candidates = await Promise.all(detours.map((d) => itineraireGoogle(d).then((r) => r ?? itineraire(d)).catch(() => null)));
    let voie = meilleureVoieNormale(candidates.filter((r): r is ItineraireRoute => r !== null), liste);
    if (!voie) voie = meilleureVoieNormale(await variantesOrion(points).catch(() => []), liste);
    if (voie && voie.durationSeconds <= peage.route.durationSeconds * 3 + 1200) normal = { route: voie, peages: [] };
  }
  if (!peage && !normal) return null;
  const p = peage ? option('peage', peage.route, peage.peages) : null;
  const n = normal ? option('normal', normal.route, []) : null;
  const defaut: ChoixItineraire = p && (!n || p.route.durationSeconds <= n.route.durationSeconds) ? 'peage' : 'normal';
  return { peage: p, normal: n, defaut };
}

/** Itinéraires d'un trajet (une seule demande par suite de points) ; null si aucun calcul n'a répondu. */
export function chargerItineraires(points: LatLng[]): Promise<Itineraires | null> {
  const k = cle(points);
  if (connus.has(k)) return Promise.resolve(connus.get(k) ?? null);
  const deja = enCours.get(k);
  if (deja) return deja;
  const promesse = dansLeDelai(calculer(points), 10_000).then((r) => {
    enCours.delete(k);
    if (r) connus.set(k, r);
    if (connus.size > 40) for (const vieux of [...connus.keys()].slice(0, connus.size - 40)) connus.delete(vieux);
    return r ?? null;
  });
  enCours.set(k, promesse);
  return promesse;
}

/** Itinéraires pour un écran : `pret` passe à vrai quand le calcul a répondu (ou renoncé). */
export function useItineraires(points: LatLng[] | null): { pret: boolean; itineraires: Itineraires | null } {
  const k = points && points.length > 1 ? cle(points) : '';
  const [etat, setEtat] = useState<{ k: string; pret: boolean; itineraires: Itineraires | null }>(() => ({ k, pret: !k || connus.has(k), itineraires: k ? connus.get(k) ?? null : null }));
  useEffect(() => {
    if (!k || !points) { setEtat({ k, pret: true, itineraires: null }); return; }
    if (connus.has(k)) { setEtat({ k, pret: true, itineraires: connus.get(k) ?? null }); return; }
    let actif = true;
    setEtat({ k, pret: false, itineraires: null });
    void chargerItineraires(points).then((itineraires) => { if (actif) setEtat({ k, pret: true, itineraires }); });
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return etat.k === k ? { pret: etat.pret, itineraires: etat.itineraires } : { pret: !k || connus.has(k), itineraires: k ? connus.get(k) ?? null : null };
}

/** L'option retenue : celle que le client a choisie si elle existe, sinon la plus rapide. */
export function optionRetenue(it: Itineraires | null, choix: ChoixItineraire | null): OptionItineraire | null {
  if (!it) return null;
  return (choix ? it[choix] : null) ?? it[it.defaut] ?? it.peage ?? it.normal;
}

/** Le choix est-il à proposer ? Seulement quand les deux itinéraires existent. */
export const choixPropose = (it: Itineraires | null): boolean => Boolean(it?.peage && it?.normal);

/** Tracé allégé (au plus `max` points) pour l'envoyer au chauffeur sans alourdir la course. */
export function alleger(geo: LatLng[], max = 160): LatLng[] {
  if (geo.length <= max) return geo.map((p) => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) }));
  const pas = (geo.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => geo[Math.round(i * pas)]!).map((p) => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) }));
}
