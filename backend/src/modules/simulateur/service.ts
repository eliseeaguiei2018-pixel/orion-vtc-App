import { haversineMeters, type LatLng } from '../../core/geo.js';
import type { Repository } from '../../core/db/repository.js';
import { isWithinCotedIvoire } from '../geo-ci/zones.js';

/**
 * SIMULATEUR DU MARCHÉ (console, réservé au PDG).
 *
 * Le PDG choisit un lieu de prise en charge, y place autant de chauffeurs qu'il veut, à la
 * distance qu'il veut, et autant de clients qui commandent. Une fois la simulation ACTIVÉE,
 * le serveur les compte comme de vrais chauffeurs et de vraies demandes partout où l'app
 * cliente les voit :
 *  - les véhicules apparaissent et roulent sur la carte de l'app cliente ;
 *  - le temps d'approche et son coût (au-delà de l'approche offerte) suivent le plus proche ;
 *  - l'offre et la demande autour du lieu décident de la majoration de forte demande.
 * On voit ainsi, sur un vrai téléphone, le prix monter quand les chauffeurs manquent et
 * redescendre quand ils sont assez nombreux.
 *
 * Garde-fous, pour que les vraies courses n'en souffrent jamais durablement :
 *  - une course n'est JAMAIS confiée à un chauffeur simulé : le dispatch ne connaît que les
 *    vrais chauffeurs (ils ne sont pas dans l'index de positions) ;
 *  - la simulation s'arrête seule à l'heure prévue (4 h au plus) et se coupe d'un geste ;
 *  - chaque activation, modification et coupure est journalisée.
 */
export const GAMMES_SIMULEES = ['argent', 'or', 'diamant', 'moto'] as const;
export type GammeSimulee = (typeof GAMMES_SIMULEES)[number];

export interface ChauffeurSimule { id: string; lat: number; lng: number; gamme: GammeSimulee }
export interface LieuSimulation { lat: number; lng: number; nom: string }

export interface Simulation {
  id: 'courante';
  actif: boolean;
  lieu: LieuSimulation | null;
  chauffeurs: ChauffeurSimule[];
  /** Clients simulés qui commandent autour du lieu (comptés dans la demande). */
  demande: number;
  /** Durée d'une activation, en minutes. */
  dureeMin: number;
  activeLe: string | null;
  expireA: string | null;
  /** Fin de la dernière activation : manuelle, ou à l'heure prévue. */
  fin: { le: string; par: string; motif: 'manuelle' | 'expiree' } | null;
  majLe: string;
  majPar: string;
  /** Change à chaque modification : les apps refont leur devis. */
  rev: number;
}

/** Les demandes simulées comptent pour les départs à moins de 1,2 km du lieu. */
export const RAYON_DEMANDE_M = 1200;
export const MAX_CHAUFFEURS = 300;
export const MAX_DEMANDE = 80;
export const DUREE_MIN = 5;
export const DUREE_MAX = 240;
export const DUREE_DEFAUT = 60;
/** Les véhicules simulés se déplacent un peu autour de leur place, comme des vrais. */
const ERRANCE_M = 35;
const PERIODE_ERRANCE_MS = 150_000;

export class ErreurSimulation extends Error {
  constructor(readonly code: 'SIMULATION_INVALIDE' | 'SIMULATION_VIDE', message: string) { super(message); }
}

export interface ChauffeurSimuleProche extends ChauffeurSimule { distanceMeters: number }

