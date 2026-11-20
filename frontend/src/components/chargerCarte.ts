// MapLibre 6 cherche son « worker » à côté de son propre module : une fois l'app empaquetée,
// il n'y est plus. Vite publie le fichier tel quel et nous en donne l'adresse.
import urlTravailleur from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

export type ML = typeof import('maplibre-gl');

function decoder(b64: string): ArrayBuffer {
  const brut = atob(b64.trim());
  const octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets.buffer;
}

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
      return { data: decoder(await reponse.text()) };
    });
    // « paquet:// » : tuiles regroupées par colonne (un fichier JSON par niveau et par x,
    // tuiles en base64 indexées par y) — pour les hébergements limités en nombre de fichiers.
    const paquets = new Map<string, Promise<Record<string, string>>>();
    ml.addProtocol('paquet', async (params) => {
      const m = params.url.slice('paquet://'.length).match(/^(.*)\/(\d+)\/(\d+)\/(\d+)(\.pbf)?$/);
      if (!m) throw new Error('Adresse de tuile invalide');
      const fichier = `${m[1]}/${m[2]}-${m[3]}.json`;
      let paquet = paquets.get(fichier);
      if (!paquet) {
        paquet = fetch(fichier).then((r) => (r.ok ? r.json() as Promise<Record<string, string>> : {})).catch(() => ({}));
        paquets.set(fichier, paquet);
      }
      const b64 = (await paquet)[m[4]!];
      return { data: b64 ? decoder(b64) : new ArrayBuffer(0) };
    });
    // « hybride:// » (APK) : la tuile livrée avec l'app si elle existe (Abidjan, hors
    // connexion, instantané), sinon la même tuile OpenStreetMap en ligne (reste du pays).
    let modeleEnLigne: Promise<string | null> | null = null;
    const tuileEnLigne = () => (modeleEnLigne ??= fetch('https://tiles.openfreemap.org/planet')
      .then((r) => r.json() as Promise<{ tiles?: string[] }>).then((j) => j.tiles?.[0] ?? null)
      .catch(() => { modeleEnLigne = null; return null; }));
    ml.addProtocol('hybride', async (params, abort) => {
      const local = params.url.slice('hybride://'.length);
      try {
        const r = await fetch(local, { signal: abort.signal });
        if (r.ok) { const octets = await r.arrayBuffer(); if (octets.byteLength > 0) return { data: octets }; }
      } catch (e) { if (abort.signal.aborted) throw e; }
      const zxy = local.match(/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      const modele = zxy ? await tuileEnLigne() : null;
      if (!zxy || !modele) return { data: new ArrayBuffer(0) };
      const r = await fetch(modele.replace('{z}', zxy[1]!).replace('{x}', zxy[2]!).replace('{y}', zxy[3]!), { signal: abort.signal });
      if (!r.ok) throw new Error(`Tuile absente (${r.status})`);
      return { data: await r.arrayBuffer() };
    });
    return ml;
  });
  return chargement;
}
