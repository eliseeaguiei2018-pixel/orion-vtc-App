import { randomUUID } from 'node:crypto';
import type { LatLng } from '../../core/geo.js';
import { EMERGENCY_ROOM, rideRoom, sosRoom, type RealtimeHub } from '../realtime/hub.js';
import { nearestZone } from '../geo-ci/zones.js';
import { lieuDe } from '../maps/lieux.js';

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
  /**
   * Services de secours RÉELLEMENT sollicités par la supervision (SAMU, police,
   * pompiers), avec l'heure et l'issue de l'appel. Vide tant que personne n'a
   * appelé : on ne laisse jamais croire qu'une ambulance arrive alors qu'aucun
   * numéro n'a été composé.
   */
  secours?: SecoursSollicite[];
}

export interface SecoursSollicite {
  /** Entrée du journal de contacts (permet de suivre l'issue de l'appel). */
  entryId: string;
  service: string;
  numero: string;
  canal: 'appel' | 'sms' | 'whatsapp';
  at: string;
  issue: 'tentative' | 'joint' | 'non_joint' | 'messagerie';
}

/**
 * Ce que la personne en détresse voit de son alerte : l'essentiel, rien d'interne.
 * Ni note de clôture, ni journal des appels internes, ni nom complet de l'agent.
 */
export interface SuiviUsager {
  id: string;
  kind: AlertKind;
  status: AlertStatus;
  createdAt: string;
  location: LatLng;
  zoneName?: string;
  priseEnCharge: { agent: string; at: string } | null;
  chat: SosChatMessage[];
  secours: Array<{ service: string; numero: string; canal: SecoursSollicite['canal']; at: string; issue: SecoursSollicite['issue'] }>;
  clotureeA: string | null;
}

/** Prénom seul pour l'usager : humain, sans exposer l'identité complète du personnel. */
export function agentPublic(nom: string | undefined): string {
  const prenom = (nom ?? '').trim().split(/\s+/)[0] ?? '';
  if (!prenom || /^(super|admin|système|systeme)$/i.test(prenom)) return 'Supervision ORION';
  return prenom;
}

