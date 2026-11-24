import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { createRepository } from '../../core/db/repository.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../core/errors.js';
import type { LatLng } from '../../core/geo.js';
import { parse } from '../../core/validate.js';
import { verifyClientToken } from '../clients/auth.js';
import { driverTokenOf, verifyDriverToken } from '../driver-app/auth.js';
import { rideRoom } from '../realtime/hub.js';
import type { ServiceType } from '../services/types.js';
import type { Ride } from './store.js';

/**
 * LA COURSE EN DIRECT entre le chauffeur (ORION Pro) et le client :
 *  - ARRÊTS ET PAUSES : arrêt prévu au trajet (déclaré d'un clic à l'arrivée) ou arrêt demandé de
 *    vive voix par le client ; chaque minute d'arrêt est facturée (100 F par défaut, console) et
 *    ajoutée au prix ; tout est tracé et visible des deux côtés ;
 *  - CHAT instantané, et à l'arrivée du chauffeur deux réponses toutes prêtes pour le client ;
 *  - APPELS PAR INTERNET, sans unités : la voix passe par le serveur ORION ;
 *  - ESPÈCES DE SECOURS : le moyen choisi ne passe pas, le chauffeur autorise les espèces.
 */

export interface Arret {
  id: string;
  /** 'prevu' : arrêt du trajet commandé ; 'demande' : demandé de vive voix par le client. */
  type: 'prevu' | 'demande';
  /** Rang de l'arrêt prévu (0 = premier arrêt du trajet). */
  index?: number;
  nom?: string;
  /** Position du véhicule au début de l'arrêt. */
  lieu?: LatLng;
  debut: string;
  fin?: string;
  minutes?: number;
  montant?: number;
}

export interface MessageChat {
  id: string;
  de: 'client' | 'chauffeur' | 'orion';
  texte: string;
  /** Réponse toute prête choisie par le client (le chauffeur la lit dans sa langue). */
  rapide?: ReponseRapide;
  at: string;
}

export const REPONSES_RAPIDES = {
  sors: 'J’arrive, je sors tout de suite',
  retard: 'Un instant, je serai un peu en retard',
} as const;
export type ReponseRapide = keyof typeof REPONSES_RAPIDES;

/** Tolérance : un arrêt de moins de 15 s ne coûte rien ; ensuite, chaque minute entamée compte. */
export const TOLERANCE_ARRET_S = 15;
export function minutesFacturees(debutMs: number, finMs: number): number {
  const s = Math.max(0, (finMs - debutMs) / 1000);
  return s <= TOLERANCE_ARRET_S ? 0 : Math.ceil((s - TOLERANCE_ARRET_S) / 60);
}

/** Arrêt ajouté par le client après sa commande (avant la prise en charge ou en course). */
export interface ArretAjoute {
  index: number;
  nom: string;
  lieu: LatLng;
  /** Détour facturé : prix du trajet avec l'arrêt moins prix sans (F CFA, jamais négatif). */
  supplement: number;
  at: string;
}
/** Au plus 5 arrêts sur un trajet (comme à la commande). */
export const ARRETS_MAX = 5;

type AvecLive = Ride & {
  arrets?: Arret[];
  nomsArrets?: string[];
  arretsAjoutes?: ArretAjoute[];
  /** Espèces autorisées par le chauffeur quand le moyen choisi n'a pas fonctionné. */
  especes?: { autoriseLe: string; clientConfirmeLe?: string };
};

