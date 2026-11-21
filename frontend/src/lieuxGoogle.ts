import type { LatLng, Place } from './types';
import { cleGoogle } from './carteGoogle';
import { etatService, motifService, noterEchec, noterReponse, oublierEtat, ouvrirGoogle, suivreServices, type EtatService } from './servicesGoogle';

/**
 * RECHERCHE DE LIEUX GOOGLE — les lieux de Google Maps dans la recherche d'adresses.
 *
 * Afficher la carte de Google et chercher dans ses lieux sont DEUX services distincts chez
 * Google : « Maps JavaScript API » dessine la carte, « Places API (New) » répond aux
 * recherches. Une clé peut autoriser l'un sans l'autre. On ne peut donc pas savoir d'avance
 * si la recherche Google est ouverte : on l'essaie, et l'application retient la réponse.
 *
 *  - `suggestionsGoogle` : suggestions au fil de la frappe (5 au plus, c'est la règle de
 *    Google). Le lieu n'a pas encore de position : `resoudreLieuGoogle` la demande au
 *    moment où le client le choisit.
 *  - `rechercheTexteGoogle` : tous les lieux répondant à une recherche (« FAO »), chacun
 *    avec sa position, comme dans l'application Google Maps.
 *
 * Si Google refuse (service non activé sur le projet de la clé), la recherche reste celle
 * d'ORION : voir `servicesGoogle` pour l'état retenu et les nouveaux essais.
 */
export type EtatPlaces = EtatService;

interface Texte { text: string }
interface LieuGoogle {
  id: string; displayName?: string | null; formattedAddress?: string | null; shortFormattedAddress?: string | null;
  location?: { lat(): number; lng(): number } | null; primaryType?: string | null; types?: string[] | null;
  fetchFields(o: { fields: string[] }): Promise<unknown>;
}
interface Prediction {
  placeId: string; text: Texte; mainText?: Texte | null; secondaryText?: Texte | null; distanceMeters?: number | null; types?: string[] | null;
  toPlace(): LieuGoogle;
}
interface BibliPlaces {
  AutocompleteSuggestion: { fetchAutocompleteSuggestions(r: Record<string, unknown>): Promise<{ suggestions: Array<{ placePrediction: Prediction | null }> }> };
  AutocompleteSessionToken: new () => unknown;
  Place: { searchByText(r: Record<string, unknown>): Promise<{ places: LieuGoogle[] }> };
}

/** Centre d'Abidjan et emprise de la Côte d'Ivoire : la recherche ne sort pas du pays. */
const ABIDJAN: LatLng = { lat: 5.3364, lng: -4.0267 };
const dansLePays = (p: LatLng) => p.lat > 4.2 && p.lat < 10.8 && p.lng > -8.7 && p.lng < -2.4;

let jeton: unknown = null;
const predictions = new Map<string, Prediction>();

export const etatPlaces = (): EtatPlaces => etatService('lieux');
/** Ce que Google a répondu en refusant (pour le montrer tel quel au propriétaire de la clé). */
export const motifPlaces = (): string => motifService('lieux');
export const suivreEtatPlaces = suivreServices;

/** Type de lieu de Google → pictogramme ORION. */
const PICTOS: Array<[RegExp, string]> = [
  [/pharmacy|drugstore/, 'pharmacy'], [/hospital|doctor|clinic|medical|dentist/, 'hospital'], [/bank|atm|finance/, 'bank'],
  [/lodging|hotel|motel|guest_house/, 'lodging'], [/mosque/, 'religious_muslim'], [/church|place_of_worship|synagogue|temple/, 'religious_christian'],
  [/university|school|library/, 'school'], [/gas_station|fuel|charging/, 'fuel'], [/airport/, 'airport'], [/police/, 'police'], [/fire_station/, 'fire_station'],
  [/bus_|train_|transit|subway|ferry|taxi_stand/, 'bus'], [/supermarket|grocery|market/, 'grocery'], [/restaurant|food|meal|cafe|bakery|bar/, 'restaurant'],
  [/park|garden|zoo|beach/, 'park'], [/museum|movie|theater|stadium|night_club|casino|tourist|amusement/, 'cinema'], [/route|street|intersection/, 'road'],
  [/store|shop|mall/, 'shop'], [/embassy|government|city_hall|courthouse|office|corporate|premise|establishment/, 'building'],
];
function picto(types: string[] | null | undefined, principal?: string | null): string | undefined {
  const liste = [principal, ...(types ?? [])].filter((x): x is string => Boolean(x));
  for (const type of liste) for (const [re, p] of PICTOS) if (re.test(type)) return p;
  return undefined;
}

