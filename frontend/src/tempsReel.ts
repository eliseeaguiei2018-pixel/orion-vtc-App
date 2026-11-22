/**
 * APK DE TEST « TEMPS RÉEL » — une app client installée À PART de l'app officielle, pour
 * comparer les prix d'ORION à ceux de la concurrence dans les conditions réelles.
 *
 * Construite avec VITE_TEMPS_REEL=1 (voir scripts/construire-apk-test.sh). Elle contient
 * toute l'app client, avec trois différences, toutes affichées au client :
 *
 *  1. Le trafic du prix est le trafic RÉEL de Google au moment de la commande (durée avec
 *     circulation comparée à la durée sans circulation), et non plus l'estimation par
 *     l'heure et le quartier.
 *  2. Le temps facturé est le temps prévu AVEC le trafic (et non à vitesse libre).
 *  3. L'APPROCHE du chauffeur compte : distance et temps par la route, trafic compris,
 *     depuis la vraie position du chauffeur le plus proche (la mini console de test) jusqu'au
 *     point de prise en charge. Les premiers kilomètres et minutes sont offerts.
 *
 * La carte Google affiche aussi la couche du trafic en direct. Le prix reste FIXE une fois
 * la course commandée. Rien de tout cela ne touche l'app officielle tant que le fondateur
 * ne l'a pas validé.
 */
import { useEffect, useState } from 'react';
import type { LatLng } from './types';
import { itineraireGoogle } from './itineraireGoogle';
import { chauffeurLibre, suivreBus } from './busTest';

export const TEMPS_REEL = import.meta.env.VITE_TEMPS_REEL === '1';

/** Barème de l'approche (test). Affiché dans « Pourquoi ce prix ». */
export const REGLES_TEST = {
  /** Approche comprise dans le prix de base. */
  approcheOfferteKm: 2, approcheOfferteMin: 5,
  /** Au-delà, par kilomètre et par minute d'approche (trafic compris), hors taxes. */
  parKmApproche: 100, parMinApproche: 18,
};

export type NiveauTrafic = 'fluid' | 'dense' | 'jam';

/**
 * Niveau de trafic réel : rapport entre la durée prévue avec la circulation du moment et la
 * durée sans circulation, tous deux donnés par Google pour CE trajet. Mêmes trois niveaux
 * (et mêmes coefficients) que la règle d'ORION : fluide ×1, dense ×1,15, embouteillage ×1,35.
 */
export function traficReel(dureeTrafic: number, dureeFluide: number): { level: NiveauTrafic; factor: number; ratio: number } {
  const ratio = dureeFluide > 0 && dureeTrafic > 0 ? dureeTrafic / dureeFluide : 1;
  if (ratio >= 1.5) return { level: 'jam', factor: 1.35, ratio };
  if (ratio >= 1.15) return { level: 'dense', factor: 1.15, ratio };
  return { level: 'fluid', factor: 1, ratio };
}

/** Coût de l'approche (hors taxes) au-delà de la part offerte. */
export function coutApproche(distanceMeters: number, durationSeconds: number): number {
  const km = Math.max(0, distanceMeters / 1000 - REGLES_TEST.approcheOfferteKm);
  const min = Math.max(0, durationSeconds / 60 - REGLES_TEST.approcheOfferteMin);
  return km * REGLES_TEST.parKmApproche + min * REGLES_TEST.parMinApproche;
}

export interface ApprocheTest {
  chauffeurId: string; nom: string; depuis: LatLng;
  distanceMeters: number; durationSeconds: number; fluideSeconds: number;
  /** Trajet donné par Google (sinon : estimation à vol d'oiseau, hors connexion). */
  google: boolean; geometrie: LatLng[] | null;
  /** Point de prise en charge visé (clé arrondie). */
  vers: string; at: number;
}

const cle = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
const distance = (a: LatLng, b: LatLng) => {
  const R = 6_371_000, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

let approche: ApprocheTest | null = null;
const abonnes = new Set<() => void>();
/** Approche connue pour ce point de prise en charge (celle qui entre dans le prix). */
export const approcheConnue = (pickup: LatLng): ApprocheTest | null => (approche && approche.vers === cle(pickup) ? approche : null);

/** Calcule l'approche d'un chauffeur jusqu'au point de prise en charge, trafic compris. */
export async function calculerApproche(depuis: LatLng, pickup: LatLng): Promise<Omit<ApprocheTest, 'chauffeurId' | 'nom' | 'vers' | 'at'>> {
  const r = await itineraireGoogle([depuis, pickup]);
  if (r) return { depuis, distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds, fluideSeconds: r.fluideSeconds ?? r.durationSeconds, google: true, geometrie: r.geometrie };
  const m = distance(depuis, pickup) * 1.3;
  const s = Math.round((m / 1000 / 24) * 3600);
  return { depuis, distanceMeters: m, durationSeconds: s, fluideSeconds: s, google: false, geometrie: null };
}

/**
 * Suit le chauffeur de test le plus proche (registre partagé) et son approche jusqu'au point
 * de prise en charge. Le prix se recalcule quand le chauffeur bouge (curseur de la console).
 */
export function useApprocheTest(pickup: LatLng | null): ApprocheTest | null {
  const [a, setA] = useState<ApprocheTest | null>(() => (pickup ? approcheConnue(pickup) : null));
  const k = pickup ? cle(pickup) : '';
  useEffect(() => {
    if (!TEMPS_REEL || !pickup) return;
    let dernier = '';
    let actif = true;
    const majLocale = () => setA(approcheConnue(pickup));
    abonnes.add(majLocale);
    const arret = suivreBus((e) => {
      const libres = e.chauffeurs.filter((c) => chauffeurLibre(c) && c.position);
      const ch = libres.sort((x, y) => distance(x.position!, pickup) - distance(y.position!, pickup))[0];
      if (!ch) {
        if (approche?.vers === k) { approche = null; abonnes.forEach((f) => f()); }
        dernier = '';
        return;
      }
      const signature = `${ch.id}@${cle(ch.position!)}>${k}`;
      if (signature === dernier) return;
      dernier = signature;
      void calculerApproche(ch.position!, pickup).then((r) => {
        if (!actif || dernier !== signature) return;
        approche = { ...r, chauffeurId: ch.id, nom: ch.nom, vers: k, at: Date.now() };
        abonnes.forEach((f) => f());
      });
    }, 3000);
    return () => { actif = false; arret(); abonnes.delete(majLocale); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return a;
}
