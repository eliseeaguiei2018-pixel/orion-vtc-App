import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { config } from '../../config/index.js';
import { parse } from '../../core/validate.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../../core/errors.js';
import { CONFIG_ROOM, DRIVER_CONFIG_ROOM, driverRoom, type RealtimeMessage } from '../realtime/hub.js';
import { ANNOUNCE_ROOM } from '../notifications/service.js';
import { effectiveCommissionRate } from '../wallet/service.js';
import { genMatricule, type Driver } from '../drivers/store.js';
import type { Ride } from '../rides/store.js';
import { driverAppConfig } from './config.js';
import {
  OtpStore, driverTokenOf, issueDriverToken, normalizePhone, requireDriver, verifyDriverToken,
} from './auth.js';

/** Statuts de course « actifs » côté chauffeur (mission en cours). */
const ACTIVE = new Set(['accepted', 'driver_en_route', 'arrived', 'in_progress', 'completed']);

/** Masque un numéro pour les journaux (jamais de numéro complet dans les logs). */
const maskPhone = (p: string) => p.replace(/\d(?=\d{2})/g, '•');

/** Début de journée locale Abidjan (UTC+0, pas d'heure d'été). */
const startOfDay = (d = new Date()) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Vue d'une course POUR LE CHAUFFEUR : trajet, montant, moyen de paiement, et surtout
 * ce que la course lui a rapporté (ledger) — gain net, bonus, commission, espèces.
 */
export function driverRideView(ride: Ride, container: Container, driverId: string) {
  const entries = container.wallet.history(driverId).filter((e) => e.rideId === ride.id);
  const sum = (types: string[]) => entries.filter((e) => types.includes(e.type)).reduce((s, e) => s + e.amount, 0);
  const paid = ride.events.find((e) => e.type === 'paid')?.payload as { method?: string; amount?: number } | undefined;
  const rated = ride.events.find((e) => e.type === 'rated')?.payload as { stars?: number; comment?: string } | undefined;
  const last = ride.events[ride.events.length - 1];
  return {
    id: ride.id,
    status: ride.status,
    serviceType: ride.serviceType,
    category: ride.quote.category,
    origin: ride.origin,
    destination: ride.destination,
    stops: ride.quote.stops ?? [],
    distanceMeters: ride.quote.distanceMeters,
    etaSeconds: ride.quote.etaSeconds,
    amount: ride.quote.amount,
    waitMinutes: ride.waitMinutes ?? 0,
    paymentMethod: paid?.method ?? ride.paymentMethod ?? null,
    paidAmount: paid?.amount ?? null,
    earnings: {
      net: Math.round(sum(['ride_earning'])),
      bonus: Math.round(sum(['adjustment'])),
      commission: Math.round(-sum(['commission'])),
      cashCollected: Math.round(-sum(['cash_collected'])),
    },
    rating: rated?.stars ?? null,
    createdAt: ride.createdAt,
    updatedAt: last?.at ?? ride.createdAt,
  };
}

/** Totaux de gains sur une période (courses payées). */
function totals(views: ReturnType<typeof driverRideView>[], sinceMs: number) {
  const rows = views.filter((v) => v.paidAmount !== null && Date.parse(v.updatedAt) >= sinceMs);
  return {
    rides: rows.length,
    gross: rows.reduce((s, v) => s + (v.paidAmount ?? 0), 0),
    net: rows.reduce((s, v) => s + v.earnings.net + v.earnings.bonus, 0),
    commission: rows.reduce((s, v) => s + v.earnings.commission, 0),
    cashCollected: rows.reduce((s, v) => s + v.earnings.cashCollected, 0),
  };
}

/** Course en cours du chauffeur, enrichie (client, secteur de prise en charge). */
export function activeRideFor(container: Container, driverId: string) {
  const ride = container.rides.listByDriver(driverId).find((r) => ACTIVE.has(r.status));
  if (!ride) return null;
  const client = container.clients.get(ride.clientId);
  const zone = container.settings.zoneForPoint(ride.origin);
  return {
    ...driverRideView(ride, container, driverId),
    events: ride.events.map((e) => ({ type: e.type, at: e.at })),
    // Coordonnées du passager : visibles UNIQUEMENT pendant la mission.
    client: { id: ride.clientId, name: client?.name ?? null, phone: client?.phone ?? null, rides: client?.rides ?? 0 },
    pickupZone: zone ? { id: zone.id, name: zone.name, driverBonus: zone.driverBonus ?? 0 } : null,
  };
}

