import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { config } from '../../config/index.js';
import { emettreCode } from '../sms/codes.js';
import { parse } from '../../core/validate.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../../core/errors.js';
import { CONFIG_ROOM, DRIVER_CONFIG_ROOM, driverRoom, rideRoom, type RealtimeMessage } from '../realtime/hub.js';
import { ANNOUNCE_ROOM } from '../notifications/service.js';
import { genMatricule } from '../drivers/store.js';
import { driverAppConfig } from './config.js';
import { activeRideFor, coursesARegulariser, driverRideView, financeFor, startOfDay, totals, vueLocationChauffeur } from './views.js';
import { ETAPES_CHAUFFEUR } from '../rental/service.js';
import { rideStateMachine } from '../services/ride/stateMachine.js';
import type { Ride } from '../rides/store.js';
import { offersOf } from './offers.js';
import {
  OtpStore, driverTokenOf, issueDriverToken, normalizePhone, requireDriver, verifyDriverToken,
} from './auth.js';

/** Ajoute un événement daté à une course (même forme que le module courses). */
function appendEvent(ride: Ride, type: string, payload?: Record<string, unknown>): void {
  ride.events.push({ type, at: new Date().toISOString(), payload });
}

/** Masque un numéro pour les journaux (jamais de numéro complet dans les logs). */
const maskPhone = (p: string) => p.replace(/\d(?=\d{2})/g, '•');

