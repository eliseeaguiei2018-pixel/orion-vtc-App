import { randomUUID } from 'node:crypto';
import type { Container } from '../../container.js';
import type { LatLng } from '../../core/geo.js';
import { nearestZone } from '../geo-ci/zones.js';
import { DASHBOARD_ROOM, type RealtimeMessage } from '../realtime/hub.js';
import type { Ride } from '../rides/store.js';
import { config } from '../../config/index.js';
import { analyser, evenementsDe, historiqueDemo, type Sources } from './analyse.js';

/**
 * TABLEAU DE BORD ORION : la vue d'ensemble de tout l'écosystème, en direct.
 *
 * Le service écoute chaque message publié par le serveur (app cliente, app chauffeur,
 * console, simulateur) et le traduit en une ligne lisible du journal d'activité. Le
 * tableau reçoit cette ligne aussitôt, puis rafraîchit ses chiffres. Aucune donnée de
 * santé n'y figure, et les clients n'apparaissent que par leur prénom et une initiale.
 */

export type Service = 'course' | 'livraison';

export interface EntreeJournal {
  id: string;
  at: string;
  /** Ce qui s'est passé : sert à l'icône et à la couleur de la ligne. */
  genre: 'commande' | 'attribution' | 'approche' | 'arrivee' | 'identite' | 'depart' | 'terminee' | 'paiement' | 'annulation' | 'alerte' | 'secours' | 'message' | 'location';
  niveau: 'info' | 'succes' | 'alerte';
  service?: Service;
  titre: string;
  detail?: string;
  rideId?: string;
}

const ACTIVES = new Set(['searching', 'accepted', 'driver_en_route', 'arrived', 'in_progress']);
const TERMINEES = new Set(['completed', 'paid', 'rated']);
const ALERTE_OUVERTE = new Set(['raised', 'dispatched', 'acknowledged']);
const MAX_JOURNAL = 60;

