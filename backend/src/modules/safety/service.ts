import { randomUUID } from 'node:crypto';
import type { LatLng } from '../../core/geo.js';
import { EMERGENCY_ROOM, rideRoom, type RealtimeHub } from '../realtime/hub.js';
import { nearestZone } from '../geo-ci/zones.js';

/**
 * Sécurité & secours d'urgence (Côte d'Ivoire).
 *
 * Déclencheurs :
 *  1) SOS manuel (bouton dans l'app client ou chauffeur) → niveau ROUGE.
 *  2) Détection automatique de choc/accident (accéléromètre) → niveau ROUGE.
 *  3) Détections système : déviation majeure d'itinéraire (ORANGE),
 *     immobilisation anormale (JAUNE), mot sensible dans un avis (ROUGE).
 *
 * Session SUPERVISION SAMU (console) :
 *  - triage par niveau de gravité avec chronomètre SLA ;
 *  - prise en charge NOMINATIVE (un seul agent par crise, verrou) ;
 *  - chat sécurisé discret avec messages pré-enregistrés ;
 *  - clôture avec note de synthèse OBLIGATOIRE → dossier SCELLÉ
 *    (accessible ensuite uniquement à la direction).
 */

/** Numéros d'urgence Côte d'Ivoire. */
export const EMERGENCY_NUMBERS = {
  samu: '185',
  police: '170',
  pompiers: '180',
  policeSecours: '111',
};

/** Échantillon capteur (accélération en g sur 3 axes + vitesse GPS optionnelle). */
export interface CrashSensorSample {
  ax: number;
  ay: number;
  az: number;
  /** Vitesse instantanée km/h avant l'impact (si disponible). */
  speedKmh?: number;
}

export type AlertKind = 'sos' | 'crash' | 'deviation' | 'immobilisation' | 'mot_sensible';
export type AlertStatus = 'raised' | 'dispatched' | 'acknowledged' | 'resolved' | 'cancelled';
export type SosLevel = 'rouge' | 'orange' | 'jaune';

/** Classification automatique par niveau de gravité. */
const LEVEL_FOR: Record<AlertKind, SosLevel> = {
  sos: 'rouge', crash: 'rouge', mot_sensible: 'rouge',
  deviation: 'orange',
  immobilisation: 'jaune',
};
export const LEVEL_RANK: Record<SosLevel, number> = { rouge: 0, orange: 1, jaune: 2 };

/** Messages pré-enregistrés du chat sécurisé discret. */
export const SOS_PRESETS = [
  'Êtes-vous en danger ? Répondez par Oui ou Non.',
  'Les secours sont prévenus. Restez calme, nous suivons votre position.',
  'Pouvez-vous parler librement ?',
  'Restez dans le véhicule si vous êtes en sécurité, sinon éloignez-vous.',
];

export interface SosChatMessage {
  from: 'agent' | 'usager';
  author?: string;
  text: string;
  at: string;
}

export interface EmergencyAlert {
  id: string;
  kind: AlertKind;
  /** Niveau de gravité : rouge (SOS/choc), orange (déviation), jaune (immobilisation). */
  level: SosLevel;
  status: AlertStatus;
  rideId?: string;
  userId: string;
  /** Origine du déclenchement. */
  source?: 'client' | 'chauffeur' | 'systeme';
  location: LatLng;
  zoneName?: string;
  /** Magnitude de l'impact (g) pour les crashs. */
  impactG?: number;
  dispatchedTo: string[];
  createdAt: string;
  updatedAt: string;
  note?: string;
  /* --- Prise en charge nominative & clôture scellée --- */
  /** Agent ayant accepté l'alerte (verrou : un seul gestionnaire de crise). */
  agent?: string;
  claimedAt?: string;
  /** Chat sécurisé discret (messages pré-enregistrés + réponses usager). */
  chat?: SosChatMessage[];
  /** Note de synthèse OBLIGATOIRE à la clôture. */
  closingNote?: string;
  /** Dossier scellé numériquement (accès direction uniquement après clôture). */
  sealed?: boolean;
  sealedAt?: string;
}

/**
 * Magnitude de l'accélération. Au repos, un téléphone mesure ~1 g (gravité).
 * On retire la composante gravité pour estimer le choc réel.
 */
export function impactMagnitudeG(s: CrashSensorSample): number {
  const total = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
  return Math.max(0, total - 1);
}

/** Seuil de détection : un accident de la route dépasse typiquement ~4 g. */
export const CRASH_THRESHOLD_G = 4;

/**
 * Décide si un échantillon traduit un accident probable. On combine la magnitude du choc
 * et, si disponible, une chute brutale de vitesse — afin de réduire les faux positifs
 * (téléphone qui tombe ≠ accident en mouvement).
 */
export function isLikelyCrash(s: CrashSensorSample): boolean {
  const g = impactMagnitudeG(s);
  if (g >= CRASH_THRESHOLD_G * 1.5) return true; // choc très violent
  if (g >= CRASH_THRESHOLD_G && (s.speedKmh ?? 0) >= 20) return true; // choc + véhicule en mouvement
  return false;
}

export class SafetyService {
  private readonly alerts = new Map<string, EmergencyAlert>();

  constructor(private readonly realtime: RealtimeHub) {}

  /** SOS déclenché manuellement par l'utilisateur. */
  raiseSos(input: { userId: string; location: LatLng; rideId?: string; note?: string; source?: 'client' | 'chauffeur' }): EmergencyAlert {
    return this.raise({ kind: 'sos', source: input.source ?? 'client', ...input });
  }