export class Simulateur {
  private sim: Simulation;
  private readonly ecouteurs: Array<(s: Simulation) => void> = [];
  private minuterie: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repo: Repository<Simulation>,
    private readonly maintenant: () => number = Date.now,
  ) {
    const enregistree = repo.get('courante');
    this.sim = enregistree ? { ...this.vide(), ...enregistree } : this.vide();
    this.programmerFin();
  }

  private vide(): Simulation {
    return {
      id: 'courante', actif: false, lieu: null, chauffeurs: [], demande: 0, dureeMin: DUREE_DEFAUT,
      activeLe: null, expireA: null, fin: null, majLe: new Date(this.maintenant()).toISOString(), majPar: '', rev: 0,
    };
  }

  onChange(f: (s: Simulation) => void): void { this.ecouteurs.push(f); }

  private sauver(par: string): void {
    this.sim = { ...this.sim, majLe: new Date(this.maintenant()).toISOString(), majPar: par, rev: this.sim.rev + 1 };
    this.repo.put(this.sim);
    this.programmerFin();
    for (const f of this.ecouteurs) { try { f(this.sim); } catch { /* un écouteur en échec ne bloque rien */ } }
  }

  /** Coupure automatique à l'heure prévue, même si personne n'interroge le serveur. */
  private programmerFin(): void {
    if (this.minuterie) { clearTimeout(this.minuterie); this.minuterie = null; }
    if (!this.sim.actif || !this.sim.expireA) return;
    const reste = Date.parse(this.sim.expireA) - this.maintenant();
    this.minuterie = setTimeout(() => { this.minuterie = null; this.enVigueur(); }, Math.max(0, Math.min(reste, 2 ** 31 - 1)) + 50);
    this.minuterie.unref?.();
  }

  /** La simulation agit-elle en ce moment ? (la coupe si son heure est passée). */
  enVigueur(): boolean {
    if (!this.sim.actif) return false;
    if (this.sim.expireA && Date.parse(this.sim.expireA) <= this.maintenant()) {
      this.sim = { ...this.sim, actif: false, fin: { le: new Date(this.maintenant()).toISOString(), par: 'serveur', motif: 'expiree' } };
      this.sauver('serveur');
      return false;
    }
    return true;
  }

  etat(): Simulation {
    this.enVigueur();
    return this.sim;
  }

  get rev(): number { return this.sim.rev; }

  /** Modifie le scénario (lieu, chauffeurs, demande, durée). Actif : appliqué tout de suite. */
  modifier(patch: { lieu?: LieuSimulation | null; chauffeurs?: ChauffeurSimule[]; demande?: number; dureeMin?: number }, par: string): Simulation {
    const suite = { ...this.sim };
    if (patch.lieu !== undefined) {
      if (patch.lieu && !isWithinCotedIvoire(patch.lieu)) throw new ErreurSimulation('SIMULATION_INVALIDE', 'Le lieu doit être en Côte d’Ivoire');
      suite.lieu = patch.lieu ? { lat: patch.lieu.lat, lng: patch.lieu.lng, nom: patch.lieu.nom.slice(0, 120) } : null;
    }
    if (patch.chauffeurs !== undefined) {
      if (patch.chauffeurs.length > MAX_CHAUFFEURS) throw new ErreurSimulation('SIMULATION_INVALIDE', `${MAX_CHAUFFEURS} chauffeurs simulés au plus`);
      const ids = new Set<string>();
      suite.chauffeurs = patch.chauffeurs.map((c, i) => {
        if (!isWithinCotedIvoire(c)) throw new ErreurSimulation('SIMULATION_INVALIDE', 'Chaque chauffeur doit être placé en Côte d’Ivoire');
        if (!(GAMMES_SIMULEES as readonly string[]).includes(c.gamme)) throw new ErreurSimulation('SIMULATION_INVALIDE', 'Gamme inconnue');
        let id = /^[0-9A-Za-z_-]{1,24}$/.test(c.id) ? c.id : `s${i}`;
        while (ids.has(id)) id = `${id}x`;
        ids.add(id);
        return { id, lat: c.lat, lng: c.lng, gamme: c.gamme };
      });
    }
    if (patch.demande !== undefined) suite.demande = Math.max(0, Math.min(MAX_DEMANDE, Math.floor(patch.demande)));
    if (patch.dureeMin !== undefined) suite.dureeMin = Math.max(DUREE_MIN, Math.min(DUREE_MAX, Math.round(patch.dureeMin)));
    this.sim = suite;
    this.sauver(par);
    return this.sim;
  }

  activer(par: string, dureeMin?: number): Simulation {
    if (!this.sim.lieu && this.sim.chauffeurs.length === 0) {
      throw new ErreurSimulation('SIMULATION_VIDE', 'Choisissez un lieu ou placez des chauffeurs avant d’activer');
    }
    const duree = Math.max(DUREE_MIN, Math.min(DUREE_MAX, Math.round(dureeMin ?? this.sim.dureeMin)));
    const t = this.maintenant();
    this.sim = { ...this.sim, actif: true, dureeMin: duree, activeLe: new Date(t).toISOString(), expireA: new Date(t + duree * 60_000).toISOString() };
    this.sauver(par);
    return this.sim;
  }

  couper(par: string): Simulation {
    if (this.sim.actif) {
      this.sim = { ...this.sim, actif: false, fin: { le: new Date(this.maintenant()).toISOString(), par, motif: 'manuelle' } };
      this.sauver(par);
    }
    return this.sim;
  }

  /**
   * Chauffeurs simulés à moins de `rayonM` du point, du plus proche au plus loin. `projet` :
   * le scénario même coupé (aperçu de la console avant activation) ; jamais pour les apps.
   */
  chauffeursProches(p: LatLng, rayonM: number, projet = false): ChauffeurSimuleProche[] {
    if (!projet && !this.enVigueur()) return [];
    const out: ChauffeurSimuleProche[] = [];
    for (const c of this.sim.chauffeurs) {
      const distanceMeters = haversineMeters(p, c);
      if (distanceMeters <= rayonM) out.push({ ...c, distanceMeters });
    }
    return out.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  /** Offre simulée : chauffeurs simulés autour du point. */
  offre(p: LatLng, rayonM: number, projet = false): number {
    return this.chauffeursProches(p, rayonM, projet).length;
  }

  /** Demande simulée : comptée pour les départs proches du lieu de la simulation. */
  demande(p: LatLng, projet = false): number {
    if ((!projet && !this.enVigueur()) || !this.sim.lieu || this.sim.demande <= 0) return 0;
    return haversineMeters(p, this.sim.lieu) <= RAYON_DEMANDE_M ? this.sim.demande : 0;
  }

  /**
   * Position affichée d'un véhicule simulé : il tourne lentement autour de sa place (35 m),
   * chacun à son rythme, comme un véhicule qui cherche à se garer. Les distances du prix
   * restent celles de sa place.
   */
  positionAffichee(c: ChauffeurSimule): LatLng {
    let h = 0;
    for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const phase = (h % 360) * Math.PI / 180;
    const sens = h % 2 === 0 ? 1 : -1;
    const a = phase + sens * (this.maintenant() / PERIODE_ERRANCE_MS) * 2 * Math.PI;
    const dLat = (ERRANCE_M * Math.sin(a)) / 111_320;
    const dLng = (ERRANCE_M * Math.cos(a)) / (111_320 * Math.cos(c.lat * Math.PI / 180));
    return { lat: c.lat + dLat, lng: c.lng + dLng };
  }
}