/** Arrêts d'une course, leur coût, et l'arrêt en cours (avec son coût à l'instant t). */
export function resumeArrets(ride: Ride, tarifMin: number, maintenant = Date.now()) {
  const arrets = (ride as AvecLive).arrets ?? [];
  const enCours = arrets.find((a) => !a.fin) ?? null;
  const finis = arrets.filter((a) => a.fin);
  const minutes = finis.reduce((t, a) => t + (a.minutes ?? 0), 0);
  const montant = finis.reduce((t, a) => t + (a.montant ?? 0), 0);
  const minutesEnCours = enCours ? minutesFacturees(Date.parse(enCours.debut), maintenant) : 0;
  const ajoutes = (ride as AvecLive).arretsAjoutes ?? [];
  const supplementTrajet = ajoutes.reduce((t, a) => t + a.supplement, 0);
  return {
    tarifMin,
    arrets,
    enCours: enCours ? { ...enCours, minutes: minutesEnCours, montant: minutesEnCours * tarifMin } : null,
    minutes,
    /** Minutes d'arrêt facturées + détours des arrêts ajoutés par le client. */
    montant: montant + supplementTrajet,
    montantMinutes: montant,
    supplementTrajet,
    ajoutes,
    /** Prix fixe de la commande, et ce prix avec les détours ajoutés (hors minutes d'arrêt). */
    prixCommande: ride.quote.amount,
    prixAvecDetours: ride.quote.amount + supplementTrajet,
    /** Prévus au trajet : nom et s'ils ont été marqués. */
    prevus: ((ride.quote.stops ?? []) as LatLng[]).map((p, index) => ({
      index, lat: p.lat, lng: p.lng,
      nom: (ride as AvecLive).nomsArrets?.[index] ?? `Arrêt ${index + 1}`,
      fait: arrets.some((a) => a.type === 'prevu' && a.index === index),
      ajoute: ajoutes.some((a) => a.index === index),
    })),
  };
}

/** Ferme l'arrêt en cours (fin de course) : ses minutes sont comptées jusqu'à maintenant. */
export function fermerArretEnCours(ride: Ride, tarifMin: number, at = Date.now()): void {
  const a = (ride as AvecLive).arrets?.find((x) => !x.fin);
  if (!a) return;
  a.fin = new Date(at).toISOString();
  a.minutes = minutesFacturees(Date.parse(a.debut), at);
  a.montant = a.minutes * tarifMin;
}

/** Montant des arrêts d'une course : minutes des arrêts terminés et détours des arrêts ajoutés par le client. */
export function montantArrets(ride: Ride): number {
  const minutes = ((ride as AvecLive).arrets ?? []).reduce((t, a) => t + (a.fin ? a.montant ?? 0 : 0), 0);
  return minutes + ((ride as AvecLive).arretsAjoutes ?? []).reduce((t, a) => t + a.supplement, 0);
}

/**
 * Détour d'un arrêt ajouté : prix du trajet passant par les arrêts `apres`, moins le prix par les
 * arrêts `avant`, aux conditions du moment (gamme, assurance, itinéraire choisi). Les deux devis
 * sont des aperçus : ils ne comptent pas comme des demandes (pas d'effet sur la majoration).
 */
export async function supplementDetour(container: Container, ride: Ride, avant: LatLng[], apres: LatLng[]): Promise<number> {
  const service = container.registry.get((ride.serviceType === 'delivery' ? 'delivery' : 'ride') as ServiceType);
  const base = {
    origin: ride.origin, destination: ride.destination, category: ride.quote.category,
    insurance: (ride.quote.breakdown?.insurance ?? 0) > 0,
    ...(ride.quote.itineraire ? { itineraire: ride.quote.itineraire.choix } : {}),
    ...(ride.quote.miseADisposition ? { miseADisposition: ride.quote.miseADisposition } : {}),
    apercu: true,
  };
  const [sans, avec] = await Promise.all([service.estimate({ ...base, stops: avant }), service.estimate({ ...base, stops: apres })]);
  return Math.max(0, Math.round(avec.amount - sans.amount));
}

export function especesAutorisees(ride: Ride): boolean {
  return Boolean((ride as AvecLive).especes?.autoriseLe);
}

const COURSE_ACTIVE = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress']);
/** Le chat reste ouvert une heure après l'arrivée (objet oublié, paiement). */
const CHAT_APRES_FIN_MS = 60 * 60_000;

/** Qui parle : le chauffeur de la course (jeton ORION Pro) ou son client (jeton de l'app). */
function participant(req: FastifyRequest, ride: Ride, jeton?: string): 'client' | 'chauffeur' {
  const brut = jeton ?? (() => { const h = req.headers.authorization; const m = h ? /^Bearer\s+(.+)$/i.exec(h.trim()) : null; return m?.[1]; })();
  const chauffeur = verifyDriverToken(jeton ?? driverTokenOf(req));
  if (chauffeur) {
    if (chauffeur !== ride.driverId) throw forbidden('Cette course ne vous est pas attribuée');
    return 'chauffeur';
  }
  const client = verifyClientToken(brut);
  if (!client) throw unauthorized('Connexion requise');
  if (client !== ride.clientId) throw forbidden('Cette course ne vous appartient pas');
  return 'client';
}

