/**
 * GÉNÉRATION DU RÉPERTOIRE DES LIEUX DU GRAND ABIDJAN (données OpenStreetMap).
 *
 *   npx tsx scripts/lieux-osm/generer-lieux.mts <dossier-des-extractions>
 *
 * Entrées (produites par extraire-tuiles.mjs et le téléchargement HDX, voir README) :
 *  - places-z14.json / places-z13.json : couche « place » des tuiles OpenMapTiles
 *    d'OpenFreeMap (OSM, mise à jour hebdomadaire) — quartiers, sous-quartiers, villages ;
 *  - limites-z14.json : limites administratives OSM (niveau 8 = communes) ;
 *  - populated_places.geojson : export OSM de HOT publié sur HDX (recoupement des villages).
 *
 * Problèmes traités (audit des données GPS) :
 *  1. DOUBLONS : un même lieu saisi deux fois (point + polygone, « Abobo Doumé » et
 *     « Abobo Doumé village », graphies avec ou sans accents) → fusionnés quand le nom
 *     normalisé est identique à moins de 1,5 km.
 *  2. NIVEAUX MÉLANGÉS : chaque lieu porte son niveau (quartier, sous-quartier, village,
 *     hameau, île) ; les maisons isolées sont écartées (ce ne sont pas des destinations).
 *  3. COMMUNE : déterminée par les VRAIES limites communales OSM (et non par le centre le
 *     plus proche, qui se trompait : Angré n'est pas à Abobo).
 *  4. ÉVOLUTION : la date d'extraction est inscrite ; relancer chaque mois.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DOSSIER = process.argv[2];
if (!DOSSIER) throw new Error('Usage : generer-lieux.mts <dossier-des-extractions>');
const lire = (f: string) => JSON.parse(readFileSync(path.join(DOSSIER, f), 'utf8'));

type Brut = { nom: string; classe: string; lat: number; lng: number; source: string };
const bruts: Brut[] = [
  ...lire('places-z14.json').map((p: Brut) => ({ ...p, source: 'tuiles' })),
  ...lire('places-z13.json').map((p: Brut) => ({ ...p, source: 'tuiles' })),
];

// --- Recoupement HDX (export OSM de HOT) : villages et hameaux nommés -------------------
const hdx = lire('populated_places.geojson') as { features: Array<{ properties: Record<string, string | null>; geometry: { type: string; coordinates: unknown } }> };
const centre = (g: { type: string; coordinates: unknown }): [number, number] | null => {
  if (g.type === 'Point') return g.coordinates as [number, number];
  const anneau = g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][])[0]![0] : null;
  if (!anneau?.length) return null;
  let x = 0, y = 0; for (const p of anneau) { x += p[0]!; y += p[1]!; }
  return [x / anneau.length, y / anneau.length];
};
const EMPRISE = { o: -4.22, s: 5.19, e: -3.78, n: 5.56 };
const dansEmprise = (lat: number, lng: number) => lng > EMPRISE.o && lng < EMPRISE.e && lat > EMPRISE.s && lat < EMPRISE.n;
const hdxLieux: Brut[] = [];
for (const f of hdx.features) {
  const p = f.properties;
  const nom = p.name_fr || p.name;
  if (!nom || !p.place || p.place === 'isolated_dwelling') continue;
  const c = centre(f.geometry); if (!c) continue;
  if (!dansEmprise(c[1], c[0])) continue;
  hdxLieux.push({ nom, classe: p.place, lat: +c[1].toFixed(5), lng: +c[0].toFixed(5), source: `hdx:${f.geometry.type}` });
}

// --- Normalisation des noms -----------------------------------------------------------
export const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ᵉ/g, 'e').replace(/[''’.,()-]/g, ' ').replace(/\bdeux\b/g, '2').replace(/\bii\b/g, '2')
  .replace(/\s+/g, ' ').trim();
/** Clé de rapprochement : sans les mots génériques (« village », « quartier », « cité »). */
const cle = (s: string) => normaliser(s).replace(/\b(village|quartier|cite|campement)\b/g, ' ')
  .replace(/\b([a-z]{4,})s\b/g, '$1') // « Cité Stars 5 » = « Cité Star 5 »
  .replace(/\s+/g, ' ').trim();
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.hypot((a.lat - b.lat) * 110.6, (a.lng - b.lng) * 110.3);

