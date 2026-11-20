/**
 * INDEX DES LIEUX D'ABIDJAN POUR LA RECHERCHE SANS SERVEUR.
 *
 * Lit les tuiles vectorielles OpenStreetMap (schéma OpenMapTiles, niveau 14) du district
 * et produit un index compact : commerces, banques, restaurants, maquis, supermarchés,
 * marchés, églises, mosquées, écoles, hôpitaux, pharmacies, hôtels, stations, lieux de
 * culture et d'événements, administrations, arrêts et gares… ainsi que les RUES nommées
 * et les QUARTIERS D'USAGE absents d'OpenStreetMap (« Riviera Golf », « Palmeraie »…),
 * placés là où les lieux qui portent leur nom se concentrent.
 *
 * Usage : node indexer-lieux.mjs <dossier-tuiles> <sortie.json>
 * Données © les contributeurs d'OpenStreetMap, licence ODbL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const NM = path.join(ici, '../../node_modules/');
const { VectorTile } = await import(NM + '@mapbox/vector-tile/index.js');
const { PbfReader } = await import(NM + 'pbf/index.js');

const [dossier, sortie] = process.argv.slice(2);
if (!dossier || !sortie) { console.error('usage : node indexer-lieux.mjs <dossier-tuiles> <sortie.json>'); process.exit(1); }

/* ---------- Quartiers vérifiés (lieux-abidjan.ts) : communes et doublons ---------- */
const source = fs.readFileSync(path.join(ici, '../../src/lieux-abidjan.ts'), 'utf8');
const COMMUNES = JSON.parse(source.match(/COMMUNES_ABIDJAN = (\[[^\]]+\])/)[1]);
const QUARTIERS = [...source.matchAll(/^\s*\["(.+?)", ([\d.-]+), ([\d.-]+), '([a-z-]+)', (-?\d+)\],$/gm)]
  .map((m) => ({ nom: m[1], lat: +m[2], lng: +m[3], niveau: m[4], commune: +m[5] }));
if (QUARTIERS.length < 400) throw new Error(`lecture de lieux-abidjan.ts : ${QUARTIERS.length} quartiers seulement`);

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();
const distM = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
};
/** Commune : celle du quartier vérifié le plus proche (à moins de 5 km), sinon -1. */
const communeDe = (p) => {
  let m = null;
  for (const q of QUARTIERS) {
    if (Math.abs(q.lat - p.lat) > 0.05 || Math.abs(q.lng - p.lng) > 0.05) continue;
    const d = distM(p, q); if (!m || d < m.d) m = { d, c: q.commune };
  }
  return m && m.d < 5000 ? m.c : -1;
};

