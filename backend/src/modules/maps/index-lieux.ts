import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/**
 * INDEX DES LIEUX DU DISTRICT D'ABIDJAN — le même fichier que celui livré avec les
 * applications (48 924 lieux : commerces, banques, sièges, écoles, lieux de culte, hôpitaux,
 * hôtels, rues nommées, arrêts, quartiers d'usage ; OpenStreetMap + Overture Maps).
 *
 * Le serveur le charge pour que TOUT client de l'API obtienne les mêmes résultats que les
 * applications ORION : écran de véhicule, intégration d'un constructeur, partenaire.
 * Il est lu une seule fois, à la première recherche (≈ 0,7 Mo compressé, quelques Mo en
 * mémoire). Absent ou illisible, la recherche garde les communes et les quartiers.
 */
export interface IndexLieux {
  communes: string[];
  /** [libellé, pictogramme, rang] — rang : 0 quartier, 2 rue, 3 lieu, 4 commerce de détail, 5 arrêt. */
  categories: Array<[libelle: string, pictogramme: string, rang: number]>;
  lieux: Array<[nom: string, lat: number, lng: number, categorie: number, commune: number]>;
  /** Noms normalisés (sans accents ni tirets), dans l'ordre de `lieux`. */
  cles: string[];
  /** Mots des libellés de catégorie, normalisés : « pharmacie », « mosquee », « supermarche »… */
  motsCategories: string[][];
}

export const sansAccents = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

const FICHIER = new URL('../../../data/lieux-index.json.gz', import.meta.url);
let index: IndexLieux | null | undefined;

export function indexLieux(): IndexLieux | null {
  if (index !== undefined) return index;
  try {
    const brut = JSON.parse(gunzipSync(readFileSync(FICHIER)).toString('utf8')) as Pick<IndexLieux, 'communes' | 'categories' | 'lieux'>;
    if (!Array.isArray(brut.lieux) || !Array.isArray(brut.categories)) throw new Error('index incomplet');
    index = {
      communes: brut.communes ?? [], categories: brut.categories, lieux: brut.lieux,
      cles: brut.lieux.map((l) => sansAccents(l[0])),
      motsCategories: brut.categories.map(([libelle]) => sansAccents(libelle).split(/[ ·]+/).filter(Boolean)),
    };
  } catch {
    index = null;
  }
  return index;
}
