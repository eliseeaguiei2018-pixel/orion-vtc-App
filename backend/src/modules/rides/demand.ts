import type { GeoIndex, LatLng } from '../../core/geo.js';

/**
 * Surge par cellules (« hexagones ») — tarification dynamique encadrée.
 *
 * La carte est découpée en cellules d'~800 m. Chaque demande de devis est
 * comptée dans sa cellule (fenêtre glissante de 10 minutes). Si la demande
 * dépasse l'offre (chauffeurs en ligne à proximité) de plus de 30 %, un
 * multiplicateur s'active pour attirer les chauffeurs des zones voisines :
 *   demande > offre × 1.3 → ×1.3   ·   demande > offre × 2 → ×1.5
 *
 * INCITATION VERTE : le multiplicateur est PLAFONNÉ (surgeCapGreen, console)
 * sur la flotte électrique ORION — prix stable et attractif pour le choix vert.
 * Le surge s'applique AVANT le verrouillage du devis : le prix affiché reste
 * un PRIX FIXE garanti.
 */
const CELL_DEG = 0.0072;        // ~800 m à la latitude d'Abidjan
const WINDOW_MS = 10 * 60_000;  // fenêtre de demande : 10 minutes
const SUPPLY_RADIUS_M = 1200;   // rayon de l'offre autour du point

export interface CellDemand {
  cell: string;
  lat: number;
  lng: number;
  demand: number;
  supply: number;
  surge: number;
}

export class DemandService {
  /** cellule → horodatages des demandes (fenêtre glissante). */
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly geo: GeoIndex) {}

  private cellKey(p: LatLng): string {
    return `${Math.round(p.lat / CELL_DEG)}:${Math.round(p.lng / CELL_DEG)}`;
  }

  /** Enregistre une demande client (appelé à chaque devis). */
  record(p: LatLng): void {
    const key = this.cellKey(p);
    const now = Date.now();
    const arr = this.cells.get(key) ?? [];
    const fresh = arr.filter((t) => now - t < WINDOW_MS);
    fresh.push(now);
    this.cells.set(key, fresh);
  }

  /** Demande courante dans la cellule du point (fenêtre glissante). */
  demandAt(p: LatLng): number {
    const now = Date.now();
    const arr = this.cells.get(this.cellKey(p)) ?? [];
    return arr.filter((t) => now - t < WINDOW_MS).length;
  }

  /** Multiplicateur brut pour un point : 1 · 1.3 · 1.5 selon demande vs offre. */
  async surgeFor(p: LatLng): Promise<number> {
    const demand = this.demandAt(p);
    if (demand < 3) return 1; // volume trop faible pour être significatif
    const supply = (await this.geo.nearby(p, SUPPLY_RADIUS_M, 50)).length;
    if (demand > Math.max(1, supply) * 2) return 1.5;
    if (demand > Math.max(1, supply) * 1.3) return 1.3;
    return 1;
  }

  /** Zones à forte demande (console : affecter des chauffeurs). */
  async hotCells(limit = 12): Promise<CellDemand[]> {
    const now = Date.now();
    const out: CellDemand[] = [];
    for (const [cell, arr] of this.cells) {
      const demand = arr.filter((t) => now - t < WINDOW_MS).length;
      if (demand === 0) { this.cells.delete(cell); continue; }
      const [la, ln] = cell.split(':').map(Number);
      const lat = (la ?? 0) * CELL_DEG, lng = (ln ?? 0) * CELL_DEG;
      const supply = (await this.geo.nearby({ lat, lng }, SUPPLY_RADIUS_M, 50)).length;
      const surge = demand >= 3 && demand > Math.max(1, supply) * 2 ? 1.5
        : demand >= 3 && demand > Math.max(1, supply) * 1.3 ? 1.3 : 1;
      out.push({ cell, lat, lng, demand, supply, surge });
    }
    return out.sort((a, b) => b.demand - a.demand).slice(0, limit);
  }
}
