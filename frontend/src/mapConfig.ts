/**
 * Configuration du fond de carte ORION (couche d'abstraction cartographique).
 *
 * Par défaut, l'app affiche la carte stylisée « façon navigation » (fonctionne hors-ligne,
 * sans clé). En production, on active un VRAI fond de carte en définissant des variables
 * d'environnement Vite — le reste de l'app (itinéraire, marqueurs, suivi voiture) ne change pas.
 *
 * Fournisseurs pris en charge :
 *  - VITE_MAP_TILE_URL : gabarit de tuiles générique « {z}/{x}/{y} » (n'importe quel fournisseur).
 *  - VITE_MAP_PROVIDER=osm : OpenStreetMap (gratuit, sans clé).
 *  - VITE_MAP_PROVIDER=maptiler + VITE_MAPTILER_KEY : MapTiler (rues détaillées).
 *  - VITE_MAP_PROVIDER=google + VITE_GOOGLE_MAPS_API_KEY : tuiles Google (partenariat).
 *
 * Exemple : VITE_MAP_PROVIDER=osm  →  vraies rues d'Abidjan.
 */
export interface TileConfig {
  url: string;
  attribution: string;
  maxZoom: number;
}

const env = import.meta.env as Record<string, string | undefined>;

export function getTileConfig(): TileConfig | null {
  const custom = env.VITE_MAP_TILE_URL;
  if (custom) {
    return { url: custom, attribution: env.VITE_MAP_ATTRIBUTION ?? '© ORION', maxZoom: 19 };
  }
  const provider = (env.VITE_MAP_PROVIDER ?? '').toLowerCase();
  if (provider === 'osm') {
    return {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    };
  }
  if (provider === 'maptiler' && env.VITE_MAPTILER_KEY) {
    return {
      url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${env.VITE_MAPTILER_KEY}`,
      attribution: '© MapTiler © OpenStreetMap',
      maxZoom: 20,
    };
  }
  if (provider === 'google' && env.VITE_GOOGLE_MAPS_API_KEY) {
    // Tuiles Google (nécessite l'activation « Map Tiles API » côté partenariat Google).
    return {
      url: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?key=${env.VITE_GOOGLE_MAPS_API_KEY}`,
      attribution: '© Google',
      maxZoom: 20,
    };
  }
  return null; // → carte stylisée (repli hors-ligne / démo)
}