function exigerChauffeur(req: FastifyRequest, ride: Ride): void {
  if (participant(req, ride) !== 'chauffeur') throw forbidden('Réservé au chauffeur de la course');
}

function chatOuvert(ride: Ride): boolean {
  if (COURSE_ACTIVE.has(ride.status)) return true;
  if (!['completed', 'paid', 'rated'].includes(ride.status)) return false;
  const fin = [...ride.events].reverse().find((e) => e.type === 'completed')?.at;
  return !fin || Date.now() - Date.parse(fin) < CHAT_APRES_FIN_MS;
}

interface ChatCourse { id: string; messages: MessageChat[] }

/** Canal WebSocket d'un participant (forme minimale utilisée ici). */
interface WebSocket {
  readyState: number;
  send(data: Buffer, o?: { binary?: boolean }): void;
  close(code?: number, raison?: string): void;
  on(ev: 'message', f: (data: Buffer, binaire: boolean) => void): void;
  on(ev: 'close', f: () => void): void;
}

/** Appel en cours d'une course (en mémoire : un appel ne survit pas à un redémarrage). */
interface Appel {
  id: string;
  de: 'client' | 'chauffeur';
  etat: 'sonne' | 'en_cours' | 'fini';
  debut: number;
  decroche?: number;
  sockets: Partial<Record<'client' | 'chauffeur', WebSocket>>;
  minuterie?: NodeJS.Timeout;
}
/** Une sonnerie sans réponse s'arrête au bout de 45 s ; un appel dure au plus 30 min. */
const SONNERIE_MS = 45_000;
const APPEL_MAX_MS = 30 * 60_000;
/** Trame audio : 20 à 100 ms de voix compressée (μ-law 8 kHz) ; au-delà, refusée. */
const TRAME_MAX = 2048;