/* ---------- Catégories affichées (libellé + pictogramme de la carte) ---------- */
const CATEGORIES = [];
const cat = (libelle, icone, rang) => { CATEGORIES.push([libelle, icone, rang]); return CATEGORIES.length - 1; };
const C = {
  rue: cat('Rue', 'road', 2), quartierUsage: cat('Quartier', 'marker', 0),
  restaurant: cat('Restaurant', 'restaurant', 3), maquis: cat('Maquis · bar', 'bar', 3), rapide: cat('Restauration rapide', 'fast_food', 3),
  cafe: cat('Café', 'cafe', 3), patisserie: cat('Boulangerie · pâtisserie', 'bakery', 3), glacier: cat('Glacier', 'ice_cream', 3),
  boite: cat('Boîte de nuit', 'music', 3), evenement: cat('Espace événementiel', 'theatre', 3),
  banque: cat('Banque', 'bank', 3), dab: cat('Distributeur', 'bank', 4), assurance: cat('Assurance', 'commercial', 4),
  supermarche: cat('Supermarché', 'grocery', 3), marche: cat('Marché', 'grocery', 3), grandMagasin: cat('Centre commercial', 'shop', 3),
  superette: cat('Supérette', 'shop', 4), commerce: cat('Commerce', 'shop', 4), mode: cat('Mode · vêtements', 'clothing_store', 4),
  beaute: cat('Beauté · coiffure', 'hairdresser', 4), telephonie: cat('Téléphonie · électronique', 'shop', 4),
  eglise: cat('Église', 'religious_christian', 3), mosquee: cat('Mosquée', 'religious_muslim', 3), culte: cat('Lieu de culte', 'place_of_worship', 3),
  ecole: cat('École', 'school', 3), universite: cat('Lycée · université', 'college', 3), bibliotheque: cat('Librairie · bibliothèque', 'library', 4),
  hopital: cat('Hôpital', 'hospital', 3), clinique: cat('Clinique', 'hospital', 3), pharmacie: cat('Pharmacie', 'pharmacy', 3),
  medecin: cat('Cabinet médical', 'doctors', 4), dentiste: cat('Dentiste', 'dentist', 4),
  hotel: cat('Hôtel', 'lodging', 3), residence: cat('Résidence · maison d’hôtes', 'lodging', 3),
  station: cat('Station-service', 'fuel', 3), garage: cat('Garage · pièces auto', 'car', 4),
  cinema: cat('Cinéma', 'cinema', 3), theatre: cat('Théâtre · salle de spectacle', 'theatre', 3), musee: cat('Musée', 'museum', 3),
  culture: cat('Espace culturel', 'art_gallery', 3), sport: cat('Sport', 'stadium', 3), loisirs: cat('Loisirs', 'attraction', 3), parc: cat('Parc · jardin', 'park', 3),
  mairie: cat('Mairie · administration', 'town_hall', 3), police: cat('Police', 'police', 3), pompiers: cat('Pompiers', 'fire_station', 3),
  poste: cat('Poste', 'post', 3), ambassade: cat('Ambassade', 'embassy', 3), tribunal: cat('Tribunal', 'town_hall', 3),
  bureau: cat('Bureau · entreprise', 'commercial', 4), gare: cat('Gare routière', 'bus', 3), arret: cat('Arrêt de bus', 'bus', 5),
  gareLagunaire: cat('Gare lagunaire', 'ferry', 3), gareTrain: cat('Gare', 'railway', 3), cimetiere: cat('Cimetière', 'cemetery', 4),
};
const EVENEMENT = /\b(espace|salle (de|des) (fete|fetes|reception|receptions|spectacle)|events?|evenementiel|receptions?|palais des congres|centre de conference|centre des congres|jardin de reception)\b/;

