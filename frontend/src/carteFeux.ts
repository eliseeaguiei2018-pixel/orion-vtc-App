import type { Map as CarteMl, GeoJSONSource } from 'maplibre-gl';
import { PEAGES, type Peage } from './routesAbidjan';

/**
 * FEUX TRICOLORES ET PÉAGES DU DISTRICT D'ABIDJAN — couche commune à toutes les cartes ORION
 * (app cliente sur Google Maps, app chauffeur, console, tableau de bord).
 *
 *  - Feux : 623 feux tricolores du district, regroupés en 301 carrefours (un repère par
 *    carrefour, à moins de 30 m), d'après Overture Maps (données OpenStreetMap, ODbL).
 *    Fichier public/carte/feux-abidjan.json, chargé une fois. Visibles à partir du zoom 14 :
 *    plus loin, ils couvriraient la ville.
 *  - Péages : postes du pont Henri-Konan-Bédié, du 4ᵉ pont, de l'autoroute de Bassam et de
 *    l'autoroute du Nord (montants réglés dans la console). Visibles dès le zoom 11.
 */
export interface FeuxAbidjan {
  source: string; feux: number; carrefours: number;
  /** [lat, lng, nombre de feux du carrefour] */
  points: [number, number, number][];
}

/** Zoom à partir duquel les feux apparaissent. */
export const ZOOM_FEUX = 14;
/** Zoom à partir duquel les postes de péage apparaissent. */
export const ZOOM_PEAGES = 11;

let chargement: Promise<FeuxAbidjan | null> | null = null;
export function chargerFeux(): Promise<FeuxAbidjan | null> {
  chargement ??= fetch(new URL('./carte/feux-abidjan.json', window.location.href).href)
    .then((r) => (r.ok ? (r.json() as Promise<FeuxAbidjan>) : null))
    .catch(() => { chargement = null; return null; });
  return chargement;
}

/** Feu tricolore dessiné (rouge, orange, vert) : même dessin sur toutes les cartes. */
export function dessinFeu(echelle = 2): { width: number; height: number; data: Uint8Array } {
  const l = 12 * echelle, h = 26 * echelle;
  const c = document.createElement('canvas');
  c.width = l; c.height = h;
  const x = c.getContext('2d');
  if (!x) return { width: 1, height: 1, data: new Uint8Array(4) };
  x.fillStyle = '#1d1f23';
  x.strokeStyle = '#ffffff';
  x.lineWidth = 1.5 * echelle;
  const r = 4 * echelle;
  x.beginPath();
  x.roundRect(x.lineWidth / 2, x.lineWidth / 2, l - x.lineWidth, h - x.lineWidth, r);
  x.fill(); x.stroke();
  ['#ff3b30', '#ffb020', '#22c55e'].forEach((teinte, i) => {
    x.fillStyle = teinte;
    x.beginPath();
    x.arc(l / 2, (5.5 + i * 7.5) * echelle, 2.6 * echelle, 0, Math.PI * 2);
    x.fill();
  });
  const img = x.getImageData(0, 0, l, h);
  return { width: l, height: h, data: new Uint8Array(img.data.buffer) };
}

/** Le même feu, en élément HTML (repères de la carte Google). */
export const HTML_FEU = '<i class="feu-tricolore" aria-hidden="true"><b></b><b></b><b></b></i>';

export const feuxGeoJSON = (f: FeuxAbidjan | null): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: (f?.points ?? []).map(([lat, lng, n]) => ({ type: 'Feature', properties: { n }, geometry: { type: 'Point', coordinates: [lng, lat] } })),
});

export const peagesGeoJSON = (liste: readonly Peage[] = PEAGES, actifs: readonly string[] = []): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: liste.map((p) => ({
    type: 'Feature', properties: { id: p.id, nom: p.nom, montant: p.montant, actif: actifs.includes(p.id) ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
  })),
});

/**
 * Ajoute les feux et les péages à une carte MapLibre (carte ORION de l'app chauffeur, de la
 * console et du tableau de bord). Sans danger si la carte les a déjà.
 */
export function ajouterFeuxEtPeages(m: CarteMl, sombre: boolean, police: string[] = ['Noto Sans Regular']): void {
  if (m.getSource('feux')) return;
  if (!m.hasImage('feu-tricolore')) m.addImage('feu-tricolore', dessinFeu(2), { pixelRatio: 2 });
  m.addSource('feux', { type: 'geojson', data: feuxGeoJSON(null) });
  m.addLayer({
    id: 'feux', type: 'symbol', source: 'feux', minzoom: ZOOM_FEUX,
    layout: { 'icon-image': 'feu-tricolore', 'icon-size': ['interpolate', ['linear'], ['zoom'], ZOOM_FEUX, 0.7, 18, 1.1], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  });
  m.addSource('peages', { type: 'geojson', data: peagesGeoJSON() });
  m.addLayer({
    id: 'peages', type: 'circle', source: 'peages', minzoom: ZOOM_PEAGES,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], ZOOM_PEAGES, 4, 16, 8],
      'circle-color': ['case', ['==', ['get', 'actif'], 1], '#ffb020', sombre ? '#3a3d44' : '#ffffff'],
      'circle-stroke-color': '#ffb020', 'circle-stroke-width': 2.5,
    },
  });
  m.addLayer({
    id: 'peages-nom', type: 'symbol', source: 'peages', minzoom: 13,
    layout: { 'text-field': ['concat', 'Péage · ', ['to-string', ['get', 'montant']], ' F'], 'text-font': police, 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top' },
    paint: { 'text-color': sombre ? '#f3f4f6' : '#1c1e22', 'text-halo-color': sombre ? '#111214' : '#ffffff', 'text-halo-width': 1.4 },
  });
  void chargerFeux().then((f) => { (m.getSource('feux') as GeoJSONSource | undefined)?.setData(feuxGeoJSON(f)); });
}

/** Met en avant les péages de l'itinéraire choisi (cercle plein orange). */
export function marquerPeages(m: CarteMl, actifs: readonly string[]): void {
  (m.getSource('peages') as GeoJSONSource | undefined)?.setData(peagesGeoJSON(PEAGES, actifs));
}
