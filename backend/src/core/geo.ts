import { config } from '../config/index.js';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoEntry {
  id: string;
  lat: number;
  lng: number;
  meta?: Record<string, unknown>;
}

export interface GeoNeighbor extends GeoEntry {
  distanceMeters: number;
}

/**
 * Distance grand-cercle (Haversine) en mètres.
 * Suffisant pour le matching de proximité urbain.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Index géospatial abstrait.
 *
 * L'implémentation par défaut est en mémoire (aucune infra requise pour tourner /
 * tester). En production on branche une implémentation Redis (GEOADD/GEOSEARCH) qui
 * respecte la MÊME interface — les services métier ne changent pas. C'est ce qui rend
 * le passage à l'échelle (sharding par zone, présence TTL) transparent.
 */
export interface GeoIndex {
  /** Enregistre/MAJ une position avec TTL de présence (en secondes). */
  upsert(entry: GeoEntry, ttlSeconds?: number): Promise<void>;
  remove(id: string): Promise<void>;
  /** Voisins dans un rayon, triés par distance croissante. */
  nearby(center: LatLng, radiusMeters: number, limit?: number): Promise<GeoNeighbor[]>;
  /** Toutes les positions vivantes (non expirées) — supervision de flotte. */
  snapshot(): Promise<GeoEntry[]>;
  size(): Promise<number>;
}

interface StoredEntry extends GeoEntry {
  expiresAt: number;
}

/**
 * Implémentation mémoire avec expiration (TTL) — équivalent fonctionnel de la présence
 * Redis : une position non rafraîchie disparaît (pas de chauffeurs "fantômes").
 */
export class InMemoryGeoIndex implements GeoIndex {
  private readonly entries = new Map<string, StoredEntry>();

  async upsert(entry: GeoEntry, ttlSeconds = config.PRESENCE_TTL_SECONDS): Promise<void> {
    this.entries.set(entry.id, { ...entry, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async nearby(center: LatLng, radiusMeters: number, limit = 10): Promise<GeoNeighbor[]> {
    const now = Date.now();
    const result: GeoNeighbor[] = [];
    for (const e of this.entries.values()) {
      if (e.expiresAt <= now) {
        this.entries.delete(e.id);
        continue;
      }
      const distanceMeters = haversineMeters(center, e);
      if (distanceMeters <= radiusMeters) {
        result.push({ id: e.id, lat: e.lat, lng: e.lng, meta: e.meta, distanceMeters });
      }
    }
    result.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return result.slice(0, limit);
  }

  async snapshot(): Promise<GeoEntry[]> {
    const now = Date.now();
    const live: GeoEntry[] = [];
    for (const e of this.entries.values()) {
      if (e.expiresAt <= now) { this.entries.delete(e.id); continue; }
      live.push({ id: e.id, lat: e.lat, lng: e.lng, meta: e.meta });
    }
    return live;
  }

  async size(): Promise<number> {
    return this.entries.size;
  }
}

/** Fabrique l'index selon la configuration (mémoire par défaut, Redis en prod). */
export function createGeoIndex(): GeoIndex {
  // En production, retourner ici une RedisGeoIndex implémentant GeoIndex.
  return new InMemoryGeoIndex();
}
