import { randomUUID } from 'node:crypto';
import type { LatLng } from '../../core/geo.js';
import { EMERGENCY_ROOM, rideRoom, type RealtimeHub } from '../realtime/hub.js';
import { nearestZone } from '../geo-ci/zones.js';

/**
 * Sécurité & secours d'urgence (Côte d'Ivoire).
 *
 * Deux déclencheurs :
 *  1) SOS manuel (bouton dans l'app).
 *  2) Détection automatique de choc/accident à partir des données capteurs
 *     (accéléromètre) envoyées par le téléphone.
 *
 * Sur déclenchement confirmé, une alerte est diffusée en temps réel vers le poste de
 * supervision (room `emergency`) pour relais au SAMU et aux contacts d'urgence.
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

export type AlertKind = 'sos' | 'crash';
export type AlertStatus = 'raised' | 'dispatched' | 'acknowledged' | 'resolved' | 'cancelled';

export interface EmergencyAlert {
  id: string;
  kind: AlertKind;
  status: AlertStatus;
  rideId?: string;
  userId: string;
  location: LatLng;
  zoneName?: string;
  /** Magnitude de l'impact (g) pour les crashs. */
  impactG?: number;
  dispatchedTo: string[];
  createdAt: string;
  updatedAt: string;
  note?: string;
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
  raiseSos(input: { userId: string; location: LatLng; rideId?: string; note?: string }): EmergencyAlert {
    return this.raise({ kind: 'sos', ...input });
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
    });
  }

  private raise(input: {
    kind: AlertKind;
    userId: string;
    location: LatLng;
    rideId?: string;
    impactG?: number;
    note?: string;
  }): EmergencyAlert {
    const now = new Date().toISOString();
    const zone = nearestZone(input.location)?.zone;
    const alert: EmergencyAlert = {
      id: randomUUID(),
      kind: input.kind,
      status: 'dispatched',
      rideId: input.rideId,
      userId: input.userId,
      location: input.location,
      zoneName: zone?.name,
      impactG: input.impactG,
      dispatchedTo: [EMERGENCY_NUMBERS.samu, EMERGENCY_NUMBERS.police],
      createdAt: now,
      updatedAt: now,
      note: input.note,
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
}
