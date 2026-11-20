import { randomUUID } from 'node:crypto';
import type { Repository } from '../../core/db/repository.js';

/**
 * TÉLÉMATIQUE DES VÉHICULES DE LOCATION.
 *
 * Confier une Maextro S800 à 900 000 F la journée à quelqu'un qu'on a vu une fois,
 * sans savoir où elle est, est un risque qu'aucun loueur sérieux ne prend. Les
 * véhicules Signature embarquent un boîtier : il remonte la position, l'état du
 * contact, le niveau de batterie, et accepte un ordre d'immobilisation.
 *
 * TROIS PRINCIPES, et ils ne sont pas négociables.
 *
 * 1. ON NE SUIT PAS UN CLIENT, ON SUIT UN VÉHICULE. La position n'est consultable
 *    que pendant une location active ou un vol déclaré, et chaque consultation est
 *    journalisée au nom de l'agent. Un loueur qui regarde où dort son client le
 *    dimanche commet une faute, pas une vérification.
 *
 * 2. ON N'ARRÊTE PAS UN MOTEUR EN ROULANT. L'ordre d'immobilisation est ARMÉ, puis
 *    le boîtier l'applique à l'arrêt, véhicule à moins de 5 km/h. Couper le moteur
 *    d'un véhicule lancé sur le boulevard Mitterrand, c'est supprimer la direction
 *    assistée et les freins assistés d'une voiture de deux tonnes.
 *
 * 3. UNE IMMOBILISATION EXIGE DEUX PERSONNES. Un agent l'arme, un responsable la
 *    confirme. C'est irréversible du point de vue du client : il se retrouve à pied,
 *    éventuellement la nuit, éventuellement avec des enfants.
 *
 * Le boîtier physique n'est pas branché ici : ce module tient l'état, les ordres et
 * la traçabilité. L'adaptateur constructeur se substitue à `TelematiqueTransport`
 * sans toucher au reste.
 */

export interface PositionVehicule {
  lat: number;
  lng: number;
  /** Vitesse instantanée en km/h, telle que remontée par le boîtier. */
  vitesseKmh: number;
  /** Cap en degrés (0 = nord). */
  cap?: number;
  contact: boolean;
  batteriePct?: number;
  /** Autonomie restante estimée, en kilomètres. */
  autonomieKm?: number;
  /** Zone reconnue, pour dire « Cocody » plutôt que deux décimales. */
  zone?: string;
  at: string;
}

export type EtatImmobilisation = 'aucune' | 'armee' | 'appliquee' | 'levee';

export type MotifImmobilisation = 'vol' | 'impaye' | 'sortie_zone' | 'fin_location' | 'securite';

export const MOTIF_LABEL: Record<MotifImmobilisation, string> = {
  vol: 'Vol déclaré',
  impaye: 'Impayé constaté',
  sortie_zone: 'Sortie du périmètre autorisé',
  fin_location: 'Location terminée, véhicule non restitué',
  securite: 'Sécurité du véhicule ou des personnes',
};

/** Vitesse au-dessous de laquelle le boîtier peut appliquer la coupure. */
export const VITESSE_COUPURE_MAX = 5;

export interface Immobilisation {
  id: string;
  vehiculeId: string;
  reservationId?: string;
  motif: MotifImmobilisation;
  commentaire: string;
  etat: EtatImmobilisation;
  armeePar: string;
  armeeLe: string;
  /** Double validation : jamais la même personne que celle qui a armé. */
  confirmeePar?: string;
  confirmeeLe?: string;
  appliqueeLe?: string;
  /** Position du véhicule au moment où la coupure a pris effet. */
  positionApplication?: { lat: number; lng: number };
  leveePar?: string;
  leveeLe?: string;
  motifLevee?: string;
}

export interface DeclarationVol {
  id: string;
  vehiculeId: string;
  reservationId: string;
  declarePar: string;
  declareLe: string;
  circonstances: string;
  /** Dernière position connue au moment de la déclaration. */
  dernierePosition?: PositionVehicule;
  /** Référence du dépôt de plainte, renseignée au retour du commissariat. */
  referencePlainte?: string;
  /** Transmission effective aux forces de l'ordre. */
  transmisLe?: string;
  transmisPar?: string;
  transmisA?: string;
  statut: 'declare' | 'transmis' | 'retrouve' | 'clos';
  retrouveLe?: string;
  note?: string;
}

