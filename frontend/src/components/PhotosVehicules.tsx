/**
 * VRAIES PHOTOS DES VÉHICULES DE LA FLOTTE ORION.
 *
 * Photos libres de droits (Wikimedia Commons : domaine public CC0, ou licences CC BY /
 * CC BY-SA avec mention de l'auteur), détourées pour se poser sur les cartes de l'app.
 * Les auteurs et licences sont listés dans CREDITS_PHOTOS, affichés dans les mentions
 * légales de l'app : c'est la condition d'utilisation de ces photos.
 */

export type IdPhoto =
  | 'avatr-12' | 'aito-m9' | 'maextro-s800' | 'yangwang-u7' | 'nio-es9' | 'nio-et9'
  | 'stelato-s9' | 'zeekr-8x' | 'geely-galaxy-e8' | 'deepal-s07' | 'bmw-ce-04';

export interface CreditPhoto {
  id: IdPhoto;
  modele: string;
  auteur: string;
  licence: string;
  source: string;
}

/** Rempli à la génération des photos (auteur, licence et page source de chaque fichier). */
export { CREDITS_PHOTOS } from './creditsPhotos';
import { CREDITS_PHOTOS } from './creditsPhotos';

const DISPONIBLES = new Set<IdPhoto>(CREDITS_PHOTOS.map((c) => c.id));

export const photoDisponible = (id: IdPhoto) => DISPONIBLES.has(id);

const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');
export const urlPhoto = (id: IdPhoto) => `${base}vehicules/${id}.webp`;

/** Gammes ORION → modèle représentatif (premier modèle de la gamme). */
export const PHOTO_DE_GAMME: Record<string, IdPhoto> = {
  bronze: 'geely-galaxy-e8', argent: 'deepal-s07', or: 'avatr-12', diamant: 'stelato-s9',
};

/** Modèle cité dans un texte (« AVATR 12 », « Huawei AITO M9 »…) → photo, si on l'a. */
export function photoDuModele(nom: string): IdPhoto | null {
  const n = nom.toLowerCase();
  const table: Array<[RegExp, IdPhoto]> = [
    [/avatr\s*0?12/, 'avatr-12'], [/aito\s*m?9/, 'aito-m9'], [/maextro/, 'maextro-s800'], [/yangwang/, 'yangwang-u7'],
    [/es9/, 'nio-es9'], [/et9/, 'nio-et9'], [/stelato/, 'stelato-s9'], [/zeekr\s*8x/, 'zeekr-8x'],
    [/galaxy\s*e8/, 'geely-galaxy-e8'], [/deepal\s*s07/, 'deepal-s07'],
  ];
  const trouve = table.find(([re]) => re.test(n))?.[1] ?? null;
  return trouve && photoDisponible(trouve) ? trouve : null;
}

export function PhotoVehicule({ id, largeur, className = '', alt }: { id: IdPhoto; largeur: number; className?: string; alt?: string }) {
  const c = CREDITS_PHOTOS.find((x) => x.id === id);
  return (
    <img
      className={`photo-vehicule ${className}`}
      src={urlPhoto(id)}
      width={largeur}
      alt={alt ?? c?.modele ?? ''}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

/** Médaillon de gamme (Bronze, Argent, Or, Diamant) : métal de la gamme, initiale gravée. */
export function MedaillonGamme({ gamme, taille = 44 }: { gamme: string; taille?: number }) {
  const lettre = gamme === 'diamant' ? '◆' : (gamme[0] ?? '').toUpperCase();
  return (
    <span className={`medaillon medaillon-${gamme}`} style={{ width: taille, height: taille, fontSize: taille * 0.42 }} aria-hidden>
      {lettre}
    </span>
  );
}