export function vueUsager(a: EmergencyAlert): SuiviUsager {
  return {
    id: a.id, kind: a.kind, status: a.status, createdAt: a.createdAt,
    location: a.location, zoneName: a.zoneName,
    priseEnCharge: a.agent ? { agent: agentPublic(a.agent), at: a.claimedAt ?? a.updatedAt } : null,
    chat: (a.chat ?? []).map((m) => ({ ...m, author: m.from === 'agent' ? agentPublic(m.author) : undefined })),
    secours: (a.secours ?? []).map(({ service, numero, canal, at, issue }) => ({ service, numero, canal, at, issue })),
    clotureeA: a.status === 'resolved' || a.status === 'cancelled' ? a.updatedAt : null,
  };
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
  /**
   * VOLUME : alerte système OUVERTE par (course, type), pour la déduplication en temps
   * constant. Sans cet index, chaque contrôle d'anomalie parcourait toutes les alertes
   * de l'histoire de la plateforme.
   */
  private readonly ouvertesParCourse = new Map<string, string>();
  /** Alertes de chaque usager (son espace « Mes alertes ») : lecture sans parcours global. */
  private readonly parUsagerIndex = new Map<string, EmergencyAlert[]>();

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
      const cle = `${input.rideId}:${input.kind}`;
      const existing = this.alerts.get(this.ouvertesParCourse.get(cle) ?? '');
      if (existing && existing.status !== 'resolved' && existing.status !== 'cancelled') return existing;
      const alerte = this.raise({ source: 'systeme', ...input });
      this.ouvertesParCourse.set(cle, alerte.id);
      return alerte;
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
    // Le lieu exact pour les secours : quartier réel et commune (limites OSM).
    const lieu = lieuDe(input.location);
    const alert: EmergencyAlert = {
      id: randomUUID(),
      kind: input.kind,
      level: LEVEL_FOR[input.kind],
      // « raised » : reçue par la supervision ORION, PAS encore transmise aux secours.
      // Elle passe « dispatched » quand un agent joint réellement le SAMU ou la police.
      status: 'raised',
      rideId: input.rideId,
      userId: input.userId,
      source: input.source,
      location: input.location,
      zoneName: lieu.libelle,
      impactG: input.impactG,
      dispatchedTo: [],
      secours: [],
      createdAt: now,
      updatedAt: now,
      note: input.note,
      chat: [],
    };
    this.alerts.set(alert.id, alert);
    const lesSiennes = this.parUsagerIndex.get(alert.userId);
    if (lesSiennes) lesSiennes.push(alert); else this.parUsagerIndex.set(alert.userId, [alert]);

    // Diffusion temps réel : poste de supervision (relais SAMU) + suivi de la course.
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.alert', alert);
    if (alert.rideId) this.realtime.publish(rideRoom(alert.rideId), 'emergency.alert', alert);
    return alert;
  }

  /**
   * Côté usager : chaque changement de son alerte lui parvient en direct, sur la
   * room de l'alerte et sur celle de sa course. C'est ce qui manquait : la console
   * voyait tout, la personne en détresse ne savait même pas qu'on l'avait lue.
   */
  private informerUsager(a: EmergencyAlert): void {
    const suivi = vueUsager(a);
    this.realtime.publish(sosRoom(a.id), 'sos.suivi', suivi);
    if (a.rideId) this.realtime.publish(rideRoom(a.rideId), 'sos.suivi', suivi);
  }

  /** Vue usager d'une alerte, si elle lui appartient bien. */
  suiviPour(id: string, userId: string): SuiviUsager | 'interdit' | undefined {
    const a = this.alerts.get(id);
    if (!a) return undefined;
    if (a.userId !== userId) return 'interdit';
    return vueUsager(a);
  }

  /**
   * Un service de secours a été sollicité depuis le poste SAMU. L'usager le voit
   * aussitôt (« ORION a prévenu le SAMU — 185 ») et l'alerte passe « dispatched ».
   */
  secoursSollicite(id: string, s: Omit<SecoursSollicite, 'at' | 'issue'>): EmergencyAlert | undefined {
    const a = this.alerts.get(id);
    if (!a) return undefined;
    const at = new Date().toISOString();
    (a.secours ??= []).push({ ...s, at, issue: 'tentative' });
    if (!a.dispatchedTo.includes(s.service)) a.dispatchedTo.push(s.service);
    if (a.status === 'raised' || a.status === 'acknowledged') a.status = 'dispatched';
    a.updatedAt = at;
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
    this.informerUsager(a);
    return a;
  }

  /** Issue de l'appel aux secours (joint, injoignable…), répercutée à l'usager. */
  issueSecours(id: string, entryId: string, issue: SecoursSollicite['issue']): EmergencyAlert | undefined {
    const a = this.alerts.get(id);
    const s = a?.secours?.find((x) => x.entryId === entryId);
    if (!a || !s) return undefined;
    s.issue = issue;
    a.updatedAt = new Date().toISOString();
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
    this.informerUsager(a);
    return a;
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
    const premiere = !a.agent;
    a.agent = agent;
    a.claimedAt ??= new Date().toISOString();
    // Prise en charge : « raised » → « acknowledged ». Une alerte déjà transmise
    // aux secours reste « dispatched » : on ne recule jamais dans le circuit.
    if (a.status === 'raised') a.status = 'acknowledged';
    a.updatedAt = new Date().toISOString();
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
    if (premiere) this.informerUsager(a);
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
    this.informerUsager(a);
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
    this.informerUsager(a);
    return a;
  }

  updateStatus(id: string, status: AlertStatus): EmergencyAlert | undefined {
    const a = this.alerts.get(id);
    if (!a) return undefined;
    a.status = status;
    a.updatedAt = new Date().toISOString();
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
    this.informerUsager(a);
    return a;
  }

  /**
   * Toutes les alertes OUVERTES, puis les `fermees` alertes closes les plus récentes.
   * VOLUME : l'historique clos grandit sans fin (des milliers par mois) ; la console n'en
   * montre que la fin, le reste se consulte dossier par dossier.
   */
  list(fermees = Number.POSITIVE_INFINITY): EmergencyAlert[] {
    const ouvertes: EmergencyAlert[] = [];
    const closes: EmergencyAlert[] = [];
    // La Map garde l'ordre de création : on la lit à rebours, du plus récent au plus ancien.
    const toutes = [...this.alerts.values()];
    for (let i = toutes.length - 1; i >= 0; i -= 1) {
      const a = toutes[i]!;
      if (a.status !== 'resolved' && a.status !== 'cancelled') ouvertes.push(a);
      else if (closes.length < fermees) closes.push(a);
    }
    return [...ouvertes, ...closes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  /** Les alertes d'un usager, de la plus récente à la plus ancienne. */
  parUsager(userId: string): EmergencyAlert[] {
    return [...(this.parUsagerIndex.get(userId) ?? [])].reverse();
  }

  /** Nombre d'alertes, ouvertes et closes. */
  get nombre(): number {
    return this.alerts.size;
  }

  /**
   * File de TRIAGE (console SAMU) : alertes ouvertes d'abord, triées par gravité
   * (rouge > orange > jaune) puis par ancienneté (SLA le plus long en premier).
   */
  triage(fermees = Number.POSITIVE_INFINITY): EmergencyAlert[] {
    const open = (a: EmergencyAlert) => a.status !== 'resolved' && a.status !== 'cancelled';
    return this.list(fermees).sort((a, b) => {
      if (open(a) !== open(b)) return open(a) ? -1 : 1;
      if (open(a)) {
        const lr = LEVEL_RANK[a.level ?? 'rouge'] - LEVEL_RANK[b.level ?? 'rouge'];
        if (lr !== 0) return lr;
        return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; // le plus ancien d'abord (SLA)
      }
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    });
  }
}
