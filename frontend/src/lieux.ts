import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as CarteML } from 'maplibre-gl';
import type { LatLng, Place } from './types';
import { ABIDJAN_PLACES, DEFAULT_ORIGIN } from './data';
import { isLiveBackend, urlApi } from './api';
import { COMMUNES_ABIDJAN, QUARTIERS_ABIDJAN, type NiveauLieu } from './lieux-abidjan';

/**
 * LIEUX DU CLIENT : point de prise en charge, recherche d'adresse, récents, domicile,
 * bureau.
 *
 * Avant cet audit, le départ de TOUTES les courses était le Plateau, affiché « Position
 * actuelle », et la recherche ne connaissait qu'une quinzaine de lieux écrits en dur.
 * Ici : la vraie position du téléphone (GPS), un départ que le client peut changer, et
 * une recherche d'adresses réelle (serveur : répertoire ORION + OpenStreetMap).
 */

export type SourceDepart = 'defaut' | 'gps' | 'manuel';
export type EtatPosition = 'inconnue' | 'attente' | 'ok' | 'refus' | 'indisponible' | 'hors_zone';

export interface Depart { place: Place; source: SourceDepart }

const CLE_RECENTS = 'orion.lieux.recents';
const CLE_DOMICILE = 'orion.lieux.domicile';
const CLE_BUREAU = 'orion.lieux.bureau';
const MAX_RECENTS = 6;

const lire = <T,>(cle: string): T | null => { try { return JSON.parse(localStorage.getItem(cle) || 'null') as T | null; } catch { return null; } };
const ecrire = (cle: string, v: unknown) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

export const lieuxRecents = (): Place[] => lire<Place[]>(CLE_RECENTS) ?? [];
export function memoriserRecent(p: Place): void {
  if (p.kind === 'home' || p.kind === 'work') return;
  const proche = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 0.0005 && Math.abs(a.lng - b.lng) < 0.0005;
  const liste = [{ ...p, kind: 'recent' as const }, ...lieuxRecents().filter((r) => r.id !== p.id && !proche(r.location, p.location))].slice(0, MAX_RECENTS);
  ecrire(CLE_RECENTS, liste);
}
export const lieuEnregistre = (quel: 'home' | 'work'): Place | null => lire<Place>(quel === 'home' ? CLE_DOMICILE : CLE_BUREAU);
export function enregistrerLieu(quel: 'home' | 'work', p: Place, nom: string): Place {
  const lieu: Place = { ...p, id: quel, name: nom, kind: quel };
  ecrire(quel === 'home' ? CLE_DOMICILE : CLE_BUREAU, lieu);
  return lieu;
}

/** Lieux populaires (gares, aéroport, hôpitaux, université…) : jamais le domicile d'un autre. */
export const LIEUX_POPULAIRES: Place[] = ABIDJAN_PLACES.filter((p) => p.kind !== 'home' && p.kind !== 'work');

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

const LIBELLE_NIVEAU: Record<NiveauLieu, string> = {
  quartier: 'Quartier', 'sous-quartier': 'Sous-quartier', village: 'Village', hameau: 'Hameau', ile: 'Île',
};
const distanceM = (a: LatLng, b: LatLng) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
};

/**
 * INDEX DÉTAILLÉ (APK et démonstration) : 31 000 lieux extraits des tuiles OpenStreetMap
 * du district — commerces, banques, restaurants, maquis, supermarchés, marchés, églises,
 * mosquées, écoles, hôpitaux, pharmacies, hôtels, stations, lieux de culture et
 * d'événements, administrations, arrêts — plus les rues nommées et les quartiers d'usage
 * absents d'OSM (« Riviéra Golf »…). Généré par scripts/carte-hors-ligne/indexer-lieux.mjs
 * et livré à côté de l'app ; absent des versions reliées au serveur (qui cherche lui-même).
 */
