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
  /** Couleur du nom des lieux selon leur famille (repérage d'un coup d'œil, comme sur un plan). */
  lieux: { manger: string; commerce: string; culte: string; sante: string; ecole: string; argent: string; hotel: string; loisirs: string; transport: string };
}

const SOMBRE: Palette = {
  fond: '#0b1813', residentiel: '#0e1d17', parc: '#0f2a1d', eau: '#0a2533', batiment: '#13241c', batimentBord: '#1a3127',
  mineure: '#1b3028', mineureBord: '#0a1611', secondaire: '#243b31', secondaireBord: '#0a1611',
  principale: '#2e4b3e', principaleBord: '#0b1712', autoroute: '#3c5d4e', autorouteBord: '#0c1a14',
  pontBord: '#5f8573', chantier: '#7d9187', texte: '#7f9b8e', texteFort: '#d3e4dc', halo: '#0b1813', texteEau: '#4f8aa3',
  lieux: { manger: '#f0a35e', commerce: '#86b6f5', culte: '#c4a7ff', sante: '#ff8f8f', ecole: '#e3b27a', argent: '#5fd3c4', hotel: '#ff9cc8', loisirs: '#7fd99a', transport: '#a5b4c3' },
};
const CLAIR: Palette = {
  fond: '#eef2ee', residentiel: '#e8eee8', parc: '#d3e9d1', eau: '#b4d6ea', batiment: '#e0e5e0', batimentBord: '#d2d9d2',
  mineure: '#ffffff', mineureBord: '#d5dcd6', secondaire: '#ffffff', secondaireBord: '#c9d2cb',
  principale: '#fff1c9', principaleBord: '#e2c983', autoroute: '#ffd68a', autorouteBord: '#d4a43f',
  pontBord: '#7d9187', chantier: '#8e9b93', texte: '#5d7065', texteFort: '#1d2b24', halo: '#ffffff', texteEau: '#3f7899',
  lieux: { manger: '#c2410c', commerce: '#1d4ed8', culte: '#6d28d9', sante: '#b91c1c', ecole: '#92400e', argent: '#0f766e', hotel: '#be185d', loisirs: '#15803d', transport: '#475569' },
};

const largeur = (base: number, z18: number): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], 10, base * 0.35, 13, base, 18, z18];
const classe = (...c: string[]): ExpressionSpecification => ['match', ['get', 'class'], c, true, false];
const nom: ExpressionSpecification = ['coalesce', ['get', 'name:fr'], ['get', 'name']];

/* Familles de lieux (classes OpenMapTiles de la couche « poi »). */
const MANGER = ['restaurant', 'fast_food', 'cafe', 'bakery', 'ice_cream', 'bar', 'beer'];
const COMMERCE = ['shop', 'grocery', 'clothing_store', 'hairdresser', 'alcohol_shop', 'butcher', 'florist', 'furniture', 'gift', 'laundry', 'music', 'bicycle', 'pet', 'car'];
const SANTE = ['hospital', 'pharmacy', 'doctors', 'dentist', 'veterinary'];
const ECOLE = ['school', 'college', 'library'];
const LOISIRS = ['cinema', 'theatre', 'museum', 'art_gallery', 'stadium', 'sports_centre', 'pitch', 'attraction', 'theme_park', 'zoo', 'park', 'garden', 'golf', 'swimming_pool', 'monument'];
const TRANSPORT = ['bus', 'ferry_terminal', 'railway', 'fuel', 'harbor'];
/** Lieux visibles dès le zoom 14 : repères de quartier (hôpitaux, lieux de culte, marchés…). */
const REPERES: ExpressionSpecification = ['any',
  ['match', ['get', 'class'], ['hospital', 'place_of_worship', 'college', 'stadium', 'museum', 'theatre', 'cinema', 'town_hall', 'attraction', 'ferry_terminal', 'fuel', 'lodging'], true, false],
  ['match', ['get', 'subclass'], ['supermarket', 'marketplace', 'department_store', 'mall', 'bus_station'], true, false]];
const SANS_INTERET = ['gate', 'toilets', 'parking', 'shelter', 'waste_basket', 'drinking_water', 'information', 'telephone', 'post', 'recycling', 'motorcycle_parking'];

