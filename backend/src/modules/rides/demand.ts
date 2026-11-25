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
export const SUPPLY_RADIUS_M = 1200;   // rayon de l'offre autour du point

/** Règle du surge : demande au-delà de 2 × l'offre → ×1,5 ; au-delà de 1,3 × → ×1,3. */
export function multiplicateur(demande: number, offre: number): number {
  if (demande > Math.max(1, offre) * 2) return 1.5;
  if (demande > Math.max(1, offre) * 1.3) return 1.3;
  return 1;
}

export interface CellDemand {
  cell: string;
  lat: number;
  lng: number;
  demand: number;
  supply: number;
  surge: number;
}

/** Une demande dans une cellule : quand, et par qui lorsque le client s'identifie. */
interface DemandEntry {
  at: number;
  /** Identifiant du demandeur — sert à ne compter qu'UNE fois la même personne. */
  by?: string;
}

/** Offre et demande ajoutées par le simulateur du PDG (console), quand il est actif. */
export interface ComplementMarche {
  demande(p: LatLng, projet?: boolean): number;
  offre(p: LatLng, rayonM: number, projet?: boolean): number;
}

/** `simulation: false` : sans le simulateur ; `projet` : son scénario, même coupé (aperçu). */
export interface OptionsSimulation { simulation?: boolean; projet?: boolean }

export class DemandService {
  private complement: ComplementMarche | null = null;
  /** cellule → demandes de la fenêtre glissante. */
  private readonly cells = new Map<string, DemandEntry[]>();
  /** Conversion : sessions (devis) et commandes (courses) cumulées par cellule. */
  private readonly sessions = new Map<string, number>();
  private readonly orders = new Map<string, number>();

  constructor(private readonly geo: GeoIndex) {}

  private cellKey(p: LatLng): string {
    return `${Math.round(p.lat / CELL_DEG)}:${Math.round(p.lng / CELL_DEG)}`;
  }

  /**
   * Enregistre une demande client (appelé à chaque devis).
   *
   * DÉDUPLICATION par demandeur : une demande représente une INTENTION DE TRAJET,
   * pas un appel HTTP. L'app cliente ré-estime à chaque changement (gamme, assurance,
   * arrêt, code promo) ; sans dédoublonnage, une seule personne qui compare trois
   * gammes atteignait le seuil de surge et faisait monter SON PROPRE prix.
   *
   * Un même `requesterId` déjà présent dans la cellule ne compte pas une seconde fois :
   * son horodatage est simplement rafraîchi (il veut toujours partir). Sans
   * identifiant (appels serveur à serveur, tests), chaque devis compte comme avant.
   */
  record(p: LatLng, requesterId?: string): void {
    const key = this.cellKey(p);
    const now = Date.now();
    const fresh = (this.cells.get(key) ?? []).filter((e) => now - e.at < WINDOW_MS);
    if (requesterId) {
      const dejaLa = fresh.find((e) => e.by === requesterId);
      if (dejaLa) {
        dejaLa.at = now;              // toujours intéressé, mais une seule demande
        this.cells.set(key, fresh);
        return;
      }
    }
    fresh.push({ at: now, by: requesterId });
    this.cells.set(key, fresh);
    this.sessions.set(key, (this.sessions.get(key) ?? 0) + 1);
  }

  /** Enregistre une commande confirmée (course créée) — taux de conversion. */
  recordOrder(p: LatLng): void {
    const key = this.cellKey(p);
    this.orders.set(key, (this.orders.get(key) ?? 0) + 1);
  }

  /**
   * Taux de conversion par cellule : sessions (devis ouverts) vs commandes.
   * Diagnostic immédiat : un taux faible = tarif trop élevé OU manque de chauffeurs.
   */
  conversion(limit = 12): { cell: string; lat: number; lng: number; sessions: number; orders: number; rate: number }[] {
    const out: { cell: string; lat: number; lng: number; sessions: number; orders: number; rate: number }[] = [];
    for (const [cell, sessions] of this.sessions) {
      const orders = this.orders.get(cell) ?? 0;
      const [la, ln] = cell.split(':').map(Number);
      out.push({
        cell, lat: (la ?? 0) * CELL_DEG, lng: (ln ?? 0) * CELL_DEG,
        sessions, orders, rate: sessions ? Math.round((orders / sessions) * 100) : 0,
      });
    }
    return out.sort((a, b) => b.sessions - a.sessions).slice(0, limit);
  }

  /** Clé de cellule d'un point (exposée pour la prédiction historique). */
  keyFor(p: LatLng): string { return this.cellKey(p); }

  /** Demande courante dans la cellule du point (fenêtre glissante). */
  demandAt(p: LatLng): number {
    const now = Date.now();
    const arr = this.cells.get(this.cellKey(p)) ?? [];
    return arr.filter((e) => now - e.at < WINDOW_MS).length;
  }

  /** Simulateur du PDG : ses chauffeurs et ses clients comptent dans l'offre et la demande. */
  brancherSimulation(c: ComplementMarche): void { this.complement = c; }

  /** Offre et demande au point, avec ou sans le simulateur (aperçu de la console). */
  async marcheEn(p: LatLng, o: OptionsSimulation = {}): Promise<{ demandeReelle: number; demandeSimulee: number; offreReelle: number; offreSimulee: number }> {
    const sim = o.simulation !== false ? this.complement : null;
    return {
      demandeReelle: this.demandAt(p),
      demandeSimulee: sim ? sim.demande(p, o.projet) : 0,
      offreReelle: (await this.geo.nearby(p, SUPPLY_RADIUS_M, 50)).length,
      offreSimulee: sim ? sim.offre(p, SUPPLY_RADIUS_M, o.projet) : 0,
    };
  }

  /** Multiplicateur brut pour un point : 1 · 1.3 · 1.5 selon demande vs offre. */
  async surgeFor(p: LatLng, o: OptionsSimulation = {}): Promise<number> {
    const sim = o.simulation !== false ? this.complement : null;
    const demand = this.demandAt(p) + (sim ? sim.demande(p, o.projet) : 0);
    if (demand < 3) return 1; // volume trop faible pour être significatif
    const supply = (await this.geo.nearby(p, SUPPLY_RADIUS_M, 50)).length + (sim ? sim.offre(p, SUPPLY_RADIUS_M, o.projet) : 0);
    return multiplicateur(demand, supply);
  }

  /** Zones à forte demande (console : affecter des chauffeurs). */
  async hotCells(limit = 12): Promise<CellDemand[]> {
    const now = Date.now();
    const out: CellDemand[] = [];
    for (const [cell, arr] of this.cells) {
      const demand = arr.filter((e) => now - e.at < WINDOW_MS).length;
      if (demand === 0) { this.cells.delete(cell); continue; }
      const [la, ln] = cell.split(':').map(Number);
      const lat = (la ?? 0) * CELL_DEG, lng = (ln ?? 0) * CELL_DEG;
      const supply = (await this.geo.nearby({ lat, lng }, SUPPLY_RADIUS_M, 50)).length;
      const surge = demand >= 3 ? multiplicateur(demand, supply) : 1;
      out.push({ cell, lat, lng, demand, supply, surge });
    }
    return out.sort((a, b) => b.demand - a.demand).slice(0, limit);
  }
}