function categorie(p, n) {
  const k = p.class, s = p.subclass;
  if (EVENEMENT.test(n) && !['place_of_worship', 'school', 'college', 'hospital', 'pharmacy', 'bank', 'bus'].includes(k)) return C.evenement;
  switch (k) {
    case 'restaurant': return C.restaurant;
    case 'fast_food': return C.rapide;
    case 'beer': case 'bar': return s === 'nightclub' ? C.boite : C.maquis;
    case 'cafe': return C.cafe;
    case 'bakery': return C.patisserie;
    case 'ice_cream': return C.glacier;
    case 'bank': return C.banque;
    case 'atm': return C.dab;
    case 'grocery': return s === 'supermarket' ? C.supermarche : s === 'marketplace' ? C.marche : s === 'department_store' ? C.grandMagasin : C.superette;
    case 'shop': return s === 'mall' ? C.grandMagasin : s === 'convenience' || s === 'general' ? C.superette : s === 'beauty' || s === 'cosmetics' || s === 'perfumery' || s === 'massage' ? C.beaute
      : s === 'mobile_phone' || s === 'electronics' || s === 'computer' ? C.telephonie : s === 'boutique' || s === 'fabric' || s === 'shoes' || s === 'jewelry' || s === 'tailor' ? C.mode : C.commerce;
    case 'clothing_store': return C.mode;
    case 'hairdresser': return C.beaute;
    case 'alcohol_shop': case 'butcher': case 'florist': case 'gift': case 'furniture': case 'music': case 'bicycle': case 'pet': return C.commerce;
    case 'place_of_worship': return s === 'christian' ? C.eglise : s === 'muslim' ? C.mosquee : C.culte;
    case 'school': return C.ecole;
    case 'college': return C.universite;
    case 'library': return C.bibliotheque;
    case 'hospital': return s === 'hospital' ? C.hopital : C.clinique;
    case 'pharmacy': return C.pharmacie;
    case 'doctors': return C.medecin;
    case 'dentist': return C.dentiste;
    case 'lodging': return s === 'hotel' || s === 'motel' ? C.hotel : C.residence;
    case 'fuel': return C.station;
    case 'car': return C.garage;
    case 'cinema': return C.cinema;
    case 'theatre': return C.theatre;
    case 'museum': return C.musee;
    case 'art_gallery': return C.culture;
    case 'stadium': case 'sports_centre': case 'pitch': case 'swimming_pool': case 'gymnastics': case 'golf': case 'basketball': case 'karting': return C.sport;
    case 'attraction': case 'theme_park': case 'water_park': case 'zoo': case 'monument': case 'castle': case 'escape_game': return C.loisirs;
    case 'park': case 'garden': case 'playground': case 'picnic_site': return C.parc;
    case 'town_hall': return s === 'courthouse' ? C.tribunal : s === 'community_centre' ? C.culture : C.mairie;
    case 'police': return C.police;
    case 'fire_station': return C.pompiers;
    case 'post': return s === 'post_office' ? C.poste : null;
    case 'office': return s === 'diplomatic' ? C.ambassade : s === 'government' ? C.mairie : s === 'insurance' ? C.assurance : C.bureau;
    case 'bus': return s === 'bus_station' ? C.gare : C.arret;
    case 'ferry_terminal': case 'harbor': return C.gareLagunaire;
    case 'railway': return C.gareTrain;
    case 'cemetery': return C.cimetiere;
    case 'laundry': return C.commerce;
    default: return null; // toilettes, portails, parkings, abris… : pas des destinations
  }
}

/* ---------- Lecture des tuiles z14 ---------- */
const Z = 14;
const pois = new Map(); // clé : nom normalisé + cellule de 60 m
const rues = new Map(); // nom normalisé → segments
const nomsLieux = []; // tous les lieux nommés (pour les quartiers d'usage)
let nbTuiles = 0;
for (const x of fs.readdirSync(path.join(dossier, String(Z)))) {
  for (const f of fs.readdirSync(path.join(dossier, String(Z), x))) {
    const y = Number(f.split('.')[0]);
    const tuile = new VectorTile(new PbfReader(fs.readFileSync(path.join(dossier, String(Z), x, f))));
    nbTuiles++;
    const poi = tuile.layers.poi;
    if (poi) for (let i = 0; i < poi.length; i++) {
      const ft = poi.feature(i); const p = ft.properties;
      const nom = String(p['name:fr'] ?? p.name ?? '').trim(); if (nom.length < 2) continue;
      const g = ft.toGeoJSON(Number(x), y, Z).geometry; if (g.type !== 'Point') continue;
      const pt = { lat: g.coordinates[1], lng: g.coordinates[0] };
      const n = norm(nom);
      nomsLieux.push({ n, ...pt, classe: p.class });
      const c = categorie(p, n); if (c === null) continue;
      // Même nom, même catégorie à moins de 150 m (250 m pour les arrêts, posés des deux
      // côtés de la voie) : un seul lieu.
      const cle = `${n}|${c}`;
      const deja = pois.get(cle) ?? [];
      if (!deja.some((q) => distM(q, pt) < (c === C.arret ? 250 : 150))) { deja.push({ nom, ...pt, c }); pois.set(cle, deja); }
    }
    const tn = tuile.layers.transportation_name;
    if (tn) for (let i = 0; i < tn.length; i++) {
      const ft = tn.feature(i); const p = ft.properties;
      const nom = String(p['name:fr'] ?? p.name ?? '').trim(); if (nom.length < 3) continue;
      const g = ft.toGeoJSON(Number(x), y, Z).geometry;
      const lignes = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of lignes) {
        if (l.length < 2) continue;
        const milieu = l[Math.floor(l.length / 2)];
        const n = norm(nom);
        if (!rues.has(n)) rues.set(n, { nom, points: [] });
        rues.get(n).points.push({ lat: milieu[1], lng: milieu[0] });
        nomsLieux.push({ n, lat: milieu[1], lng: milieu[0], classe: 'rue' });
      }
    }
    const pl = tuile.layers.place;
    if (pl) for (let i = 0; i < pl.length; i++) {
      const ft = pl.feature(i); const p = ft.properties; const nom = String(p['name:fr'] ?? p.name ?? '').trim(); if (!nom) continue;
      const g = ft.toGeoJSON(Number(x), y, Z).geometry; if (g.type !== 'Point') continue;
      nomsLieux.push({ n: norm(nom), lat: g.coordinates[1], lng: g.coordinates[0], classe: 'place' });
    }
  }
}