export async function driverAppRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const otps = new OtpStore();
  const offers = offersOf(container);
  const activeOf = (driverId: string) => {
    const pending = offers.pendingFor(driverId);
    return activeRideFor(container, driverId, pending ?? null);
  };
  // Arrêt en douceur : coupe les comptes à rebours d'offres.
  app.addHook('onClose', async () => offers.stopAll());

  /* ------------------------------ Connexion ------------------------------ */

  // Étape 1 : le chauffeur saisit son numéro → code à 6 chiffres envoyé par SMS.
  app.post('/drivers/auth/otp', async (req) => {
    const body = parse(z.object({ phone: z.string().min(6).max(25) }), req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest('Numéro de téléphone invalide');
    // Envoi par l'opérateur SMS (Orange Côte d'Ivoire ou Twilio) : on ne journalise
    // jamais le code ni le numéro complet.
    const issued = await emettreCode({ sms: container.sms, otps, phone, pour: 'chauffeur', log: req.log });
    req.log.info({ phone: maskPhone(phone), sms: issued.envoye }, 'Code de connexion chauffeur émis');
    return {
      sent: true,
      phone,
      expiresAt: issued.expiresAt,
      registered: Boolean(container.drivers.findByPhone(phone)),
      // Développement uniquement : le code est renvoyé pour tester sans SMS.
      ...(config.NODE_ENV !== 'production' ? { devCode: issued.code } : {}),
    };
  });

  // Étape 2 : vérification du code → jeton. Nouveau numéro = INSCRIPTION (dossier en brouillon).
  app.post('/drivers/auth/verify', async (req, reply) => {
    const body = parse(z.object({
      phone: z.string().min(6).max(25),
      code: z.string().min(4).max(8),
      name: z.string().trim().min(2).max(60).optional(),
      // « moto » : coursier de la livraison à moto.
      category: z.enum(['bronze', 'argent', 'or', 'diamant', 'moto']).optional(),
    }), req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest('Numéro de téléphone invalide');
    // Inscription sans nom : refus AVANT de consommer le code (le chauffeur corrige et
    // renvoie le même code, sans redemander de SMS).
    if (!container.drivers.findByPhone(phone) && !body.name) {
      throw badRequest('Indiquez votre nom complet pour créer votre compte chauffeur');
    }
    const result = otps.verify(phone, body.code);
    if (result === 'expired') throw unauthorized('Code expiré — demandez un nouveau code');
    if (result === 'locked') throw unauthorized('Trop d’essais — demandez un nouveau code');
    if (result === 'invalid') throw unauthorized('Code incorrect');

    let driver = container.drivers.findByPhone(phone);
    const created = !driver;
    if (!driver) {
      driver = container.drivers.upsert({
        id: randomUUID(),
        name: body.name ?? 'Chauffeur ORION',
        matricule: genMatricule(),
        category: body.category ?? 'bronze',
        kycStatus: 'draft',
        availability: 'offline',
        ratingAvg: 0,
        ratingCount: 0,
        phone,
      });
    }
    // Lien app ↔ chauffeur : désormais, ses courses lui sont proposées comme des offres
    // (compte à rebours console) et ne sont plus simulées.
    if (!driver.appLinkedAt) {
      driver.appLinkedAt = new Date().toISOString();
      container.drivers.persist(driver.id);
    }
    container.audit.log({
      actor: driver.name, role: 'chauffeur', action: created ? 'driver.signup' : 'driver.login',
      target: driver.id, details: { phone: maskPhone(phone), matricule: driver.matricule },
    });
    const { token, expiresAt } = issueDriverToken(driver.id);
    if (created) reply.code(201);
    return { token, expiresAt, created, driver };
  });

  // Fiche du chauffeur connecté (reprise de session au démarrage de l'app).
  app.get('/drivers/me', async (req) => {
    const id = verifyDriverToken(driverTokenOf(req));
    if (!id) throw unauthorized('Session chauffeur absente ou expirée — reconnectez-vous');
    const driver = container.drivers.get(id);
    if (!driver) throw notFound('Chauffeur introuvable');
    return { driver, finance: financeFor(container, driver) };
  });

  /* ----------------------- Configuration chauffeur ----------------------- */
  app.get('/drivers/config', async () => driverAppConfig(container.settings));

  // Annonces de la console destinées aux chauffeurs (audience chauffeurs ou tous).
  app.get('/drivers/announcements', async () => ({ announcements: container.notifications.forAudience('drivers') }));

  // Zones à forte demande (carte de chaleur chauffeur) : demande vs offre par cellule
  // (~800 m, fenêtre glissante 10 min). Données agrégées, aucune donnée personnelle.
  app.get('/drivers/demand', async () => ({ cells: await container.demand.hotCells(12) }));

  /* ------------------------- Dossier (KYC) ------------------------- */

  // Le chauffeur SOUMET son dossier complété : il passe dans la file de validation
  // de la console (pipeline KYC). Pièces originales vérifiées en agence ORION.
  app.post('/drivers/:id/kyc/submit', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    if (d.kycStatus !== 'draft' && d.kycStatus !== 'docs_submitted') {
      throw badRequest('Dossier déjà en cours d’examen ou validé');
    }
    const required: Array<[keyof typeof d, string]> = [
      ['phone', 'téléphone'], ['birthDate', 'date de naissance'], ['licenseNo', 'numéro de permis'],
      ['vehicleModel', 'modèle du véhicule'], ['vehiclePlate', 'immatriculation'],
      ['vehicleColor', 'couleur du véhicule'], ['insuranceExpiry', 'échéance de l’assurance'],
    ];
    const missing = required.filter(([k]) => !d[k]).map(([, label]) => label);
    if (missing.length) throw badRequest(`Dossier incomplet : ${missing.join(', ')}`, { missing });
    if (d.insuranceExpiry && Date.parse(d.insuranceExpiry) < Date.now()) {
      throw badRequest('Assurance expirée — renouvelez-la avant de soumettre le dossier');
    }
    d.kycStatus = 'docs_submitted';
    container.drivers.persist(id);
    container.audit.log({ actor: d.name, role: 'chauffeur', action: 'driver.kyc_submit', target: id, details: { matricule: d.matricule } });
    return { driver: d };
  });

  /* --------------------------- Courses & gains --------------------------- */

  // Historique des courses + totaux du jour et des 7 derniers jours.
  app.get('/drivers/:id/rides', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const driver = container.drivers.get(id);
    if (!driver) throw notFound('Chauffeur introuvable');
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query ?? {});
    // VOLUME : les écritures du chauffeur sont regroupées par course une seule fois.
    const parCourse = new Map<string, Array<{ rideId?: string; type: string; amount: number }>>();
    for (const e of container.wallet.ecritures(id)) {
      if (!e.rideId) continue;
      const l = parCourse.get(e.rideId) ?? [];
      l.push(e);
      parCourse.set(e.rideId, l);
    }
    const views = container.rides.listByDriver(id).map((r) => driverRideView(r, container, id, parCourse.get(r.id) ?? []));
    const today = startOfDay();
    return {
      rides: views.slice(0, q.limit),
      total: views.length,
      today: totals(views, today),
      week: totals(views, today - 6 * 86_400_000),
      finance: financeFor(container, driver),
      // Courses terminées sans paiement après le délai console : à encaisser ou régulariser.
      aRegulariser: views.filter((v) => v.status === 'completed' && v.liberee),
    };
  });

  // Course en cours (reprise après fermeture de l'app, perte réseau…).
  app.get('/drivers/:id/active-ride', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    return { ride: activeOf(id) };
  });

  /* ----------------------- Locations Signature ----------------------- */

  /**
   * Locations confiées à ce chauffeur (mariages, délégations, mise à disposition).
   * Il y trouve tout ce qu'il doit savoir avant de se présenter : le véhicule, la
   * période, le lieu, le contact sur place et les options à préparer (décoration,
   * tapis rouge, rafraîchissements…).
   */
  app.get('/drivers/:id/rentals', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    // Le chauffeur n'a pas à connaître le montant facturé au client ; il a besoin
    // de la prestation à assurer. Le prix reste à la console et au client.
    const rentals = container.rental.listByDriver(id).map(vueLocationChauffeur);
    return { rentals, total: rentals.length };
  });

  /**
   * Étape déclarée par le chauffeur sur SA location : véhicule préparé (décoration,
   * tapis rouge, rafraîchissements…), en route, sur place, début puis fin de service.
   * La console (session Location) voit l'avancement ; le dossier passe en cours puis terminé.
   */
  app.post('/drivers/:id/rentals/:rentalId/etape', async (req) => {
    const { id, rentalId } = req.params as { id: string; rentalId: string };
    requireDriver(req, id);
    const body = parse(z.object({ etape: z.enum(ETAPES_CHAUFFEUR), note: z.string().trim().max(200).optional() }), req.body);
    const r = container.rental.etapeChauffeur(rentalId, id, body.etape, body.note);
    const d = container.drivers.get(id);
    container.audit.log({ actor: d?.name ?? id, role: 'chauffeur', action: 'rental.etape_chauffeur', target: rentalId, details: { etape: body.etape } });
    return { rental: vueLocationChauffeur(r) };
  });

  /* --------------------------- Annulation chauffeur --------------------------- */

  /**
   * ANNULATION PAR LE CHAUFFEUR — motif obligatoire, tracé, et jamais à la charge du
   * passager (il annulait par la transition générique : frais facturés au client et
   * « annulation abusive » comptée contre lui, sans motif ni auteur).
   *  - Avant la prise en charge : la course repart vers un autre chauffeur, le passager
   *    garde son suivi et ne paie rien.
   *  - Client absent : seulement une fois arrivé ET après les minutes d'attente offertes ;
   *    la course est annulée et les frais console s'appliquent (no-show).
   *  - Course en cours : pas d'annulation (terminer la course ou SOS).
   */
  const MOTIFS_CHAUFFEUR = ['client_absent', 'client_injoignable', 'adresse_introuvable', 'vehicule_panne', 'securite', 'autre'] as const;
  app.post('/drivers/:id/rides/:rideId/cancel', async (req) => {
    const { id, rideId } = req.params as { id: string; rideId: string };
    requireDriver(req, id);
    const body = parse(z.object({ motif: z.enum(MOTIFS_CHAUFFEUR), details: z.string().trim().max(300).optional() }), req.body);
    const ride = container.rides.get(rideId);
    if (!ride || ride.driverId !== id) throw notFound('Course introuvable');
    if (!rideStateMachine.canTransition(ride.status, 'cancelled')) {
      throw badRequest(ride.status === 'in_progress'
        ? 'La course est en cours : terminez-la, ou utilisez le SOS en cas de danger.'
        : 'Cette course ne peut plus être annulée.');
    }
    const d = container.drivers.get(id)!;
    container.audit.log({
      actor: d.name, role: 'chauffeur', action: body.motif === 'securite' ? 'ride.cancel_chauffeur_securite' : 'ride.cancel_chauffeur',
      target: rideId, details: { motif: body.motif, details: body.details, status: ride.status },
    });
    // Qualité de service : les annulations du chauffeur sont comptées (sauf insécurité).
    if (body.motif !== 'securite') { d.cancellations = (d.cancellations ?? 0) + 1; container.drivers.persist(id); }

    if (body.motif === 'client_absent') {
      const arrivee = [...ride.events].reverse().find((e) => e.type === 'arrived');
      const attenteMin = arrivee ? (Date.now() - Date.parse(arrivee.at)) / 60_000 : 0;
      const offertes = container.settings.getPricing().freeWaitMinutes;
      if (ride.status !== 'arrived' || attenteMin < offertes) {
        throw badRequest(`« Client absent » : possible après ${offertes} min d’attente au point de prise en charge.`);
      }
      const frais = container.settings.getPricing().cancelFee;
      ride.status = 'cancelled';
      appendEvent(ride, 'cancelled', { by: 'chauffeur', motif: 'client_absent', details: body.details, frais, attenteMin: Math.round(attenteMin) });
      if (frais > 0) {
        appendEvent(ride, 'cancel_fee', { amount: frais, noShow: true, afterMinutes: Math.round(attenteMin) });
        const client = container.clients.get(ride.clientId);
        if (client) { client.noShowFees = (client.noShowFees ?? 0) + frais; container.clients.persist(ride.clientId); }
      }
      container.rides.persist(ride);
      container.matching.releaseLock(id);
      container.drivers.setAvailability(id, 'online');
      container.realtime.publish(rideRoom(ride.id), 'ride.status', { rideId: ride.id, status: 'cancelled', reason: 'client_absent' });
      container.notifications.notify({ clientId: ride.clientId }, 'Course annulée — passager absent',
        `Votre chauffeur vous a attendu ${Math.round(attenteMin)} min au point de prise en charge.${frais > 0 ? ` Frais d’absence : ${frais.toLocaleString('fr-FR')} F.` : ''}`);
      return { ok: true, reattribuee: false, frais };
    }

    // Autres motifs : le passager garde sa course, elle part vers un autre chauffeur.
    // (Motif de sécurité : tracé au journal comme côté client ; en danger, c'est le SOS.)
    const res = await offers.retirerChauffeur(ride, id, body.motif, body.details, body.motif === 'vehicule_panne');
    return { ok: true, reattribuee: res.reassignedTo !== null, frais: 0 };
  });

  /* ------------------------------ Offres ------------------------------ */

  // Accepter l'offre (dans le délai console) → course confirmée.
  app.post('/drivers/:id/offers/:rideId/accept', async (req) => {
    const { id, rideId } = req.params as { id: string; rideId: string };
    requireDriver(req, id);
    offers.accept(id, rideId);
    return { ride: activeOf(id) };
  });

  // Refuser l'offre → réattribution automatique au chauffeur suivant.
  app.post('/drivers/:id/offers/:rideId/decline', async (req) => {
    const { id, rideId } = req.params as { id: string; rideId: string };
    requireDriver(req, id);
    const body = parse(z.object({ reason: z.string().max(120).optional() }), req.body ?? {});
    const res = await offers.decline(id, rideId, body.reason);
    return { ok: true, reassigned: res.reassignedTo !== null };
  });

  /* ------------------------ Canal temps réel chauffeur ------------------------ */
  // GET /ws/drivers/:id?token=… — à la connexion : fiche, config publique (= GET /config),
  // config chauffeur (= GET /drivers/config), situation financière et course en cours.
  // Ensuite : tout ce qui concerne CE chauffeur (affectation, paiement reçu, notification,
  // message d'équipe, décision console), la config publique (`config.update`), la config
  // chauffeur (`driver-config.update`) et les annonces destinées aux chauffeurs.
  app.register(async (scoped) => {
    scoped.get('/ws/drivers/:id', { websocket: true }, (socket, req) => {
      const { id } = req.params as { id: string };
      const sub = verifyDriverToken(driverTokenOf(req));
      const driver = container.drivers.get(id);
      const send = (msg: unknown) => {
        try {
          socket.send(JSON.stringify(msg));
        } catch {
          /* socket en cours de fermeture */
        }
      };
      if (!sub || sub !== id || !driver) {
        send({ type: 'error', code: !sub ? 'UNAUTHORIZED' : 'FORBIDDEN', message: 'Session chauffeur invalide — reconnectez-vous', at: new Date().toISOString() });
        socket.close();
        return;
      }

      send({
        type: 'connected',
        room: driverRoom(id),
        driver,
        config: { ...container.settings.getServices(), currency: 'XOF' },
        driverConfig: driverAppConfig(container.settings),
        finance: financeFor(container, driver),
        activeRide: activeOf(id),
        at: new Date().toISOString(),
      });

      const relay = (msg: RealtimeMessage) => send(msg);
      // Suivi de la course en cours : les événements de sa room (annulation client,
      // statuts, réattribution, SOS) sont relayés sur ce même canal — une seule
      // connexion côté app. Sa propre position est filtrée (déjà connue de l'app).
      let rideUnsub: (() => void) | null = null;
      let followed: string | null = null;
      const follow = (rideId: string | null) => {
        if (rideId === followed) return;
        rideUnsub?.();
        rideUnsub = null;
        followed = rideId;
        if (rideId) rideUnsub = container.realtime.subscribe(rideRoom(rideId), (msg) => { if (msg.type !== 'driver.location') relay(msg); });
      };
      follow(activeOf(id)?.id ?? null);
      const unsubs = [
        container.realtime.subscribe(driverRoom(id), (msg) => {
          if (msg.type === 'driver.location') return;
          relay(msg);
          if (msg.type === 'ride.assigned') follow((msg.data as { ride: { id: string } }).ride.id);
          if (msg.type === 'ride.withdrawn' && (msg.data as { rideId: string }).rideId === followed) follow(null);
        }),
        container.realtime.subscribe(CONFIG_ROOM, relay),
        container.realtime.subscribe(DRIVER_CONFIG_ROOM, relay),
        container.realtime.subscribe(ANNOUNCE_ROOM, (msg) => {
          const aud = (msg.data as { audience?: string } | undefined)?.audience;
          if (aud === 'drivers' || aud === 'all') relay(msg);
        }),
      ];

      const heartbeat = setInterval(() => {
        try {
          socket.ping();
        } catch {
          /* ignore */
        }
      }, 30_000);
      heartbeat.unref?.();

      socket.on('close', () => {
        clearInterval(heartbeat);
        for (const u of unsubs) u();
        follow(null);
      });
    });
  });
}

