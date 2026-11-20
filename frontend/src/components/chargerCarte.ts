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
    // Carte livrée avec l'app sous forme texte (« b64:// ») : tuiles et polices encodées en
    // base64, pour les hébergements qui ne servent pas les fichiers binaires .pbf.
    ml.addProtocol('b64', async (params, abort) => {
      const reponse = await fetch(params.url.slice('b64://'.length), { signal: abort.signal });
      if (!reponse.ok) throw new Error(`Tuile absente (${reponse.status})`);
      const brut = atob((await reponse.text()).trim());
      const octets = new Uint8Array(brut.length);
      for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
      return { data: octets.buffer };
    });
    return ml;
  });
  return chargement;
}
