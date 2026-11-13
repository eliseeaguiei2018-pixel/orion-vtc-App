/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Adresses de secours du serveur, séparées par des virgules (console et tableau de bord). */
  readonly VITE_API_URLS_SECOURS?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** Fond de carte réel : 'osm' | 'maptiler' | 'google' (sinon carte stylisée). */
  readonly VITE_MAP_PROVIDER?: string;
  /** Gabarit de tuiles générique « {z}/{x}/{y} » (prioritaire sur VITE_MAP_PROVIDER). */
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_ATTRIBUTION?: string;
  readonly VITE_MAPTILER_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