const NIVEAU: Record<string, 'quartier' | 'sous-quartier' | 'village' | 'hameau' | 'ile'> = {
  suburb: 'quartier', quarter: 'quartier', neighbourhood: 'sous-quartier', village: 'village', town: 'village', hamlet: 'hameau', island: 'ile',
};
const PRIORITE: Record<string, number> = { suburb: 0, quarter: 1, town: 2, village: 3, neighbourhood: 4, hamlet: 5, island: 6 };

// Communes : traitées par le répertoire des zones (ALL_ZONES), pas dupliquées ici.
const COMMUNES = ['Abobo', 'Adjamé', 'Attécoubé', 'Cocody', 'Koumassi', 'Marcory', 'Le Plateau', 'Plateau', 'Port-Bouët', 'Treichville', 'Yopougon', 'Bingerville', 'Anyama', 'Songon', 'Abidjan'];
const estCommune = new Set(COMMUNES.map(normaliser));

const candidats = [...bruts, ...hdxLieux].filter((p) => p.nom && NIVEAU[p.classe] && dansEmprise(p.lat, p.lng) && !estCommune.has(normaliser(p.nom)));

// --- Dédoublonnage : même clé, à moins de 1,5 km → un seul lieu ----------------------------
type Lieu = Brut & { fusionnes: string[] };
const lieux: Lieu[] = [];
const doublons: string[] = [];
for (const p of [...candidats].sort((a, b) => (PRIORITE[a.classe]! - PRIORITE[b.classe]!) || (a.source === 'tuiles' ? -1 : 1))) {
  const existant = lieux.find((l) => cle(l.nom) === cle(p.nom) && km(l, p) < 1.5);
  if (existant) {
    if (existant.nom !== p.nom || km(existant, p) > 0.05 || existant.source !== p.source) {
      if (!existant.fusionnes.includes(`${p.nom} (${p.classe}, ${p.source})`)) existant.fusionnes.push(`${p.nom} (${p.classe}, ${p.source}, ${Math.round(km(existant, p) * 1000)} m)`);
    }
    continue;
  }
  lieux.push({ ...p, fusionnes: [] });
}
for (const l of lieux) if (l.fusionnes.length) doublons.push(`${l.nom} ← ${l.fusionnes.join(' ; ')}`);

// --- Commune par les limites OSM (niveau 8) -------------------------------------------------
const limites = lire('limites-z14.json') as Record<string, number[][]>;
const SEGMENTS = limites['8']!;
const placesTuiles = [...lire('places-z13.json'), ...lire('places-z14.json')] as Brut[];
const etiquette = (nom: string, alias?: string) => {
  const p = placesTuiles.find((x) => x.nom === (alias ?? nom) && ['suburb', 'city', 'town', 'village'].includes(x.classe));
  if (!p) throw new Error(`Point de commune introuvable : ${nom}`);
  return { nom, lat: p.lat, lng: p.lng };
};
export const POINTS_COMMUNES = [
  etiquette('Abobo'), etiquette('Adjamé'), etiquette('Attécoubé'), etiquette('Cocody'), etiquette('Koumassi'),
  etiquette('Marcory'), etiquette('Plateau', 'Le Plateau'), etiquette('Port-Bouët'), etiquette('Treichville'),
  etiquette('Yopougon'), etiquette('Bingerville'), etiquette('Anyama'), etiquette('Songon', 'Songon Dagbé'),
];
const croise = (ax: number, ay: number, bx: number, by: number, s: number[]) => {
  const [x1, y1, x2, y2] = s as [number, number, number, number];
  const d = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  return (d(ax, ay, bx, by, x1, y1) > 0) !== (d(ax, ay, bx, by, x2, y2) > 0) && (d(x1, y1, x2, y2, ax, ay) > 0) !== (d(x1, y1, x2, y2, bx, by) > 0);
};
export function communeDe(p: { lat: number; lng: number }): string | null {
  const tries = POINTS_COMMUNES.map((c) => ({ c, d: km(p, c) })).sort((a, b) => a.d - b.d);
  for (const { c, d } of tries) {
    if (d > 25) break;
    if (!SEGMENTS.some((s) => croise(p.lng, p.lat, c.lng, c.lat, s))) return c.nom;
  }
  return null; // hors des communes du district (Grand-Bassam, Alépé…) ou cas ambigu
}

const sortie = lieux
  .map((l) => ({ nom: l.nom, lat: +l.lat.toFixed(5), lng: +l.lng.toFixed(5), niveau: NIVEAU[l.classe]!, commune: communeDe(l) }))
  .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

