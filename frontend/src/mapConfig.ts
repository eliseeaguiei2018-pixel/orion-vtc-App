/**
 * Fond de carte ORION.
 *
 * Par défaut : VRAIE carte vectorielle de la Côte d'Ivoire, dessinée par l'app à partir
 * des données OpenStreetMap (routes, ponts, échangeurs, voies en construction, quartiers,
 * lagune), servies par OpenFreeMap (gratuit, sans clé, mises à jour chaque semaine).
 * Le style est celui d'ORION : sombre ou clair, itinéraire à la couleur choisie.
 *
 * Variables d'environnement (facultatives) :
 *  - VITE_MAP_TILES_URL : source vectorielle d'un serveur de tuiles ORION : une adresse
 *    TileJSON, ou un modèle « …/{z}/{x}/{y}.pbf ». Une adresse relative (« ./tuiles/… »)
 *    désigne des tuiles livrées avec l'application (carte embarquée, sans Internet).
 *  - VITE_MAP_TILES_BOUNDS : emprise des tuiles livrées, « ouest,sud,est,nord ».
 *  - VITE_MAP_TILES_MAXZOOM : dernier niveau de zoom livré (au-delà, agrandissement).
 *  - VITE_MAP_GLYPHS_URL : polices des libellés, au format « {fontstack}/{range}.pbf ».
 *  - VITE_MAP_PROVIDER=stylise : force la carte stylisée hors-ligne (démo sans réseau).
 *
 * Sans réseau, ou si les tuiles ne répondent pas, l'app bascule d'elle-même sur la carte
 * stylisée : la course n'est jamais bloquée par la carte.
 */
export interface VectorConfig {
  /** Adresse TileJSON, ou modèle de tuiles contenant {z}/{x}/{y}. */
  tiles: string;
  glyphs: string;
  attribution: string;
  bounds?: [number, number, number, number];
  maxzoom?: number;
  /** Polices livrées avec l'app : dossiers sans espaces (« NotoSansRegular »). */
  policesLocales?: boolean;
}

const env = import.meta.env as Record<string, string | undefined>;

export function getVectorConfig(): VectorConfig | null {
  if ((env.VITE_MAP_PROVIDER ?? '').toLowerCase() === 'stylise') return null;
  const bornes = (env.VITE_MAP_TILES_BOUNDS ?? '').split(',').map(Number);
  return {
    tiles: absolu(env.VITE_MAP_TILES_URL ?? 'https://tiles.openfreemap.org/planet'),
    glyphs: absolu(env.VITE_MAP_GLYPHS_URL ?? 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'),
    attribution: '© OpenStreetMap · OpenFreeMap',
    bounds: bornes.length === 4 && bornes.every(Number.isFinite) ? bornes as [number, number, number, number] : undefined,
    maxzoom: env.VITE_MAP_TILES_MAXZOOM ? Number(env.VITE_MAP_TILES_MAXZOOM) : undefined,
    policesLocales: (env.VITE_MAP_GLYPHS_URL ?? '').startsWith('./'),
  };
}

/**
 * Adresse relative → absolue, à partir du dossier de la page. Concaténation volontaire :
 * `new URL()` encoderait les accolades des modèles {z}/{x}/{y} et {fontstack}/{range}.
 */
function absolu(adresse: string): string {
  if (!adresse.startsWith('./')) return adresse;
  return new URL('./', window.location.href).href + adresse.slice(2);
}
