import { chargerGoogle, cleGoogle } from './carteGoogle';

/**
 * SERVICES GOOGLE AU-DELÀ DE LA CARTE — lieux, itinéraires, adresses.
 *
 * Chez Google, chaque fonction est un service distinct, à activer sur le projet de la clé :
 *  - « Maps JavaScript API » dessine la carte ;
 *  - « Places API (New) » répond aux recherches de lieux ;
 *  - « Routes API » calcule les itinéraires, avec le trafic ;
 *  - « Geocoding API » donne le nom de la rue d'une position.
 * Une clé peut autoriser l'un sans l'autre, et rien ne permet de le savoir d'avance : on
 * essaie, et l'application retient la réponse de chaque service.
 *
 * Refus (service non activé) : plus d'essai jusqu'au prochain lancement ou à « Vérifier ».
 * Pas de réponse (réseau) : nouvel essai trente secondes plus tard. Dans les deux cas
 * l'application continue avec les données d'ORION.
 */
export type EtatService = 'sans-cle' | 'inconnu' | 'actif' | 'refuse' | 'injoignable';
export type ServiceGoogle = 'lieux' | 'itineraires' | 'adresses';

interface Fiche { etat: Exclude<EtatService, 'sans-cle'>; motif: string; reprise: number }
const vierge = (): Fiche => ({ etat: 'inconnu', motif: '', reprise: 0 });
const fiches: Record<ServiceGoogle, Fiche> = { lieux: vierge(), itineraires: vierge(), adresses: vierge() };
const abonnes = new Set<() => void>();
const prevenir = () => abonnes.forEach((f) => f());

export const etatService = (s: ServiceGoogle): EtatService => (cleGoogle() ? fiches[s].etat : 'sans-cle');
/** Ce que Google a répondu en refusant (pour le montrer tel quel au propriétaire de la clé). */
export const motifService = (s: ServiceGoogle): string => fiches[s].motif;
export function suivreServices(f: () => void): () => void { abonnes.add(f); return () => { abonnes.delete(f); }; }

function fixer(s: ServiceGoogle, etat: Fiche['etat'], motif = ''): void {
  const f = fiches[s];
  if (f.etat === etat && f.motif === motif) return;
  f.etat = etat; f.motif = motif;
  prevenir();
}

/** Google a répondu : le service est ouvert pour cette clé. */
export const noterReponse = (s: ServiceGoogle): void => fixer(s, 'actif');

const REFUS = /PERMISSION_DENIED|Permission denied|REQUEST_DENIED|not allowed|not authorized|not activated|not enabled|has not been used|is disabled|ApiNotActivated|ApiTargetBlocked|API_KEY|cle-refusee/i;
/** Range un échec : refus de Google (définitif pour la session) ou absence de réponse. */
export function noterEchec(s: ServiceGoogle, e: unknown): void {
  const err = e as { code?: unknown; message?: string };
  const texte = `${String(err?.code ?? '')} ${String(err?.message ?? e)}`.replace(/AIza[\w-]+/g, '').trim().slice(0, 180);
  if (REFUS.test(texte) || err?.code === 7) { fixer(s, 'refuse', texte); return; }
  fiches[s].reprise = Date.now() + 30_000;
  fixer(s, 'injoignable', texte);
}

/** Oublie la réponse retenue : le prochain appel réessaie (« Vérifier maintenant »). */
export function oublierEtat(s: ServiceGoogle): void { fiches[s] = vierge(); prevenir(); }

export interface ApiGoogle { importLibrary(nom: string): Promise<unknown> }
/** L'API de Google si le service peut être essayé maintenant ; null sinon. */
export async function ouvrirGoogle(s: ServiceGoogle): Promise<ApiGoogle | null> {
  const f = fiches[s];
  if (!cleGoogle() || f.etat === 'refuse' || (f.etat === 'injoignable' && Date.now() < f.reprise)) return null;
  try {
    await chargerGoogle();
    return (window as unknown as { google: { maps: ApiGoogle } }).google.maps;
  } catch (e) {
    noterEchec(s, e);
    return null;
  }
}

/** Réponse attendue dans un délai : au-delà, l'appelant continue sans Google. */
export function dansLeDelai<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((ok) => {
    const minuteur = setTimeout(() => ok(null), ms);
    void p.then((v) => { clearTimeout(minuteur); ok(v); }, () => { clearTimeout(minuteur); ok(null); });
  });
}