export function styleOrion(mode: 'dark' | 'light', cfg: VectorConfig): StyleSpecification {
  // Polices livrées avec l'app : mêmes fontes, dossiers sans espaces.
  const police = (nom: string) => (cfg.policesLocales ? nom.replace(/ /g, '') : nom);
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
    sprite: cfg.sprite,
    sources: {
      // Modèle {z}/{x}/{y} (tuiles livrées avec l'app) ou TileJSON (serveur de tuiles).
      osm: cfg.tiles.includes('{z}')
        ? { type: 'vector', tiles: [cfg.tiles], attribution: cfg.attribution, ...(cfg.bounds ? { bounds: cfg.bounds } : {}), maxzoom: cfg.maxzoom ?? 14 }
        : { type: 'vector', url: cfg.tiles, attribution: cfg.attribution },
      // Quartiers que les Abidjanais nomment mais qu'OSM ne porte pas (« Riviéra Golf »).
      ...(cfg.quartiersUsage ? { usage: { type: 'geojson' as const, data: cfg.quartiersUsage } } : {}),
    },
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
        layout: { 'text-field': nom, 'text-font': [police('Noto Sans Italic')], 'text-size': 13, 'text-letter-spacing': 0.12, 'text-max-width': 8 },
        paint: { 'text-color': P.texteEau, 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
      },
      // Numéros de rue (au plus près seulement).
      {
        id: 'numeros', type: 'symbol', source: 'osm', 'source-layer': 'housenumber', minzoom: 17.5,
        layout: { 'text-field': ['get', 'housenumber'], 'text-font': [police('Noto Sans Regular')], 'text-size': 9.5 },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1, 'text-opacity': 0.8 },
      },
      // Toutes les rues nommées : grands axes dès le zoom 13, rues de quartier ensuite.
      {
        id: 'noms-routes', type: 'symbol', source: 'osm', 'source-layer': 'transportation_name', minzoom: 13,
        filter: classe('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'),
        layout: { 'symbol-placement': 'line', 'text-field': nom, 'text-font': [police('Noto Sans Regular')], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13], 'text-max-angle': 30 },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
      },
      {
        id: 'noms-voies-service', type: 'symbol', source: 'osm', 'source-layer': 'transportation_name', minzoom: 15.5,
        filter: classe('service', 'track', 'path', 'pedestrian'),
        layout: { 'symbol-placement': 'line', 'text-field': nom, 'text-font': [police('Noto Sans Regular')], 'text-size': 10.5, 'text-max-angle': 30 },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
      },
      // Arrêts de bus et de gbaka : seulement de très près (plus de 3 600 à Abidjan).
      {
        id: 'arrets', type: 'symbol', source: 'osm', 'source-layer': 'poi', minzoom: 16.5,
        filter: ['all', ['has', 'name'], ['==', ['get', 'class'], 'bus'], ['!=', ['get', 'subclass'], 'bus_station']],
        layout: { 'icon-image': 'bus_11', 'text-field': nom, 'text-font': [police('Noto Sans Regular')], 'text-size': 10, 'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-optional': true, 'text-max-width': 8 },
        paint: { 'text-color': P.lieux.transport, 'text-halo-color': P.halo, 'text-halo-width': 1.2, 'icon-opacity': 0.85 },
      },
      // Commerces, banques, restaurants, maquis, supermarchés, églises, mosquées, écoles,
      // santé, hôtels, culture et loisirs : pictogramme + nom, colorés par famille.
      {
        id: 'lieux', type: 'symbol', source: 'osm', 'source-layer': 'poi', minzoom: 15.3,
        filter: ['all', ['has', 'name'], ['!', ['match', ['get', 'class'], ['bus', ...SANS_INTERET], true, false]], ['!', REPERES]],
        layout: {
          'icon-image': ['match', ['get', 'subclass'], 'christian', 'religious_christian_11', 'muslim', 'religious_muslim_11',
            ['coalesce', ['image', ['concat', ['get', 'class'], '_11']], ['image', 'dot_11']]],
          'text-field': nom, 'text-font': [police('Noto Sans Regular')], 'text-size': 10.5, 'text-anchor': 'top', 'text-offset': [0, 0.7],
          'text-optional': true, 'text-max-width': 8, 'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': ['match', ['get', 'class'], MANGER, P.lieux.manger, COMMERCE, P.lieux.commerce, 'place_of_worship', P.lieux.culte, SANTE, P.lieux.sante,
      ECOLE, P.lieux.ecole, ['bank', 'atm'], P.lieux.argent, 'lodging', P.lieux.hotel, LOISIRS, P.lieux.loisirs, TRANSPORT, P.lieux.transport, P.texte], 'text-halo-color': P.halo, 'text-halo-width': 1.3, 'icon-opacity': 0.9 },
      },
      {
        id: 'lieux-reperes', type: 'symbol', source: 'osm', 'source-layer': 'poi', minzoom: 14,
        filter: ['all', ['has', 'name'], REPERES],
        layout: {
          'icon-image': ['match', ['get', 'subclass'], 'christian', 'religious_christian_11', 'muslim', 'religious_muslim_11',
            ['coalesce', ['image', ['concat', ['get', 'class'], '_11']], ['image', 'dot_11']]],
          'text-field': nom, 'text-font': [police('Noto Sans Bold')], 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 11.5], 'text-anchor': 'top',
          'text-offset': [0, 0.7], 'text-optional': true, 'text-max-width': 8, 'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': ['match', ['get', 'class'], MANGER, P.lieux.manger, COMMERCE, P.lieux.commerce, 'place_of_worship', P.lieux.culte, SANTE, P.lieux.sante,
      ECOLE, P.lieux.ecole, ['bank', 'atm'], P.lieux.argent, 'lodging', P.lieux.hotel, LOISIRS, P.lieux.loisirs, TRANSPORT, P.lieux.transport, P.texte], 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
      },
      // Sous-quartiers, cités, lotissements (Cité Angré Star 8, Les Jardins de la Riviéra…).
      {
        id: 'sous-quartiers', type: 'symbol', source: 'osm', 'source-layer': 'place', minzoom: 13.5,
        filter: classe('neighbourhood', 'hamlet', 'isolated_dwelling'),
        layout: { 'text-field': nom, 'text-font': [police('Noto Sans Bold')], 'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10.5, 16, 12.5], 'text-max-width': 8 },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1.5, 'text-opacity': 0.92 },
      },
      ...(cfg.quartiersUsage ? [{
        id: 'quartiers-usage', type: 'symbol' as const, source: 'usage', minzoom: 12.5,
        layout: {
          'text-field': ['get', 'nom'] as ExpressionSpecification, 'text-font': [police('Noto Sans Bold')], 'text-transform': 'uppercase' as const, 'text-letter-spacing': 0.12,
          'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 10, 15, 12.5] as ExpressionSpecification, 'text-max-width': 9,
        },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1.6 },
      }] : []),
      {
        id: 'quartiers', type: 'symbol', source: 'osm', 'source-layer': 'place',
        filter: classe('suburb', 'quarter', 'village', 'town'),
        layout: {
          'text-field': nom, 'text-font': [police('Noto Sans Bold')], 'text-transform': 'uppercase', 'text-letter-spacing': 0.16,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13.5], 'text-max-width': 9,
        },
        paint: { 'text-color': P.texteFort, 'text-halo-color': P.halo, 'text-halo-width': 1.6, 'text-opacity': 0.85 },
      },
      {
        id: 'villes', type: 'symbol', source: 'osm', 'source-layer': 'place', filter: classe('city'),
        layout: { 'text-field': nom, 'text-font': [police('Noto Sans Bold')], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 12, 18] },
        paint: { 'text-color': P.texteFort, 'text-halo-color': P.halo, 'text-halo-width': 1.6 },
      },
      {
        id: 'aeroports', type: 'symbol', source: 'osm', 'source-layer': 'aerodrome_label',
        layout: { 'text-field': nom, 'text-font': [police('Noto Sans Regular')], 'text-size': 11, 'text-max-width': 8 },
        paint: { 'text-color': P.texte, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
      },
    ] as StyleSpecification['layers'],
  };
}
