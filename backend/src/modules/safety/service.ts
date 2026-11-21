import { randomUUID } from 'node:crypto';
import type { LatLng } from '../../core/geo.js';
import { EMERGENCY_ROOM, rideRoom, sosRoom, type RealtimeHub } from '../realtime/hub.js';
import { nearestZone } from '../geo-ci/zones.js';
import { lieuDe } from '../maps/lieux.js';
import {
  libelleDemande, ouvrirAgentSos, passerLaMainSos, relancerAgentSos, repondreAgentSos,
  type CleDemande, type ContexteSos, type EtatAgentSos, type LangueAgent, type TourAgent,
} from './agent-sos.js';

/**
 * Sécurité & secours d'urgence (Côte d'Ivoire).
 *
 * Déclencheurs :
 *  1) SOS manuel (bouton dans l'app client ou chauffeur) → niveau ROUGE.
 *  2) Détection automatique de choc/accident (accéléromètre) → niveau ROUGE.
 *  3) Détections système : déviation majeure d'itinéraire (ORANGE),
 *     immobilisation anormale (JAUNE), mot sensible dans un avis (ROUGE).
 *
 * AGENT ORION AUTOMATIQUE (agent-sos.ts) : dès l'alerte, il répond à la personne, qualifie
 * la situation et DEMANDE AU CENTRE DE CONTRÔLE de prévenir les services qu'il faut. Ce
 * n'est jamais à la personne en détresse d'appeler le SAMU ou la police : le centre le
 * fait, et elle voit où il en est. L'agent humain qui prend le dossier reprend la main.
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
  /** Message de l'agent automatique (et non d'un opérateur). */
  auto?: boolean;
}

/** Nom sous lequel l'agent automatique signe ses messages. */
export const AGENT_AUTO = 'Agent ORION';

/** Numéro que le centre compose pour chaque service demandé par l'agent automatique. */
const NUMERO_SERVICE: Partial<Record<CleDemande, string>> = {
  samu: EMERGENCY_NUMBERS.samu, police: EMERGENCY_NUMBERS.police, pompiers: EMERGENCY_NUMBERS.pompiers,
};

/** Ce que l'agent automatique a demandé au centre : un service à prévenir, ou un geste interne. */
export interface DemandeAuCentre {
  cle: CleDemande;
  label: string;
  /** Numéro à composer (services de secours) ; absent pour un geste interne au centre. */
  numero?: string;
  /** Pourquoi : c'est ce que l'opérateur dit au service quand il l'a en ligne. */
  raison: string;
  at: string;
  /** L'opérateur a traité la demande (appel passé, chauffeur joint, course arrêtée…). */
  traiteeLe?: string;
  traiteePar?: string;
}

/** Où en est une demande, vu de la personne en détresse. */
export type StatutDemande = 'transmise' | 'en_cours' | 'joint' | 'injoignable' | 'faite';

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
  /* --- Agent automatique --- */
  /** État de la conversation menée par l'agent automatique (interne). */
  agentAuto?: {
    etat: EtatAgentSos;
    contexte: ContexteSos;
    /** Faux dès qu'un agent humain a pris le dossier. */
    actif: boolean;
    /** Dernier signe de vie de la personne (création de l'alerte ou dernier message). */
    dernierSigne: string;
    suggestions: string[];
  };
  /** Ce que l'agent automatique a demandé au centre, dans l'ordre. */
  demandes?: DemandeAuCentre[];
  /** Synthèse tenue à jour par l'agent automatique, lue par l'opérateur. */
  resume?: string;
}

export interface SecoursSollicite {
  /** Entrée du journal de contacts (permet de suivre l'issue de l'appel). */
  entryId: string;
  /** Fiche du répertoire d'urgence appelée (« samu », « police »…). */
  contactId?: string;
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
  /**
   * Ce que le CENTRE fait pour elle : chaque service à prévenir et chaque geste interne,
   * avec son avancement réel. « joint » ne s'affiche que si un opérateur l'a consigné.
   */
  demandes: Array<{ cle: CleDemande; label: string; numero?: string; at: string; statut: StatutDemande }>;
  /** Réponses proposées d'un toucher par l'agent automatique (vide si un humain a la main). */
  suggestions: string[];
  /** Vrai tant que c'est l'agent automatique qui répond. */
  agentAuto: boolean;
  clotureeA: string | null;
}

const chiffres = (n: string) => n.replace(/\D/g, '');

/** Fiches du répertoire d'urgence qui répondent à chaque demande de l'agent automatique. */
export const CONTACTS_DEMANDE: Partial<Record<CleDemande, string[]>> = {
  samu: ['samu'], police: ['police', 'police-111'], pompiers: ['pompiers'], depannage: ['remorquage', 'garage'],
};

