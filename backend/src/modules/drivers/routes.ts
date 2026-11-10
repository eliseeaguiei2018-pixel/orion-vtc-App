import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import { conflict, forbidden, notFound } from '../../core/errors.js';
import { config } from '../../config/index.js';
import { fromDriverApp } from '../driver-app/auth.js';
import { driverRoom, rideRoom } from '../realtime/hub.js';
import { genMatricule } from './store.js';
import { normalizePhone } from '../driver-app/auth.js';

const registerSchema = z.object({
  name: z.string().min(1),
  category: z.string().default('bronze'),
  /**
   * Numéro du chauffeur. Il était impossible à renseigner à la création : seuls les
   * chauffeurs inscrits eux-mêmes par OTP en avaient un, et la console affichait les
   * autres sans aucun moyen de les joindre.
   */
  phone: z.string().min(8).max(20).optional(),
});

const onlineSchema = z.object({ position: latLng });
const locationSchema = z.object({ position: latLng });

export async function driverRoutes(app: FastifyInstance, container: Container): Promise<void> {
  app.post('/drivers', async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const driver = container.drivers.upsert({
      id: randomUUID(),
      name: body.name,
      matricule: genMatricule(),
      category: body.category,
      kycStatus: 'draft',
      availability: 'offline',
      ratingAvg: 0,
      ratingCount: 0,
      phone: (body.phone ? normalizePhone(body.phone) : undefined) ?? undefined,
    });
    reply.code(201);
    return { driver };
  });

  app.get('/drivers/:id', async (req) => {
    const { id } = req.params as { id: string };
    const driver = container.drivers.get(id);
    if (!driver) throw notFound('Chauffeur introuvable');
    return { driver };
  });

  // Activation de la disponibilité (passage en ligne) + publication de la position.
  app.post('/drivers/:id/online', async (req) => {
    const { id } = req.params as { id: string };
    const drv = container.drivers.get(id);
    if (!drv) throw notFound('Chauffeur introuvable');
    const body = parse(onlineSchema, req.body);
    // Garde-fous (synchro console) : compte suspendu → motif affiché ; ORION fermé
    // (maintenance) → aucune mise en ligne.
    if (drv.kycStatus === 'suspended') {
      throw forbidden(`Compte suspendu par ORION${drv.suspensionReason ? ` : ${drv.suspensionReason}` : ''}`);
    }
    if (!container.settings.getServices().open) {
      throw conflict('ORION est momentanément fermé (maintenance) — mise en ligne impossible');
    }
    // Depuis l'app chauffeur (ou en mode strict) : dossier VALIDÉ par ORION exigé.
    if ((config.DRIVER_AUTH_STRICT || fromDriverApp(req)) && drv.kycStatus !== 'approved' && drv.kycStatus !== 'active') {
      throw forbidden('Dossier en cours de validation par ORION — mise en ligne possible après validation');
    }
    await container.drivers.goOnline(id, body.position);
    return { status: 'online' };
  });

  app.post('/drivers/:id/offline', async (req) => {
    const { id } = req.params as { id: string };
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    await container.drivers.goOffline(id);
    container.matching.releaseLock(id);
    return { status: 'offline' };
  });

  // Heartbeat de position (renouvelle le TTL de présence).
  app.post('/drivers/:id/location', async (req) => {
    const { id } = req.params as { id: string };
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    const body = parse(locationSchema, req.body);
    await container.drivers.updateLocation(id, body.position);

    // Diffusion temps réel : suivi précis côté client (room de la course active).
    container.realtime.publish(driverRoom(id), 'driver.location', { driverId: id, position: body.position });
    const activeRide = container.rides.findActiveByDriver(id);
    if (activeRide) {
      container.realtime.publish(rideRoom(activeRide.id), 'driver.location', {
        driverId: id,
        position: body.position,
      });
    }
    return { status: 'updated' };
  });
}

/* Télémétrie flotte verte : l'app chauffeur remonte motorisation et niveau de
   batterie (SoC). L'algorithme exclut du dispatch les électriques dont
   l'autonomie ne couvre pas la course demandée. */
