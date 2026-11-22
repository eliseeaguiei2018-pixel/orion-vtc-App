/**
 * PHOTOS ET VIDÉOS RÉELLES DES VÉHICULES (Mariage, Location Signature).
 *
 * La vitrine d'un véhicule lit une liste déclarative : chaque entrée dit pour quel service,
 * quel véhicule et quelles options elle vaut. La liste vient du fichier livré avec
 * l'application (public/medias/vehicules.json) et, quand un serveur ORION est joint, de sa
 * route /rental/medias-vehicules — ce qui permet d'ajouter des images sans republier l'application.
 * Tant qu'elle est vide, la vitrine montre le modèle en volume et le dit.
 */
import { urlApi } from './api';
import { enTetesPasserelle } from './securiteGoogle';

export type ServiceMedia = 'mariage' | 'location';
export type ValeurOption = string | number | boolean;
export interface MediaVehicule {
  service: ServiceMedia;
  /** Gamme (mariage) ou identifiant du véhicule (location) ; « * » : tous. */
  vehicule: string;
  options?: Record<string, ValeurOption>;
  type: 'image' | 'video';
  src: string;
  affiche?: string;
  legende?: string;
}

const valide = (m: unknown): m is MediaVehicule => {
  const x = m as Partial<MediaVehicule> | null;
  return Boolean(x) && (x!.service === 'mariage' || x!.service === 'location') && typeof x!.vehicule === 'string'
    && (x!.type === 'image' || x!.type === 'video') && typeof x!.src === 'string' && x!.src.length > 0;
};
/** Adresse affichable : absolue telle quelle, sinon relative à l'application. */
const adresse = (src: string): string => (/^(https?:|data:|blob:)/.test(src) ? src : `${import.meta.env.BASE_URL}${src.replace(/^\//, '')}`);

async function lireListe(url: string, serveur = false): Promise<MediaVehicule[]> {
  try {
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url, { signal: ctrl.signal, headers: serveur ? enTetesPasserelle() : undefined });
    clearTimeout(minuterie);
    if (!r.ok) return [];
    const j = await r.json() as { medias?: unknown[] };
    return (j.medias ?? []).filter(valide).map((m) => ({ ...m, src: adresse(m.src), affiche: m.affiche ? adresse(m.affiche) : undefined }));
  } catch { return []; }
}

let memoire: Promise<MediaVehicule[]> | null = null;
/** La liste complète, lue une fois par ouverture de l'application. */
export function chargerMedias(): Promise<MediaVehicule[]> {
  if (!memoire) {
    const serveur = urlApi('/rental/medias-vehicules');
    memoire = Promise.all([lireListe(`${import.meta.env.BASE_URL}medias/vehicules.json`), serveur ? lireListe(serveur, true) : Promise.resolve([])])
      .then(([livres, distants]) => [...distants, ...livres]);
  }
  return memoire;
}

/**
 * Les médias à montrer pour un véhicule et des options : ceux du véhicule (ou de tous), dont
 * chaque option déclarée correspond au choix du client ; les plus précis d'abord.
 */
export function mediasPour(liste: MediaVehicule[], service: ServiceMedia, vehicule: string, options: Record<string, ValeurOption>): MediaVehicule[] {
  return liste
    .filter((m) => m.service === service && (m.vehicule === vehicule || m.vehicule === '*'))
    .filter((m) => Object.entries(m.options ?? {}).every(([k, v]) => options[k] === v))
    .map((m, i) => ({ m, i, precision: Object.keys(m.options ?? {}).length + (m.vehicule === '*' ? 0 : 1) }))
    .sort((a, b) => b.precision - a.precision || a.i - b.i)
    .map((x) => x.m);
}
