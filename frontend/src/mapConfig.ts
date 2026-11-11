/**
 * Fond de carte ORION.
 *
 * Par défaut : VRAIE carte vectorielle de la Côte d'Ivoire, dessinée par l'app à partir
 * des données OpenStreetMap (routes, ponts, échangeurs, voies en construction, quartiers,
 * lagune), servies par OpenFreeMap (gratuit, sans clé, mises à jour chaque semaine).
 * Le style est celui d'ORION : sombre ou clair, itinéraire à la couleur choisie.
 *
 * Variables d'environnement (facultatives) :
 *  - VITE_MAP_TILES_URL : source vectorielle (TileJSON) d'un serveur de tuiles ORION.
 *  - VITE_MAP_GLYPHS_URL : polices des libellés, au format « {fontstack}/{range}.pbf ».
 *  - VITE_MAP_PROVIDER=stylise : force la carte stylisée hors-ligne (démo sans réseau).
 *
 * Sans réseau, ou si les tuiles ne répondent pas, l'app bascule d'elle-même sur la carte
 * stylisée : la course n'est jamais bloquée par la carte.
 */
export interface VectorConfig {
  tiles: string;
  glyphs: string;
  attribution: string;
}

const env = import.meta.env as Record<string, string | undefined>;

export function getVectorConfig(): VectorConfig | null {
  if ((env.VITE_MAP_PROVIDER ?? '').toLowerCase() === 'stylise') return null;
  return {
    tiles: env.VITE_MAP_TILES_URL ?? 'https://tiles.openfreemap.org/planet',
    glyphs: env.VITE_MAP_GLYPHS_URL ?? 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    attribution: '© OpenStreetMap · OpenFreeMap',
  };
}