const lieux = [];
const arrondi = (v) => Math.round(v * 1e5) / 1e5;
let nbPois = 0;
for (const liste of pois.values()) for (const p of liste) { lieux.push([p.nom, arrondi(p.lat), arrondi(p.lng), p.c, communeDe(p)]); nbPois++; }

/* ---------- Rues : un point par tronçon distinct (même nom à plus de 900 m) ---------- */
let nbRues = 0;
for (const { nom, points } of rues.values()) {
  const groupes = [];
  for (const pt of points) {
    const g = groupes.find((x) => distM(x.centre, pt) < 900);
    if (g) { g.pts.push(pt); g.centre = { lat: g.pts.reduce((s, q) => s + q.lat, 0) / g.pts.length, lng: g.pts.reduce((s, q) => s + q.lng, 0) / g.pts.length }; }
    else groupes.push({ centre: pt, pts: [pt] });
  }
  for (const g of groupes) {
    // Point réel le plus proche du centre (sur la voie, pas au milieu d'un pâté de maisons).
    const sur = g.pts.reduce((m, q) => (distM(q, g.centre) < distM(m, g.centre) ? q : m), g.pts[0]);
    lieux.push([nom, arrondi(sur.lat), arrondi(sur.lng), C.rue, communeDe(sur)]); nbRues++;
  }
}

/* ---------- Quartiers d'usage absents d'OpenStreetMap ----------
 * Noms que les Abidjanais emploient tous les jours mais qu'OSM ne porte pas comme
 * quartiers. Position : médiane des lieux (arrêts, écoles, commerces, rues…) dont le
 * nom les contient ; retenue seulement si au moins 3 lieux concordent à moins de 1,2 km. */