/** Consultation de position : qui a regardé où, et pourquoi. */
export interface AccesPosition {
  id: string;
  vehiculeId: string;
  reservationId?: string;
  par: string;
  motif: string;
  at: string;
}

/** Le boîtier réel se branche ici. Par défaut, une simulation déterministe. */
export interface TelematiqueTransport {
  position(vehiculeId: string): PositionVehicule | null;
  /** Transmet l'ordre d'immobilisation ; renvoie vrai si le boîtier l'a accepté. */
  armerCoupure(vehiculeId: string): boolean;
  leverCoupure(vehiculeId: string): boolean;
}

export class TelematiqueService {
  private readonly positions = new Map<string, PositionVehicule>();
  private readonly immobilisations = new Map<string, Immobilisation>();
  private readonly vols = new Map<string, DeclarationVol>();
  private readonly acces: AccesPosition[] = [];

  constructor(
    private readonly repoImmo?: Repository<Immobilisation>,
    private readonly repoVols?: Repository<DeclarationVol>,
    private readonly transport?: TelematiqueTransport,
  ) {
    for (const i of repoImmo?.all() ?? []) this.immobilisations.set(i.id, i);
    for (const v of repoVols?.all() ?? []) this.vols.set(v.id, v);
  }

  /** Remontée du boîtier (ou de l'adaptateur constructeur). */
  majPosition(vehiculeId: string, p: Omit<PositionVehicule, 'at'>): PositionVehicule {
    const position: PositionVehicule = { ...p, at: new Date().toISOString() };
    this.positions.set(vehiculeId, position);

    // Une coupure armée s'applique dès que le véhicule est réellement à l'arrêt.
    // C'est le boîtier qui décide du moment, jamais l'agent depuis son écran.
    const armee = this.immobilisationActive(vehiculeId);
    if (armee?.etat === 'armee' && armee.confirmeeLe && p.vitesseKmh <= VITESSE_COUPURE_MAX) {
      armee.etat = 'appliquee';
      armee.appliqueeLe = position.at;
      armee.positionApplication = { lat: p.lat, lng: p.lng };
      this.repoImmo?.put(armee);
    }
    return position;
  }

  /**
   * Position d'un véhicule. L'appelant DOIT motiver sa consultation : elle est
   * journalisée à son nom. On ne suit pas un client, on suit un véhicule.
   */
  position(vehiculeId: string, contexte: { par: string; motif: string; reservationId?: string }): PositionVehicule | null {
    this.acces.push({
      id: randomUUID().slice(0, 8), vehiculeId, reservationId: contexte.reservationId,
      par: contexte.par, motif: contexte.motif, at: new Date().toISOString(),
    });
    if (this.acces.length > 2000) this.acces.splice(0, this.acces.length - 2000);
    return this.positions.get(vehiculeId) ?? this.transport?.position(vehiculeId) ?? null;
  }

  /** Position sans journalisation — usage interne (vigilance, tableau de bord). */
  positionBrute(vehiculeId: string): PositionVehicule | null {
    return this.positions.get(vehiculeId) ?? null;
  }