// --- Statistiques et recoupement HDX ---------------------------------------------------------
const parCommune: Record<string, number> = {};
const parNiveau: Record<string, number> = {};
for (const l of sortie) { parCommune[l.commune ?? '(hors district)'] = (parCommune[l.commune ?? '(hors district)'] ?? 0) + 1; parNiveau[l.niveau] = (parNiveau[l.niveau] ?? 0) + 1; }
const hdxVillages = hdxLieux.filter((h) => ['village', 'hamlet', 'town'].includes(h.classe));
const hdxRetrouves = hdxVillages.filter((h) => sortie.some((l) => cle(l.nom) === cle(h.nom) && km(l, h) < 1.5));
const tuilesVillages = bruts.filter((b) => ['village', 'hamlet'].includes(b.classe) && dansEmprise(b.lat, b.lng));
const stats = {
  date: new Date().toISOString().slice(0, 10),
  bruts: { tuiles: bruts.length, hdx: hdxLieux.length, candidats: candidats.length },
  retenus: sortie.length,
  fusionnes: candidats.length - sortie.length,
  parNiveau, parCommune,
  hdx: { villagesEtHameaux: hdxVillages.length, retrouves: hdxRetrouves.length, absentsDesTuiles: hdxVillages.filter((h) => !tuilesVillages.some((t) => cle(t.nom) === cle(h.nom) && km(t, h) < 1.5)).map((h) => h.nom) },
  doublons,
};
writeFileSync(path.join(DOSSIER, 'rapport-lieux.json'), JSON.stringify(stats, null, 1));

// --- Fichiers du serveur ----------------------------------------------------------------------
const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'src', 'modules', 'maps');
const communesListe = POINTS_COMMUNES.map((c) => c.nom);
writeFileSync(path.join(racine, 'quartiers-abidjan.ts'), `/**
 * LIEUX DU GRAND ABIDJAN — extraits d'OpenStreetMap le ${stats.date} (tuiles OpenMapTiles
 * d'OpenFreeMap, recoupées avec l'export OSM de HOT publié sur HDX).
 * Données © les contributeurs d'OpenStreetMap, licence ODbL (citée dans l'app).
 *
 * ${stats.bruts.tuiles + stats.bruts.hdx} entrées brutes → ${sortie.length} lieux après nettoyage :
 * doublons fusionnés (point + polygone, « X » / « X village », graphies), maisons isolées
 * écartées, niveau de chaque lieu, commune déterminée par les limites communales OSM.
 * Régénérer : scripts/lieux-osm/README.md (la base OSM évolue chaque semaine).
 */
export type NiveauLieu = 'quartier' | 'sous-quartier' | 'village' | 'hameau' | 'ile';
export const COMMUNES_ABIDJAN = ${JSON.stringify(communesListe)} as const;

/** [nom, lat, lng, niveau, indice de la commune dans COMMUNES_ABIDJAN ou -1 hors district] */
export type Quartier = readonly [nom: string, lat: number, lng: number, niveau: NiveauLieu, commune: number];

export const QUARTIERS_ABIDJAN: readonly Quartier[] = [
${sortie.map((l) => `  [${JSON.stringify(l.nom)}, ${l.lat}, ${l.lng}, '${l.niveau}', ${l.commune ? communesListe.indexOf(l.commune) : -1}],`).join('\n')}
];
`);
// Copie identique pour l'app cliente : recherche des lieux sans serveur (réseau faible, démo).
writeFileSync(path.resolve(racine, '..', '..', '..', '..', 'frontend', 'src', 'lieux-abidjan.ts'), readFileSync(path.join(racine, 'quartiers-abidjan.ts')));
writeFileSync(path.join(racine, 'limites-communes.ts'), `/**
 * LIMITES DES COMMUNES DU DISTRICT D'ABIDJAN — OpenStreetMap (limites administratives de
 * niveau 8), extraites le ${stats.date}. Données © contributeurs OSM, ODbL.
 *
 * Une position appartient à la commune dont le point central est joignable en ligne
 * droite SANS franchir de limite communale (le plus proche d'abord).
 */
export const POINTS_COMMUNES: ReadonlyArray<{ nom: string; lat: number; lng: number }> = ${JSON.stringify(POINTS_COMMUNES)};

/** Segments de limite : [lng1, lat1, lng2, lat2] à plat (4 nombres par segment). */
export const SEGMENTS_LIMITES: readonly number[] = ${JSON.stringify(SEGMENTS.flat())};
`);
console.log(JSON.stringify({ ...stats, doublons: `${stats.doublons.length} lieux fusionnés (voir rapport-lieux.json)` }, null, 1));