const PAIEMENT: Record<string, string> = {
  orange_money: 'Orange Money', wave: 'Wave', mtn_momo: 'MTN MoMo', moov_money: 'Moov Money', cash: 'Espèces', card: 'Carte',
};

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} F`;
const debutDuJour = (maintenant = new Date()) => { const d = new Date(maintenant); d.setHours(0, 0, 0, 0); return d.getTime(); };
const service = (r: Ride): Service => (r.serviceType === 'delivery' ? 'livraison' : 'course');
/** Moment où la course a atteint un statut (horodatage de l'événement). */
const momentDe = (r: Ride, type: string) => r.events.find((e) => e.type === type)?.at;
/** Accord en français : 0 et 1 au singulier. */
const pl = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
const commune = (p: LatLng) => nearestZone(p)?.zone.name ?? 'Abidjan';

/** Jours d'historique de démonstration : jamais en production, 730 par défaut en développement simulé. */
export function joursDeDemo(): number {
  if (config.NODE_ENV === 'production') return 0;
  if (config.DEMO_HISTORY_DAYS !== undefined) return config.DEMO_HISTORY_DAYS;
  return config.NODE_ENV === 'development' && config.SIMULATE_RIDES ? 730 : 0;
}

export class TableauDeBord {
  private readonly journal: EntreeJournal[] = [];

  constructor(private readonly c: Container) {
    c.realtime.subscribeAll((msg) => {
      if (msg.room === DASHBOARD_ROOM) return;
      for (const entree of this.traduire(msg)) {
        this.journal.unshift(entree);
        if (this.journal.length > MAX_JOURNAL) this.journal.length = MAX_JOURNAL;
        c.realtime.publish(DASHBOARD_ROOM, 'journal', entree);
      }
    });
  }

  /** « Aya Kouassi » → « Aya K. » : un écran mural n'affiche pas l'identité complète. */
  private client(clientId: string): string {
    const nom = this.c.clients.get(clientId)?.name?.trim();
    if (!nom) return 'Un client';
    const [prenom, ...reste] = nom.split(/\s+/);
    return reste.length ? `${prenom} ${reste[reste.length - 1]![0]!.toUpperCase()}.` : prenom!;
  }

  private conducteur(r: Ride): string {
    const d = r.driverId ? this.c.drivers.get(r.driverId) : undefined;
    return d?.name ?? (service(r) === 'livraison' ? 'le coursier' : 'le chauffeur');
  }

  private trajet(r: Ride): string {
    return `${commune(r.origin)} → ${commune(r.destination)}`;
  }

  private traduire(msg: RealtimeMessage): EntreeJournal[] {
    const e = this.traduireUn(msg);
    if (!e) return [];
    // Une commande servie sur-le-champ : la commande, puis l'attribution du conducteur.
    if (msg.type === 'ride.created' && e.rideId) {
      const ride = this.c.rides.get(e.rideId);
      if (ride?.driverId) {
        const liv = service(ride) === 'livraison';
        return [e, { id: randomUUID(), at: msg.at, rideId: ride.id, genre: 'attribution', niveau: 'info', service: service(ride),
          titre: `${liv ? 'Coursier' : 'Chauffeur'} attribué : ${this.conducteur(ride)}`,
          detail: `${liv ? 'Livraison' : 'Course'} de ${this.client(ride.clientId)} · ${this.trajet(ride)}` }];
      }
    }
    return [e];
  }

  private traduireUn(msg: RealtimeMessage): EntreeJournal | null {
    const d = (msg.data ?? {}) as Record<string, unknown>;
    const ride = typeof d.rideId === 'string' ? this.c.rides.get(d.rideId) : undefined;
    const base = { id: randomUUID(), at: msg.at, rideId: ride?.id };
    const liv = ride ? service(ride) === 'livraison' : false;
    const quoi = liv ? 'Livraison' : 'Course';

    switch (msg.type) {
      case 'ride.created':
        if (!ride) return null;
        return { ...base, genre: 'commande', niveau: 'info', service: service(ride),
          titre: `${liv ? 'Nouvelle livraison moto' : 'Nouvelle course'} · ${this.client(ride.clientId)}`,
          detail: `${this.trajet(ride)} · ${fcfa(ride.quote.amount)}` };
      case 'ride.reassigned':
        if (!ride) return null;
        return { ...base, genre: 'attribution', niveau: 'info', service: service(ride),
          titre: `${liv ? 'Livraison réattribuée' : 'Course réattribuée'} : ${this.conducteur(ride)}`,
          detail: `${quoi} de ${this.client(ride.clientId)} · ${this.trajet(ride)}` };
      case 'ride.driver_confirmed':
        if (!ride) return null;
        return { ...base, genre: 'attribution', niveau: 'succes', service: service(ride),
          titre: `${this.conducteur(ride)} accepte ${liv ? 'la livraison' : 'la course'}`, detail: 'Confirmé dans l’app chauffeur' };
      case 'ride.status': {
        if (!ride) return null;
        const s = String(d.status ?? ride.status);
        const svc = service(ride);
        if (s === 'driver_en_route') return { ...base, genre: 'approche', niveau: 'info', service: svc, titre: `${this.conducteur(ride)} en route`, detail: liv ? `vers le point de retrait, ${commune(ride.origin)}` : `vers ${this.client(ride.clientId)}, ${commune(ride.origin)}` };
        if (s === 'arrived') return { ...base, genre: 'arrivee', niveau: 'info', service: svc, titre: liv ? 'Coursier au point de retrait' : 'Chauffeur au point de prise en charge', detail: `${this.conducteur(ride)} · ${commune(ride.origin)}` };
        if (s === 'in_progress') return { ...base, genre: 'depart', niveau: 'info', service: svc, titre: liv ? 'Colis récupéré, livraison en cours' : 'Client à bord, course en cours', detail: this.trajet(ride) };
        if (s === 'completed') return { ...base, genre: 'terminee', niveau: 'succes', service: svc, titre: liv ? 'Colis livré' : 'Course terminée', detail: `${this.trajet(ride)} · ${fcfa(ride.quote.amount)}` };
        if (s === 'rated') {
          const note = ride.events.find((e) => e.type === 'rated')?.payload?.stars;
          return { ...base, genre: 'terminee', niveau: 'succes', service: svc, titre: `${quoi} notée${typeof note === 'number' ? ` ${note} ★` : ''}`, detail: `par ${this.client(ride.clientId)}` };
        }
        if (s === 'cancelled') return { ...base, genre: 'annulation', niveau: 'alerte', service: svc, titre: `${quoi} annulée`, detail: d.reason === 'no_driver' ? 'Aucun conducteur disponible' : this.trajet(ride) };
        return null;
      }
      case 'ride.code': {
        // Code de prise en charge : identité du passager confirmée, ou saisie refusée.
        if (!ride) return null;
        if (d.resultat === 'verifie') {
          return { ...base, genre: 'identite', niveau: 'succes', service: service(ride),
            titre: `Identité confirmée par code · ${this.client(ride.clientId)}`,
            detail: `${this.conducteur(ride)} · ${d.par === 'simulation' ? 'saisie simulée' : 'code saisi dans l’app chauffeur'}` };
        }
        if (d.resultat === 'faux' && d.bloque) {
          return { ...base, genre: 'identite', niveau: 'alerte', service: service(ride),
            titre: 'Code de prise en charge bloqué', detail: `${this.conducteur(ride)} · 5 erreurs, passager prévenu : à rappeler` };
        }
        if (d.resultat === 'faux') {
          return { ...base, genre: 'identite', niveau: 'info', service: service(ride),
            titre: 'Code de prise en charge erroné', detail: `${this.conducteur(ride)} · ${pl(Number(d.essaisRestants ?? 0), 'essai restant', 'essais restants')}` };
        }
        return null;
      }
      case 'payment.received':
        if (!ride) return null;
        return { ...base, genre: 'paiement', niveau: 'succes', service: service(ride),
          titre: `Paiement reçu · ${fcfa(Number(d.amount ?? ride.quote.amount))}`,
          detail: `${PAIEMENT[String(d.method)] ?? String(d.method ?? '')} · ${quoi.toLowerCase()} de ${this.client(ride.clientId)}` };
      case 'emergency.alert':
        return { ...base, genre: 'alerte', niveau: 'alerte', rideId: typeof d.rideId === 'string' ? d.rideId : undefined,
          titre: 'Alerte SOS', detail: `Niveau ${String(d.level ?? 'rouge')} · prise en charge par la supervision SAMU` };
      case 'sos.contact':
        return { ...base, genre: 'secours', niveau: 'alerte', titre: `Secours contactés : ${String(d.label ?? '')}`, detail: `par ${String(d.agent ?? 'la supervision')}` };
      case 'message': {
        if (msg.room.startsWith('ride:')) return null; // même message, déjà vu sur la room du client
        const type = String(d.type ?? 'info');
        return { ...base, genre: 'message', niveau: 'info', rideId: typeof d.rideId === 'string' ? d.rideId : undefined,
          titre: type === 'controle' ? 'Contrôle de sécurité envoyé' : type === 'consigne' ? 'Consigne envoyée à un client' : 'Message ORION envoyé',
          detail: String(d.titre ?? '') };
      }
      case 'rental.new':
        return { ...base, genre: 'location', niveau: 'info', titre: 'Nouvelle réservation Location Signature' };
      default:
        return null;
    }
  }

  /** Historique de démonstration, généré une fois par jour (journée entière, filtrée à l'usage). */
  private demo?: { jour: string; sources: Sources };

  /**
   * Objectifs financiers et niveau des commandes (courbes de l'onglet « Objectifs et
   * tendances »). Toujours calculé sur les vraies courses ; en développement, un
   * historique synthétique s'y ajoute, signalé à l'écran.
   */
  analyse(maintenant = new Date()) {
    const reelles = evenementsDe(this.c.rides.listAll());
    const jours = joursDeDemo();
    if (jours === 0) return analyser(reelles, this.c.objectifs.get(), maintenant, false);
    const jour = new Date(debutDuJour(maintenant)).toISOString();
    if (this.demo?.jour !== jour) {
      const finDuJour = new Date(debutDuJour(maintenant) + 86_400_000 - 1);
      this.demo = { jour, sources: historiqueDemo(jours, finDuJour) };
    }
    const now = +maintenant;
    const sources: Sources = {
      revenus: [...this.demo.sources.revenus.filter((e) => e.t <= now), ...reelles.revenus],
      commandes: [...this.demo.sources.commandes.filter((e) => e.t <= now), ...reelles.commandes],
    };
    return analyser(sources, this.c.objectifs.get(), maintenant, true);
  }

  journalRecent(n = 30): EntreeJournal[] {
    return this.journal.slice(0, n);
  }

  /** L'état de l'écosystème à l'instant : chiffres du jour, flotte, courses en cours. */
  async etat(maintenant = new Date()) {
    const c = this.c;
    const jour = debutDuJour(maintenant);
    const rides = c.rides.listAll();
    const duJour = rides.filter((r) => Date.parse(r.createdAt) >= jour);
    const terminees = rides.filter((r) => TERMINEES.has(r.status) && Date.parse(momentDe(r, 'completed') ?? r.createdAt) >= jour);
    const actives = rides.filter((r) => ACTIVES.has(r.status));
    const ca = terminees.reduce((s, r) => s + r.quote.amount, 0);
    const notes = rides.flatMap((r) => r.events.filter((e) => e.type === 'rated' && Date.parse(e.at) >= jour).map((e) => Number(e.payload?.stars)))
      .filter((n) => n >= 1 && n <= 5);

    // Flotte : position connue de chaque conducteur en service.
    const positions = new Map((await c.geo.snapshot()).map((e) => [e.id, e]));
    const flotte = c.drivers.list().filter((d) => d.availability !== 'offline').map((d) => {
      const p = positions.get(d.id);
      return p ? { id: d.id, nom: d.name, categorie: d.category, moto: d.category === 'moto', enCourse: d.availability === 'on_trip', lat: p.lat, lng: p.lng } : null;
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    // Par heure (aujourd'hui) : commandes de courses et de livraisons.
    const parHeure = Array.from({ length: 24 }, (_, h) => ({ heure: h, courses: 0, livraisons: 0 }));
    for (const r of duJour) {
      const h = new Date(r.createdAt).getHours();
      if (service(r) === 'livraison') parHeure[h]!.livraisons += 1; else parHeure[h]!.courses += 1;
    }
    const paiements: Record<string, number> = {};
    for (const r of terminees) {
      const m = PAIEMENT[r.paymentMethod ?? ''] ?? 'Autre';
      paiements[m] = (paiements[m] ?? 0) + r.quote.amount;
    }
    const alertes = c.safety.list();
    const messages = c.messages.recents(500).filter((m) => Date.parse(m.envoyeLe) >= jour);
    const controles = messages.filter((m) => m.type === 'controle');
    const reponseAlerte = (m: (typeof controles)[number]) => Boolean(m.reponse && m.reponses.find((x) => x.code === m.reponse?.code)?.alerte);
    const conducteurs = c.drivers.list();

    return {
      genereLe: maintenant.toISOString(),
      devise: 'XOF',
      enDirect: {
        courses: actives.filter((r) => service(r) === 'course').length,
        livraisons: actives.filter((r) => service(r) === 'livraison').length,
        enRecherche: actives.filter((r) => r.status === 'searching').length,
      },
      conducteurs: {
        enLigne: conducteurs.filter((d) => d.availability !== 'offline').length,
        enCourse: conducteurs.filter((d) => d.availability === 'on_trip').length,
        coursiers: conducteurs.filter((d) => d.category === 'moto' && d.availability !== 'offline').length,
        total: conducteurs.length,
      },
      aujourdhui: {
        commandes: duJour.length,
        courses: terminees.filter((r) => service(r) === 'course').length,
        livraisons: terminees.filter((r) => service(r) === 'livraison').length,
        annulees: duJour.filter((r) => r.status === 'cancelled' || r.status === 'no_driver').length,
        chiffreAffaires: Math.round(ca),
        panierMoyen: terminees.length ? Math.round(ca / terminees.length) : 0,
        noteMoyenne: notes.length ? Math.round((notes.reduce((s, n) => s + n, 0) / notes.length) * 10) / 10 : null,
        notes: notes.length,
        nouveauxClients: c.clients.list().filter((x) => Date.parse(x.createdAt) >= jour).length,
      },
      securite: {
        alertesOuvertes: alertes.filter((a) => ALERTE_OUVERTE.has(a.status)).length,
        alertesDuJour: alertes.filter((a) => Date.parse(a.createdAt) >= jour).length,
        controles: controles.length,
        reponsesOk: controles.filter((m) => m.reponse && !reponseAlerte(m)).length,
        reponsesAlerte: controles.filter(reponseAlerte).length,
      },
      assurance: {
        inscrits: c.dossiers.nombreInscrits(),
        coursesAssurees: duJour.filter((r) => (r.quote.breakdown?.insurance ?? 0) > 0).length,
      },
      parHeure,
      paiements,
      flotte,
      coursesActives: actives.map((r) => {
        const pos = r.trace?.length ? r.trace[r.trace.length - 1]! : undefined;
        return {
          id: r.id, service: service(r), statut: r.status, client: this.client(r.clientId),
          conducteur: r.driverId ? this.conducteur(r) : null, montant: r.quote.amount,
          origine: r.origin, destination: r.destination, position: pos ?? null,
          trajet: this.trajet(r), itineraire: r.itineraire?.geometrie ?? null,
        };
      }),
      journal: this.journalRecent(30),
    };
  }
}
