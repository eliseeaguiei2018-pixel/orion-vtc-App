import { configPublique } from './configPublique.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { exigerTitulaire } from '../clients/auth.js';
import { parse } from '../../core/validate.js';
import { notFound } from '../../core/errors.js';
import { normalizePhone } from '../driver-app/auth.js';

/**
 * Endpoints SUPPORT côté client (app cliente) + config publique.
 * Le client ouvre une conversation et échange avec les agents ORION (chat).
 */
export async function supportClientRoutes(app: FastifyInstance, container: Container): Promise<void> {
  /** Données d'un client : un compte inscrit doit présenter sa propre session. */
  const titulaire = (req: FastifyRequest, id: string) =>
    exigerTitulaire(req, id, (c) => Boolean(container.clients.get(c)?.phoneVerifiedAt));

  // Config publique : services activés + ville ouverte (l'app cliente adapte son hub).
  // codeWhatsApp : l'app propose « Recevoir le code via WhatsApp » seulement si le serveur sait l'envoyer.
  app.get('/config', async () => configPublique(container));

  /**
   * FICHE CLIENT — enregistrée depuis l'app après vérification du numéro.
   *
   * Le client saisissait son nom et son téléphone à l'inscription, et rien n'était
   * conservé côté serveur : la console affichait « client-8842 » sans aucun moyen de
   * le joindre. Un support qui ne peut pas rappeler n'est pas un support.
   */
  app.post('/clients/profile', async (req) => {
    const body = parse(
      z.object({
        clientId: z.string().min(1).max(64),
        name: z.string().min(1).max(80).optional(),
        phone: z.string().min(8).max(20).optional(),
      }),
      req.body,
    );
    // Normalisation ivoirienne : « 07 08 09 10 11 » et « +2250708091011 » sont le
    // même numéro — sans cela, deux fiches cohabitent pour une seule personne.
    // On réutilise LE normaliseur de la plateforme : deux implémentations finiraient
    // par diverger, et le même numéro donnerait deux fiches pour une seule personne.
    // Le nom et le numéro d'un compte inscrit ne se changent qu'avec SA session : sans
    // cela, connaître l'identifiant suffisait à détourner le numéro d'un client.
    titulaire(req, body.clientId);
    const phone = body.phone ? (normalizePhone(body.phone) ?? undefined) : undefined;
    const client = container.clients.touch(body.clientId, { name: body.name, phone });
    return { client: { id: client.id, name: client.name ?? null, phone: client.phone ?? null } };
  });

  // Annonces publiques (bannière app cliente).
  app.get('/announcements', async () => ({ announcements: container.notifications.forAudience('clients') }));

  // Le client démarre / poursuit une conversation.
  app.post('/support/messages', async (req, reply) => {
    const body = parse(
      z.object({ clientId: z.string().min(1), subject: z.string().optional(), text: z.string().min(1).max(2000) }),
      req.body,
    );
    titulaire(req, body.clientId);
    container.clients.touch(body.clientId);
    const conv = container.support.openFromClient(body);
    reply.code(201);
    return { conversation: conv };
  });

  // Le client consulte ses conversations.
  app.get('/clients/:clientId/support', async (req) => {
    const { clientId } = req.params as { clientId: string };
    exigerTitulaire(req, clientId, (c) => Boolean(container.clients.get(c)?.phoneVerifiedAt));
    return { conversations: container.support.listByClient(clientId) };
  });

  // Le client répond dans une conversation existante.
  app.post('/support/:id/reply', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ text: z.string().min(1).max(2000) }), req.body);
    const msg = container.support.post(id, { from: 'client', text: body.text });
    if (!msg) throw notFound('Conversation introuvable');
    return { message: msg };
  });

  // Satisfaction post-résolution (CSAT 1–5) — alimente les indicateurs des agents.
  app.post('/support/:id/csat', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ stars: z.number().int().min(1).max(5) }), req.body);
    const conv = container.support.rateCsat(id, body.stars);
    if (!conv) throw notFound('Conversation introuvable');
    return { conversation: { id: conv.id, csat: conv.csat } };
  });
}
