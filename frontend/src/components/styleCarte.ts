import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import type { VectorConfig } from '../mapConfig';

/**
 * STYLE DE CARTE ORION (données OpenStreetMap, schéma OpenMapTiles).
 *
 * Une carte de navigation, pas un atlas : la voirie est hiérarchisée (autoroutes et
 * grands boulevards d'abord), les PONTS sont mis en valeur (bord plus clair) parce
 * qu'à Abidjan ils structurent chaque trajet, les voies EN CONSTRUCTION sont en
 * pointillés, les quartiers et la lagune Ébrié sont nommés. Le reste s'efface pour
 * laisser l'itinéraire, à la couleur choisie par le client, au premier plan.
 */

interface Palette {
  fond: string; residentiel: string; parc: string; eau: string; batiment: string; batimentBord: string;
  mineure: string; mineureBord: string; secondaire: string; secondaireBord: string;
  principale: string; principaleBord: string; autoroute: string; autorouteBord: string;
  pontBord: string; chantier: string; texte: string; texteFort: string; halo: string; texteEau: string;
}

const SOMBRE: Palette = {
  fond: '#0b1813', residentiel: '#0e1d17', parc: '#0f2a1d', eau: '#0a2533', batiment: '#13241c', batimentBord: '#1a3127',
  mineure: '#1b3028', mineureBord: '#0a1611', secondaire: '#243b31', secondaireBord: '#0a1611',
  principale: '#2e4b3e', principaleBord: '#0b1712', autoroute: '#3c5d4e', autorouteBord: '#0c1a14',
  pontBord: '#5f8573', chantier: '#7d9187', texte: '#7f9b8e', texteFort: '#d3e4dc', halo: '#0b1813', texteEau: '#4f8aa3',
};
const CLAIR: Palette = {
  fond: '#eef2ee', residentiel: '#e8eee8', parc: '#d3e9d1', eau: '#b4d6ea', batiment: '#e0e5e0', batimentBord: '#d2d9d2',
  mineure: '#ffffff', mineureBord: '#d5dcd6', secondaire: '#ffffff', secondaireBord: '#c9d2cb',
  principale: '#fff1c9', principaleBord: '#e2c983', autoroute: '#ffd68a', autorouteBord: '#d4a43f',
  pontBord: '#7d9187', chantier: '#8e9b93', texte: '#5d7065', texteFort: '#1d2b24', halo: '#ffffff', texteEau: '#3f7899',
};

const largeur = (base: number, z18: number): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], 10, base * 0.35, 13, base, 18, z18];
const classe = (...c: string[]): ExpressionSpecification => ['match', ['get', 'class'], c, true, false];
const nom: ExpressionSpecification = ['coalesce', ['get', 'name:fr'], ['get', 'name']];