interface IndexLieux {
  communes: string[];
  /** [libellé, pictogramme, rang] — rang : 0 quartier, 2 rue, 3 lieu, 4 commerce de détail, 5 arrêt. */
  categories: Array<[string, string, number]>;
  lieux: Array<[nom: string, lat: number, lng: number, categorie: number, commune: number]>;
}
let indexCharge: (IndexLieux & { cles: string[] }) | null = null;
let chargement: Promise<void> | null = null;
export function chargerIndexLieux(): Promise<void> {
  chargement ??= fetch(new URL('./carte/lieux-index.json', window.location.href).href)
    .then((r) => (r.ok ? r.json() as Promise<IndexLieux> : null))
    .then((ix) => { if (ix?.lieux?.length) indexCharge = { ...ix, cles: ix.lieux.map((l) => sansAccents(l[0])) }; })
    .catch(() => { /* pas d'index livré : la recherche garde les quartiers */ });
  return chargement;
}

/** Famille d'un lieu (couleur de son nom sur la carte), d'après son pictogramme. */
const FAMILLE: Record<string, string> = {
  restaurant: 'manger', bar: 'manger', fast_food: 'manger', cafe: 'manger', bakery: 'manger', ice_cream: 'manger',
  bank: 'argent', grocery: 'commerce', shop: 'commerce', clothing_store: 'commerce', hairdresser: 'commerce', car: 'commerce',
  religious_christian: 'culte', religious_muslim: 'culte', place_of_worship: 'culte',
  school: 'ecole', college: 'ecole', library: 'ecole', hospital: 'sante', pharmacy: 'sante', doctors: 'sante', dentist: 'sante',
  lodging: 'hotel', fuel: 'transport', bus: 'transport', ferry: 'transport', railway: 'transport', airport: 'transport', harbor: 'transport',
  cinema: 'loisirs', theatre: 'loisirs', museum: 'loisirs', art_gallery: 'loisirs', stadium: 'loisirs', attraction: 'loisirs', park: 'loisirs', music: 'loisirs',
  commercial: 'bureau', building: 'bureau',
};
/** Repères de quartier, visibles de loin : on s'oriente avec eux. */
const REPERES = new Set(['Hôpital', 'Clinique', 'Église', 'Mosquée', 'Lycée · université', 'Supermarché', 'Marché', 'Centre commercial',
  'Hôtel', 'Station-service', 'Gare routière', 'Gare lagunaire', 'Gare', 'Aéroport', 'Port', 'Mairie · administration', 'Ambassade',
  'Musée', 'Cinéma', 'Théâtre · salle de spectacle', 'Sport', 'Police', 'Pompiers', 'Tribunal']);

/**
 * Les lieux de l'index, prêts pour la carte. Les rues, arrêts et quartiers n'y sont pas :
 * la carte les dessine déjà elle-même. `n` = niveau d'apparition (0 repère, 1 lieu,
 * 2 commerce de détail, 3 immeuble nommé).
 */
export function lieuxPourCarte(): GeoJSON.FeatureCollection<GeoJSON.Point> | null {
  if (!indexCharge) return null;
  const { categories, lieux } = indexCharge;
  const features: Array<GeoJSON.Feature<GeoJSON.Point>> = [];
  for (const [nom, lat, lng, c] of lieux) {
    const [libelle, ic, rg] = categories[c] ?? ['', 'dot', 9];
    if (rg <= 2 || rg >= 5) continue;
    const n = libelle === 'Immeuble · résidence' ? 3 : REPERES.has(libelle) ? 0 : rg === 3 ? 1 : 2;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { nom, ic, rg, n, f: FAMILLE[ic] ?? 'autre' } });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * CARTE « COMBLÉE » — la même dans l'app cliente, l'app chauffeur, la console et le tableau
 * de bord. Dès que l'index est chargé, la carte affiche tous ses lieux (banques, sièges,
 * écoles, commerces, immeubles nommés…) et masque ceux des tuiles, qui n'en sont qu'un
 * sous-ensemble. Sans index livré, rien ne change : les lieux des tuiles restent affichés.
 */
