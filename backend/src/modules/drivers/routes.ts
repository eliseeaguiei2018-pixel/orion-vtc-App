import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import { notFound } from '../../core/errors.js';
import { driverRoom, rideRoom } from '../realtime/hub.js';
import { genMatricule } from './store.js';

const registerSchema = z.object({
  name: z.string().min(1),
  category: z.string().default('bronze'),
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
    if (!container.drivers.get(id)) throw notFound('Chauffeur introuvable');
    const body = parse(onlineSchema, req.body);
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
    }), req.body);
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    if (body.engine) d.engine = body.engine;
    if (body.batteryPct !== undefined) d.batteryPct = Math.round(body.batteryPct);
    container.drivers.persist(id);
    return { ok: true, engine: d.engine ?? null, batteryPct: d.batteryPct ?? null };
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
    }), req.body);
    const d = container.drivers.get(id);
    if (!d) throw notFound('Chauffeur introuvable');
    if (body.vehicleModel) d.vehicleModel = body.vehicleModel;
    if (body.insuranceExpiry) d.insuranceExpiry = body.insuranceExpiry;
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