export async function courseLiveRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const chats = createRepository<ChatCourse>('chats_course');
  const appels = new Map<string, Appel>();
  const tarif = () => container.settings.getPricing().arretParMin;
  const course = (id: string): AvecLive => {
    const r = container.rides.get(id);
    if (!r) throw notFound('Course introuvable');
    return r as AvecLive;
  };
  const publier = (ride: Ride, type: string, data: Record<string, unknown>) => container.realtime.publish(rideRoom(ride.id), type, { rideId: ride.id, ...data });
  const publierArrets = (ride: Ride) => publier(ride, 'ride.arrets', { arrets: resumeArrets(ride, tarif()) });

  const ajouterMessage = (ride: Ride, m: Omit<MessageChat, 'id' | 'at'>): MessageChat => {
    const msg: MessageChat = { id: randomUUID(), at: new Date().toISOString(), ...m };
    const c = chats.get(ride.id) ?? { id: ride.id, messages: [] };
    c.messages = [...c.messages, msg].slice(-200);
    chats.put(c);
    publier(ride, 'chat.message', { message: msg });
    return msg;
  };

  // L'arrivée du chauffeur s'annonce dans le chat, avec les réponses toutes prêtes pour le client.
  container.realtime.subscribeAll?.((m) => {
    if (m.type !== 'ride.status') return;
    const d = m.data as { rideId?: string; status?: string };
    if (d.status !== 'arrived' || !d.rideId) return;
    const ride = container.rides.get(d.rideId);
    if (!ride) return;
    const deja = chats.get(ride.id)?.messages.some((x) => x.de === 'orion' && x.texte.startsWith('Votre chauffeur est arrivé'));
    if (!deja) ajouterMessage(ride, { de: 'orion', texte: 'Votre chauffeur est arrivé au point de prise en charge.' });
  });

  /* ------------------------------ Arrêts ------------------------------ */

  app.get('/rides/:id/arrets', async (req) => {
    const ride = course((req.params as { id: string }).id);
    participant(req, ride);
    return resumeArrets(ride, tarif());
  });

  /** Le chauffeur arrive à un arrêt prévu, ou s'arrête à la demande du client : le compteur part. */
  app.post('/rides/:id/arrets', async (req) => {
    const ride = course((req.params as { id: string }).id);
    exigerChauffeur(req, ride);
    const body = parse(z.object({
      type: z.enum(['prevu', 'demande']),
      index: z.number().int().min(0).max(20).optional(),
      position: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    }), req.body ?? {});
    if (ride.status !== 'in_progress') throw conflict('Les arrêts se déclarent pendant la course, client à bord');
    const arrets = ride.arrets ?? [];
    if (arrets.some((a) => !a.fin)) throw conflict('Un arrêt est déjà en cours : reprenez d’abord la course');
    const prevus = ride.quote.stops ?? [];
    if (body.type === 'prevu') {
      if (body.index === undefined || body.index >= prevus.length) throw badRequest('Arrêt prévu inconnu');
      if (arrets.some((a) => a.type === 'prevu' && a.index === body.index)) throw conflict('Cet arrêt a déjà été marqué');
    }
    const arret: Arret = {
      id: randomUUID(), type: body.type, debut: new Date().toISOString(),
      ...(body.type === 'prevu' ? { index: body.index, nom: ride.nomsArrets?.[body.index!] ?? `Arrêt ${body.index! + 1}` } : {}),
      ...(body.position ? { lieu: body.position } : {}),
    };
    ride.arrets = [...arrets, arret];
    ride.events.push({ type: 'arret_debut', at: arret.debut, payload: { arretId: arret.id, type: arret.type, index: arret.index ?? null } });
    container.rides.persist(ride);
    publierArrets(ride);
    return resumeArrets(ride, tarif());
  });

  /** Fin de l'arrêt : la course reprend ; les minutes et le montant sont arrêtés. */
  app.post('/rides/:id/arrets/fin', async (req) => {
    const ride = course((req.params as { id: string }).id);
    exigerChauffeur(req, ride);
    const a = ride.arrets?.find((x) => !x.fin);
    if (!a) throw conflict('Aucun arrêt en cours');
    fermerArretEnCours(ride, tarif());
    ride.events.push({ type: 'arret_fin', at: a.fin!, payload: { arretId: a.id, minutes: a.minutes, montant: a.montant } });
    container.rides.persist(ride);
    publierArrets(ride);
    return resumeArrets(ride, tarif());
  });

  /*
   * ARRÊT AJOUTÉ PAR LE CLIENT, après la commande : avant la prise en charge ou en course.
   * Il voit d'abord le supplément (aperçu), puis confirme ; le chauffeur est prévenu (message
   * ORION dans le chat, notification) et son guidage passe par l'arrêt.
   */
  const ARRET_POSSIBLE = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress']);
  const schemaArretClient = z.object({
    position: z.object({ lat: z.number().min(4).max(11), lng: z.number().min(-9).max(-2) }),
    nom: z.string().trim().min(1).max(80).optional(),
  });
  const preparerAjout = async (req: FastifyRequest) => {
    const ride = course((req.params as { id: string }).id);
    if (participant(req, ride) !== 'client') throw forbidden('Seul le client ajoute un arrêt à sa course');
    if (!ARRET_POSSIBLE.has(ride.status)) throw conflict('La course n’accepte plus de nouvel arrêt');
    const body = parse(schemaArretClient, req.body ?? {});
    const avant = (ride.quote.stops ?? []) as LatLng[];
    if (avant.length >= ARRETS_MAX) throw conflict(`Au plus ${ARRETS_MAX} arrêts sur un trajet`);
    const apres = [...avant, body.position];
    const supplement = await supplementDetour(container, ride, avant, apres);
    return { ride, body, avant, apres, supplement };
  };

  app.post('/rides/:id/arrets/apercu', async (req) => {
    const { ride, supplement } = await preparerAjout(req);
    const r = resumeArrets(ride, tarif());
    return { supplement, tarifMin: tarif(), prixAvant: r.prixAvecDetours, prixApres: r.prixAvecDetours + supplement };
  });

  app.post('/rides/:id/arrets/ajout', async (req) => {
    const { ride, body, apres, supplement } = await preparerAjout(req);
    const index = apres.length - 1;
    const nom = body.nom ?? `Arrêt ${index + 1}`;
    ride.quote.stops = apres;
    // Les arrêts commandés sans nom gardent « Arrêt n » ; le nouveau prend sa place dans la liste.
    const noms = [...(ride.nomsArrets ?? [])];
    while (noms.length < index) noms.push(`Arrêt ${noms.length + 1}`);
    noms[index] = nom;
    ride.nomsArrets = noms.slice(0, 20);
    const ajout: ArretAjoute = { index, nom, lieu: body.position, supplement, at: new Date().toISOString() };
    ride.arretsAjoutes = [...(ride.arretsAjoutes ?? []), ajout];
    ride.events.push({ type: 'arret_ajoute', at: ajout.at, payload: { index, nom, supplement, statut: ride.status } });
    container.rides.persist(ride);
    publier(ride, 'ride.arrets', { arrets: resumeArrets(ride, tarif()), nouvelArret: ajout });
    ajouterMessage(ride, { de: 'orion', texte: supplement > 0
      ? `Le client a ajouté un arrêt : ${nom}. Détour : +${supplement.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} F ; chaque minute sur place est comptée.`
      : `Le client a ajouté un arrêt : ${nom}. Chaque minute sur place est comptée.` });
    return resumeArrets(ride, tarif());
  });

  /* -------------------------------- Chat ------------------------------- */

  app.get('/rides/:id/chat', async (req) => {
    const ride = course((req.params as { id: string }).id);
    const qui = participant(req, ride);
    return { messages: chats.get(ride.id)?.messages ?? [], ouvert: chatOuvert(ride), moi: qui, rapides: REPONSES_RAPIDES };
  });

  app.post('/rides/:id/chat', async (req) => {
    const ride = course((req.params as { id: string }).id);
    const qui = participant(req, ride);
    if (!chatOuvert(ride)) throw conflict('La discussion de cette course est close');
    const body = parse(z.object({
      texte: z.string().trim().min(1).max(500).optional(),
      rapide: z.enum(['sors', 'retard']).optional(),
    }).refine((b) => b.texte || b.rapide, 'Message vide'), req.body ?? {});
    if (body.rapide && qui !== 'client') throw forbidden('Réponse réservée au client');
    const message = ajouterMessage(ride, { de: qui, texte: body.rapide ? REPONSES_RAPIDES[body.rapide] : body.texte!, ...(body.rapide ? { rapide: body.rapide } : {}) });
    return { message };
  });

  /* ------------------------------- Appels ------------------------------ */

  const finir = (ride: Ride, a: Appel, raison: 'raccroche' | 'refuse' | 'sans_reponse' | 'coupe') => {
    if (a.etat === 'fini') return;
    a.etat = 'fini';
    if (a.minuterie) clearTimeout(a.minuterie);
    for (const s of Object.values(a.sockets)) { try { s?.close(); } catch { /* déjà fermé */ } }
    appels.delete(ride.id);
    const duree = a.decroche ? Math.round((Date.now() - a.decroche) / 1000) : 0;
    ride.events.push({ type: 'appel', at: new Date().toISOString(), payload: { appelId: a.id, de: a.de, raison, dureeS: duree } });
    container.rides.persist(ride);
    publier(ride, 'appel.etat', { appelId: a.id, etat: 'fini', raison, de: a.de, dureeS: duree });
  };

  /** Sonner, décrocher, refuser ou raccrocher : le signal passe par le canal de la course. */
  app.post('/rides/:id/appel', async (req) => {
    const ride = course((req.params as { id: string }).id);
    const qui = participant(req, ride);
    const { action } = parse(z.object({ action: z.enum(['appeler', 'decrocher', 'refuser', 'raccrocher']) }), req.body ?? {});
    const a = appels.get(ride.id);
    if (action === 'appeler') {
      if (!COURSE_ACTIVE.has(ride.status)) throw conflict('Les appels ORION sont ouverts pendant la course');
      if (a && a.etat !== 'fini') throw conflict('Un appel est déjà en cours');
      const nouvel: Appel = { id: randomUUID(), de: qui, etat: 'sonne', debut: Date.now(), sockets: {} };
      nouvel.minuterie = setTimeout(() => finir(ride, nouvel, 'sans_reponse'), SONNERIE_MS);
      nouvel.minuterie.unref?.();
      appels.set(ride.id, nouvel);
      publier(ride, 'appel.etat', { appelId: nouvel.id, etat: 'sonne', de: qui });
      return { appelId: nouvel.id, etat: 'sonne' };
    }
    if (!a) throw conflict('Aucun appel en cours');
    if (action === 'decrocher') {
      if (a.de === qui) throw badRequest('L’appel se décroche de l’autre côté');
      if (a.etat !== 'sonne') return { appelId: a.id, etat: a.etat };
      a.etat = 'en_cours';
      a.decroche = Date.now();
      if (a.minuterie) clearTimeout(a.minuterie);
      a.minuterie = setTimeout(() => finir(ride, a, 'coupe'), APPEL_MAX_MS);
      a.minuterie.unref?.();
      publier(ride, 'appel.etat', { appelId: a.id, etat: 'en_cours', de: a.de });
      return { appelId: a.id, etat: 'en_cours' };
    }
    finir(ride, a, action === 'refuser' ? 'refuse' : 'raccroche');
    return { appelId: a.id, etat: 'fini' };
  });

  /**
   * Voix de l'appel : chaque participant ouvre ce canal avec son jeton ; ce que l'un envoie
   * (trames audio binaires) part aussitôt chez l'autre. Rien n'est enregistré.
   */
  app.get('/ws/appel/:id', { websocket: true }, (brut, req) => {
    const socket = brut as unknown as WebSocket;
    const { id } = req.params as { id: string };
    const { jeton } = (req.query ?? {}) as { jeton?: string };
    const ride = container.rides.get(id);
    const a = ride ? appels.get(id) : undefined;
    let qui: 'client' | 'chauffeur' | null = null;
    try { if (ride) qui = participant(req, ride, jeton); } catch { qui = null; }
    if (!ride || !a || !qui || a.etat === 'fini') { try { socket.close(4403, 'Appel indisponible'); } catch { /* fermé */ } return; }
    a.sockets[qui]?.close();
    a.sockets[qui] = socket;
    const autre = qui === 'client' ? 'chauffeur' : 'client';
    socket.on('message', (data: Buffer, binaire: boolean) => {
      if (!binaire || data.length > TRAME_MAX || a.etat !== 'en_cours') return;
      const cible = a.sockets[autre];
      if (cible && cible.readyState === 1) cible.send(data, { binary: true });
    });
    socket.on('close', () => { if (a.sockets[qui!] === socket) delete a.sockets[qui!]; });
  });

  /* ---------------------------- Espèces de secours --------------------------- */

  /** Le moyen choisi ne passe pas : le chauffeur autorise les espèces, l'app du client bascule. */
  app.post('/rides/:id/especes/autoriser', async (req) => {
    const ride = course((req.params as { id: string }).id);
    exigerChauffeur(req, ride);
    if (!['in_progress', 'completed'].includes(ride.status)) throw conflict('Les espèces s’autorisent en fin de course');
    if (container.settings.getServices().gateways?.['cash'] === false) throw conflict('Les espèces sont désactivées par ORION');
    ride.especes = { autoriseLe: new Date().toISOString() };
    ride.events.push({ type: 'especes_autorisees', at: ride.especes.autoriseLe, payload: { avant: ride.paymentMethod ?? null } });
    container.rides.persist(ride);
    publier(ride, 'paiement.especes', { autorise: true });
    return { especes: ride.especes };
  });

  /** Le client confirme qu'il paie en espèces (le chauffeur confirme ensuite l'encaissement). */
  app.post('/rides/:id/especes/confirmer', async (req) => {
    const ride = course((req.params as { id: string }).id);
    if (participant(req, ride) !== 'client') throw forbidden('Réservé au client');
    if (!ride.especes) throw conflict('Le chauffeur n’a pas autorisé les espèces');
    ride.especes.clientConfirmeLe = new Date().toISOString();
    ride.events.push({ type: 'especes_client', at: ride.especes.clientConfirmeLe });
    container.rides.persist(ride);
    publier(ride, 'paiement.especes', { autorise: true, clientConfirme: true });
    return { especes: ride.especes };
  });
}

/** Noms des arrêts prévus, donnés par l'app cliente à la commande (affichés au chauffeur). */
export function retenirNomsArrets(ride: Ride, noms?: string[]): void {
  if (!noms?.length) return;
  (ride as AvecLive).nomsArrets = noms.slice(0, 20).map((n) => n.trim().slice(0, 80));
}