/** Avancement d'une demande : il se lit dans le journal des appels du centre, jamais ailleurs. */
export function statutDemande(d: DemandeAuCentre, secours: SecoursSollicite[]): StatutDemande {
  const fiches = CONTACTS_DEMANDE[d.cle] ?? [];
  const appels = secours.filter((s) =>
    (s.contactId !== undefined && fiches.includes(s.contactId)) ||
    (d.numero !== undefined && chiffres(s.numero) === chiffres(d.numero)));
  if (appels.some((s) => s.issue === 'joint')) return 'joint';
  if (appels.some((s) => s.issue === 'tentative')) return 'en_cours';
  if (appels.length > 0) return 'injoignable';
  return d.traiteeLe ? 'faite' : 'transmise';
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
    chat: (a.chat ?? []).map((m) => ({ ...m, author: m.from === 'agent' ? (m.auto ? AGENT_AUTO : agentPublic(m.author)) : undefined })),
    secours: (a.secours ?? []).map(({ service, numero, canal, at, issue }) => ({ service, numero, canal, at, issue })),
    demandes: (a.demandes ?? []).map((d) => ({ cle: d.cle, label: d.label, numero: d.numero, at: d.at, statut: statutDemande(d, a.secours ?? []) })),
    suggestions: a.agentAuto?.actif && a.status !== 'resolved' && a.status !== 'cancelled' ? a.agentAuto.suggestions : [],
    agentAuto: Boolean(a.agentAuto?.actif),
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
  raiseSos(input: {
    userId: string; location: LatLng; rideId?: string; note?: string; source?: 'client' | 'chauffeur';
    /** « controle » : l'alerte naît d'une réponse au contrôle de sécurité en course. */
    origine?: 'bouton' | 'controle';
    langue?: LangueAgent;
  }): EmergencyAlert {
    const { origine, langue, ...reste } = input;
    const source = input.source ?? 'client';
    // L'agent automatique parle au PASSAGER. Un chauffeur en détresse est pris par un
    // opérateur : ses situations (agression par un client, malaise au volant) ont leur
    // propre conduite à tenir.
    return this.raise({ kind: 'sos', ...reste, source }, source === 'client' ? { origine: origine ?? 'bouton', langue } : undefined);
  }

  /** Écouteurs des demandes de l'agent automatique (astreinte prévenue par SMS, journal…). */
  private readonly ecouteursDemandes: Array<(a: EmergencyAlert, d: DemandeAuCentre[]) => void> = [];
  onDemandes(fn: (a: EmergencyAlert, d: DemandeAuCentre[]) => void): void { this.ecouteursDemandes.push(fn); }

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
    }, { origine: 'choc' });
  }

  private raise(input: {
    kind: AlertKind;
    userId: string;
    location: LatLng;
    rideId?: string;
    impactG?: number;
    note?: string;
    source?: 'client' | 'chauffeur' | 'systeme';
  }, agent?: { origine: ContexteSos['origine']; langue?: LangueAgent }): EmergencyAlert {
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

    // Une personne a déclenché l'alerte (ou un choc a été mesuré) : l'agent automatique
    // lui répond avant même qu'un opérateur n'ouvre le dossier.
    if (agent) this.demarrerAgent(alert, { origine: agent.origine, enCourse: Boolean(alert.rideId), lieu: alert.zoneName, langue: agent.langue });

    // Diffusion temps réel : poste de supervision (relais SAMU). Le canal de la course,
    // lui, est aussi écouté par l'app du chauffeur : il ne reçoit qu'un signal sans
    // contenu — ni message, ni position, ni motif. Une passagère qui signale son
    // chauffeur ne doit pas voir sa conversation partir sur le téléphone de celui-ci.
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.alert', alert);
    if (alert.rideId) this.realtime.publish(rideRoom(alert.rideId), 'emergency.alert', { id: alert.id, kind: alert.kind, level: alert.level, at: alert.createdAt });
    return alert;
  }

  /* ----------------------------- Agent automatique ----------------------------- */

  private demarrerAgent(a: EmergencyAlert, contexte: ContexteSos): void {
    const tour = ouvrirAgentSos(contexte);
    a.agentAuto = { etat: tour.etat, contexte, actif: true, dernierSigne: a.createdAt, suggestions: tour.suggestions };
    this.appliquerTour(a, tour, false);
  }

  /** Inscrit dans le dossier ce que l'agent automatique vient de dire et de demander. */
  private appliquerTour(a: EmergencyAlert, tour: TourAgent, diffuser = true): void {
    if (!a.agentAuto) return;
    const at = new Date().toISOString();
    a.agentAuto.etat = tour.etat;
    a.agentAuto.suggestions = tour.suggestions;
    a.resume = tour.resume;
    for (const text of tour.messages) (a.chat ??= []).push({ from: 'agent', author: AGENT_AUTO, auto: true, text, at });
    const nouvelles: DemandeAuCentre[] = tour.demandes.map((d) => ({
      cle: d.cle, label: libelleDemande(d.cle), numero: NUMERO_SERVICE[d.cle], raison: d.raison, at,
    }));
    if (nouvelles.length) (a.demandes ??= []).push(...nouvelles);
    a.updatedAt = at;
    if (tour.terminer) {
      // Fausse manœuvre confirmée par la personne, aucun service engagé : le dossier se
      // referme seul, avec sa conversation, et reste lisible par la supervision.
      a.status = 'cancelled';
      a.closingNote = 'Fausse manœuvre confirmée par l’usager auprès de l’agent automatique.';
      a.agentAuto.actif = false;
    }
    if (nouvelles.length) for (const fn of this.ecouteursDemandes) { try { fn(a, nouvelles); } catch { /* une notification ratée ne bloque pas l'alerte */ } }
    if (diffuser) {
      this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
      this.informerUsager(a);
    }
  }

  /**
   * Silences : l'agent relance la personne après 30 s, puis, sans nouvelle à 75 s, demande
   * au centre de la rappeler et de prévenir la police. Appelé périodiquement.
   */
  relancerAgents(maintenant = Date.now()): number {
    let relancees = 0;
    for (const a of this.alerts.values()) {
      const ag = a.agentAuto;
      if (!ag?.actif || a.status === 'resolved' || a.status === 'cancelled') continue;
      const tour = relancerAgentSos(ag.etat, ag.contexte, (maintenant - Date.parse(ag.dernierSigne)) / 1000);
      if (!tour) continue;
      this.appliquerTour(a, tour);
      relancees += 1;
    }
    return relancees;
  }

  /** Le centre a joint un partenaire du répertoire (dépanneur, garage) : la demande correspondante est faite. */
  contactPartenaire(id: string, contactId: string, agent: string): void {
    const a = this.alerts.get(id);
    const d = a?.demandes?.find((x) => !x.traiteeLe && (CONTACTS_DEMANDE[x.cle] ?? []).includes(contactId));
    if (a && d && !NUMERO_SERVICE[d.cle]) this.traiterDemande(id, d.cle, agent);
  }

  /** L'opérateur a traité une demande interne (chauffeur joint, course arrêtée, client rappelé…). */
  traiterDemande(id: string, cle: CleDemande, agent: string): EmergencyAlert | undefined {
    const a = this.alerts.get(id);
    const d = a?.demandes?.find((x) => x.cle === cle && !x.traiteeLe);
    if (!a || !d) return undefined;
    d.traiteeLe = new Date().toISOString();
    d.traiteePar = agent;
    a.updatedAt = d.traiteeLe;
    this.realtime.publish(EMERGENCY_ROOM, 'emergency.update', a);
    this.informerUsager(a);
    return a;
  }

  /**
   * Côté usager : chaque changement de son alerte lui parvient en direct, sur la
   * room de l'alerte et sur celle de sa course. C'est ce qui manquait : la console
   * voyait tout, la personne en détresse ne savait même pas qu'on l'avait lue.
   */
  private informerUsager(a: EmergencyAlert): void {
    // Uniquement sur le canal de l'alerte, réservé à son auteur : le canal de la course
    // est partagé avec le chauffeur.
    this.realtime.publish(sosRoom(a.id), 'sos.suivi', vueUsager(a));
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
    // L'opérateur prend la main : l'agent automatique l'annonce à la personne et se tait.
    if (premiere && a.agentAuto?.actif) {
      a.agentAuto.actif = false;
      a.agentAuto.suggestions = [];
      (a.chat ??= []).push({ from: 'agent', author: AGENT_AUTO, auto: true, text: passerLaMainSos(a.agentAuto.etat, agentPublic(agent)), at: a.updatedAt });
    }
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
    // Tant qu'aucun opérateur n'a pris le dossier, l'agent automatique répond aussitôt.
    const ag = a.agentAuto;
    if (msg.from === 'usager' && ag) {
      ag.dernierSigne = m.at;
      if (ag.actif && a.status !== 'resolved' && a.status !== 'cancelled') {
        this.appliquerTour(a, repondreAgentSos(ag.etat, msg.text, ag.contexte));
        return m;
      }
    }
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