const USAGE = [
  'Riviera Golf', 'Riviera Palmeraie', 'Riviera Faya', 'Riviera Anono', 'Riviera Attoban', 'Riviera 5', 'Riviera M\'Badon', 'Riviera Abatta',
  'Riviera Akouedo', 'Riviera Allabra', 'Riviera Ciad', 'Riviera Lauriers', 'Anono', 'Akouedo', 'M\'Badon', 'Bonoumin',
  'Angré Château', 'Angré Mahou', 'Angré Djibi', 'Angré Petro Ivoire', 'Angré Nouveau CHU', 'Angré Terminus 81', 'Angré 7e tranche', 'Angré 8e tranche',
  'Angré 9e tranche', 'Angré Star', 'Djibi', 'Cocody Danga', 'Danga', 'Cocody Ambassades', 'Ambassades', 'Cocody Saint Jean',
  'Blockhaus', 'Cocody Centre', 'Mermoz', 'Vallons', 'Aghien', 'Deux Plateaux Vallons', 'Sideci', 'Gobelet', 'Washington', 'Cité des Arts',
  'Niangon', 'Wassakara', 'Toits Rouges', 'Selmer', 'Andokoi', 'Siporex', 'Sicogi', 'Yopougon Maroc', 'Ficgayo', 'Banco', 'Mamie Adjoua',
  'Koweït', 'Kouté', 'Port Bouët 2', 'Zone 4', 'Zone 3', 'Biétry', 'Remblais', 'Anoumabo', 'Gonzagueville', 'Vridi', 'Jean Folly', 'Adjouffou',
  'Derrière Wharf', 'Grand Campement', 'Prodomo', 'Arras', 'Avocatier', 'PK 18', 'Akeikoi', 'Sagbé', 'Dokui', 'Williamsville', 'Bracodi',
  'Paillet', 'Bromakoté', 'Abobo Gare', 'N\'Dotré', 'Anonkoua', 'Belleville', 'Agban', 'Locodjro', 'Boribana', 'Mossikro', 'Abattoir',
  'Petit Marché', 'Grand Marché', 'Gesco', 'Banco 2', 'Port Bouët Phare', 'Cité Verte', 'Marcory Résidentiel', 'Hibiscus',
  'Bingerville Centre', 'Anyama Centre', 'Songon Agban', 'Abatta', 'Faya', 'Attoban', 'Allabra', 'Akouai Santai', 'Cité Fairmont',
];
const dejaQuartier = new Set(QUARTIERS.map((q) => norm(q.nom)));
const mediane = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
let nbUsage = 0;
const usageRetenus = [];
const ecartes = [];
for (const nom of USAGE) {
  const n = norm(nom);
  if (dejaQuartier.has(n)) { ecartes.push(`${nom} (déjà dans OSM)`); continue; }
  const re = new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  const pts = nomsLieux.filter((l) => re.test(l.n));
  if (pts.length < 3) { ecartes.push(`${nom} (${pts.length} lieu·x)`); continue; }
  const centre = { lat: mediane(pts.map((p) => p.lat)), lng: mediane(pts.map((p) => p.lng)) };
  const proches = pts.filter((p) => distM(p, centre) < 1200);
  if (proches.length < 3 || proches.length / pts.length < 0.5) { ecartes.push(`${nom} (dispersé)`); continue; } // pas un quartier
  const c = { lat: mediane(proches.map((p) => p.lat)), lng: mediane(proches.map((p) => p.lng)) };
  lieux.push([nom.replace(/\bRiviera\b/, 'Riviéra'), arrondi(c.lat), arrondi(c.lng), C.quartierUsage, communeDe(c)]);
  usageRetenus.push(`${nom} (${proches.length}/${pts.length})`); nbUsage++;
}

const index = {
  version: 1,
  source: 'OpenStreetMap (ODbL) — tuiles OpenMapTiles d’OpenFreeMap',
  genereLe: new Date().toISOString().slice(0, 10),
  communes: COMMUNES,
  categories: CATEGORIES,
  lieux,
};
fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(sortie, JSON.stringify(index));
// Les mêmes quartiers d'usage, en GeoJSON, pour leur nom sur la carte.
fs.writeFileSync(path.join(path.dirname(sortie), 'quartiers-usage.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  features: lieux.filter((l) => l[3] === C.quartierUsage).map(([nom, lat, lng]) => ({ type: 'Feature', properties: { nom }, geometry: { type: 'Point', coordinates: [lng, lat] } })),
}));
console.log(`${nbTuiles} tuiles → ${lieux.length} lieux (${nbPois} lieux nommés, ${nbRues} tronçons de rues, ${nbUsage} quartiers d'usage) · ${(fs.statSync(sortie).size / 1024 / 1024).toFixed(2)} Mo`);
console.log('Quartiers d’usage retenus :', usageRetenus.join(', '));
console.log('Écartés :', ecartes.join(', '));