export function comblerCarte(m: CarteML, estAnnule: () => boolean = () => false): void {
  void chargerIndexLieux().then(() => {
    if (estAnnule()) return;
    const lieux = lieuxPourCarte();
    let source: { setData?: (d: unknown) => void } | undefined;
    try { source = m.getSource('index') as { setData?: (d: unknown) => void } | undefined; } catch { return; /* carte déjà retirée */ }
    if (!lieux || !source?.setData) return;
    source.setData(lieux);
    for (const id of ['index-reperes', 'index-lieux', 'index-detail', 'index-immeubles']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible');
    for (const id of ['lieux', 'lieux-reperes']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none');
  });
}

/**
 * RECHERCHE SANS SERVEUR : les 449 lieux du Grand Abidjan vérifiés (OpenStreetMap,
 * dédoublonnés, avec niveau et commune), et l'index détaillé quand il est livré. Sert
 * quand le serveur ne répond pas (réseau faible) et en démonstration.
 * « pharmacie », « mosquée », « banque »… trouvent aussi les lieux de cette catégorie
 * les plus proches, même si leur nom ne contient pas le mot.
 */
export function rechercheLocale(q: string, pres?: LatLng): Place[] {
  const cle = sansAccents(q);
  if (cle.length < 2) return [];
  const rang = (n: string) => (n === cle ? 0 : n.startsWith(cle) ? 1 : n.split(' ').some((m) => m.startsWith(cle)) ? 2 : n.includes(cle) ? 3 : -1);
  type Candidat = Place & { rang: number; poids: number };
  const candidats: Candidat[] = [];
  for (const p of LIEUX_POPULAIRES) {
    const r = Math.min(...[rang(sansAccents(p.name)), rang(sansAccents(p.area))].map((x) => (x < 0 ? 9 : x)));
    if (r < 9) candidats.push({ ...p, rang: r, poids: 0 });
  }
  const dejaQuartiers = new Set<string>();
  for (const [nom, lat, lng, niveau, iCommune] of QUARTIERS_ABIDJAN) {
    const n = sansAccents(nom);
    const r = rang(n);
    if (r < 0) continue;
    dejaQuartiers.add(n);
    // Les quartiers passent avant leurs subdivisions (« Zone 4 » avant « Zone 4A »).
    const poids = niveau === 'quartier' ? 1 : niveau === 'sous-quartier' ? 2 : 3;
    candidats.push({
      id: `osm-lieu:${n.replace(/ /g, '-')}:${lat}`, name: nom,
      area: `${LIBELLE_NIVEAU[niveau]} · ${COMMUNES_ABIDJAN[iCommune] ?? 'Grand Abidjan'}`,
      location: { lat, lng }, rang: r, poids, categorie: 'marker',
    });
  }
  const ix = indexCharge;
  if (ix) {
    // Catégories demandées par leur nom (« pharmacie », « eglise », « supermarche »…).
    const categoriesVisees = new Set<number>();
    if (cle.length >= 4) ix.categories.forEach(([libelle], i) => { if (sansAccents(libelle).split(/[ ·]+/).some((m) => m.startsWith(cle))) categoriesVisees.add(i); });
    const parCategorie: Candidat[] = [];
    for (let i = 0; i < ix.lieux.length; i++) {
      const [nom, lat, lng, c, iCommune] = ix.lieux[i]!;
      const r = rang(ix.cles[i]!);
      const visee = categoriesVisees.has(c);
      if (r < 0 && !visee) continue;
      if (ix.categories[c]![2] === 0 && dejaQuartiers.has(ix.cles[i]!)) continue;
      const [libelle, icone, rangCat] = ix.categories[c]!;
      const lieu: Candidat = {
        id: `osm-poi:${i}`, name: nom, area: `${libelle} · ${ix.communes[iCommune] ?? 'Grand Abidjan'}`,
        location: { lat, lng },
        // Un arrêt de bus porte souvent le nom d'un lieu (« Pharmacie », « Mosquée ») : il
        // passe après les vrais lieux de même nom.
        rang: visee ? 0.5 : r + (rangCat >= 5 ? 1.5 : 0) + (categoriesVisees.size ? 1 : 0), poids: rangCat === 0 ? 1 : rangCat, categorie: icone,
      };
      (visee ? parCategorie : candidats).push(lieu);
    }
    // « pharmacie », « mosquée »… : les plus proches de cette catégorie d'abord (il y en a des centaines).
    if (pres) parCategorie.sort((a, b) => distanceM(pres, a.location) - distanceM(pres, b.location));
    candidats.push(...parCategorie.slice(0, 10));
  }
  const tries = candidats.sort((a, b) => a.rang - b.rang || (a.rang === 0.5 ? 0 : a.poids - b.poids) || (pres ? distanceM(pres, a.location) - distanceM(pres, b.location) : 0));
  // Un même nom à moins de 300 m (arrêt de bus et école « Riviéra Golf ») : un seul résultat.
  const retenus: Candidat[] = [];
  for (const c of tries) {
    if (retenus.length >= 12) break;
    if (retenus.some((r) => sansAccents(r.name) === sansAccents(c.name) && distanceM(r.location, c.location) < 300)) continue;
    retenus.push(c);
  }
  return retenus.map(({ rang: _r, poids: _p, ...l }) => {
    // Le quartier précis d'un commerce ou d'une rue : « Pharmacie · Riviéra 2, Cocody ».
    if (l.id.startsWith('osm-poi:') && !l.area.startsWith('Quartier')) {
      const proche = lieuProche(l.location);
      if (proche) return { ...l, area: `${l.area.split(' · ')[0]} · ${proche}` };
    }
    return l;
  });
}

/**
 * Recherche d'adresse. L'index livré avec l'application (48 924 lieux du district d'Abidjan)
 * répond toujours, connecté ou non, dans les quatre interfaces. Relié au serveur, on y
 * ajoute ce que lui seul connaît : les adresses hors du district (géocodage), sans doublon.
 */
export async function rechercherLieux(q: string, pres?: LatLng, signal?: AbortSignal): Promise<Place[]> {
  const requete = q.trim();
  if (requete.length < 2) return [];
  const duServeur = async (): Promise<Place[]> => {
    if (!isLiveBackend()) return [];
    try {
      const params = new URLSearchParams({ q: requete });
      if (pres) { params.set('lat', String(pres.lat)); params.set('lng', String(pres.lng)); }
      const res = await fetch(urlApi(`/maps/recherche?${params}`)!, { signal });
      if (!res.ok) return [];
      const json = await res.json() as { lieux: Array<{ id: string; nom: string; secteur: string; location: LatLng; categorie?: string }> };
      return json.lieux.map((l) => ({ id: l.id, name: l.nom, area: l.secteur, location: l.location, ...(l.categorie ? { categorie: l.categorie } : {}) }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      return [];
    }
  };
  const [serveur] = await Promise.all([duServeur(), chargerIndexLieux()]);
  const locaux = rechercheLocale(requete, pres);
  if (!serveur.length) return locaux;
  if (!locaux.length) return serveur;
  const fusion = [...locaux];
  for (const l of serveur) {
    if (fusion.length >= 12) break;
    if (fusion.some((r) => sansAccents(r.name) === sansAccents(l.name) && distanceM(r.location, l.location) < 300)) continue;
    fusion.push(l);
  }
  return fusion;
}

/** Lieu le plus proche (quartier, village…) à moins de 1,2 km, d'après le répertoire livré. */
function lieuProche(p: LatLng): string | null {
  let meilleur: { nom: string; d: number } | null = null;
  for (const [nom, lat, lng, , iCommune] of QUARTIERS_ABIDJAN) {
    if (Math.abs(lat - p.lat) > 0.02 || Math.abs(lng - p.lng) > 0.02) continue;
    const d = distanceM(p, { lat, lng });
    const commune = COMMUNES_ABIDJAN[iCommune];
    if (d <= 1_200 && (!meilleur || d < meilleur.d)) meilleur = { nom: commune ? `${nom}, ${commune}` : nom, d };
  }
  return meilleur?.nom ?? null;
}
const EN_COTE_D_IVOIRE = (p: LatLng) => p.lat > 4.34 && p.lat < 10.74 && p.lng > -8.61 && p.lng < -2.49;

/** Quartier ou commune d'un point ; null si hors de Côte d'Ivoire ou serveur muet. */
export async function quartierDe(p: LatLng): Promise<{ nom: string; enZone: boolean } | null> {
  // Sans serveur : le lieu le plus proche du répertoire livré avec l'app.
  if (!isLiveBackend()) return { nom: lieuProche(p) ?? (EN_COTE_D_IVOIRE(p) ? 'Abidjan' : 'Hors de Côte d’Ivoire'), enZone: EN_COTE_D_IVOIRE(p) };
  try {
    const res = await fetch(urlApi('/geo/resolve')!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ point: p }) });
    if (!res.ok) return null;
    const j = await res.json() as { inServiceArea: boolean; zone: { name: string } | null; lieu?: { libelle: string } | null };
    // « Riviéra 2, Cocody » : quartier réel et commune (limites OSM) ; à défaut, la zone.
    return { nom: j.lieu?.libelle ?? j.zone?.name ?? 'Côte d’Ivoire', enZone: j.inServiceArea };
  } catch {
    const proche = lieuProche(p);
    return proche ? { nom: proche, enZone: true } : null;
  }
}

/** Lecture fraîche du GPS du téléphone (rien de mémorisé). Rejette avec l'erreur du navigateur (code 1 = refus). */
export function lirePositionGps(): Promise<LatLng> {
  return new Promise((ok, ko) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { ko({ code: 2 }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => ok({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => ko(err),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

/**
 * POINT DE PRISE EN CHARGE. La position du téléphone si elle est disponible et en Côte
 * d'Ivoire ; sinon un point par défaut MARQUÉ « à confirmer » (le client doit le choisir
 * avant de commander) ; ou le point qu'il a choisi lui-même.
 */
export function useDepart(libelles: { maPosition: string }) {
  const [depart, setDepart] = useState<Depart>({ place: DEFAULT_ORIGIN, source: 'defaut' });
  const [etat, setEtat] = useState<EtatPosition>('inconnue');
  const manuel = useRef(false);

  const localiser = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { setEtat('indisponible'); return; }
    setEtat('attente');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const q = await quartierDe(p);
        if (q && !q.enZone) { setEtat('hors_zone'); return; }
        setEtat('ok');
        if (manuel.current) return; // le client a choisi lui-même : on ne l'écrase pas
        setDepart({ place: { id: 'gps', name: libelles.maPosition, area: q?.nom ?? '', location: p }, source: 'gps' });
      },
      (err) => setEtat(err.code === err.PERMISSION_DENIED ? 'refus' : 'indisponible'),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [libelles.maPosition]);

  // Au lancement : si l'autorisation est déjà donnée, on se localise sans rien demander.
  useEffect(() => {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return;
    void perms.query({ name: 'geolocation' as PermissionName }).then((s) => { if (s.state === 'granted') localiser(); }).catch(() => {});
  }, [localiser]);

  const choisir = useCallback((place: Place) => { manuel.current = true; setDepart({ place, source: 'manuel' }); }, []);
  const revenirAuGps = useCallback(() => { manuel.current = false; localiser(); }, [localiser]);

  /**
   * Le client demande à ACTUALISER sa position (bulle sur la carte) : une lecture fraîche du
   * GPS, qui remplace le point de prise en charge même s'il avait été choisi à la main.
   */
  const actualiser = useCallback(async (): Promise<{ etat: EtatPosition; place?: Place }> => {
    setEtat('attente');
    try {
      const p = await lirePositionGps();
      const q = await quartierDe(p);
      if (q && !q.enZone) { setEtat('hors_zone'); return { etat: 'hors_zone' }; }
      const place: Place = { id: 'gps', name: libelles.maPosition, area: q?.nom ?? '', location: p };
      manuel.current = false;
      setEtat('ok');
      setDepart({ place, source: 'gps' });
      return { etat: 'ok', place };
    } catch (e) {
      const etatEchec: EtatPosition = (e as { code?: number }).code === 1 ? 'refus' : 'indisponible';
      setEtat(etatEchec);
      return { etat: etatEchec };
    }
  }, [libelles.maPosition]);

  return { depart, etat, localiser, choisir, revenirAuGps, actualiser };
}
