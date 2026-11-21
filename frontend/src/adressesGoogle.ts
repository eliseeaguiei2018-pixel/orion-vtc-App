import type { LatLng } from './types';
import { dansLeDelai, etatService, noterEchec, noterReponse, oublierEtat, ouvrirGoogle, type EtatService } from './servicesGoogle';

/**
 * ADRESSES GOOGLE — le nom de la rue d'une position (GPS du téléphone, point choisi sur la carte).
 *
 * Service « Geocoding API ». ORION connaît le quartier d'un point ; Google ajoute la rue.
 * Sans réponse de Google en deux secondes et demie, l'application garde le quartier seul.
 */
interface Composant { long_name: string; types: string[] }
interface Resultat { types: string[]; address_components: Composant[] }
interface BibliAdresses { Geocoder: new () => { geocode(r: Record<string, unknown>): Promise<{ results: Resultat[] }> } }

export interface RueGoogle { rue: string; commune?: string }

const cache = new Map<string, Promise<RueGoogle | null>>();
const SANS_NOM = /^(unnamed road|route sans nom|voie sans nom)$/i;
/** Référence de voirie (« C 20 », « D 30 », « A 100 ») : exacte, mais personne ne s'en sert pour se repérer. */
const REFERENCE = /^[A-Z]{1,2}\s?\d{1,4}$/;

export const etatAdresses = (): EtatService => etatService('adresses');

/** Rue (et commune) d'un point, d'après Google ; null si Google ne la connaît pas ou ne répond pas. */
export function rueGoogle(p: LatLng): Promise<RueGoogle | null> {
  const cle = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;          // une dizaine de mètres : la même rue
  const deja = cache.get(cle);
  if (deja) return deja;
  const promesse = dansLeDelai(chercher(p), 2500);
  cache.set(cle, promesse);
  void promesse.then((r) => { if (!r) cache.delete(cle); });
  if (cache.size > 80) for (const k of [...cache.keys()].slice(0, cache.size - 80)) cache.delete(k);
  return promesse;
}

async function chercher(p: LatLng): Promise<RueGoogle | null> {
  const maps = await ouvrirGoogle('adresses');
  if (!maps) return null;
  try {
    const { Geocoder } = await maps.importLibrary('geocoding') as BibliAdresses;
    const { results } = await new Geocoder().geocode({ location: p, language: 'fr', region: 'ci' });
    noterReponse('adresses');
    for (const r of results ?? []) {
      if (r.types.includes('plus_code')) continue;
      const composant = (...types: string[]) => r.address_components.find((c) => types.some((t) => c.types.includes(t)))?.long_name;
      const rue = composant('route');
      if (!rue || SANS_NOM.test(rue) || REFERENCE.test(rue.trim())) continue;
      const commune = composant('sublocality_level_1', 'sublocality', 'neighborhood') ?? composant('locality');
      return { rue, commune: commune && commune !== rue ? commune : undefined };
    }
    return null;
  } catch (e) {
    // « Aucun résultat » est une réponse de Google, pas une panne.
    if (/ZERO_RESULTS/.test(`${String((e as { code?: unknown }).code ?? '')} ${String((e as Error).message ?? '')}`)) { noterReponse('adresses'); return null; }
    noterEchec('adresses', e);
    return null;
  }
}

/** Nouvel essai demandé par le client (Menu → Carte → « Vérifier ») : une adresse au Plateau. */
export async function verifierAdresses(): Promise<EtatService> {
  oublierEtat('adresses');
  cache.clear();
  await rueGoogle({ lat: 5.3237, lng: -4.017 });
  return etatAdresses();
}
