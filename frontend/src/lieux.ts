import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng, Place } from './types';
import { ABIDJAN_PLACES, DEFAULT_ORIGIN } from './data';
import { isLiveBackend, urlApi } from './api';

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

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche d'adresse : serveur (répertoire ORION + OpenStreetMap), sinon lieux connus. */
export async function rechercherLieux(q: string, pres?: LatLng, signal?: AbortSignal): Promise<Place[]> {
  const requete = q.trim();
  if (requete.length < 2) return [];
  if (isLiveBackend()) {
    try {
      const params = new URLSearchParams({ q: requete });
      if (pres) { params.set('lat', String(pres.lat)); params.set('lng', String(pres.lng)); }
      const res = await fetch(urlApi(`/maps/recherche?${params}`)!, { signal });
      if (res.ok) {
        const json = await res.json() as { lieux: Array<{ id: string; nom: string; secteur: string; location: LatLng }> };
        if (json.lieux.length) return json.lieux.map((l) => ({ id: l.id, name: l.nom, area: l.secteur, location: l.location }));
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  const cle = sansAccents(requete);
  return LIEUX_POPULAIRES.filter((p) => sansAccents(`${p.name} ${p.area}`).includes(cle));
}

/** Quartier ou commune d'un point (serveur) ; null si hors de Côte d'Ivoire. */
export async function quartierDe(p: LatLng): Promise<{ nom: string; enZone: boolean } | null> {
  if (!isLiveBackend()) return { nom: 'Abidjan', enZone: true };
  try {
    const res = await fetch(urlApi('/geo/resolve')!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ point: p }) });
    if (!res.ok) return null;
    const j = await res.json() as { inServiceArea: boolean; zone: { name: string } | null; lieu?: { libelle: string } | null };
    // « Riviéra 2, Cocody » : quartier réel et commune (limites OSM) ; à défaut, la zone.
    return { nom: j.lieu?.libelle ?? j.zone?.name ?? 'Côte d’Ivoire', enZone: j.inServiceArea };
  } catch { return null; }
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

  return { depart, etat, localiser, choisir, revenirAuGps };
}