export async function greenTelemetryRoutes(app: import('fastify').FastifyInstance, container: import('../../container.js').Container): Promise<void> {
  app.post('/drivers/:id/telemetry', async (req) => {
    const { id } = req.params as { id: string };
    const { z } = await import('zod');
    const { parse } = await import('../../core/validate.js');
    const { notFound } = await import('../../core/errors.js');
    const body = parse(z.object({
      engine: z.enum(['electric', 'hybrid']).optional(),
      batteryPct: z.number().min(0).max(100).optional(),
      /** Santé de la batterie (SoH %) — dégradation long terme, planification maintenance. */
      batteryHealthPct: z.number().min(0).max(100).optional(),
    }), req.body);
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    if (body.engine) d.engine = body.engine;
    if (body.batteryPct !== undefined) d.batteryPct = Math.round(body.batteryPct);
    if (body.batteryHealthPct !== undefined) d.batteryHealthPct = Math.round(body.batteryHealthPct);
    container.drivers.persist(id);
    return { ok: true, engine: d.engine ?? null, batteryPct: d.batteryPct ?? null, batteryHealthPct: d.batteryHealthPct ?? null };
  });

  /**
   * Position dans la file d'attente FIFO (zones denses type aéroport) :
   * « Vous êtes 12ᵉ sur 45 » — ordre strict d'ancienneté d'attente.
   */
  app.get('/drivers/:id/queue', async (req) => {
    const { id } = req.params as { id: string };
    const { notFound } = await import('../../core/errors.js');
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    const online = container.drivers.list()
      .filter((d) => d.availability === 'online')
      .sort((a, b) => (a.idleSince ?? '9999').localeCompare(b.idleSince ?? '9999'));
    const idx = online.findIndex((d) => d.id === id);
    return { inQueue: idx >= 0, position: idx >= 0 ? idx + 1 : null, total: online.length };
  });

  // Dossier véhicule (CRM flotte) : modèle + expiration d'assurance.
  app.post('/drivers/:id/profile', async (req) => {
    const { id } = req.params as { id: string };
    const { z } = await import('zod');
    const { parse } = await import('../../core/validate.js');
    const { notFound } = await import('../../core/errors.js');
    const body = parse(z.object({
      vehicleModel: z.string().min(2).max(60).optional(),
      insuranceExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      /* Dossier d'identification (transmission SAMU / police). */
      phone: z.string().min(6).max(20).optional(),
      licenseNo: z.string().min(3).max(30).optional(),
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      vehiclePlate: z.string().min(3).max(15).optional(),
      vehicleColor: z.string().min(3).max(20).optional(),
      /* Conformité éco-responsable + vérif fiscale/bancaire (session Chauffeur). */
      batteryKwh: z.number().min(0).max(300).optional(),
      plugType: z.string().min(2).max(20).optional(),
      cablesConfirmed: z.boolean().optional(),
      ribVerified: z.boolean().optional(),
      nif: z.string().min(3).max(40).optional(),
    }), req.body);
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    if (body.vehicleModel) d.vehicleModel = body.vehicleModel;
    if (body.insuranceExpiry) d.insuranceExpiry = body.insuranceExpiry;
    if (body.phone) d.phone = body.phone;
    if (body.licenseNo) d.licenseNo = body.licenseNo;
    if (body.birthDate) d.birthDate = body.birthDate;
    if (body.vehiclePlate) d.vehiclePlate = body.vehiclePlate;
    if (body.vehicleColor) d.vehicleColor = body.vehicleColor;
    if (body.batteryKwh !== undefined) d.batteryKwh = body.batteryKwh;
    if (body.plugType) d.plugType = body.plugType;
    if (body.cablesConfirmed !== undefined) d.cablesConfirmed = body.cablesConfirmed;
    if (body.ribVerified !== undefined) d.ribVerified = body.ribVerified;
    if (body.nif) d.nif = body.nif;
    container.drivers.persist(id);
    return { ok: true };
  });

  /**
   * Module d'engagement & éco-conduite : le chauffeur visionne la vidéo des
   * standards ORION (app chauffeur) puis valide un QCM — ≥ 3/4 requis.
   * Les bonnes réponses restent CÔTÉ SERVEUR.
   */
  const ECO_QCM = [
    { q: 'Pour préserver la batterie, la conduite idéale est…', options: ['Accélérations franches', 'Souple et anticipative', 'Vitesse maximale constante'], answer: 1 },
    { q: 'Le freinage régénératif sert à…', options: ['User les plaquettes', 'Recharger la batterie en décélérant', 'Faire du bruit'], answer: 1 },
    { q: 'Avant une course « Mobilité Verte », je vérifie…', options: ['Mon niveau de batterie (SoC)', 'La radio', 'Rien'], answer: 0 },
    { q: 'Le standard d’accueil ORION impose…', options: ['Téléphone au volant', 'Véhicule propre, salutation, aide bagages', 'Musique forte'], answer: 1 },
  ];

  // Contenu du module (l'app chauffeur affiche la vidéo puis les questions).
  app.get('/training/eco', async () => ({
    title: 'Standards ORION & éco-conduite',
    videoUrl: '/assets/training/eco-conduite.mp4',
    questions: ECO_QCM.map(({ q, options }) => ({ q, options })), // sans les réponses
    passScore: 3,
  }));

  // Validation du QCM : ≥ 3/4 → chauffeur certifié (trained).
  app.post('/drivers/:id/training', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { z } = await import('zod');
    const { parse } = await import('../../core/validate.js');
    const { notFound } = await import('../../core/errors.js');
    const body = parse(z.object({ answers: z.array(z.number().int().min(0).max(3)).length(ECO_QCM.length) }), req.body);
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    const score = ECO_QCM.reduce((s, item, i) => s + (body.answers[i] === item.answer ? 1 : 0), 0);
    const passed = score >= 3;
    if (passed) { d.trained = true; container.drivers.persist(id); }
    reply.code(passed ? 200 : 400);
    return { score, total: ECO_QCM.length, passed, trained: d.trained ?? false };
  });
}