/**
 * Garde d'accès des routes chauffeur EXISTANTES (sans les réécrire) :
 *  - jeton chauffeur présenté → il doit correspondre au chauffeur visé (sinon 403) ;
 *  - aucun jeton → accepté (compatibilité), SAUF en mode strict (DRIVER_AUTH_STRICT).
 * Sur les routes de course, un jeton chauffeur ne peut agir que sur SES courses.
 */
const DRIVER_SCOPED = /^\/drivers\/([^/?#]+)\/(online|offline|location|telemetry|profile|payout|training|wallet|queue)(?:[/?#]|$)/;
const RIDE_SCOPED = /^\/rides\/([^/?#]+)\/(transition|wait|sos|pay)(?:[/?#]|$)/;

export function registerDriverGuard(app: FastifyInstance, container: Container): void {
  app.addHook('onRequest', async (req) => {
    const d = DRIVER_SCOPED.exec(req.url);
    if (d) {
      const id = decodeURIComponent(d[1]!);
      if (!driverTokenOf(req)) {
        if (config.DRIVER_AUTH_STRICT) throw unauthorized('Connexion chauffeur requise');
        return;
      }
      requireDriver(req, id);
      return;
    }
    const r = RIDE_SCOPED.exec(req.url);
    if (r) {
      const token = driverTokenOf(req);
      if (!token) return; // app cliente / supervision : inchangé
      const sub = verifyDriverToken(token);
      if (!sub) throw unauthorized('Session chauffeur absente ou expirée — reconnectez-vous');
      const ride = container.rides.get(decodeURIComponent(r[1]!));
      if (ride && ride.driverId !== sub) throw forbidden('Cette course ne vous est pas attribuée');
    }
  });
}