  /**
   * Alerte système (déviation d'itinéraire, immobilisation, mot sensible).
   * Dédupliquée : une seule alerte OUVERTE par (course, type).
   */
  raiseSystem(input: { kind: 'deviation' | 'immobilisation' | 'mot_sensible'; userId: string; location: LatLng; rideId?: string; note?: string }): EmergencyAlert {
    if (input.rideId) {
      const existing = [...this.alerts.values()].find(
        (a) => a.rideId === input.rideId && a.kind === input.kind && a.status !== 'resolved' && a.status !== 'cancelled',
      );
      if (existing) return existing;
    }
    return this.raise({ source: 'systeme', ...input });
  }

  /**
   * Évalue un échantillon capteur ; si un crash est probable, lève une alerte.
   * Retourne l'alerte créée, ou null si aucun choc significatif.
   */
  ingestSensor(input: {
    userId: string;
    location: LatLng;
    rideId?: string;
    sample: CrashSensorSample;
  }): EmergencyAlert | null {
    if (!isLikelyCrash(input.sample)) return null;
    return this.raise({
      kind: 'crash',
      userId: input.userId,
      location: input.location,
      rideId: input.rideId,
      impactG: Math.round(impactMagnitudeG(input.sample) * 10) / 10,
      note: 'Accident détecté automatiquement (capteurs)',
      source: 'systeme',
    });
  }

  private raise(input: {
    kind: AlertKind;
    userId: string;
    location: LatLng;
    rideId?: string;
    impactG?: number;
    note?: string;
    source?: 'client' | 'chauffeur' | 'systeme';
  }): EmergencyAlert {
    const now = new Date().toISOString();
    const zone = nearestZone(input.location)?.zone;
    const alert: EmergencyAlert = {
      id: randomUUID(),
      kind: input.kind,
      level: LEVEL_FOR[input.kind],
      status: 'dispatched',
      rideId: input.rideId,
      userId: input.userId,
      source: input.source,
      location: input.location,
      zoneName: zone?.name,
      impactG: input.impactG,
      dispatchedTo: [EMERGENCY_NUMBERS.samu, EMERGENCY_NUMBERS.police],
      createdAt: now,
      updatedAt: now,
      note: input.note,
      chat: [],
    };
    this.alerts.set(alert.id, alert);

    // Diffusion temps réel : poste de supervision (relais SAMU) + suivi de la course.
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.alert', alert);
    if (alert.rideId) this.realtime.publish(rideRoom(alert.rideId), 'emergency.alert', alert);
    return alert;
  }

  get(id: string): EmergencyAlert | undefined {
    return this.alerts.get(id);
  }

  /**
   * Prise en charge NOMINATIVE : l'agent qui accepte l'alerte en devient le seul
   * gestionnaire (verrou anti-doublon d'intervention). 'taken' si déjà prise.
   */
  claim(id: string, agent: string): EmergencyAlert | 'taken' | undefined {
    const a = this.alerts.get(id);
    if (!a) return undefined;
    if (a.agent && a.agent !== agent) return 'taken';
    a.agent = agent;
    a.claimedAt ??= new Date().toISOString();
    if (a.status === 'raised' || a.status === 'dispatched') a.status = 'acknowledged';
    a.updatedAt = new Date().toISOString();
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
    return a;
  }

  /** Chat sécurisé discret (agent ↔ usager en détresse). */
  postChat(id: string, msg: { from: 'agent' | 'usager'; author?: string; text: string }): SosChatMessage | undefined {
    const a = this.alerts.get(id);
    if (!a) return undefined;
    const m: SosChatMessage = { ...msg, at: new Date().toISOString() };
    (a.chat ??= []).push(m);
    a.updatedAt = m.at;
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.chat', { alertId: id, message: m });
    if (a.rideId) this.realtime.publish(rideRoom(a.rideId), 'emergency.chat', { alertId: id, message: m });
    return m;
  }

  /**
   * Clôture : note de synthèse OBLIGATOIRE, réservée à l'agent gestionnaire.
   * Le dossier est ensuite SCELLÉ (lecture réservée à la direction).
   */
  close(id: string, agent: string, note: string): EmergencyAlert | 'not_agent' | undefined {
    const a = this.alerts.get(id);
    if (!a) return undefined;
    if (a.agent && a.agent !== agent) return 'not_agent';
    a.agent ??= agent;
    a.status = 'resolved';
    a.closingNote = note;
    a.sealed = true;
    a.sealedAt = new Date().toISOString();
    a.updatedAt = a.sealedAt;
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
    return a;
  }

  updateStatus(id: string, status: AlertStatus): EmergencyAlert | undefined {
    const a = this.alerts.get(id);
    if (!a) return undefined;
    a.status = status;
    a.updatedAt = new Date().toISOString();
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
    return a;
  }

  list(): EmergencyAlert[] {
    return [...this.alerts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * File de TRIAGE (console SAMU) : alertes ouvertes d'abord, triées par gravité
   * (rouge > orange > jaune) puis par ancienneté (SLA le plus long en premier).
   */
  triage(): EmergencyAlert[] {
    const open = (a: EmergencyAlert) => a.status !== 'resolved' && a.status !== 'cancelled';
    return [...this.alerts.values()].sort((a, b) => {
      if (open(a) !== open(b)) return open(a) ? -1 : 1;
      if (open(a)) {
        const lr = LEVEL_RANK[a.level ?? 'rouge'] - LEVEL_RANK[b.level ?? 'rouge'];
        if (lr !== 0) return lr;
        return a.createdAt.localeCompare(b.createdAt); // le plus ancien d'abord (SLA)
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
}
