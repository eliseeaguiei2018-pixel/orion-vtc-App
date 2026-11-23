import { createHash } from 'node:crypto';
import { haversineMeters, type GeoIndex, type LatLng } from '../../core/geo.js';
import { gammesServies, sertLaGamme, type DriverStore } from '../drivers/store.js';

/**
 * CHAUFFEURS PROCHES — ce que le client voit AVANT de commander (comme Yango, Uber) :
 *  - les véhicules libres autour de lui, qui bougent sur la carte en direct ;
 *  - par gamme, le temps d'approche du chauffeur libre le plus proche ;
 *  - ce même temps d'approche entre dans le prix fixe (approche offerte jusqu'à un seuil,
 *    réglé en console), comme dans l'APK de test.
 *
 * Vie privée des chauffeurs : aucun nom, aucun identifiant réel. Chaque véhicule porte un
 * identifiant anonyme qui change chaque jour (empreinte de l'identifiant + sel du serveur),
 * suffisant pour l'animer d'une position à la suivante, inutilisable pour suivre quelqu'un.
 */
export interface VehiculeProche { id: string; lat: number; lng: number; cap: number; gamme: string }
export interface Approche { km: number; minutes: number }

/** Distance par la route ≈ 1,35 × vol d'oiseau en ville (Abidjan). */
const FACTEUR_ROUTE = 1.35;
/** Vitesse d'approche en ville, circulation fluide (km/h). */
const VITESSE_KMH = 24;
/** Rayon des véhicules montrés sur la carte, et rayon de recherche d'approche (= dispatch). */
const RAYON_CARTE_M = 6000;
const RAYON_APPROCHE_M = 30_000;
const MAX_VEHICULES = 25;
const CACHE_MS = 2500;

export const GAMMES_COURSE = ['argent', 'or', 'diamant'] as const;
export const GAMME_COURSIER = 'moto';

export class ChauffeursProches {
  /** Dernière position vue et cap de chaque véhicule (orientation de l'icône). */
  private readonly caps = new Map<string, { lat: number; lng: number; cap: number }>();
  /** Réponses récentes par cellule d'environ 100 m : les clients voisins se partagent le calcul. */
  private readonly cache = new Map<string, { t: number; val: { vehicules: VehiculeProche[]; approche: Record<string, Approche | null> } }>();

  constructor(
    private readonly geo: GeoIndex,
    private readonly drivers: Pick<DriverStore, 'get'>,
    private readonly sel: string,
    private readonly maintenant: () => number = Date.now,
  ) {}

  private anonyme(id: string): string {
    const jour = new Date(this.maintenant()).toISOString().slice(0, 10);
    return createHash('sha256').update(`${this.sel}|${jour}|${id}`).digest('base64url').slice(0, 10);
  }

  private orienter(id: string, p: LatLng): number {
    const avant = this.caps.get(id);
    let cap = avant?.cap ?? 0;
    if (avant && haversineMeters(avant, p) > 8) {
      const y = Math.sin((p.lng - avant.lng) * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180);
      const x = Math.cos(avant.lat * Math.PI / 180) * Math.sin(p.lat * Math.PI / 180)
        - Math.sin(avant.lat * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180) * Math.cos((p.lng - avant.lng) * Math.PI / 180);
      cap = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    }
    if (!avant || haversineMeters(avant, p) > 8) this.caps.set(id, { lat: p.lat, lng: p.lng, cap });
    if (this.caps.size > 20_000) this.caps.clear();
    return cap;
  }

  /** Temps d'approche estimé depuis une distance à vol d'oiseau (facteur de trafic ≥ 1). */
  static approcheDepuis(metres: number, facteurTrafic = 1): Approche {
    const km = (metres / 1000) * FACTEUR_ROUTE;
    const minutes = Math.max(1, Math.round((km / (VITESSE_KMH / Math.max(1, facteurTrafic))) * 60));
    return { km: Math.round(km * 10) / 10, minutes };
  }

  /** Chauffeur LIBRE le plus proche de cette gamme (rayon du dispatch), ou null. */
  async approche(p: LatLng, gamme: string, facteurTrafic = 1): Promise<Approche | null> {
    const voisins = await this.geo.nearby(p, RAYON_APPROCHE_M, 200);
    for (const v of voisins) {
      if (!sertLaGamme(v.meta, gamme)) continue;
      const d = this.drivers.get(v.id);
      if (!d || d.availability !== 'online') continue;
      return ChauffeursProches.approcheDepuis(v.distanceMeters, facteurTrafic);
    }
    return null;
  }

  /** Véhicules libres autour du point, et approche du plus proche de chaque gamme. */
  async autour(p: LatLng, facteurTrafic = 1): Promise<{ vehicules: VehiculeProche[]; approche: Record<string, Approche | null> }> {
    const cle = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    const t = this.maintenant();
    const enCache = this.cache.get(cle);
    if (enCache && t - enCache.t < CACHE_MS) return enCache.val;

    const voisins = await this.geo.nearby(p, RAYON_APPROCHE_M, 300);
    const vehicules: VehiculeProche[] = [];
    const approche: Record<string, Approche | null> = Object.fromEntries([...GAMMES_COURSE, GAMME_COURSIER].map((g) => [g, null]));
    for (const v of voisins) {
      const d = this.drivers.get(v.id);
      if (!d || d.availability !== 'online') continue;
      const gamme = String(v.meta?.['category'] ?? d.category);
      // Un chauffeur ouvert à plusieurs gammes compte pour chacune d'elles.
      for (const g of gammesServies(d)) {
        if (approche[g] === null) approche[g] = ChauffeursProches.approcheDepuis(v.distanceMeters, facteurTrafic);
      }
      if (v.distanceMeters <= RAYON_CARTE_M && vehicules.length < MAX_VEHICULES) {
        vehicules.push({ id: this.anonyme(v.id), lat: v.lat, lng: v.lng, cap: this.orienter(v.id, v), gamme });
      }
    }
    const val = { vehicules, approche };
    this.cache.set(cle, { t, val });
    if (this.cache.size > 5000) {
      for (const [k, e] of this.cache) if (t - e.t > CACHE_MS) this.cache.delete(k);
    }
    return val;
  }
}