const classer = (e: unknown): void => noterEchec('lieux', e);
const fixer = (_: 'actif'): void => noterReponse('lieux');

async function bibliotheque(): Promise<BibliPlaces | null> {
  const maps = await ouvrirGoogle('lieux');
  if (!maps) return null;
  try {
    return await maps.importLibrary('places') as BibliPlaces;
  } catch (e) {
    classer(e);
    return null;
  }
}

/** Zone privilégiée : cinquante kilomètres autour du client (ou d'Abidjan). */
const autour = (pres?: LatLng) => ({ center: pres && dansLePays(pres) ? pres : ABIDJAN, radius: 50_000 });

/** Suggestions au fil de la frappe. Tableau vide si Google n'est pas disponible. */
export async function suggestionsGoogle(q: string, pres?: LatLng): Promise<Place[]> {
  const lib = await bibliotheque();
  if (!lib) return [];
  try {
    jeton ??= new lib.AutocompleteSessionToken();
    const zone = autour(pres);
    const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: q, language: 'fr', region: 'ci', includedRegionCodes: ['ci'], origin: zone.center, locationBias: zone, sessionToken: jeton,
    });
    fixer('actif');
    const lieux: Place[] = [];
    for (const s of suggestions ?? []) {
      const p = s.placePrediction;
      if (!p?.placeId) continue;
      predictions.set(p.placeId, p);
      lieux.push({
        id: `google:${p.placeId}`, name: p.mainText?.text || p.text.text, area: p.secondaryText?.text ?? '', location: zone.center,
        googleId: p.placeId, aResoudre: true, categorie: picto(p.types),
      });
    }
    if (predictions.size > 60) for (const k of [...predictions.keys()].slice(0, predictions.size - 60)) predictions.delete(k);
    return lieux;
  } catch (e) {
    classer(e);
    return [];
  }
}

/** Position et nom exacts d'une suggestion, au moment où le client la choisit. */
export async function resoudreLieuGoogle(p: Place): Promise<Place> {
  if (!p.aResoudre || !p.googleId) return p;
  const lib = await bibliotheque();
  const prediction = predictions.get(p.googleId);
  if (!lib || !prediction) throw new Error('lieu-google-indisponible');
  try {
    const lieu = prediction.toPlace();
    await lieu.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
    jeton = null;                                   // la session de recherche se termine avec le détail du lieu
    if (!lieu.location) throw new Error('lieu-sans-position');
    const position = { lat: lieu.location.lat(), lng: lieu.location.lng() };
    // Le nom reste celui que le client a touché dans la liste : Google renvoie parfois un autre
    // nom pour le même lieu (« Riviéra Golf » devenait « Riviéra 1 »).
    return { id: p.id, name: p.name || lieu.displayName || '', area: p.area || lieu.formattedAddress || '', location: position, googleId: p.googleId, categorie: p.categorie };
  } catch (e) {
    if ((e as Error).message !== 'lieu-sans-position') classer(e);
    throw e;
  }
}

/** Tous les lieux répondant à une recherche, chacun avec sa position (jusqu'à vingt). */
export async function rechercheTexteGoogle(q: string, pres?: LatLng): Promise<Place[]> {
  const lib = await bibliotheque();
  if (!lib) return [];
  try {
    const zone = autour(pres);
    const { places } = await lib.Place.searchByText({
      textQuery: q, fields: ['displayName', 'formattedAddress', 'location', 'primaryType', 'types'],
      locationBias: zone, maxResultCount: 20, language: 'fr', region: 'ci',
    });
    fixer('actif');
    const lieux: Place[] = [];
    for (const l of places ?? []) {
      if (!l.location) continue;
      const position = { lat: l.location.lat(), lng: l.location.lng() };
      if (!dansLePays(position)) continue;
      lieux.push({ id: `google:${l.id}`, name: l.displayName || q, area: l.formattedAddress ?? '', location: position, googleId: l.id, categorie: picto(l.types, l.primaryType) });
    }
    return lieux;
  } catch (e) {
    classer(e);
    return [];
  }
}

/** Nouvel essai demandé par le client (Menu → Carte → « Vérifier ») : une suggestion suffit. */
export async function verifierPlaces(): Promise<EtatPlaces> {
  if (!cleGoogle()) return 'sans-cle';
  oublierEtat('lieux');
  await suggestionsGoogle('Abidjan');
  return etatPlaces();
}
