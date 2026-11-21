/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Adresses de secours du serveur, séparées par des virgules (console et tableau de bord). */
  readonly VITE_API_URLS_SECOURS?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** '1' : Google Maps est la seule carte de l'app cliente (exige VITE_GOOGLE_MAPS_API_KEY). */
  readonly VITE_MAP_GOOGLE_SEUL?: string;
  /** Fond de carte réel : 'osm' | 'maptiler' | 'google' (sinon carte stylisée). */
  readonly VITE_MAP_PROVIDER?: string;
  /** Gabarit de tuiles générique « {z}/{x}/{y} » (prioritaire sur VITE_MAP_PROVIDER). */
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_ATTRIBUTION?: string;
  readonly VITE_MAPTILER_KEY?: string;
  /** Clé de site reCAPTCHA Enterprise : jeton joint aux demandes de code SMS et à la connexion console. */
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  /** Clé de l'application pour API Gateway (en-tête x-api-key de chaque appel). */
  readonly VITE_ORION_API_KEY?: string;
  /** Adresse des canaux temps réel quand elle diffère de l'API (suivi en direct par l'équilibreur plutôt que par API Gateway). */
  readonly VITE_WS_URL?: string;
  /** Clé web Identity Platform : la vérification du numéro du client est confiée à Google. */
  readonly VITE_IDENTITY_PLATFORM_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
