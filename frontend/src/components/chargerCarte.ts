// MapLibre 6 cherche son « worker » à côté de son propre module : une fois l'app empaquetée,
// il n'y est plus. Vite publie le fichier tel quel et nous en donne l'adresse.
import urlTravailleur from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

export type ML = typeof import('maplibre-gl');

/** MapLibre est chargé à la demande (bibliothèque lourde) ; selon le bundler, il arrive sous `default`. */
let chargement: Promise<ML> | null = null;
export function chargerML(): Promise<ML> {
  chargement ??= import('maplibre-gl').then((mod) => {
    const ml = (mod as unknown as { default?: ML }).default ?? mod;
    ml.setWorkerUrl(new URL(urlTravailleur, window.location.href).href);
    return ml;
  });
  return chargement;
}