export function styleOrion(mode: 'dark' | 'light', cfg: VectorConfig): StyleSpecification {
  const P = mode === 'light' ? CLAIR : SOMBRE;
  const routes = (_n: string, filtre: ExpressionSpecification, pont: boolean) => {
    const base: ExpressionSpecification = pont
      ? ['all', filtre, ['==', ['get', 'brunnel'], 'bridge']]
      : ['all', filtre, ['!=', ['get', 'brunnel'], 'bridge']];
    return base;
  };
  const couche = (id: string, filtre: ExpressionSpecification, couleur: string, w: ExpressionSpecification, extra: Record<string, unknown> = {}) => ({
    id, type: 'line' as const, source: 'osm', 'source-layer': 'transportation', filter: filtre,
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: { 'line-color': couleur, 'line-width': w, ...extra },
  });

  // Ordre de dessin : bords puis remplissages, routes au sol puis ponts au-dessus.
  const voirie = (pont: boolean) => {
    const s = pont ? '-pont' : '';
    const bord = pont ? P.pontBord : undefined;
    return [
      couche(`mineure-bord${s}`, routes('m', classe('minor', 'service'), pont), bord ?? P.mineureBord, largeur(3.2, 16), { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13.5, 1] }),
      couche(`secondaire-bord${s}`, routes('s', classe('secondary', 'tertiary'), pont), bord ?? P.secondaireBord, largeur(4.6, 22)),
      couche(`principale-bord${s}`, routes('p', classe('primary'), pont), bord ?? P.principaleBord, largeur(6, 28)),
      couche(`autoroute-bord${s}`, routes('a', classe('motorway', 'trunk'), pont), bord ?? P.autorouteBord, largeur(7, 32)),
      couche(`mineure${s}`, routes('m', classe('minor', 'service'), pont), P.mineure, largeur(2.2, 13), { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13.5, 1] }),
      couche(`secondaire${s}`, routes('s', classe('secondary', 'tertiary'), pont), P.secondaire, largeur(3.4, 18)),
      couche(`principale${s}`, routes('p', classe('primary'), pont), P.principale, largeur(4.6, 23)),
      couche(`autoroute${s}`, routes('a', classe('motorway', 'trunk'), pont), P.autoroute, largeur(5.4, 26)),
    ];
  };

  return {
    version: 8,
    name: `ORION ${mode}`,
    glyphs: cfg.glyphs,
    sources: { osm: { type: 'vector', url: cfg.tiles, attribution: cfg.attribution } },
    layers: [
      { id: 'fond', type: 'background', paint: { 'background-color': P.fond } },
      { id: 'residentiel', type: 'fill', source: 'osm', 'source-layer': 'landuse', filter: classe('residential', 'suburb', 'neighbourhood'), paint: { 'fill-color': P.residentiel } },
      { id: 'parcs', type: 'fill', source: 'osm', 'source-layer': 'park', paint: { 'fill-color': P.parc } },
      { id: 'vegetation', type: 'fill', source: 'osm', 'source-layer': 'landcover', filter: classe('wood', 'grass', 'farmland', 'wetland'), paint: { 'fill-color': P.parc, 'fill-opacity': 0.7 } },
      { id: 'eau', type: 'fill', source: 'osm', 'source-layer': 'water', paint: { 'fill-color': P.eau } },
      { id: 'cours-eau', type: 'line', source: 'osm', 'source-layer': 'waterway', paint: { 'line-color': P.eau, 'line-width': largeur(1.4, 8) } },
      {
        id: 'batiments', type: 'fill', source: 'osm', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-color': P.batiment, 'fill-outline-color': P.batimentBord, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1] },
      },
      // Voies EN CONSTRUCTION (ex. autoroute de contournement, échangeurs en chantier).
      {
        id: 'chantiers', type: 'line', source: 'osm', 'source-layer': 'transportation',
        filter: ['in', '_construction', ['get', 'class']],
        layout: { 'line-cap': 'butt' },
        paint: { 'line-color': P.chantier, 'line-width': largeur(3, 14), 'line-dasharray': [2, 1.6], 'line-opacity': 0.85 },
      },
      ...voirie(false),
      ...voirie(true),
      {
        id: 'noms-eau', type: 'symbol', source: 'osm', 'source-layer': 'water_name',
        layout: { 'text-field': nom, 'text-font': ['Noto Sans Italic'], 'text-size': 13, 'text-letter-spacing': 0.12, 'text-max-width': 8 },
        paint: { 'text-color': P.texteEau, 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
      },
      {
        id: 'noms-routes', type: 'symbol', source: 'osm', 'source-layer': 'transportation_name', minzoom: 13,
        filter: classe('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'),
        layout: { 'symbol-placement': 'line', 'text-field': nom, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13], 'text-max-angle': 30 },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
      },
      {
        id: 'quartiers', type: 'symbol', source: 'osm', 'source-layer': 'place',
        filter: classe('suburb', 'quarter', 'neighbourhood', 'village', 'town'),
        layout: {
          'text-field': nom, 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.16,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13], 'text-max-width': 9,
        },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1.6 },
      },
      {
        id: 'villes', type: 'symbol', source: 'osm', 'source-layer': 'place', filter: classe('city'),
        layout: { 'text-field': nom, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 12, 18] },
        paint: { 'text-color': P.texteFort, 'text-halo-color': P.halo, 'text-halo-width': 1.6 },
      },
      {
        id: 'aeroports', type: 'symbol', source: 'osm', 'source-layer': 'aerodrome_label',
        layout: { 'text-field': nom, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 8 },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
      },
    ] as StyleSpecification['layers'],
  };
}