  journalAcces(vehiculeId?: string): AccesPosition[] {
    return [...this.acces]
      .filter((a) => !vehiculeId || a.vehiculeId === vehiculeId)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  /* ---------------------------- Immobilisation ---------------------------- */

  immobilisationActive(vehiculeId: string): Immobilisation | undefined {
    for (const i of this.immobilisations.values()) {
      if (i.vehiculeId === vehiculeId && (i.etat === 'armee' || i.etat === 'appliquee')) return i;
    }
    return undefined;
  }

  armer(input: {
    vehiculeId: string; reservationId?: string; motif: MotifImmobilisation;
    commentaire: string; par: string;
  }): Immobilisation | 'deja_armee' {
    if (this.immobilisationActive(input.vehiculeId)) return 'deja_armee';
    const i: Immobilisation = {
      id: randomUUID().slice(0, 8),
      vehiculeId: input.vehiculeId,
      reservationId: input.reservationId,
      motif: input.motif,
      commentaire: input.commentaire,
      etat: 'armee',
      armeePar: input.par,
      armeeLe: new Date().toISOString(),
    };
    this.immobilisations.set(i.id, i);
    this.repoImmo?.put(i);
    return i;
  }

  /**
   * Confirmation par une SECONDE personne. Priver quelqu'un de son véhicule, la
   * nuit, peut-être avec des enfants à bord, ne se décide pas seul.
   */
  confirmer(id: string, par: string): Immobilisation | 'auto_confirmation' | 'deja_confirmee' | null {
    const i = this.immobilisations.get(id);
    if (!i) return null;
    if (i.confirmeeLe) return 'deja_confirmee';
    if (i.armeePar === par) return 'auto_confirmation';
    i.confirmeePar = par;
    i.confirmeeLe = new Date().toISOString();

    // Si le véhicule est déjà à l'arrêt, la coupure prend effet immédiatement.
    const p = this.positions.get(i.vehiculeId);
    if (p && p.vitesseKmh <= VITESSE_COUPURE_MAX) {
      i.etat = 'appliquee';
      i.appliqueeLe = i.confirmeeLe;
      i.positionApplication = { lat: p.lat, lng: p.lng };
    }
    this.repoImmo?.put(i);
    this.transport?.armerCoupure(i.vehiculeId);
    return i;
  }

  lever(id: string, par: string, motif: string): Immobilisation | 'non_active' | null {
    const i = this.immobilisations.get(id);
    if (!i) return null;
    if (i.etat !== 'armee' && i.etat !== 'appliquee') return 'non_active';
    i.etat = 'levee';
    i.leveePar = par;
    i.leveeLe = new Date().toISOString();
    i.motifLevee = motif;
    this.repoImmo?.put(i);
    this.transport?.leverCoupure(i.vehiculeId);
    return i;
  }

  immobilisations_(filtre: { vehiculeId?: string; actives?: boolean } = {}): Immobilisation[] {
    return [...this.immobilisations.values()]
      .filter((i) => (!filtre.vehiculeId || i.vehiculeId === filtre.vehiculeId)
        && (!filtre.actives || i.etat === 'armee' || i.etat === 'appliquee'))
      .sort((a, b) => Date.parse(b.armeeLe) - Date.parse(a.armeeLe));
  }

  /* -------------------------------- Vol -------------------------------- */

  declarerVol(input: {
    vehiculeId: string; reservationId: string; circonstances: string; par: string;
  }): DeclarationVol {
    const v: DeclarationVol = {
      id: randomUUID().slice(0, 8),
      vehiculeId: input.vehiculeId,
      reservationId: input.reservationId,
      declarePar: input.par,
      declareLe: new Date().toISOString(),
      circonstances: input.circonstances,
      dernierePosition: this.positions.get(input.vehiculeId),
      statut: 'declare',
    };
    this.vols.set(v.id, v);
    this.repoVols?.put(v);
    return v;
  }

  marquerTransmis(id: string, par: string, a: string, referencePlainte?: string): DeclarationVol | null {
    const v = this.vols.get(id);
    if (!v) return null;
    v.statut = 'transmis';
    v.transmisLe = new Date().toISOString();
    v.transmisPar = par;
    v.transmisA = a;
    if (referencePlainte) v.referencePlainte = referencePlainte;
    this.repoVols?.put(v);
    return v;
  }

  cloreVol(id: string, statut: 'retrouve' | 'clos', note?: string): DeclarationVol | null {
    const v = this.vols.get(id);
    if (!v) return null;
    v.statut = statut;
    v.note = note;
    if (statut === 'retrouve') v.retrouveLe = new Date().toISOString();
    this.repoVols?.put(v);
    return v;
  }

  volActif(vehiculeId: string): DeclarationVol | undefined {
    for (const v of this.vols.values()) {
      if (v.vehiculeId === vehiculeId && (v.statut === 'declare' || v.statut === 'transmis')) return v;
    }
    return undefined;
  }

  vols_(filtre: { actifs?: boolean } = {}): DeclarationVol[] {
    return [...this.vols.values()]
      .filter((v) => !filtre.actifs || v.statut === 'declare' || v.statut === 'transmis')
      .sort((a, b) => Date.parse(b.declareLe) - Date.parse(a.declareLe));
  }

  getVol(id: string): DeclarationVol | undefined { return this.vols.get(id); }
  getImmobilisation(id: string): Immobilisation | undefined { return this.immobilisations.get(id); }
}
