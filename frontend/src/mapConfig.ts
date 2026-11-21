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
 *    désigne des tuiles livrées avec l'application (carte embarquée, sans Internet) ;
 *    préfixée « b64: », des tuiles encodées en base64 dans des fichiers texte.
 *  - VITE_MAP_TILES_BOUNDS : emprise des tuiles livrées, « ouest,sud,est,nord ».
 *  - VITE_MAP_TILES_MAXZOOM : dernier niveau de zoom livré (au-delà, agrandissement).
 *    Préfixée « paquet: », des tuiles regroupées par blocs dans des fichiers JSON
 *    (hébergements limités en nombre de fichiers) ; préfixée « hybride: », les tuiles
 *    livrées d'abord, puis OpenFreeMap en ligne au-delà de leur emprise (APK).
 *  - VITE_MAP_GLYPHS_URL : polices des libellés, au format « {fontstack}/{range}.pbf ».
 *  - VITE_MAP_DONNEES_URL : dossier livré avec l'app (« ./carte/ ») contenant les
 *    pictogrammes de la carte (sprites/), les quartiers d'usage et l'index de recherche.
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
  /** Pictogrammes des lieux (commerces, banques, lieux de culte…). */
  sprite: string;
  /** Quartiers d'usage absents d'OSM (« Riviéra Golf ») : GeoJSON livré avec l'app. */
  quartiersUsage?: string;
  /**
   * L'index des lieux est livré avec l'app : la carte affiche TOUS ses lieux (banques,
   * entreprises, immeubles nommés, commerces…), pas seulement ceux que portent les tuiles.
   */
  lieuxIndex?: boolean;
}

const env = import.meta.env as Record<string, string | undefined>;

export function getVectorConfig(): VectorConfig | null {
  if ((env.VITE_MAP_PROVIDER ?? '').toLowerCase() === 'stylise') return null;
  const bornes = (env.VITE_MAP_TILES_BOUNDS ?? '').split(',').map(Number);
  const donnees = env.VITE_MAP_DONNEES_URL ? absolu(env.VITE_MAP_DONNEES_URL.replace(/\/?$/, '/')) : null;
  return {
    tiles: absolu(env.VITE_MAP_TILES_URL ?? 'https://tiles.openfreemap.org/planet'),
    glyphs: absolu(env.VITE_MAP_GLYPHS_URL ?? 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'),
    attribution: donnees ? '© OpenStreetMap · OpenFreeMap · Overture Maps' : '© OpenStreetMap · OpenFreeMap',
    bounds: bornes.length === 4 && bornes.every(Number.isFinite) ? bornes as [number, number, number, number] : undefined,
    maxzoom: env.VITE_MAP_TILES_MAXZOOM ? Number(env.VITE_MAP_TILES_MAXZOOM) : undefined,
    policesLocales: /^((b64|paquet|hybride):)?\.\//.test(env.VITE_MAP_GLYPHS_URL ?? ''),
    sprite: donnees ? `${donnees}sprites/ofm` : 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    quartiersUsage: donnees ? `${donnees}quartiers-usage.json` : undefined,
    lieuxIndex: Boolean(donnees),
  };
}

/**
 * Adresse relative → absolue, à partir du dossier de la page. Concaténation volontaire :
 * `new URL()` encoderait les accolades des modèles {z}/{x}/{y} et {fontstack}/{range}.
 */
function absolu(adresse: string): string {
  const protocole = adresse.match(/^(b64|paquet|hybride):(\.\/.*)$/);
  if (protocole) return `${protocole[1]}://${absolu(protocole[2]!)}`;
  if (!adresse.startsWith('./')) return adresse;
  return new URL('./', window.location.href).href + adresse.slice(2);
}
