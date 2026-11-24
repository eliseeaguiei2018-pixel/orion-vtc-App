import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { AppError, notFound } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { parse } from '../../core/validate.js';
import type { Permission } from '../admin/roles.js';
import { requireDriver } from '../driver-app/auth.js';
import { courseDuChauffeur } from '../rides/bienvenue.js';
import { participant } from '../rides/courseLive.js';
import type { Ride } from '../rides/store.js';
import { SERVICES_GOOGLE, servicesGoogle, type ServiceGoogle } from './services.js';

/**
 * Routes des services Google du serveur : météo du chauffeur, image du trajet (client,
 * chauffeur, console), photo du point de prise en charge (chauffeur), réglages console.
 * Les images passent par le serveur : la clé Google ne quitte jamais le serveur.
 */

const image = (reply: FastifyReply, i: { octets: Buffer; type: string }) => {
  reply.header('content-type', i.type);
  reply.header('cache-control', 'private, max-age=86400');
  return reply.send(i.octets);
};
const indisponible = (quoi: string) => new AppError(404, 'GOOGLE_INDISPONIBLE', `${quoi} indisponible pour le moment`);

/** Recale le tracé d'une course terminée et l'enregistre (sans bloquer : appelé en arrière-plan). */
export async function recalerCourse(container: Container, ride: Ride): Promise<boolean> {
  const trace = (ride.trace ?? []).slice(ride.traceDepart ?? 0);
  if (trace.length < 2) return false;
  const r = await servicesGoogle(container).recaler(trace);
  if (!r) return false;
  ride.recalage = r;
  container.rides.persist(ride);
  return true;
}

export async function servicesGoogleRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const course = (id: string) => {
    const r = container.rides.get(id);
    if (!r) throw notFound('Course introuvable');
    return r;
  };

  // Course arrivée : son tracé GPS est recalé sur les routes, en arrière-plan.
  container.realtime.subscribeAll?.((m) => {
    if (m.type !== 'ride.status') return;
    const d = m.data as { rideId?: string; status?: string };
    if (d.status !== 'completed' || !d.rideId) return;
    const ride = container.rides.get(d.rideId);
    if (!ride || ride.recalage || !servicesGoogle(container).actif('recalage')) return;
    void recalerCourse(container, ride).catch((e) => logger.warn({ err: e instanceof Error ? e.message : e, rideId: ride.id }, 'recalage GPS impossible'));
  });

  /** ORION Pro : météo de la commune du chauffeur et pluie attendue ailleurs (3 h). */
  app.get('/drivers/:id/meteo', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const q = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), req.query ?? {});
    return { meteo: await servicesGoogle(container).meteoChauffeur(q) };
  });

  /** Image du trajet, pour le client et le chauffeur de la course. */
  app.get('/rides/:id/carte.jpg', async (req, reply) => {
    const ride = course((req.params as { id: string }).id);
    participant(req, ride);
    const i = await servicesGoogle(container).carteTrajet(ride);
    if (!i) throw indisponible('Carte du trajet');
    return image(reply, i);
  });

  /** ORION Pro : Google a-t-il une photo de la rue où attend le client ? */
  app.get('/rides/:id/point-de-rencontre', async (req) => {
    const ride = courseDuChauffeurEnApproche(req, container);
    return servicesGoogle(container).streetViewDispo(ride.origin);
  });
  app.get('/rides/:id/point-de-rencontre.jpg', async (req, reply) => {
    const ride = courseDuChauffeurEnApproche(req, container);
    const i = await servicesGoogle(container).streetViewImage(ride.origin);
    if (!i) throw indisponible('Photo du point de prise en charge');
    return image(reply, i);
  });
}

function courseDuChauffeurEnApproche(req: FastifyRequest, container: Container): Ride {
  // Même contrôle que l'accueil vocal (chauffeur de la course), livraisons comprises ici.
  const { id } = req.params as { id: string };
  const ride = container.rides.get(id);
  if (ride?.serviceType === 'delivery') {
    participant(req, ride);
    return ride;
  }
  return courseDuChauffeur(req, container, ['accepted', 'driver_en_route', 'arrived']);
}

/** Console : état des services, coupure/remise en service, météo de la ville, carte d'une course. */
export function servicesGoogleAdminRoutes(
  scoped: FastifyInstance,
  container: Container,
  exiger: (req: FastifyRequest, perm: Permission) => void,
  journaliser: (req: FastifyRequest, action: string, target?: string, details?: Record<string, unknown>) => void,
): void {
  scoped.get('/admin/services-google', async (req) => {
    exiger(req, 'services:read');
    return servicesGoogle(container).etat();
  });
  scoped.put('/admin/services-google', async (req) => {
    exiger(req, 'services:write');
    const b = parse(z.object({ actifs: z.object(Object.fromEntries(SERVICES_GOOGLE.map((s) => [s, z.boolean().optional()])) as Record<ServiceGoogle, z.ZodOptional<z.ZodBoolean>>) }), req.body);
    const acteur = (req as unknown as { admin?: { name?: string } }).admin?.name ?? 'console';
    servicesGoogle(container).reglerActifs(b.actifs, acteur);
    journaliser(req, 'services_google.update', 'services', b.actifs);
    return servicesGoogle(container).etat();
  });
  scoped.get('/admin/meteo', async (req) => {
    exiger(req, 'services:read');
    return { communes: await servicesGoogle(container).meteoCommunes() };
  });
  scoped.get('/admin/courses/:id/carte.jpg', async (req, reply) => {
    exiger(req, 'rides:read');
    const ride = container.rides.get((req.params as { id: string }).id);
    if (!ride) throw notFound('Course introuvable');
    const i = await servicesGoogle(container).carteTrajet(ride);
    if (!i) throw indisponible('Carte du trajet');
    return image(reply, i);
  });
  /** Recaler une course terminée à la demande (anciennes courses, litige). */
  scoped.post('/admin/courses/:id/recaler', async (req) => {
    exiger(req, 'rides:write');
    const ride = container.rides.get((req.params as { id: string }).id);
    if (!ride) throw notFound('Course introuvable');
    if (!servicesGoogle(container).actif('recalage')) throw new AppError(409, 'GOOGLE_INDISPONIBLE', 'Recalage GPS coupé ou clé Google absente');
    if (!(await recalerCourse(container, ride))) throw new AppError(422, 'RECALAGE_IMPOSSIBLE', 'Tracé GPS trop court ou refusé par Google');
    journaliser(req, 'course.recalage', ride.id);
    return { recalage: ride.recalage };
  });
}
