import type { FastifyInstance, FastifyRequest } from 'fastify';
import { exigerTitulaire } from '../clients/auth.js';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { latLng, parse } from '../../core/validate.js';
import { notFound } from '../../core/errors.js';
import { EMERGENCY_NUMBERS, vueUsager } from './service.js';
import { accesPersonnel } from '../admin/acces-hors-console.js';

export async function safetyRoutes(app: FastifyInstance, container: Container): Promise<void> {
  /** Données d'un client : un compte inscrit doit présenter sa propre session. */
  const titulaire = (req: FastifyRequest, id: string) =>
    exigerTitulaire(req, id, (c) => Boolean(container.clients.get(c)?.phoneVerifiedAt));

  app.get('/safety/emergency-numbers', async () => ({ numbers: EMERGENCY_NUMBERS }));

  // SOS manuel.
  app.post('/safety/sos', async (req, reply) => {
    const body = parse(
      z.object({
        userId: z.string().min(1), location: latLng, rideId: z.string().optional(), note: z.string().optional(),
        /** Langue de l'app : l'agent automatique répond en français ou en anglais. */
        langue: z.string().max(5).optional(),
      }),
      req.body,
    );
    const alert = container.safety.raiseSos({ ...body, langue: body.langue?.startsWith('en') ? 'en' : 'fr' });
    reply.code(201);
    // `suivi` : ce que l'usager voit de son alerte, puis reçoit en direct (/ws/sos/:id).
    return { alert, suivi: vueUsager(alert) };
  });

  /**
   * SUIVI DE SON ALERTE par la personne qui l'a déclenchée : prise en charge,
   * messages de l'agent, secours réellement prévenus. Réservé à son auteur — une
   * autre personne obtient 404, sans apprendre que l'alerte existe.
   */
  app.get('/safety/sos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { userId } = parse(z.object({ userId: z.string().min(1) }), req.query);
    titulaire(req, userId);
    const suivi = container.safety.suiviPour(id, userId);
    if (!suivi || suivi === 'interdit') { reply.code(404); return { error: 'Alerte introuvable' }; }
    return { suivi };
  });

  /** Réponse de l'usager à l'agent (chat discret). */
  app.post('/safety/sos/:id/message', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ userId: z.string().min(1), text: z.string().trim().min(1).max(300) }), req.body);
    titulaire(req, body.userId);
    const suivi = container.safety.suiviPour(id, body.userId);
    if (!suivi || suivi === 'interdit') { reply.code(404); return { error: 'Alerte introuvable' }; }
    if (suivi.clotureeA) {
      reply.code(409);
      return { error: `Cette alerte est clôturée. En cas de nouveau danger, relancez un SOS ou appelez le ${EMERGENCY_NUMBERS.samu}.` };
    }
    container.safety.postChat(id, { from: 'usager', text: body.text });
    return { suivi: container.safety.suiviPour(id, body.userId) };
  });

  // Flux capteurs (accéléromètre) → détection automatique d'accident.
  app.post('/safety/sensor', async (req) => {
    const body = parse(
      z.object({
        userId: z.string().min(1),
        location: latLng,
        rideId: z.string().optional(),
        sample: z.object({
          ax: z.number(),
          ay: z.number(),
          az: z.number(),
          speedKmh: z.number().optional(),
        }),
      }),
      req.body,
    );
    const alert = container.safety.ingestSensor(body);
    return { crashDetected: alert !== null, alert };
  });

  // Liste brute des alertes : supervision uniquement (positions de personnes en détresse).
  app.get('/safety/alerts', async (req, reply) => {
    const acces = accesPersonnel(req, 'alerts:read');
    if (!acces.ok) { reply.code(acces.code); return { error: acces.message }; }
    return { alerts: container.safety.list(300) };
  });

  // Changement de statut : supervision uniquement — publique, cette route permettait
  // à n'importe qui de marquer une détresse « résolue » et de la sortir de la file.
  app.post('/safety/alerts/:id/status', async (req, reply) => {
    const acces = accesPersonnel(req, 'alerts:write');
    if (!acces.ok) { reply.code(acces.code); return { error: acces.message }; }
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({ status: z.enum(['raised', 'dispatched', 'acknowledged', 'resolved', 'cancelled']) }),
      req.body,
    );
    const alert = container.safety.updateStatus(id, body.status);
    if (!alert) throw notFound('Alerte introuvable');
    return { alert };
  });
}