/** Situation financière synthétique (solde, dette espèces, taux appliqué). */
export function financeFor(container: Container, driver: Driver) {
  const ops = container.settings.getOps();
  const balance = Math.round(container.wallet.balance(driver.id));
  const debt = balance < 0 ? -balance : 0;
  return {
    balance,
    cashDebt: debt,
    cashDebtLimit: ops.cashDebtLimit,
    /** Au-delà du plafond : plus de courses payées en espèces (règle console). */
    cashBlocked: debt > ops.cashDebtLimit,
    commissionRate: effectiveCommissionRate(driver, ops),
    frozen: container.wallet.isFrozen(driver.id),
  };
}

export async function driverAppRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const otps = new OtpStore();

  /* ------------------------------ Connexion ------------------------------ */

  // Étape 1 : le chauffeur saisit son numéro → code à 6 chiffres envoyé par SMS.
  app.post('/drivers/auth/otp', async (req) => {
    const body = parse(z.object({ phone: z.string().min(6).max(25) }), req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest('Numéro de téléphone invalide');
    const issued = otps.issue(phone);
    if ('retryInSeconds' in issued) {
      throw new AppError(429, 'RATE_LIMITED', `Code déjà envoyé — réessayez dans ${issued.retryInSeconds} s`);
    }
    // Opérateur SMS à brancher en production (Orange / MTN / Moov) : on ne journalise
    // jamais le code ni le numéro complet.
    req.log.info({ phone: maskPhone(phone) }, 'Code de connexion chauffeur émis');
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
      category: z.enum(['bronze', 'argent', 'or', 'diamant']).optional(),
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

  /* --------------------------- Courses & gains --------------------------- */

  // Historique des courses + totaux du jour et des 7 derniers jours.
  app.get('/drivers/:id/rides', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const driver = container.drivers.get(id);
    if (!driver) throw notFound('Chauffeur introuvable');
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query ?? {});
    const views = container.rides.listByDriver(id).map((r) => driverRideView(r, container, id));
    const today = startOfDay();
    return {
      rides: views.slice(0, q.limit),
      total: views.length,
      today: totals(views, today),
      week: totals(views, today - 6 * 86_400_000),
      finance: financeFor(container, driver),
    };
  });

  // Course en cours (reprise après fermeture de l'app, perte réseau…).
  app.get('/drivers/:id/active-ride', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    return { ride: activeRideFor(container, id) };
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
        activeRide: activeRideFor(container, id),
        at: new Date().toISOString(),
      });

      const relay = (msg: RealtimeMessage) => send(msg);
      const unsubs = [
        // Sa propre position lui est inutile (déjà connue de l'app) : filtrée.
        container.realtime.subscribe(driverRoom(id), (msg) => { if (msg.type !== 'driver.location') relay(msg); }),
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
const RIDE_SCOPED = /^\/rides\/([^/?#]+)\/(transition|wait|sos)(?:[/?#]|$)/;

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

/** Utilisé par la route de mise en ligne : la requête vient-elle de l'app chauffeur ? */
export function fromDriverApp(req: import('fastify').FastifyRequest): boolean {
  return verifyDriverToken(driverTokenOf(req)) !== null;
}

/** Diffuse l'affectation d'une course au chauffeur (room personnelle). */
export function publishAssignment(container: Container, ride: Ride, etaSeconds?: number): void {
  if (!ride.driverId) return;
  container.realtime.publish(driverRoom(ride.driverId), 'ride.assigned', {
    ride: driverRideView(ride, container, ride.driverId),
    etaToPickupSeconds: etaSeconds ?? null,
    // Le canal de suivi de la course (positions, statuts, annulation client) reste
    // le canal existant /ws/rides/:id, partagé avec l'app cliente.
    rideChannel: `/ws/rides/${ride.id}`,
  });
}
